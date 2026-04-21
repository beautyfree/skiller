import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { sharedSkillsDir } from "./shared-skills";

export type ProvenanceEntry = {
	source: string;
	repository?: string | null;
	skill_path?: string | null;
	/** Git commit SHA pinned at install time (for reproducible re-install across devices). */
	ref?: string | null;
	/**
	 * When set, the skill content is mirrored into the sync repo at this relative
	 * path (e.g. "skills/my-custom"), and the lockfile records it as `kind: bundled`
	 * so other devices can materialise it without needing any remote origin.
	 */
	bundled_path?: string | null;
	installed_at?: string;
};

export function provenancePath(): string {
	return `${sharedSkillsDir()}/.provenance.json`;
}

export function readProvenance(): Record<string, ProvenanceEntry> {
	const path = provenancePath();
	if (!existsSync(path)) return {};
	try {
		const raw = readFileSync(path, "utf-8");
		return JSON.parse(raw) as Record<string, ProvenanceEntry>;
	} catch {
		return {};
	}
}

export function writeProvenance(
	skillId: string,
	source: string,
	repository: string | null | undefined,
	skillPath: string | null | undefined,
	ref?: string | null | undefined,
): void {
	const map = readProvenance();
	const now = String(Math.floor(Date.now() / 1000));
	map[skillId] = {
		source,
		repository: repository ?? null,
		skill_path: skillPath ?? null,
		ref: ref ?? null,
		installed_at: now,
	};
	writeFileSync(provenancePath(), JSON.stringify(map, null, 2), "utf-8");
}

export function removeProvenance(skillId: string): void {
	const map = readProvenance();
	if (map[skillId] === undefined) return;
	delete map[skillId];
	writeFileSync(provenancePath(), JSON.stringify(map, null, 2), "utf-8");
}

/** Set or clear `bundled_path` on an existing provenance entry (creates one if missing). */
export function setBundledPath(skillId: string, bundledPath: string | null): void {
	const map = readProvenance();
	const entry = map[skillId] ?? { source: "local" };
	entry.bundled_path = bundledPath;
	map[skillId] = entry;
	writeFileSync(provenancePath(), JSON.stringify(map, null, 2), "utf-8");
}

/** Raw entries for scanner source resolution (Rust-compatible). */
export function readProvenanceRaw(): Record<string, Record<string, unknown>> {
	const path = provenancePath();
	if (!existsSync(path)) return {};
	try {
		const raw = readFileSync(path, "utf-8");
		return JSON.parse(raw) as Record<string, Record<string, unknown>>;
	} catch {
		return {};
	}
}
