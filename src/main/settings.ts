import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { parse as parseToml, stringify as stringifyToml } from "@iarna/toml";
import type { AppSettingsJson, RepoEntryJson } from "../shared/rpc-schema";

export function settingsPath(): string {
	return join(homedir(), ".skills-app", "config.toml");
}

export function readSettings(): AppSettingsJson {
	const path = settingsPath();
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
