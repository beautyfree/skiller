import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { appDataRootPath } from "./settings";

export { classifyThreeWaySkill } from "dotagents/reconcile";
export type { ThreeWayAction, ThreeWaySkill } from "dotagents/reconcile";

export const SYNC_LEDGER_VERSION = 1;

export type SyncLedger = {
	schema_version: typeof SYNC_LEDGER_VERSION;
	profile_id: string;
	updated_at: string;
	skills: Record<string, { sha256: string; kept_remote_sha256?: string }>;
	/** Local-only decision to keep a conflicting external skill at this pin. */
	external_kept_sources?: Record<string, { repository: string; ref: string }>;
};

export function syncLedgerPath(profileId: string): string {
	return join(appDataRootPath(), "sync-ledger", `${profileId}.json`);
}

export function readSyncLedgerAt(path: string): SyncLedger | null {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SyncLedger>;
		if (parsed.schema_version !== SYNC_LEDGER_VERSION || typeof parsed.profile_id !== "string" || !parsed.skills) return null;
		return parsed as SyncLedger;
	} catch {
		return null;
	}
}

export function readSyncLedger(profileId: string): SyncLedger | null {
	return readSyncLedgerAt(syncLedgerPath(profileId));
}

/** Atomic local bookkeeping; the ledger itself is never added to a sync repo. */
export function writeSyncLedgerAt(path: string, ledger: SyncLedger): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
	renameSync(temporary, path);
}

export function makeSyncLedger(
	profileId: string,
	entries: { id: string; sha256: string; keptRemoteSha256?: string }[],
	externalKeptSources?: Record<string, { repository: string; ref: string }>,
): SyncLedger {
	return {
		schema_version: SYNC_LEDGER_VERSION,
		profile_id: profileId,
		updated_at: new Date().toISOString(),
		skills: Object.fromEntries(entries.map((entry) => [entry.id, {
			sha256: entry.sha256,
			...(entry.keptRemoteSha256 ? { kept_remote_sha256: entry.keptRemoteSha256 } : {}),
		}])),
		...(externalKeptSources && Object.keys(externalKeptSources).length > 0
			? { external_kept_sources: externalKeptSources }
			: {}),
	};
}
