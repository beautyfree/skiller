import { existsSync, lstatSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "@iarna/toml";
import type { AgentConfig } from "./types";
import { removeProvenance } from "./provenance";
import { sharedSkillsDir } from "./shared-skills";

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
			removeProvenance(skillId);
		}
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

export function uninstallSkillFromAll(skillId: string, agents: AgentConfig[]): void {
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
	const canonical = join(sharedSkillsDir(), skillId);
	removeEntry(canonical);
	removeProvenance(skillId);
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
