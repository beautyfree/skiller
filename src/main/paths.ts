import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { PATHS } from "electrobun/bun";

/**
 * Bundled agent TOMLs: Electrobun copies `agents` to `Resources/agents` (sibling of `app/`), not
 * `Resources/app/agents`. `PATHS.VIEWS_FOLDER` is `Resources/app/views`, so two `dirname`s reach
 * `Resources/`. Fallback: repo `./agents` (create if missing for first-run dev).
 */
export function getAgentsDir(): string {
	const resourcesRoot = dirname(dirname(PATHS.VIEWS_FOLDER));
	const packaged = join(resourcesRoot, "agents");
	if (existsSync(packaged)) return packaged;
	const cwdAgents = join(process.cwd(), "agents");
	if (existsSync(cwdAgents)) return cwdAgents;
	mkdirSync(cwdAgents, { recursive: true });
	return cwdAgents;
}

export function getTemplatesDir(): string {
	const viewsParent = dirname(PATHS.VIEWS_FOLDER);
	return join(viewsParent, "templates");
}
