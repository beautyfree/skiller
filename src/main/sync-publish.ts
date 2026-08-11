import { planLibraryPublish, type ForkOrigin, type LibraryPublishCandidate, type SnapshotOrigin, type VendoredOrigin } from "dotagents";
import {
	applyLibraryUpdatePlan,
	planLibraryUpdate,
	type LibraryUpdatePlan,
} from "dotagents/library-update";
import {
	type SyncManifest,
	createSyncManifest,
	validateSyncManifest,
} from "./sync-profile";

export type BundledSkillCandidate = { kind?: "bundled"; id: string; sourcePath: string; forkedFrom?: ForkOrigin; installationAgentSlugs?: string[] };
export type ReferenceSkillCandidate = { kind: "reference"; id: string; repository: string; ref: string; skillPath: string; contentHash?: string; installationAgentSlugs?: string[] };
export type SkillsShSkillCandidate = { kind: "skills_sh"; id: string; sourceUrl: string; ref: string; skillPath: string; contentHash?: string; installationAgentSlugs?: string[] };
export type VendoredSkillCandidate = { kind: "vendored"; id: string; sourcePath: string; origin: VendoredOrigin; installationAgentSlugs?: string[] };
export type SnapshotSkillCandidate = { kind: "snapshot"; id: string; sourcePath: string; origin: SnapshotOrigin; installationAgentSlugs?: string[] };
export type SyncPublishCandidate = BundledSkillCandidate | ReferenceSkillCandidate | SkillsShSkillCandidate | VendoredSkillCandidate | SnapshotSkillCandidate;
export type SyncPublishPlan = {
  kind: "dotagents-library-publish";
  planId: string;
  manifest: SyncManifest;
  bundledSkills: ReturnType<typeof planLibraryPublish>["bundledSkills"];
  bundledDistributions: ReturnType<typeof planLibraryPublish>["bundledDistributions"];
  vendoredOrigins: ReturnType<typeof planLibraryPublish>["vendoredOrigins"];
  snapshotOrigins: ReturnType<typeof planLibraryPublish>["snapshotOrigins"];
  forkedFrom: ReturnType<typeof planLibraryPublish>["forkedFrom"];
  secretFindings: ReturnType<typeof planLibraryPublish>["secretFindings"];
};

/**
 * Applies a reviewed subset update to an already-fetched manifest.  This is
 * used for granular "publish my local change" actions: an untouched remote
 * skill remains in the manifest and in the worktree rather than disappearing
 * because the user chose to publish just one skill.
 */
export function mergeBundledUpdateIntoManifest(
	base: SyncManifest,
	update: SyncPublishPlan,
	options: { allowSourceConversion?: boolean; allowNew?: boolean } = {},
): SyncPublishPlan {
	const replacement = new Map(update.manifest.skills.map((skill) => [skill.id, skill]));
	for (const skill of update.manifest.skills) {
		const previous = base.skills.find((item) => item.id === skill.id);
		if ((!previous && !options.allowNew) || (previous && (!options.allowSourceConversion && (previous.kind !== "bundled" || skill.kind !== "bundled"))))
			throw new Error(`Granular sync update is not a known bundled skill: ${skill.id}`);
	}
	return { ...update, manifest: validateSyncManifest({ ...base, skills: [...base.skills.map((skill) => replacement.get(skill.id) ?? skill), ...update.manifest.skills.filter((skill) => !base.skills.some((existing) => existing.id === skill.id))] }) };
}

export function createSyncPublishPlan(
	profileId: string,
	mode: SyncManifest["profile"]["mode"],
	candidates: SyncPublishCandidate[],
	agentPolicy?: SyncManifest["agent_policy"],
): SyncPublishPlan {
	const coreCandidates: LibraryPublishCandidate[] = candidates.map((candidate) => {
		if (candidate.kind === "reference") return { kind: "git", id: candidate.id, repository: candidate.repository, ref: candidate.ref, skillPath: candidate.skillPath, ...(candidate.contentHash ? { contentHash: candidate.contentHash } : {}), ...(candidate.installationAgentSlugs ? { installationAgentSlugs: candidate.installationAgentSlugs } : {}) };
		if (candidate.kind === "skills_sh") return { kind: "skills-cli", id: candidate.id, sourceUrl: candidate.sourceUrl, ref: candidate.ref, skillPath: candidate.skillPath, ...(candidate.contentHash ? { contentHash: candidate.contentHash } : {}), ...(candidate.installationAgentSlugs ? { installationAgentSlugs: candidate.installationAgentSlugs } : {}) };
		if (candidate.kind === "vendored") return { kind: "vendored", id: candidate.id, sourcePath: candidate.sourcePath, origin: candidate.origin, ...(candidate.installationAgentSlugs ? { installationAgentSlugs: candidate.installationAgentSlugs } : {}) };
		if (candidate.kind === "snapshot") return { kind: "snapshot", id: candidate.id, sourcePath: candidate.sourcePath, origin: candidate.origin, ...(candidate.installationAgentSlugs ? { installationAgentSlugs: candidate.installationAgentSlugs } : {}) };
		return { kind: "owned", id: candidate.id, sourcePath: candidate.sourcePath, ...(candidate.forkedFrom ? { forkedFrom: candidate.forkedFrom } : {}), ...(candidate.installationAgentSlugs ? { installationAgentSlugs: candidate.installationAgentSlugs } : {}) };
	});
	const core = planLibraryPublish(coreCandidates);
	const manifest = createSyncManifest(profileId, mode, agentPolicy);
	manifest.skills = candidates.map((candidate) => {
		const installations = candidate.installationAgentSlugs?.length ? [...new Set(candidate.installationAgentSlugs)].sort() : undefined;
		if (candidate.kind === "reference") return { id: candidate.id, kind: "reference" as const, repository: candidate.repository, ref: candidate.ref, skill_path: candidate.skillPath, ...(candidate.contentHash ? { sha256: candidate.contentHash } : {}), ...(installations ? { installations } : {}) };
		if (candidate.kind === "skills_sh") return { id: candidate.id, kind: "skills_sh" as const, source_url: candidate.sourceUrl, ref: candidate.ref, skill_path: candidate.skillPath, ...(candidate.contentHash ? { sha256: candidate.contentHash } : {}), ...(installations ? { installations } : {}) };
		const bundled = core.bundledSkills.find((entry) => entry.id === candidate.id);
		if (!bundled) throw new Error(`Missing bundled export plan: ${candidate.id}`);
		return { id: candidate.id, kind: "bundled" as const, path: bundled.bundledPath, sha256: bundled.sha256, ...(installations ? { installations } : {}) };
	});
  return { kind: "dotagents-library-publish", planId: core.planId, manifest: validateSyncManifest(manifest), bundledSkills: core.bundledSkills, bundledDistributions: core.bundledDistributions, vendoredOrigins: core.vendoredOrigins, snapshotOrigins: core.snapshotOrigins, forkedFrom: core.forkedFrom, secretFindings: core.secretFindings };
}

/**
 * Applies reviewed skill bundles plus an explicit set of portable root files.
 * Canonical dotagents publication uses this with skills.json/skills.lock/config.
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
