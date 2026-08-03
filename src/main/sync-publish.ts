import type { VendoredOrigin } from "@beautyfree/dotagent/config";
import {
	applyLibraryUpdatePlan,
	planLibraryUpdate,
	type LibraryUpdatePlan,
} from "@beautyfree/dotagent/library-update";
import {
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
	contentHash?: string;
	installationAgentSlugs?: string[];
};

export type SkillsShSkillCandidate = {
	kind: "skills_sh";
	id: string;
	sourceUrl: string;
	ref: string;
	skillPath: string;
	contentHash?: string;
	installationAgentSlugs?: string[];
};

export type VendoredSkillCandidate = {
	kind: "vendored";
	id: string;
	sourcePath: string;
	origin: VendoredOrigin;
	installationAgentSlugs?: string[];
};

export type SyncPublishCandidate =
	| BundledSkillCandidate
	| ReferenceSkillCandidate
	| SkillsShSkillCandidate
	| VendoredSkillCandidate;

export type SyncPublishPlan = {
	manifest: SyncManifest;
	bundledSkills: BundledSkillExportPlan[];
	bundledDistributions: Record<string, "owned" | "vendored">;
	vendoredOrigins: Record<string, VendoredOrigin>;
	secretFindings: SyncExportFinding[];
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
	options: { allowSourceConversion?: boolean } = {},
): SyncPublishPlan {
	const replacement = new Map(update.manifest.skills.map((skill) => [skill.id, skill]));
	for (const skill of update.manifest.skills) {
		const previous = base.skills.find((item) => item.id === skill.id);
		if (!previous || skill.kind !== "bundled" || (!options.allowSourceConversion && previous.kind !== "bundled")) {
			throw new Error(`Granular sync update is not a known bundled skill: ${skill.id}`);
		}
	}
	return {
		...update,
		manifest: validateSyncManifest({
			...base,
			skills: base.skills.map((skill) => replacement.get(skill.id) ?? skill),
		}),
	};
}

export function createSyncPublishPlan(
	profileId: string,
	mode: SyncManifest["profile"]["mode"],
	candidates: SyncPublishCandidate[],
	agentPolicy?: SyncManifest["agent_policy"],
): SyncPublishPlan {
	const bundledSkills = candidates
		.filter(
			(candidate): candidate is BundledSkillCandidate | VendoredSkillCandidate =>
				candidate.kind === undefined || candidate.kind === "bundled" || candidate.kind === "vendored",
		)
		.map((candidate) => planBundledSkillExport(candidate.id, candidate.sourcePath));
	const vendoredOrigins = Object.fromEntries(
		candidates
			.filter((candidate): candidate is VendoredSkillCandidate => candidate.kind === "vendored")
			.map((candidate) => [candidate.id, candidate.origin]),
	);
	const bundledDistributions = Object.fromEntries(
		candidates
			.filter(
				(candidate): candidate is BundledSkillCandidate | VendoredSkillCandidate =>
					candidate.kind === undefined || candidate.kind === "bundled" || candidate.kind === "vendored",
			)
			.map((candidate) => [candidate.id, candidate.kind === "vendored" ? ("vendored" as const) : ("owned" as const)]),
	);
	const manifest = createSyncManifest(profileId, mode, agentPolicy);
	manifest.skills = candidates.map((candidate) => {
		if (candidate.kind === "reference") {
			return {
				id: candidate.id,
				kind: "reference" as const,
				repository: candidate.repository,
				ref: candidate.ref,
				skill_path: candidate.skillPath,
				...(candidate.contentHash ? { sha256: candidate.contentHash } : {}),
				...(candidate.installationAgentSlugs?.length
					? { installations: [...new Set(candidate.installationAgentSlugs)].sort() }
					: {}),
			};
		}
		if (candidate.kind === "skills_sh") {
			return {
				id: candidate.id,
				kind: "skills_sh" as const,
				source_url: candidate.sourceUrl,
				ref: candidate.ref,
				skill_path: candidate.skillPath,
				...(candidate.contentHash ? { sha256: candidate.contentHash } : {}),
				...(candidate.installationAgentSlugs?.length
					? { installations: [...new Set(candidate.installationAgentSlugs)].sort() }
					: {}),
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
		bundledDistributions,
		vendoredOrigins,
		secretFindings: bundledSkills.flatMap((skill) => skill.secretFindings),
	};
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
 * Canonical dotagent publication uses this with skills.json/skills.lock/config;
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

/** Provider/UI adapter for dotagent's shared transactional workspace update. */
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
