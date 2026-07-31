import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parseSkillMdFile } from "./parser";
import { planBundledSkillExport } from "./sync-export";
import { sharedSkillsDir } from "./shared-skills";
import type { AgentConfig } from "./types";

export type SyncInventoryLocationKind = "shared" | "agent-local" | "inherited";

export type SyncInventoryLocation = {
	agentSlug: string;
	kind: SyncInventoryLocationKind;
};

export type SyncInventoryItem = {
	/** Portable candidate key; becomes final only after collision review. */
	candidateKey: string;
	displayName: string;
	contentHash: string;
	/** Local-only source for staging; never exposed to the renderer or manifest. */
	sourcePath: string;
	locations: SyncInventoryLocation[];
};

export type SyncInventoryCollision = {
	displayName: string;
	candidateKeys: string[];
};

export type SyncInventory = {
	items: SyncInventoryItem[];
	collisions: SyncInventoryCollision[];
	invalidPaths: number;
};

type Root = { agentSlug: string; path: string; kind: SyncInventoryLocationKind };

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

function portableKey(name: string, hash: string): string {
	const normalized = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48) || "skill";
	return `${normalized}-${hash.slice(0, 8)}`;
}

function canonical(path: string): string | null {
	try {
		return realpathSync(path);
	} catch {
		return null;
	}
}

/**
 * Read-only raw inventory. It deliberately groups only byte-identical skills;
 * same-name differences stay visible as collisions for a human decision.
 */
export function scanSyncInventoryFromRoots(roots: Root[]): SyncInventory {
	const byHash = new Map<string, SyncInventoryItem>();
	const sharedRoot = canonical(sharedSkillsDir());
	let invalidPaths = 0;

	for (const root of roots) {
		if (!existsSync(root.path)) continue;
		for (const skillDir of collectSkillRoots(root.path)) {
			try {
				const actual = canonical(skillDir);
				if (!actual) throw new Error("unresolvable skill path");
				const parsed = parseSkillMdFile(join(actual, "SKILL.md"));
				const displayName = parsed.name?.trim() || basename(actual);
				const exportPlan = planBundledSkillExport("inventory-skill", actual);
				const item = byHash.get(exportPlan.sha256) ?? {
					candidateKey: portableKey(displayName, exportPlan.sha256),
					displayName,
					contentHash: exportPlan.sha256,
					sourcePath: actual,
					locations: [],
				};
				const kind: SyncInventoryLocationKind = sharedRoot && actual.startsWith(`${sharedRoot}/`)
					? "shared"
					: root.kind;
				if (!item.locations.some((location) => location.agentSlug === root.agentSlug && location.kind === kind)) {
					item.locations.push({ agentSlug: root.agentSlug, kind });
				}
				byHash.set(exportPlan.sha256, item);
			} catch {
				invalidPaths += 1;
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
		.map((group) => ({ displayName: group[0].displayName, candidateKeys: group.map((item) => item.candidateKey) }));
	return { items, collisions, invalidPaths };
}

export function scanSyncInventory(configs: AgentConfig[]): SyncInventory {
	const roots: Root[] = [];
	for (const agent of configs.filter((agent) => agent.detected)) {
		for (const path of agent.global_paths) roots.push({ agentSlug: agent.slug, path, kind: "agent-local" });
		for (const readable of agent.additional_readable_paths) {
			roots.push({ agentSlug: agent.slug, path: readable.path, kind: "inherited" });
		}
	}
	return scanSyncInventoryFromRoots(roots);
}
