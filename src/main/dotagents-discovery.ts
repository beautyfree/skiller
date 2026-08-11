import {
	discoverSkills,
	suggestImportCandidates,
	type SkillDiscoveryReport,
	type SkillDiscoveryRoot,
} from "dotagents/discovery";
import { skillsCliLockToProvenance, type SkillsCliLock } from "dotagents/adapters/skills-cli";
import type { ImportCandidate } from "dotagents/import";
import { planImport, type ImportPlan } from "dotagents/import";
import { readSkillsCliLock } from "./skills-cli-lock";
import { sharedSkillsDir } from "./shared-skills";
import type { AgentConfig } from "./types";

export function dotagentsDiscoveryRoots(configs: AgentConfig[], sharedRoot = sharedSkillsDir()): SkillDiscoveryRoot[] {
	const roots: SkillDiscoveryRoot[] = [{ path: sharedRoot, kind: "shared" }];
	for (const agent of configs) {
		// Presence of a global skill directory is sufficient for discovery, but
		// never becomes agent-installation evidence or a materialization target.
		for (const root of agent.global_paths) roots.push({ path: root, agent: agent.slug, kind: "agent-local" });
		for (const readable of agent.additional_readable_paths) {
			if (readable.source_agent !== "shared") roots.push({ path: readable.path, agent: agent.slug, kind: "inherited" });
		}
	}
	return roots;
}

export async function scanDotagentsSkillDiscovery(
	configs: AgentConfig[],
	options: {
		sharedRoot?: string;
		skillsCliLock?: SkillsCliLock | null;
	} = {},
): Promise<{ report: SkillDiscoveryReport; suggestions: ImportCandidate[]; skippedSources: { skill: string; reason: string }[] }> {
	const report = await discoverSkills(dotagentsDiscoveryRoots(configs, options.sharedRoot));
	const skillsCli = options.skillsCliLock === undefined ? readSkillsCliLock() : options.skillsCliLock;
	const adapted = skillsCli ? skillsCliLockToProvenance(skillsCli) : { provenance: [], skipped: [] };
	return {
		report,
		// skills-cli's documented lock can refine a shared package reference. Git
		// provenance for every other source is discovered by dotagents itself.
		suggestions: suggestImportCandidates(report, adapted.provenance),
		skippedSources: adapted.skipped,
	};
}

export type DotagentsImportDecision = {
	candidateKey: string;
	disposition: "suggested" | "owned" | "dependency" | "local-only" | "excluded";
	reason?: string;
};

/** Rebuilds discovery before planning so renderer choices never carry trusted filesystem paths. */
export async function planDotagentsImportFromDiscovery(
	libraryRoot: string,
	configs: AgentConfig[],
	decisions: DotagentsImportDecision[],
	options: Parameters<typeof scanDotagentsSkillDiscovery>[1] = {},
): Promise<ImportPlan> {
	const discovery = await scanDotagentsSkillDiscovery(configs, options);
	const byKey = new Map(discovery.report.skills.map((skill, index) => [skill.candidateKey, { skill, suggestion: discovery.suggestions[index]! }]));
	const seen = new Set<string>();
	const candidates: ImportCandidate[] = decisions.map((decision) => {
		if (seen.has(decision.candidateKey)) throw new Error(`Duplicate import decision: ${decision.candidateKey}`);
		seen.add(decision.candidateKey);
		const found = byKey.get(decision.candidateKey);
		if (!found) throw new Error(`Import candidate changed or disappeared: ${decision.candidateKey}`);
		if (decision.disposition === "suggested") return found.suggestion;
		if (decision.disposition === "dependency") {
			if (found.suggestion.kind !== "dependency") throw new Error(`${decision.candidateKey} has no verified external provenance`);
			return found.suggestion;
		}
		const agents = [...new Set(found.skill.locations.flatMap((location) => location.agent ? [location.agent] : []))].sort();
		if (decision.disposition === "owned") return { kind: "owned", skill: found.skill.name, sourcePath: found.skill.sourcePath, ...(agents.length ? { agents } : {}) };
		return {
			kind: decision.disposition,
			skill: found.skill.name,
			sourcePath: found.skill.sourcePath,
			reason: decision.reason?.trim() || (decision.disposition === "excluded" ? "Excluded during review" : "Kept on this machine during review"),
		};
	});
	if (candidates.length === 0) throw new Error("Choose at least one discovered skill before creating an import plan");
	return planImport(libraryRoot, candidates);
}
