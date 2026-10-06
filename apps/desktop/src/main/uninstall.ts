import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { Skill } from './skill-types';
import { parse as parseToml, stringify as stringifyToml } from "@iarna/toml";
import type { AgentConfig } from "./types";
import { removeLocalSkillSource } from "dotagents/source-registry";
import { sharedSkillsDir } from "./shared-skills";
import { linkOrCopy } from "./fsutil";

function expandHomePath(path: string): string {
	if (path.startsWith("~/")) {
		const stripped = path.slice(2).replace(/\//g, sep);
		return join(homedir(), stripped);
	}
	return path;
}

function removeEntry(path: string): void {
	let meta;
	try {
		meta = lstatSync(path);
	} catch (e: unknown) {
		if (e && typeof e === "object" && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT")
			return;
		throw e;
	}
	const ft = meta;
	if (meta.isSymbolicLink()) {
		if (process.platform === "win32") {
			try {
				const st = statSync(path);
				if (st.isDirectory()) {
					rmSync(path);
					return;
				}
			} catch {
				/* fall through */
			}
		}
		unlinkSync(path);
	} else if (ft.isDirectory()) {
		rmSync(path, { recursive: true, force: true });
	} else {
		rmSync(path, { force: true });
	}
}

function cleanupRegistryEntry(registryPath: string, skillId: string): void {
	if (!existsSync(registryPath)) return;
	const content = readFileSync(registryPath, "utf-8");
	let json: { skills?: { path?: string }[] };
	try {
		json = JSON.parse(content) as { skills?: { path?: string }[] };
	} catch {
		return;
	}
	if (!json.skills?.length) return;
	const before = json.skills.length;
	json.skills = json.skills.filter((item) => {
		const p = item.path;
		if (!p) return true;
		return !p.endsWith(`/${skillId}`) && !p.endsWith(`\\${skillId}`);
	});
	if (json.skills.length !== before) {
		writeFileSync(registryPath, JSON.stringify(json, null, 2), "utf-8");
	}
}

function rootContainsSkill(root: string, skillId: string): boolean {
	const direct = join(root, skillId);
	if (existsSync(direct)) return true;
	// Some readable roots can point directly at the skill folder itself.
	return basename(root) === skillId && existsSync(join(root, "SKILL.md"));
}

export function uninstallSkill(skillId: string, agentSlug: string, agents: AgentConfig[]): void {
	const agent = agents.find((a) => a.slug === agentSlug);
	if (!agent) throw new Error(`agent \`${agentSlug}\` not found`);

	if (agent.global_paths[0]) {
		const agentSkill = join(agent.global_paths[0], skillId);
		removeEntry(agentSkill);
	}

	const canonical = join(sharedSkillsDir(), skillId);
	if (existsSync(canonical)) {
		const stillReferenced = agents.some((a) => {
			if (a.slug === agentSlug) return false;
			return a.global_paths.some((root) => existsSync(join(root, skillId)));
		});
		if (!stillReferenced) {
			removeEntry(canonical);
			removeLocalSkillSource(skillId);
		}
	}

	// extra_config cleanup: this writes to files like ~/.codex/config.toml or
	// agent registry JSONs. These files are typically PER-AGENT. Cleaning
	// them on single-agent uninstall is correct *for the agent being removed*
	// — but only touch THIS agent's own extra_config, not some global one
	// that also references the skill for other agents. The previous logic
	// iterated `agent.extra_config` which is already per-agent, so this is
	// fine — the concern flagged in the audit (B5) doesn't actually apply
	// because each agent owns its own config file. Leaving a defensive guard:
	// only clean when the skill truly isn't referenced by this agent anymore
	// (we already removed it from global_paths above, so that's always true
	// at this point).
	if (agent.extra_config) {
		for (const cfg of agent.extra_config) {
			if (cfg.target_file) {
				const p = expandHomePath(cfg.target_file);
				if (existsSync(p)) {
					cleanupRegistryEntry(p, skillId);
				}
			}
		}
	}
}

/** Remove private agent entries only; shared sources and other agents stay intact. */
export function privateAgentSkillEntries(
  skillId: string,
  agentSlug: string,
  agents: AgentConfig[],
  skills: Skill[],
) {
  if (!/^[^./\\][^/\\]*$/.test(skillId) || skillId.includes('\0')) throw new Error('Invalid skill ID');
  const agent = agents.find(a => a.slug === agentSlug);
  const skill = skills.find(s => s.id === skillId);
  if (!agent || !skill || skill.collection) throw new Error('Agent skill not found');
  const entries = [...new Set(skill.installations.filter(i => i.agent_slug === agentSlug && !i.is_inherited).map(i => i.path))];
  if (!entries.length) throw new Error('This skill is available through a shared source');
  return entries.map(path => {
    if (!isAbsolute(path) || !agent.global_paths.some(root => resolve(join(root, skillId)) === resolve(path))) throw new Error('Invalid agent skill path');
    const parent = realpathSync(dirname(path));
    const meta = lstatSync(path);
    const destination = realpathSync(path);
    if (existsSync(sharedSkillsDir()) && parent === realpathSync(sharedSkillsDir())) throw new Error('Keep the shared library source');
    for (const other of agents) {
      if (other.slug === agentSlug) continue;
      for (const root of [...other.global_paths, ...other.additional_readable_paths.map(r => r.path)]) {
        if (!existsSync(root)) continue;
        const realRoot = realpathSync(root);
        if (realRoot === parent) throw new Error(`Keep the source used by ${other.name}`);
        if (!meta.isSymbolicLink()) {
          if (destination === realRoot || destination.startsWith(realRoot + sep)) throw new Error(`Keep the source used by ${other.name}`);
          if (existsSync(join(root, skillId)) && realpathSync(join(root, skillId)) === destination) throw new Error(`Keep the source used by ${other.name}`);
        }
      }
    }
    return { path, parent, destination, dev: meta.dev, ino: meta.ino };
  });
}

export async function trashAgentSkill(skillId: string, agentSlug: string, agents: AgentConfig[], skills: Skill[], trash: (path: string) => Promise<void>): Promise<void> {
  const entries = privateAgentSkillEntries(skillId, agentSlug, agents, skills);
  for (const entry of entries) {
    const meta = lstatSync(entry.path);
    if (meta.dev !== entry.dev || meta.ino !== entry.ino || realpathSync(dirname(entry.path)) !== entry.parent || realpathSync(entry.path) !== entry.destination) throw new Error('Agent skill changed; refresh and try again');
    await trash(entry.path);
  }
  const agent = agents.find(agent => agent.slug === agentSlug)!;
  if (!agent.additional_readable_paths.some(root => rootContainsSkill(root.path, skillId))) {
    for (const cfg of agent.extra_config ?? []) if (cfg.target_file) cleanupRegistryEntry(expandHomePath(cfg.target_file), skillId);
  }
}

export function uninstallSkillFromAll(skillId: string, agents: AgentConfig[]): void {
	uninstallDirectSkillFromAll(skillId, agents);
	const canonical = join(sharedSkillsDir(), skillId);
	removeEntry(canonical);
	removeLocalSkillSource(skillId);
}

/**
 * Remove only direct installations from every agent. The canonical shared
 * copy is intentionally retained so agents that inherit it keep access.
 */
export function uninstallDirectSkillFromAll(skillId: string, agents: AgentConfig[]): void {
	for (const agent of agents) {
		for (const root of agent.global_paths) {
			removeEntry(join(root, skillId));
		}
		if (agent.extra_config) {
			for (const cfg of agent.extra_config) {
				if (cfg.target_file) {
					const p = expandHomePath(cfg.target_file);
					if (existsSync(p)) {
						cleanupRegistryEntry(p, skillId);
					}
				}
			}
		}
	}
}

/**
 * "Detach" a skill from the shared `~/.agents/skills/` library so one specific
 * agent can stop seeing it while the others keep it. Needed because the
 * shared dir is read simultaneously by every agent that opts in — you can't
 * selectively uninstall from just Gemini if the skill physically lives there.
 *
 * Flow:
 *   1. Find every agent that currently inherits from shared dir.
 *   2. For each such agent EXCEPT `removeFromAgentSlug`: materialise the
 *      skill into that agent's own global_paths[0] via linkOrCopy (same
 *      primitive normal installs use). Result: they now have a direct copy.
 *   3. Delete the shared canonical dir. The target agent loses visibility
 *      (no direct install, no inherited source), everyone else keeps it.
 *
 * Tradeoff: after detach the skill is no longer tracked by the shared dir,
 * so git-pulls / dotfile updates to `.agents/` won't reach the detached
 * copies. The user trades "update-in-lockstep" for "per-agent control".
 */
export function detachSharedSkill(
	skillId: string,
	removeFromAgentSlug: string,
	agents: AgentConfig[],
): { preservedOn: string[]; removedFrom: string } {
	const canonicalDir = join(sharedSkillsDir(), skillId);
	if (!existsSync(canonicalDir)) {
		throw new Error(`shared skill not found: ${skillId}`);
	}
	let sharedReal: string;
	try {
		sharedReal = realpathSync(sharedSkillsDir());
	} catch {
		sharedReal = sharedSkillsDir();
	}

	const inheritingAgents = agents.filter((a) => {
		if (!a.detected) return false;
		return a.additional_readable_paths.some((rp) => {
			try {
				return realpathSync(rp.path) === sharedReal;
			} catch {
				return rp.path === sharedSkillsDir();
			}
		});
	});

	const preservedOn: string[] = [];
	for (const agent of inheritingAgents) {
		if (agent.slug === removeFromAgentSlug) continue;
		const gp = agent.global_paths[0];
		if (!gp) continue;
		mkdirSync(gp, { recursive: true });
		const target = join(gp, skillId);
		if (existsSync(target)) {
			rmSync(target, { recursive: true, force: true });
		}
		linkOrCopy(canonicalDir, target);
		preservedOn.push(agent.slug);
	}

	// Delete the shared canonical — this is what cuts visibility for
	// removeFromAgentSlug (and any other agent that ONLY reads from .agents
	// without its own global_paths entry).
	rmSync(canonicalDir, { recursive: true, force: true });
	// NOTE: keep provenance intact — the skill still exists on preservedOn
	// agents, and `update_skill` needs `provenance[skillId]` to know where to
	// pull new versions from. Removing provenance here would leave updates
	// broken on every agent we just materialised a copy into.

	return { preservedOn, removedFrom: removeFromAgentSlug };
}

export function unlinkInheritedSkillFromAgentConfigs(
	skillId: string,
	agents: AgentConfig[],
	agentsDir: string,
): number {
	const pathsByAgent = new Map<string, Set<string>>();

	for (const agent of agents) {
		for (const readable of agent.additional_readable_paths) {
			if (!rootContainsSkill(readable.path, skillId)) continue;
			const set = pathsByAgent.get(agent.slug) ?? new Set<string>();
			set.add(readable.path);
			pathsByAgent.set(agent.slug, set);
		}
	}

	if (pathsByAgent.size === 0) {
		throw new Error(`No inherited links found for skill \`${skillId}\``);
	}

	let updatedFiles = 0;
	for (const name of readdirSync(agentsDir)) {
		if (!name.endsWith(".toml")) continue;
		const path = join(agentsDir, name);
		let parsed: Record<string, unknown>;
		try {
			parsed = parseToml(readFileSync(path, "utf-8")) as Record<string, unknown>;
		} catch {
			continue;
		}

		const slug = String(parsed.slug ?? "");
		const toRemove = pathsByAgent.get(slug);
		if (!toRemove || toRemove.size === 0) continue;

		const arr = (parsed.additional_readable_paths as Array<{ path?: string; source_agent?: string }> | undefined) ?? [];
		const next = arr.filter((entry) => {
			const rawPath = typeof entry.path === "string" ? entry.path : "";
			const expanded = expandHomePath(rawPath);
			return !toRemove.has(expanded);
		});

		if (next.length === arr.length) continue;
		parsed.additional_readable_paths = next;
		const content = stringifyToml(parsed as Parameters<typeof stringifyToml>[0]);
		writeFileSync(path, content, "utf-8");
		updatedFiles += 1;
	}

	if (updatedFiles === 0) {
		throw new Error(`Found inherited links for \`${skillId}\` but could not update agent configs`);
	}
	return updatedFiles;
}
