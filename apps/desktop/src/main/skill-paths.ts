import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "./types";
import { sharedSkillsDir } from "./shared-skills";

/** Resolve install directory for a skill id (canonical shared dir, then agent trees). */
export function resolveSkillSourcePath(skillId: string, agents: AgentConfig[]): string {
	const canonical = join(sharedSkillsDir(), skillId);
	if (existsSync(canonical)) return canonical;
	for (const agent of agents) {
		for (const root of agent.global_paths) {
			const agentSkill = join(root, skillId);
			if (existsSync(agentSkill)) return agentSkill;
		}
	}
	throw new Error(`skill '${skillId}' not found in any directory`);
}
