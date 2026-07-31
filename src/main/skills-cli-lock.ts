import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type SkillsCliLockEntry = {
	name: string;
	source: string;
	source_type: string;
	source_url: string;
	ref: string | null;
	skill_path: string | null;
	updated_at: string;
};

export type SkillsCliLock = {
	path: string;
	version: number;
	skills: SkillsCliLockEntry[];
};

export function getSkillsCliLockPath(env = process.env, home = homedir()): string {
	return env.XDG_STATE_HOME?.trim()
		? join(env.XDG_STATE_HOME, "skills", ".skill-lock.json")
		: join(home, ".agents", ".skill-lock.json");
}

/** Read Skills CLI v3 metadata without modifying its lock file. */
export function readSkillsCliLock(path = getSkillsCliLockPath()): SkillsCliLock | null {
	if (!existsSync(path)) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const lock = parsed as { version?: unknown; skills?: unknown };
	if (typeof lock.version !== "number" || !lock.skills || typeof lock.skills !== "object") return null;
	const skills = Object.entries(lock.skills as Record<string, unknown>)
		.flatMap(([name, value]) => {
			if (!value || typeof value !== "object") return [];
			const entry = value as Record<string, unknown>;
			if (
				typeof entry.source !== "string" ||
				typeof entry.sourceType !== "string" ||
				typeof entry.sourceUrl !== "string"
			) return [];
			return [{
				name,
				source: entry.source,
				source_type: entry.sourceType,
				source_url: entry.sourceUrl,
				ref: typeof entry.ref === "string" ? entry.ref : null,
				skill_path: typeof entry.skillPath === "string" ? entry.skillPath : null,
				updated_at: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
			}];
		})
		.sort((a, b) => a.name.localeCompare(b.name));
	return { path, version: lock.version, skills };
}
