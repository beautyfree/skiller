import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
	assertPortableRelativePath,
	createSyncManifest,
	stringifySyncManifest,
	validateSyncManifest,
	type SyncManifest,
} from "./sync-profile";
import { planBundledSkillExport, type BundledSkillExportPlan, type SyncExportFinding } from "./sync-export";

export type BundledSkillCandidate = {
	kind?: "bundled";
	id: string;
	sourcePath: string;
	installationAgentSlugs?: string[];
};

export type ReferenceSkillCandidate = {
	kind: "reference";
	id: string;
	repository: string;
	ref: string;
	skillPath: string;
};

export type SyncPublishCandidate = BundledSkillCandidate | ReferenceSkillCandidate;

export type SyncPublishPlan = {
	manifest: SyncManifest;
	bundledSkills: BundledSkillExportPlan[];
	secretFindings: SyncExportFinding[];
};

export function createSyncPublishPlan(
	profileId: string,
	mode: SyncManifest["profile"]["mode"],
	candidates: SyncPublishCandidate[],
	agentPolicy?: SyncManifest["agent_policy"],
): SyncPublishPlan {
	const bundledSkills = candidates
		.filter((candidate): candidate is BundledSkillCandidate => candidate.kind !== "reference")
		.map((candidate) => planBundledSkillExport(candidate.id, candidate.sourcePath));
	const manifest = createSyncManifest(profileId, mode, agentPolicy);
	manifest.skills = candidates.map((candidate) => {
		if (candidate.kind === "reference") {
			return {
				id: candidate.id,
				kind: "reference" as const,
				repository: candidate.repository,
				ref: candidate.ref,
				skill_path: candidate.skillPath,
			};
		}
		const skill = bundledSkills.find((item) => item.id === candidate.id);
		if (!skill) throw new Error(`Missing bundled export plan: ${candidate.id}`);
		return {
			id: skill.id,
			kind: "bundled" as const,
			path: skill.bundledPath,
			sha256: skill.sha256,
			...(candidate.installationAgentSlugs?.length
				? { installations: [...new Set(candidate.installationAgentSlugs)].sort() }
				: {}),
		};
	});
	return {
		manifest: validateSyncManifest(manifest),
		bundledSkills,
		secretFindings: bundledSkills.flatMap((skill) => skill.secretFindings),
	};
}

/**
 * Writes a previously reviewed plan into the managed Git worktree. This never
 * stages, commits, or pushes; those remain explicit operations in SyncWorkspace.
 */
export function applySyncPublishPlan(workspacePath: string, plan: SyncPublishPlan): void {
	if (plan.secretFindings.length > 0) {
		throw new Error(`Sync publish is blocked by ${plan.secretFindings.length} secret finding(s)`);
	}
	const workspace = resolve(workspacePath);
	const stagedBundles = plan.bundledSkills.map((skill) => prepareStagedBundle(workspace, skill));
	try {
		for (const staged of stagedBundles) replaceWorkspacePath(workspace, staged.bundledPath, staged.stagingPath);
		writeFileSync(workspaceChild(workspace, "skiller-sync.yaml"), stringifySyncManifest(plan.manifest), "utf8");
	} finally {
		for (const staged of stagedBundles) {
			if (existsSync(staged.stagingPath)) rmSync(staged.stagingPath, { recursive: true, force: true });
		}
	}
}

function prepareStagedBundle(workspace: string, plan: BundledSkillExportPlan): { bundledPath: string; stagingPath: string } {
	assertPortableRelativePath(plan.bundledPath);
	const stagingPath = workspaceChild(workspace, `.skiller-staging/${randomUUID()}/${plan.bundledPath}`);
	for (const file of plan.files) {
		assertPortableRelativePath(file.relativePath);
		const source = readFileSync(join(plan.sourcePath, file.relativePath));
		const sha256 = createHash("sha256").update(source).digest("hex");
		if (sha256 !== file.sha256) {
			throw new Error(`Sync source changed after preview: ${plan.id}/${file.relativePath}`);
		}
		const destination = workspaceChild(stagingPath, file.relativePath);
		mkdirSync(dirname(destination), { recursive: true });
		writeFileSync(destination, source);
	}
	return { bundledPath: plan.bundledPath, stagingPath };
}

function replaceWorkspacePath(workspace: string, bundledPath: string, stagingPath: string): void {
	const destination = workspaceChild(workspace, bundledPath);
	mkdirSync(dirname(destination), { recursive: true });
	const backup = `${destination}.skiller-backup-${randomUUID()}`;
	const hadPrevious = existsSync(destination);
	if (hadPrevious) renameSync(destination, backup);
	try {
		renameSync(stagingPath, destination);
		if (hadPrevious) rmSync(backup, { recursive: true, force: true });
	} catch (error) {
		if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
		if (hadPrevious && existsSync(backup)) renameSync(backup, destination);
		throw error;
	}
}

function workspaceChild(workspace: string, portablePath: string): string {
	assertPortableRelativePath(portablePath);
	const target = resolve(workspace, portablePath);
	if (target !== workspace && !target.startsWith(`${workspace}${sep}`)) {
		throw new Error(`Sync workspace path escapes managed workspace: ${portablePath}`);
	}
	return target;
}
