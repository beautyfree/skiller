import {
	discoverSkills,
	suggestImportCandidates,
	type DiscoveredProvenance,
	type SkillDiscoveryReport,
	type SkillDiscoveryRoot,
} from "@beautyfree/dotagent/discovery";
import { skillsCliLockToProvenance, type SkillsCliLock } from "@beautyfree/dotagent/adapters/skills-cli";
import type { ImportCandidate } from "@beautyfree/dotagent/import";
import { readSkillsCliLock } from "./skills-cli-lock";
import { readProvenance, type ProvenanceEntry } from "./provenance";
import { sharedSkillsDir } from "./shared-skills";
import type { AgentConfig } from "./types";

function packageName(repository: string, skill: string): string {
	const withoutTransport = repository.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^git@/i, "").replace(/\.git$/i, "");
	const normalized = withoutTransport.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
	return normalized && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) ? normalized : `${skill}-source`.slice(0, 64);
}

function legacyProvenance(entries: Record<string, ProvenanceEntry>): DiscoveredProvenance[] {
	return Object.entries(entries).flatMap(([skill, entry]) => {
		const repository = entry.repository?.trim();
		const skillPath = entry.skill_path?.trim();
		if (!repository || !skillPath) return [];
		return [{
			skill,
			package: packageName(repository, skill),
			url: repository,
			ref: entry.ref?.trim() || "HEAD",
			skillPath,
			source: entry.source === "skills.sh" ? "skills-cli" as const : "git" as const,
		}];
	});
}

export function dotagentDiscoveryRoots(configs: AgentConfig[], sharedRoot = sharedSkillsDir()): SkillDiscoveryRoot[] {
	const roots: SkillDiscoveryRoot[] = [{ path: sharedRoot, kind: "shared" }];
	for (const agent of configs.filter((config) => config.detected)) {
		for (const root of agent.global_paths) roots.push({ path: root, agent: agent.slug, kind: "agent-local" });
		for (const readable of agent.additional_readable_paths) {
			if (readable.source_agent !== "shared") roots.push({ path: readable.path, agent: agent.slug, kind: "inherited" });
		}
	}
	return roots;
}

export async function scanDotagentSkillDiscovery(
	configs: AgentConfig[],
	options: {
		sharedRoot?: string;
		skillsCliLock?: SkillsCliLock | null;
		provenance?: Record<string, ProvenanceEntry>;
	} = {},
): Promise<{ report: SkillDiscoveryReport; suggestions: ImportCandidate[]; skippedSources: { skill: string; reason: string }[] }> {
	const report = await discoverSkills(dotagentDiscoveryRoots(configs, options.sharedRoot));
	const skillsCli = options.skillsCliLock === undefined ? readSkillsCliLock() : options.skillsCliLock;
	const adapted = skillsCli ? skillsCliLockToProvenance(skillsCli) : { provenance: [], skipped: [] };
	const provenance = options.provenance ?? readProvenance();
	return {
		report,
		suggestions: suggestImportCandidates(report, [...adapted.provenance, ...legacyProvenance(provenance)]),
		skippedSources: adapted.skipped,
	};
}
