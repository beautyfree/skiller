import {
	discoverSkills,
	suggestImportCandidates,
	type DiscoveredProvenance,
	type SkillDiscoveryReport,
	type SkillDiscoveryRoot,
} from "@beautyfree/dotagent/discovery";
import { skillsCliLockToProvenance, type SkillsCliLock } from "@beautyfree/dotagent/adapters/skills-cli";
import type { ImportCandidate } from "@beautyfree/dotagent/import";
import { planImport, type ImportPlan } from "@beautyfree/dotagent/import";
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

export type DotagentImportDecision = {
	candidateKey: string;
	disposition: "suggested" | "owned" | "dependency" | "local-only" | "excluded";
	reason?: string;
};

/** Rebuilds discovery before planning so renderer choices never carry trusted filesystem paths. */
export async function planDotagentImportFromDiscovery(
	libraryRoot: string,
	configs: AgentConfig[],
	decisions: DotagentImportDecision[],
	options: Parameters<typeof scanDotagentSkillDiscovery>[1] = {},
): Promise<ImportPlan> {
	const discovery = await scanDotagentSkillDiscovery(configs, options);
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
