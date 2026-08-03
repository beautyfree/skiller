import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { recoverLibraryReconciliation } from "@beautyfree/dotagent/reconcile";
import { appDataRootPath } from "./settings";

export type RestoreJournalEntry = {
	id: string;
	targetPath: string;
	backupPath: string;
	hadPrevious: boolean;
	stage: "pending" | "backed-up" | "applied";
};

export type RestoreJournal = {
	schema_version: 1;
	profile_id: string;
	staged_root: string;
	backup_root: string;
	phase: "applying" | "completed";
	entries: RestoreJournalEntry[];
};

export function syncJournalPath(profileId: string): string {
	return join(appDataRootPath(), "sync-journal", `${profileId}.json`);
}

export function writeRestoreJournalAt(path: string, journal: RestoreJournal): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(temporary, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
	renameSync(temporary, path);
}

export type CurrentRestoreJournal = { kind: "library-reconcile"; schemaVersion: 1; entries: unknown[] };

export function readRestoreJournalAt(path: string): RestoreJournal | CurrentRestoreJournal | null {
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		if (raw.kind === "library-reconcile" && raw.schemaVersion === 1 && Array.isArray(raw.entries)) {
			return raw as unknown as CurrentRestoreJournal;
		}
		if (raw.schema_version !== 1 || raw.phase === undefined || !Array.isArray(raw.entries)) return null;
		return raw as unknown as RestoreJournal;
	} catch {
		return null;
	}
}

/**
 * Restore every changed target to its pre-apply state. This is safe to call
 * after a process interruption; completed operations only lose stale staging
 * data and their journal, never their successfully applied targets.
 */
export function recoverRestoreJournalAt(path: string): boolean {
	const journal = readRestoreJournalAt(path);
	if (!journal) return false;
	if ("kind" in journal) return recoverLibraryReconciliation(path);
	if (journal.phase === "completed") {
		if (existsSync(journal.staged_root)) rmSync(journal.staged_root, { recursive: true, force: true });
		if (existsSync(journal.backup_root)) rmSync(journal.backup_root, { recursive: true, force: true });
		rmSync(path, { force: true });
		return true;
	}
	for (const entry of [...journal.entries].reverse()) {
		if (existsSync(entry.backupPath)) {
			if (existsSync(entry.targetPath)) rmSync(entry.targetPath, { recursive: true, force: true });
			mkdirSync(dirname(entry.targetPath), { recursive: true });
			renameSync(entry.backupPath, entry.targetPath);
		} else if (!entry.hadPrevious && existsSync(entry.targetPath)) {
			rmSync(entry.targetPath, { recursive: true, force: true });
		}
	}
	if (existsSync(journal.staged_root)) rmSync(journal.staged_root, { recursive: true, force: true });
	if (existsSync(journal.backup_root)) rmSync(journal.backup_root, { recursive: true, force: true });
	rmSync(path, { force: true });
	return true;
}
