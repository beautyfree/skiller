import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { parse as parseToml, stringify as stringifyToml } from "@iarna/toml";
import type { AppSettingsJson, RepoEntryJson } from "../shared/rpc-schema";

const APP_DATA_DIR = ".skiller";
const LEGACY_APP_DATA_DIR = ".skills-app";

type Platform = NodeJS.Platform;

/** Native data roots for the platforms that do not conventionally use dotfiles. */
export function appDataRootPathFor(platform: Platform, home: string, env: NodeJS.ProcessEnv): string {
	if (platform === "win32") return join(env.APPDATA || join(home, "AppData", "Roaming"), "Skiller");
	if (platform === "linux") return join(env.XDG_DATA_HOME || join(home, ".local", "share"), "skiller");
	// Keep the established macOS location: moving it would collide with
	// Electron's unrelated userData directory on existing installations.
	return join(home, APP_DATA_DIR);
}

function legacyAppDataRootPath(): string {
	return join(homedir(), APP_DATA_DIR);
}

function migrateLegacyRoot(target: string): string {
	const legacy = legacyAppDataRootPath();
	if (target === legacy || existsSync(target) || !existsSync(legacy)) return target;
	try {
		mkdirSync(dirname(target), { recursive: true });
		renameSync(legacy, target);
		return target;
	} catch {
		// Keep using the original location if a cross-volume or permission error
		// prevents an atomic move. No settings or sync worktree is discarded.
		return legacy;
	}
}

export function appDataRootPath(): string {
	return migrateLegacyRoot(appDataRootPathFor(process.platform, homedir(), process.env));
}

function legacySettingsPath(): string {
	return join(homedir(), LEGACY_APP_DATA_DIR, "config.toml");
}

export function settingsPath(): string {
	return join(appDataRootPath(), "config.toml");
}

export function readSettings(): AppSettingsJson {
	const currentPath = settingsPath();
	const legacyPath = legacySettingsPath();
	const path = existsSync(currentPath) ? currentPath : legacyPath;
	if (!existsSync(path)) return {};
	try {
		const raw = readFileSync(path, "utf-8");
		return parseToml(raw) as AppSettingsJson;
	} catch {
		return {};
	}
}

export function writeSettings(settings: AppSettingsJson): void {
	const path = settingsPath();
	mkdirSync(dirname(path), { recursive: true });
	const content = stringifyToml(
		settings as Parameters<typeof stringifyToml>[0],
	);
	writeFileSync(path, content, "utf-8");
}

export type { RepoEntryJson };
