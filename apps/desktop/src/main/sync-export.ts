import {
	DEFAULT_SKILL_EXPORT_LIMITS,
	planSkillExport,
	type SkillExportFile,
	type SkillExportFinding,
} from "dotagents/export-policy";
import { sharedSkillsDir } from "./shared-skills";

export type SyncExportFile = SkillExportFile;
export type SyncExportFinding = SkillExportFinding;

export type BundledSkillExportPlan = {
	id: string;
	sourcePath: string;
	bundledPath: string;
	sha256: string;
	files: SyncExportFile[];
	excludedPaths: string[];
	secretFindings: SyncExportFinding[];
};

/** Compatibility facade over dotagents's canonical, read-only export policy. */
export function planBundledSkillExport(id: string, sourcePath: string): BundledSkillExportPlan {
	// Global .agents/skills is an explicit user-visible discovery root. dotagents
	// may materialize a regular file link within it into the portable copy, while
	// links to arbitrary locations remain blocked.
	const plan = planSkillExport(id, sourcePath, { ...DEFAULT_SKILL_EXPORT_LIMITS, trustedFileRoots: [sharedSkillsDir()] });
	return {
		id,
		sourcePath: plan.sourcePath,
		bundledPath: `skills/${id}`,
		sha256: plan.sha256,
		files: plan.files,
		excludedPaths: plan.excludedPaths,
		secretFindings: plan.secretFindings,
	};
}
