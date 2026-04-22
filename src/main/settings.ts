import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { parse as parseToml, stringify as stringifyToml } from "@iarna/toml";
import type { AppSettingsJson, RepoEntryJson } from "../shared/rpc-schema";

const APP_DATA_DIR = ".skiller";
const LEGACY_APP_DATA_DIR = ".skills-app";

export function appDataRootPath(): string {
	return join(homedir(), APP_DATA_DIR);
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
