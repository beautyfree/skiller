import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Packaged-bundle root where the host (Electrobun or Electron) copies
 * `agents/` and `templates/`. Must be set at startup by whichever host is
 * running (see `src/bun/index.ts` and `src/electron-main/index.ts`). If left
 * unset, `getAgentsDir` / `getTemplatesDir` fall back to the repo layout so
 * `bun run dev:vite` / `electron-vite dev` keep working.
 */
let packagedResourcesDir: string | null = null;
let packagedViewsDir: string | null = null;

export function setPackagedResourcesDir(dir: string): void {
	packagedResourcesDir = dir;
}

export function setPackagedViewsDir(dir: string): void {
	packagedViewsDir = dir;
}

export function getAgentsDir(): string {
	if (packagedResourcesDir) {
		const packaged = join(packagedResourcesDir, "agents");
		if (existsSync(packaged)) return packaged;
	}
	const cwdAgents = join(process.cwd(), "agents");
	if (existsSync(cwdAgents)) return cwdAgents;
	mkdirSync(cwdAgents, { recursive: true });
	return cwdAgents;
}

export function getTemplatesDir(): string {
	if (packagedViewsDir) {
		return join(packagedViewsDir, "templates");
	}
	return join(process.cwd(), "templates");
}
