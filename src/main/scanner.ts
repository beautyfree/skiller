import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { computeSkillFootprint } from "../shared/skill-footprint";
import type { ParsedSkillMd } from "./parser";
import type { AgentConfig } from "./types";
import { parseSkillMdFile } from "./parser";
import { readProvenanceRaw } from "./provenance";
import { isSymlink, resolveCanonical } from "./fsutil";
import type { Skill, SkillInstallation, SkillScope, SkillSource } from "./skill-types";

export type SkillCandidate = {
	dir: string;
	parsed_name?: string;
};

/** Recursively find directories containing SKILL.md (skips `.git`). */
export function discoverSkillDirs(root: string): SkillCandidate[] {
	const candidates: SkillCandidate[] = [];

	function walk(dir: string): void {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const name of entries) {
			if (name === ".git") continue;
			const path = join(dir, name);
			try {
				const st = statSync(path);
				if (st.isDirectory()) {
					const skillMd = join(path, "SKILL.md");
					if (existsSync(skillMd)) {
						let parsed_name: string | undefined;
						try {
							parsed_name = parseSkillMdFile(skillMd).name;
						} catch {
							parsed_name = undefined;
						}
						candidates.push({ dir: path, parsed_name });
					}
					walk(path);
				}
			} catch {
				/* ignore */
			}
		}
	}

	walk(root);

	const rootSkillMd = join(root, "SKILL.md");
	if (existsSync(rootSkillMd)) {
		let parsed_name: string | undefined;
		try {
			parsed_name = parseSkillMdFile(rootSkillMd).name;
		} catch {
			parsed_name = undefined;
		}
		candidates.push({ dir: root, parsed_name });
	}

	return candidates;
}

/** Max directory depth walked when discovering nested skill packages. */
const MAX_SCAN_DEPTH = 8;

/**
 * Recursively collect directories that contain a `SKILL.md`, supporting nested
 * skill packages (e.g. `skills/Pkg/skills/className/leaf/SKILL.md`). Descent
 * stops at the first `SKILL.md` so a skill's own resource subfolders are not
 * mistaken for separate skills. Follows symlinks, skips `.git`, depth-capped.
 */
function collectSkillRoots(root: string): string[] {
	const found: string[] = [];

	function walk(dir: string, depth: number): void {
		if (depth > MAX_SCAN_DEPTH) return;
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const name of entries) {
			if (name === ".git") continue;
			const path = join(dir, name);
			let st;
			try {
				st = statSync(path); // follow symlinks so symlinked skill dirs resolve
			} catch {
				continue;
			}
			if (!st.isDirectory()) continue;
			if (existsSync(join(path, "SKILL.md"))) {
				found.push(path);
				continue; // a skill dir is a leaf — don't descend into its resources
			}
			walk(path, depth + 1);
		}
	}

	walk(root, 0);
	return found;
}

