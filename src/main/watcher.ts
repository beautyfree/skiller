import { existsSync, mkdirSync } from "node:fs";
import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import { detectAgents, loadAgentConfigs } from "./registry";
import { getAgentsDir } from "./paths";
import { join, sep } from "node:path";
import type { AgentConfig } from "./types";
import { sharedSkillsDir } from "./shared-skills";

function collectWatchPaths(agents: AgentConfig[]): string[] {
	const paths: string[] = [];
	for (const a of agents) {
		if (!a.detected && a.global_paths.length === 0) continue;
		for (const p of a.global_paths) {
			if (existsSync(p)) paths.push(p);
		}
	}
	const shared = sharedSkillsDir();
	try {
		mkdirSync(shared, { recursive: true });
	} catch {
		/* ignore */
	}
	if (existsSync(shared)) paths.push(shared);
	paths.sort();
	return [...new Set(paths)];
}

function buildWatchGlobs(roots: string[]): string[] {
	const globs: string[] = [];
	for (const root of roots) {
		// Watch only SKILL.md files recursively; scanning entire trees can block startup.
		const glob = join(root, "**", "SKILL.md");
		globs.push(sep === "\\" ? glob.split("\\").join("/") : glob);
	}
	globs.sort();
	return [...new Set(globs)];
}

/**
 * Watch skill dirs and debounce (parity with Rust notify + 500ms debounce).
 * Returns a dispose function.
 */
export function startSkillWatcher(onChange: () => void): () => void {
	let configs: AgentConfig[];
	try {
		configs = detectAgents(loadAgentConfigs(getAgentsDir()));
	} catch {
		return () => {};
	}
	const paths = collectWatchPaths(configs);
	const watchGlobs = buildWatchGlobs(paths);
	if (watchGlobs.length === 0) return () => {};

	let timer: ReturnType<typeof setTimeout> | null = null;
	const debounceMs = 500;

	const fire = () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			onChange();
		}, debounceMs);
	};

	let watcher: FSWatcher;
	try {
		watcher = chokidar.watch(watchGlobs, {
			ignoreInitial: true,
			awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
		});
	} catch {
		return () => {};
	}

	watcher.on("all", () => fire());

	return () => {
		if (timer) clearTimeout(timer);
		void watcher.close();
	};
}
