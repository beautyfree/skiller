/**
 * Compatibility facade for Skiller's existing sync profile format.
 *
 * The portable schema, migration rules, and safety validation now live in
 * dotagents so the desktop app and future CLI use one engine.
 * Keep these aliases while the UI migrates from skiller-sync.yaml to the
 * canonical dotagents library format.
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
} from "dotagents/adapters/skiller";

export type {
	SkillerSyncManifest as SyncManifest,
	SkillerSyncSkill as SyncSkill,
} from "dotagents/adapters/skiller";

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
