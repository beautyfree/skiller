import {
	mergeSkillerSyncPublishUpdate,
	planSkillerSyncPublish,
	type SkillerBundledPublishCandidate,
	type SkillerReferencePublishCandidate,
	type SkillerSkillsShPublishCandidate,
	type SkillerSyncPublishCandidate,
	type SkillerSyncPublishPlan,
	type SkillerVendoredPublishCandidate,
} from "dotagents/adapters/skiller";
import {
	applyLibraryUpdatePlan,
	planLibraryUpdate,
	type LibraryUpdatePlan,
} from "dotagents/library-update";
import {
	stringifySyncManifest,
	type SyncManifest,
} from "./sync-profile";

export type BundledSkillCandidate = SkillerBundledPublishCandidate;
export type ReferenceSkillCandidate = SkillerReferencePublishCandidate;
export type SkillsShSkillCandidate = SkillerSkillsShPublishCandidate;
export type VendoredSkillCandidate = SkillerVendoredPublishCandidate;
export type SyncPublishCandidate = SkillerSyncPublishCandidate;
export type SyncPublishPlan = SkillerSyncPublishPlan;

/**
 * Applies a reviewed subset update to an already-fetched manifest.  This is
 * used for granular "publish my local change" actions: an untouched remote
 * skill remains in the manifest and in the worktree rather than disappearing
 * because the user chose to publish just one skill.
 */
export function mergeBundledUpdateIntoManifest(
	base: SyncManifest,
	update: SyncPublishPlan,
	options: { allowSourceConversion?: boolean } = {},
): SyncPublishPlan {
	return mergeSkillerSyncPublishUpdate(base, update, options);
}

export function createSyncPublishPlan(
	profileId: string,
	mode: SyncManifest["profile"]["mode"],
	candidates: SyncPublishCandidate[],
	agentPolicy?: SyncManifest["agent_policy"],
): SyncPublishPlan {
	return planSkillerSyncPublish(profileId, mode, candidates, agentPolicy);
}

/**
 * Writes a previously reviewed plan into the managed Git worktree. This never
 * stages, commits, or pushes; those remain explicit operations in SyncWorkspace.
 */
export function applySyncPublishPlan(workspacePath: string, plan: SyncPublishPlan): void {
	applySyncPublishFiles(workspacePath, plan, {
		"skiller-sync.yaml": stringifySyncManifest(plan.manifest),
	});
}

/**
 * Applies reviewed skill bundles plus an explicit set of portable root files.
 * Canonical dotagents publication uses this with skills.json/skills.lock/config;
 * the legacy wrapper above remains read/write compatible for existing profiles.
 */
export function applySyncPublishFiles(
	workspacePath: string,
	plan: SyncPublishPlan,
	portableFiles: Record<string, string>,
): void {
	const update = createSyncPublishWorkspacePlan(workspacePath, plan, portableFiles);
	applyLibraryUpdatePlan(update, { portableFiles });
}

/** Provider/UI adapter for dotagents's shared transactional workspace update. */
export function createSyncPublishWorkspacePlan(
	workspacePath: string,
	plan: SyncPublishPlan,
	portableFiles: Record<string, string>,
): LibraryUpdatePlan {
	return planLibraryUpdate({
		root: workspacePath,
		skills: plan.bundledSkills.map((skill) => ({
			skill: skill.id,
			path: skill.bundledPath,
			sourcePath: skill.sourcePath,
			integrity: skill.sha256,
		})),
		portableFiles,
	});
}
