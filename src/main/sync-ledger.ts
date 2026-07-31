import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { appDataRootPath } from "./settings";

export const SYNC_LEDGER_VERSION = 1;

export type SyncLedger = {
	schema_version: typeof SYNC_LEDGER_VERSION;
	profile_id: string;
	updated_at: string;
	skills: Record<string, { sha256: string }>;
};

export type ThreeWayAction = "take-remote" | "publish-local" | "unchanged" | "conflict" | "unmanaged";

export type ThreeWaySkill = {
	id: string;
	baseSha256: string | null;
	localSha256: string | null;
	remoteSha256: string;
	action: ThreeWayAction;
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

export function makeSyncLedger(profileId: string, entries: { id: string; sha256: string }[]): SyncLedger {
	return {
		schema_version: SYNC_LEDGER_VERSION,
		profile_id: profileId,
		updated_at: new Date().toISOString(),
		skills: Object.fromEntries(entries.map((entry) => [entry.id, { sha256: entry.sha256 }])),
	};
}

/**
 * Classifies without writing. A missing base is deliberately `unmanaged` when
 * local and remote differ: old profiles and hand-edited installations deserve
 * a human decision, not a default overwrite.
 */
export function classifyThreeWaySkill(
	id: string,
	baseSha256: string | null,
	localSha256: string | null,
	remoteSha256: string,
): ThreeWaySkill {
	if (baseSha256 === null) {
		const action: ThreeWayAction = localSha256 === null
			? "take-remote"
			: localSha256 === remoteSha256
				? "unchanged"
				: "unmanaged";
		return { id, baseSha256, localSha256, remoteSha256, action };
	}
	const localChanged = localSha256 !== baseSha256;
	const remoteChanged = remoteSha256 !== baseSha256;
	let action: ThreeWayAction;
	if (!localChanged && !remoteChanged) action = "unchanged";
	else if (!localChanged && remoteChanged) action = "take-remote";
	else if (localChanged && !remoteChanged) action = "publish-local";
	else if (localSha256 === remoteSha256) action = "unchanged";
	else action = "conflict";
	return { id, baseSha256, localSha256, remoteSha256, action };
}
