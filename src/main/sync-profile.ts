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
