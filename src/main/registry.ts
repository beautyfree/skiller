import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parse as parseToml } from "@iarna/toml";
import { builtinAgentCatalogEntry } from "dotagents/catalog";
import which from "which";
import { expandHome } from "./fsutil";
import type { AgentConfig, ReadablePath } from "./types";
import { defaultAgentConfig } from "./types";

export class RegistryError extends Error {
	constructor(
		message: string,
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = "RegistryError";
	}
}

function commandExists(cmd: string): boolean {
	try {
		which.sync(cmd);
		return true;
	} catch {
		return false;
	}
}

export function loadAgentConfigs(dir: string): AgentConfig[] {
	const configs: AgentConfig[] = [];
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch (e) {
		throw new RegistryError(`failed to read agent config directory: ${dir}`, e);
	}
	for (const name of entries) {
		if (!name.endsWith(".toml")) continue;
		const path = join(dir, name);
		let raw: string;
		try {
			raw = readFileSync(path, "utf-8");
		} catch (e) {
			throw new RegistryError(`failed to read ${path}`, e);
		}
		let parsed: Record<string, unknown>;
		try {
			parsed = parseToml(raw) as Record<string, unknown>;
		} catch (e) {
			throw new RegistryError(`failed to parse TOML \`${path}\``, e);
		}
		const slug = String(parsed.slug ?? "");
		const builtin = builtinAgentCatalogEntry(slug);
		const displayName = builtin?.displayName ?? String(parsed.name ?? slug);
		const cfg = defaultAgentConfig({
			slug,
			name: displayName,
			enabled: parsed.enabled !== false,
			global_paths: (builtin?.skillRoots ?? (parsed.global_paths as string[] | undefined) ?? []).map((p) => expandHome(p)),
			project_skills_dir: builtin?.projectSkillsDir ?? (parsed.project_skills_dir as string | undefined),
			skill_format: (parsed.skill_format as AgentConfig["skill_format"]) ?? "skill-md",
			extra_config: parsed.extra_config as AgentConfig["extra_config"],
			hooks: parsed.hooks as AgentConfig["hooks"],
			additional_readable_paths: builtin
				? builtin.readableRoots.map((root) => ({ path: expandHome(root.path), source_agent: root.sourceAgent }))
				: (parsed.additional_readable_paths as ReadablePath[] | undefined)?.map((rp) => ({
						...rp,
						path: expandHome(rp.path),
					})) ?? [],
			cli_command: builtin ? builtin.command ?? null : parsed.cli_command as string | null | undefined,
			install_command: parsed.install_command as string | null | undefined,
			install_command_windows: parsed.install_command_windows as string | null | undefined,
			install_command_linux: parsed.install_command_linux as string | null | undefined,
			install_docs_url: parsed.install_docs_url as string | null | undefined,
			install_docs_url_linux: parsed.install_docs_url_linux as string | null | undefined,
			install_source_label: parsed.install_source_label as string | null | undefined,
			detect_paths: (builtin?.detectionMarkers ?? (parsed.detect_paths as string[] | undefined) ?? []).map((p) => expandHome(p)),
		});
		configs.push(cfg);
	}
	configs.sort((a, b) => a.slug.localeCompare(b.slug));
	return configs;
}

export function detectAgents(configs: AgentConfig[]): AgentConfig[] {
	return configs.map((cfg) => detectAgent(cfg));
}

function detectAgent(config: AgentConfig): AgentConfig {
	if (config.cli_command && commandExists(config.cli_command)) {
		return { ...config, detected: true, detection_reason: "cli" };
	}

	const marker = config.detect_paths.find((path) => existsSync(path));
	if (!marker) return { ...config, detected: false, detection_reason: "not-found" };
	if (isSkillsOnlyMarker(marker, config.global_paths)) {
		return { ...config, detected: false, detection_reason: "skills-only" };
	}
	return { ...config, detected: true, detection_reason: "marker" };
}

/**
 * A previous Skiller install may have created an agent's detection directory
 * solely to place its `skills` directory inside it. That is not evidence that
 * the agent itself is installed, and treating it as such causes subsequent
 * batch installs to target the same absent agent again.
 */
function isSkillsOnlyMarker(markerPath: string, globalPaths: string[]): boolean {
	const nestedSkillPaths = globalPaths
		.map((path) => relative(markerPath, path))
		.filter((path) => path && !path.startsWith(`..${sep}`) && path !== "..");
	if (nestedSkillPaths.length === 0) return false;

	const pathSegments = nestedSkillPaths.map((path) => path.split(sep));
	return containsOnlySkillPathBranches(markerPath, pathSegments);
}

function containsOnlySkillPathBranches(dir: string, paths: string[][]): boolean {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return false;
	}
	if (entries.length === 0) return false;

	for (const entry of entries) {
		const matching = paths.filter(([head]) => head === entry);
		if (matching.length === 0) return false;

		const descendants = matching
			.filter((path) => path.length > 1)
			.map(([, ...rest]) => rest);
		if (descendants.length > 0 && !containsOnlySkillPathBranches(join(dir, entry), descendants)) {
			return false;
		}
	}
	return true;
}
