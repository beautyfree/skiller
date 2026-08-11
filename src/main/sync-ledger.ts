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
	/** Per-device inventory baseline. It lets Agent Library distinguish a real
	 * edit made after setup from pre-existing direct agent installations. */
	observed_content_hashes?: Record<string, string>;
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
	observedContentHashes?: Record<string, string>,
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
		...(observedContentHashes && Object.keys(observedContentHashes).length > 0
			? { observed_content_hashes: observedContentHashes }
			: {}),
	};
}

/**
 * Older libraries predate the per-device ledger.  Their clean workspace is
 * still an exact, reviewed baseline, so record it locally before the first
 * reconciliation rather than presenting every previously saved skill as an
 * unexplained conflict.  This never changes a skill or remote repository.
 */
export function bootstrapSyncLedgerFromManifest(
	profileId: string,
	skills: readonly { kind: string; id: string; sha256?: string }[],
	existing: SyncLedger | null,
): SyncLedger {
	if (existing) return existing;
	return makeSyncLedger(
		profileId,
		skills
			.filter((skill): skill is { kind: "bundled"; id: string; sha256: string } => skill.kind === "bundled" && typeof skill.sha256 === "string")
			.map((skill) => ({ id: skill.id, sha256: skill.sha256 })),
	);
}

/**
 * Record an explicit choice to keep this computer's current state instead of
 * the exact reviewed library versions. A later library version asks again.
 */
export function recordSyncLedgerDeviceChoices(
	profileId: string,
	current: SyncLedger | null,
	versions: { id: string; remoteSha256: string }[],
): SyncLedger {
	const entries = new Map(
		Object.entries(current?.skills ?? {}).map(([id, entry]) => [
			id,
			{ sha256: entry.sha256, keptRemoteSha256: entry.kept_remote_sha256 },
		]),
	);
	for (const version of versions) {
		entries.set(version.id, {
			sha256: entries.get(version.id)?.sha256 ?? version.remoteSha256,
			keptRemoteSha256: version.remoteSha256,
		});
	}
	return makeSyncLedger(
		profileId,
		[...entries.entries()].map(([id, entry]) => ({ id, ...entry })),
		current?.external_kept_sources,
	);
}
