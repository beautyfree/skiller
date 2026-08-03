import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import { parseSkillMdFile } from "./parser";
import { planBundledSkillExport } from "./sync-export";
import { sharedSkillsDir } from "./shared-skills";
import type { AgentConfig } from "./types";

export type SyncInventoryLocationKind = "shared" | "agent-local" | "inherited";

export type SyncInventoryLocation = {
	/** Omitted for the canonical shared library: it belongs to no agent. */
	agentSlug?: string;
	kind: SyncInventoryLocationKind;
};

export type SyncInventoryItem = {
	/** Portable candidate key; becomes final only after collision review. */
	candidateKey: string;
	displayName: string;
	/** Read-only frontmatter summary, shown before a user chooses it for a library. */
	description: string | null;
	whenToUse: string | null;
	contentHash: string;
	/** Local-only source for staging; never exposed to the renderer or manifest. */
	sourcePath: string;
	locations: SyncInventoryLocation[];
};

export type SyncInventoryCollision = {
	displayName: string;
	candidateKeys: string[];
};

export type SyncInventoryInvalidEntry = {
	displayName: string;
	reason: string;
};

export type SyncInventory = {
	items: SyncInventoryItem[];
	collisions: SyncInventoryCollision[];
	invalidPaths: number;
	invalidEntries: SyncInventoryInvalidEntry[];
	/** SKILL.md aliases whose canonical skill is discovered elsewhere in the same library. */
	linkedAliases: number;
};

type Root = { agentSlug?: string; path: string; kind: SyncInventoryLocationKind };

function collectSkillRoots(root: string): string[] {
	// Importing scanner's private traversal would make a safety-critical inventory
	// depend on its presentation deduplication. Keep this traversal intentionally
	// small and skip a skill's resources once its SKILL.md is found.
	const result: string[] = [];
	const visit = (directory: string, depth: number): void => {
		if (depth > 8) return;
		let entries: string[];
		try {
			entries = readdirSync(directory).sort();
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry === ".git" || entry === "node_modules") continue;
			const candidate = join(directory, entry);
			try {
				const stat = statSync(candidate);
				if (!stat.isDirectory()) continue;
				if (existsSync(join(candidate, "SKILL.md"))) result.push(candidate);
				else visit(candidate, depth + 1);
			} catch {
				// An unreadable or dangling entry is not safe to sync.
			}
		}
	};
	if (existsSync(join(root, "SKILL.md"))) result.push(root);
	visit(root, 0);
	return result;
}

function portableBaseKey(name: string): string {
	const normalized = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48) || "skill";
	return normalized;
}

function canonical(path: string): string | null {
	try {
		return realpathSync(path);
	} catch {
		return null;
	}
}

function isInternalSkillMarkdownAlias(skillDir: string, root: string): boolean {
	try {
		const skillMarkdown = join(skillDir, "SKILL.md");
		if (!lstatSync(skillMarkdown).isSymbolicLink()) return false;
		const target = realpathSync(skillMarkdown);
		const relativeTarget = relative(realpathSync(root), target);
		return relativeTarget !== "" && !relativeTarget.startsWith("..") && !isAbsolute(relativeTarget);
	} catch {
		return false;
	}
}

function inventoryErrorReason(error: unknown): string {
	const message = error instanceof Error ? error.message : "";
	if (message.startsWith("Sync export rejects symlink")) return "Contains a linked file, so Skiller will not follow it outside this skill.";
	if (message.startsWith("Sync export exceeds")) return "Exceeds the safety limit for a portable skill bundle.";
	if (message.startsWith("Sync export requires SKILL.md")) return "Its SKILL.md file could not be read.";
	return "Could not be read safely.";
}

/**
 * Read-only raw inventory. It deliberately groups only byte-identical skills;
 * same-name differences stay visible as collisions for a human decision.
 */
export function scanSyncInventoryFromRoots(roots: Root[]): SyncInventory {
	const byHash = new Map<string, SyncInventoryItem>();
	let invalidPaths = 0;
	const invalidEntries: SyncInventoryInvalidEntry[] = [];
	let linkedAliases = 0;

	for (const root of roots) {
		if (!existsSync(root.path)) continue;
		for (const skillDir of collectSkillRoots(root.path)) {
			// A SKILL.md symlink that resolves inside this managed root is an
			// alias, not an independently exportable skill. Its canonical source
			// is traversed by this inventory, so do not present it as broken.
			if (isInternalSkillMarkdownAlias(skillDir, root.path)) {
				linkedAliases += 1;
				continue;
			}
			try {
				const actual = canonical(skillDir);
				if (!actual) throw new Error("unresolvable skill path");
				const parsed = parseSkillMdFile(join(actual, "SKILL.md"));
				const displayName = parsed.name?.trim() || basename(actual);
				const exportPlan = planBundledSkillExport("inventory-skill", actual);
				const item = byHash.get(exportPlan.sha256) ?? {
					candidateKey: portableBaseKey(displayName),
					displayName,
					description: parsed.description?.trim() || null,
					whenToUse: parsed.when_to_use?.trim() || null,
					contentHash: exportPlan.sha256,
					sourcePath: actual,
					locations: [],
				};
				// The root, rather than its canonical destination, defines ownership.
				// A symlink placed in an agent's own folder is a real agent link;
				// the canonical ~/.agents/skills root is one shared source, never one
				// pseudo-installation per agent that happens to read it.
				const kind = root.kind;
				if (!item.locations.some((location) => location.agentSlug === root.agentSlug && location.kind === kind)) {
					item.locations.push(root.agentSlug ? { agentSlug: root.agentSlug, kind } : { kind });
				}
				byHash.set(exportPlan.sha256, item);
			} catch (error) {
				invalidPaths += 1;
				invalidEntries.push({ displayName: basename(skillDir), reason: inventoryErrorReason(error) });
			}
		}
	}

	const items = [...byHash.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
	const sameName = new Map<string, SyncInventoryItem[]>();
	for (const item of items) {
		const key = item.displayName.trim().toLocaleLowerCase();
		sameName.set(key, [...(sameName.get(key) ?? []), item]);
	}
	const collisions = [...sameName.values()]
		.filter((group) => group.length > 1)
		.map((group) => {
			// Only an actual collision gets a content-derived suffix. A normal edit
			// of a unique skill retains its portable identity across machines.
			for (const item of group) item.candidateKey = `${portableBaseKey(item.displayName)}-${item.contentHash.slice(0, 8)}`;
			return { displayName: group[0].displayName, candidateKeys: group.map((item) => item.candidateKey) };
		});
	return { items, collisions, invalidPaths, invalidEntries, linkedAliases };
}

export function scanSyncInventory(configs: AgentConfig[]): SyncInventory {
	const roots: Root[] = [{ path: sharedSkillsDir(), kind: "shared" }];
	for (const agent of configs.filter((agent) => agent.detected)) {
		for (const path of agent.global_paths) roots.push({ agentSlug: agent.slug, path, kind: "agent-local" });
		for (const readable of agent.additional_readable_paths) {
			if (readable.source_agent !== "shared") roots.push({ agentSlug: agent.slug, path: readable.path, kind: "inherited" });
		}
	}
	return scanSyncInventoryFromRoots(roots);
}
