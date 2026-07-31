import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { parseSyncManifest, type SyncManifest } from "./sync-profile";
import { planBundledSkillExport, type SyncExportFinding } from "./sync-export";

export type SyncRestoreAction = "create" | "unchanged" | "conflict";

export type SyncRestoreEntry = {
	id: string;
	sourcePath: string;
	targetPath: string;
	action: SyncRestoreAction;
	remoteSha256: string;
	localSha256: string | null;
};

export type SyncRestorePlan = {
	manifest: SyncManifest;
	entries: SyncRestoreEntry[];
	secretFindings: SyncExportFinding[];
};

/**
 * Reads a fetched workspace without changing local skills. Integrity and
 * containment checks happen before a UI may offer "Apply" for any entry.
 */
export function createSyncRestorePlan(workspacePath: string, canonicalSkillsPath: string): SyncRestorePlan {
	const workspace = realpathSync(workspacePath);
	const manifest = parseSyncManifest(readFileSync(join(workspace, "skiller-sync.yaml"), "utf8"));
	const entries: SyncRestoreEntry[] = [];
	const secretFindings: SyncExportFinding[] = [];

	for (const skill of manifest.skills) {
		if (skill.kind !== "bundled") continue;
		const sourcePath = workspaceChildRealPath(workspace, skill.path);
		const remote = planBundledSkillExport(skill.id, sourcePath);
		if (remote.sha256 !== skill.sha256) {
			throw new Error(`Sync bundle integrity mismatch: ${skill.id}`);
		}
		secretFindings.push(...remote.secretFindings);

		const targetPath = resolve(canonicalSkillsPath, skill.id);
		let action: SyncRestoreAction = "create";
		let localSha256: string | null = null;
		if (existsSync(targetPath)) {
			const targetStat = lstatSync(targetPath);
			if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
				action = "conflict";
			} else {
				try {
					localSha256 = planBundledSkillExport(skill.id, targetPath).sha256;
					action = localSha256 === remote.sha256 ? "unchanged" : "conflict";
				} catch {
					action = "conflict";
				}
			}
		}
		entries.push({
			id: skill.id,
			sourcePath,
			targetPath,
			action,
			remoteSha256: remote.sha256,
			localSha256,
		});
	}
	return { manifest, entries, secretFindings };
}

/**
 * Applies only entries explicitly selected by the user after preview. It
 * refuses to overwrite a local skill that changed since that preview.
 */
export function applySyncRestorePlan(plan: SyncRestorePlan, selectedIds: string[]): void {
	if (plan.secretFindings.length > 0) {
		throw new Error(`Sync restore is blocked by ${plan.secretFindings.length} secret finding(s)`);
	}
	const selected = new Set(selectedIds);
	const entries = plan.entries.filter((entry) => selected.has(entry.id) && entry.action !== "unchanged");
	if (entries.length === 0) return;

	const stagedRoot = join(dirname(entries[0].targetPath), `.skiller-sync-restore-${randomUUID()}`);
	const backupRoot = `${stagedRoot}-backup`;
	const staged = entries.map((entry) => ({ entry, stagingPath: stageRestoreEntry(stagedRoot, entry) }));
	const applied: { targetPath: string; backupPath: string; hadPrevious: boolean }[] = [];
	try {
		for (const { entry, stagingPath } of staged) {
			assertRestorePrecondition(entry);
			const backupPath = join(backupRoot, entry.id);
			const hadPrevious = existsSync(entry.targetPath);
			if (hadPrevious) {
				mkdirSync(dirname(backupPath), { recursive: true });
				renameSync(entry.targetPath, backupPath);
			}
			try {
				mkdirSync(dirname(entry.targetPath), { recursive: true });
				renameSync(stagingPath, entry.targetPath);
			} catch (error) {
				if (hadPrevious && existsSync(backupPath)) renameSync(backupPath, entry.targetPath);
				throw error;
			}
			applied.push({ targetPath: entry.targetPath, backupPath, hadPrevious });
		}
		rmSync(backupRoot, { recursive: true, force: true });
	} catch (error) {
		for (const item of applied.reverse()) {
			if (existsSync(item.targetPath)) rmSync(item.targetPath, { recursive: true, force: true });
			if (item.hadPrevious && existsSync(item.backupPath)) renameSync(item.backupPath, item.targetPath);
		}
		throw error;
	} finally {
		if (existsSync(stagedRoot)) rmSync(stagedRoot, { recursive: true, force: true });
		if (existsSync(backupRoot)) rmSync(backupRoot, { recursive: true, force: true });
	}
}

function stageRestoreEntry(stagedRoot: string, entry: SyncRestoreEntry): string {
	const sourcePlan = planBundledSkillExport(entry.id, entry.sourcePath);
	if (sourcePlan.sha256 !== entry.remoteSha256 || sourcePlan.secretFindings.length > 0) {
		throw new Error(`Sync remote skill changed after preview: ${entry.id}`);
	}
	const stagingPath = join(stagedRoot, entry.id);
	for (const file of sourcePlan.files) {
		const source = readFileSync(join(sourcePlan.sourcePath, file.relativePath));
		if (createHash("sha256").update(source).digest("hex") !== file.sha256) {
			throw new Error(`Sync remote file changed during restore: ${entry.id}/${file.relativePath}`);
		}
		const destination = join(stagingPath, file.relativePath);
		mkdirSync(dirname(destination), { recursive: true });
		writeFileSync(destination, source);
	}
	return stagingPath;
}

function assertRestorePrecondition(entry: SyncRestoreEntry): void {
	if (entry.action === "create") {
		if (existsSync(entry.targetPath)) throw new Error(`Local skill appeared after preview: ${entry.id}`);
		return;
	}
	if (entry.localSha256 === null || !existsSync(entry.targetPath) || lstatSync(entry.targetPath).isSymbolicLink()) {
		throw new Error(`Local skill cannot be safely replaced: ${entry.id}`);
	}
	const current = planBundledSkillExport(entry.id, entry.targetPath).sha256;
	if (current !== entry.localSha256) throw new Error(`Local skill changed after preview: ${entry.id}`);
}

function workspaceChildRealPath(workspace: string, relativePath: string): string {
	const candidate = resolve(workspace, relativePath);
	if (!candidate.startsWith(`${workspace}${sep}`)) {
		throw new Error(`Sync workspace path escapes managed workspace: ${relativePath}`);
	}
	const real = realpathSync(candidate);
	if (!real.startsWith(`${workspace}${sep}`)) {
		throw new Error(`Sync workspace bundle escapes managed workspace: ${relativePath}`);
	}
	return real;
}