function detectCollection(skillDir: string, skillsRoot: string): string | undefined {
	if (isSymlink(skillDir)) {
		const c = collectionFromRealPath(skillDir, skillsRoot);
		if (c) return c;
	}
	const skillMd = join(skillDir, "SKILL.md");
	if (isSymlink(skillMd)) {
		try {
			const realMd = resolveCanonical(skillMd);
			const realDir = dirname(realMd);
			return collectionFromRealPath(realDir, skillsRoot);
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function collectionFromRealPath(realOrLink: string, skillsRoot: string): string | undefined {
	let real: string;
	let rootCanon: string;
	try {
		real = resolveCanonical(realOrLink);
		rootCanon = resolveCanonical(skillsRoot);
	} catch {
		return undefined;
	}
	if (!real.startsWith(rootCanon)) return undefined;
	const relative = real.slice(rootCanon.length).replace(/^[/\\]/, "");
	const parts = relative.split(/[/\\]/).filter(Boolean);
	if (parts.length >= 2) return parts[0];
	return undefined;
}

function listingFootprintFromParsed(parsed: ParsedSkillMd, rawName: string, dirName: string) {
	const fp = computeSkillFootprint({
		description: parsed.description,
		when_to_use: parsed.when_to_use,
		disable_model_invocation: parsed.disable_model_invocation,
		skill_md_char_count: parsed.skill_md_char_count,
		display_name: rawName,
		skill_id: dirName,
	});
	return {
		when_to_use: parsed.when_to_use ?? null,
		footprint_listing_source_chars: fp.footprint_listing_source_chars,
		footprint_listing_slice_chars: fp.footprint_listing_slice_chars,
		footprint_name_chars: fp.footprint_name_chars,
		footprint_skill_md_chars: fp.footprint_skill_md_chars,
		listing_excluded: fp.listing_excluded,
	};
}

function resolveSource(
	skillId: string,
	canonical: string,
	provenance: Record<string, Record<string, unknown>>,
): SkillSource {
	const entry = provenance[skillId];
	if (entry) {
		const src = String(entry.source ?? "");
		const repo = entry.repository != null ? String(entry.repository) : undefined;
		const skillPath = entry.skill_path != null ? String(entry.skill_path) : undefined;
		if (src === "skills.sh") return { kind: "SkillsSh", repository: repo ?? null };
		if (src === "clawhub") return { kind: "ClawHub", repository: repo ?? null };
		if (src === "git") {
			return { kind: "GitRepository", repo_url: repo ?? "", skill_path: skillPath ?? null };
		}
	}
	return { kind: "LocalPath", path: canonical };
}

function mergeSkill(dedup: Map<string, Skill>, key: string, incoming: Skill): void {
	const existing = dedup.get(key);
	if (existing) {
		if (existing.collection == null && incoming.collection != null) {
			existing.collection = incoming.collection;
		}
		for (const inst of incoming.installations) {
			const dominated = existing.installations.some((e) => e.agent_slug === inst.agent_slug);
			if (!dominated) existing.installations.push(inst);
		}
		const distinct = new Set(
			existing.installations.filter((i) => !i.is_inherited).map((i) => i.agent_slug),
		);
		if (distinct.size > 1) {
			existing.scope = { kind: "SharedGlobal" };
		}
		return;
	}
	dedup.set(key, incoming);
}

function scanInheritedRoot(
	root: string,
	agent: AgentConfig,
	sourceAgent: string,
	dedup: Map<string, Skill>,
	provenance: Record<string, Record<string, unknown>>,
): void {
	for (const skillDir of collectSkillRoots(root)) {
		const canonical = resolveCanonical(skillDir);
		const skillMd = join(canonical, "SKILL.md");
		if (!existsSync(skillMd)) continue;
		let parsed;
		try {
			parsed = parseSkillMdFile(skillMd);
		} catch (e) {
			console.error(`skipping ${skillMd}:`, e);
			continue;
		}
		if (parsed.description == null) continue;

		const dirName = basename(skillDir);
		const collection = detectCollection(skillDir, root);
		const skillName = parsed.name ?? dirName;
		const fp = listingFootprintFromParsed(parsed, skillName, dirName);

		const installation: SkillInstallation = {
			agent_slug: agent.slug,
			path: skillDir,
			is_symlink: isSymlink(skillDir),
			is_inherited: true,
			inherited_from: sourceAgent,
		};

		mergeSkill(dedup, dirName, {
			id: dirName,
			name: skillName,
			description: parsed.description,
			...fp,
			canonical_path: canonical,
			source: resolveSource(dirName, canonical, provenance),
			metadata: parsed.metadata,
			collection,
			scope: { kind: "SharedGlobal" },
			installations: [installation],
			bundled_path: (provenance[dirName]?.bundled_path as string | undefined) ?? null,
		});
	}
}

function scanSkillMdRoot(
	root: string,
	agent: AgentConfig,
	dedup: Map<string, Skill>,
	provenance: Record<string, Record<string, unknown>>,
): void {
	for (const skillDir of collectSkillRoots(root)) {
		const canonical = resolveCanonical(skillDir);
		const skillMd = join(canonical, "SKILL.md");
		if (!existsSync(skillMd)) continue;
		let parsed;
		try {
			parsed = parseSkillMdFile(skillMd);
		} catch (e) {
			console.error(`skipping ${skillMd}:`, e);
			continue;
		}
		if (parsed.description == null) continue;

		const dirName = basename(skillDir);
		const rawName = parsed.name ?? dirName;
		const symlink = isSymlink(skillDir);
		const collection = detectCollection(skillDir, root);
		const skillId = dirName;
		const fp = listingFootprintFromParsed(parsed, rawName, dirName);

		const installation: SkillInstallation = {
			agent_slug: agent.slug,
			path: skillDir,
			is_symlink: symlink,
			is_inherited: false,
			inherited_from: null,
		};

		const scope: SkillScope = { kind: "AgentLocal", agent: agent.slug };

		mergeSkill(dedup, dirName, {
			id: skillId,
			name: rawName,
			description: parsed.description,
			...fp,
			canonical_path: canonical,
			source: resolveSource(skillId, canonical, provenance),
			metadata: parsed.metadata,
			collection,
			scope,
			installations: [installation],
			bundled_path: (provenance[skillId]?.bundled_path as string | undefined) ?? null,
		});
	}
}

export function scanAllSkills(configs: AgentConfig[]): Skill[] {
	const dedup = new Map<string, Skill>();
	const provenance = readProvenanceRaw();

	for (const agent of configs.filter((cfg) => cfg.detected || cfg.global_paths.length > 0)) {
		for (const root of agent.global_paths) {
			if (!existsSync(root)) continue;
			scanSkillMdRoot(root, agent, dedup, provenance);
		}
	}

	for (const agent of configs.filter((cfg) => cfg.detected)) {
		for (const readable of agent.additional_readable_paths) {
			if (!existsSync(readable.path)) continue;
			scanInheritedRoot(readable.path, agent, readable.source_agent, dedup, provenance);
		}
	}

	const items = [...dedup.values()];
	items.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
	return items;
}

export function allAgentSlugs(skill: Skill): string[] {
	return skill.installations.map((i) => i.agent_slug);
}
