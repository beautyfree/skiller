/**
 * Compatibility facade for Skiller's existing sync profile format.
 *
 * The portable schema, migration rules, and safety validation now live in
 * @beautyfree/dotagent so the desktop app and future CLI use one engine.
 * Keep these aliases while the UI migrates from skiller-sync.yaml to the
 * canonical dotagent library format.
 */
export {
	SKILLER_SYNC_MANIFEST_FILE as SYNC_MANIFEST_FILE,
	SKILLER_SYNC_MANIFEST_VERSION as SYNC_MANIFEST_VERSION,
	assertCredentialFreeGitRemote,
	assertSkillerPortableRelativePath as assertPortableRelativePath,
	assertSkillerPortableSkillSourcePath as assertPortableSkillSourcePath,
	assertSkillerStableId as assertSyncStableId,
	createSkillerSyncManifest as createSyncManifest,
	parseSkillerSyncManifest as parseSyncManifest,
	stringifySkillerSyncManifest as stringifySyncManifest,
	validateSkillerSyncManifest as validateSyncManifest,
} from "@beautyfree/dotagent/adapters/skiller";

export type {
	SkillerSyncManifest as SyncManifest,
	SkillerSyncSkill as SyncSkill,
} from "@beautyfree/dotagent/adapters/skiller";

/** Derive a private local workspace id without exposing this concept in setup UI. */
export function syncProfileIdFromRemote(remoteUrl: string): string {
	const withoutQuery = remoteUrl.trim().split(/[?#]/, 1)[0] ?? "";
	const remoteParts = withoutQuery.replace(/[\\/]+$/, "").split(/[\\/:]/);
	const repository = remoteParts[remoteParts.length - 1]?.replace(/\.git$/i, "") ?? "";
	const normalized = repository
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 56);
	return normalized || "agent-library";
}
