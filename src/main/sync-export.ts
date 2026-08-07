import {
	planSkillExport,
	type SkillExportFile,
	type SkillExportFinding,
} from "dotagents/export-policy";

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
	const plan = planSkillExport(id, sourcePath);
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
