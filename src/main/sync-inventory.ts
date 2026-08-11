import { basename } from "node:path";
import { discoverSkills, type DiscoveredGitSource } from "dotagents/discovery";
import { readLocalSkillSources } from "dotagents/source-registry";
import { sharedSkillsDir } from "./shared-skills";
import type { AgentConfig } from "./types";

export type SyncInventoryLocationKind = "shared" | "agent-local" | "inherited";
export type SyncInventoryLocation = { agentSlug?: string; kind: SyncInventoryLocationKind };
export type SyncInventoryItem = {
  candidateKey: string;
  displayName: string;
  description: string | null;
  whenToUse: string | null;
  contentHash: string;
  /** Native path remains in main process and is never sent to the renderer. */
  sourcePath: string;
  locations: SyncInventoryLocation[];
  gitSource?: DiscoveredGitSource;
  /** Portable-safe attribution for an independently editable fork. */
  forkedFrom?: { url: string; ref?: string; skillPath?: string };
};
export type SyncInventoryCollision = { displayName: string; candidateKeys: string[] };
export type SyncInventoryInvalidEntry = { displayName: string; reason: string; sourcePath: string };
export type SyncInventory = {
  items: SyncInventoryItem[];
  collisions: SyncInventoryCollision[];
  invalidPaths: number;
  invalidEntries: SyncInventoryInvalidEntry[];
  linkedAliases: number;
};
export type SyncInventoryRoot = { agentSlug?: string; path: string; kind: SyncInventoryLocationKind };

function orderedLocations(locations: SyncInventoryLocation[]): SyncInventoryLocation[] {
  const rank: Record<SyncInventoryLocationKind, number> = { shared: 0, "agent-local": 1, inherited: 2 };
  return [...locations].sort((left, right) => rank[left.kind] - rank[right.kind] || (left.agentSlug ?? "").localeCompare(right.agentSlug ?? "", "en"));
}

/** Global agent roots only. Project-local skills stay with their project Git repository. */
export function syncInventoryRoots(configs: AgentConfig[], sharedRoot = sharedSkillsDir()): SyncInventoryRoot[] {
  const roots: SyncInventoryRoot[] = [{ path: sharedRoot, kind: "shared" }];
  for (const agent of configs) {
    for (const path of agent.global_paths) roots.push({ agentSlug: agent.slug, path, kind: "agent-local" });
    for (const readable of agent.additional_readable_paths) {
      if (readable.source_agent !== "shared") roots.push({ agentSlug: agent.slug, path: readable.path, kind: "inherited" });
    }
  }
  return roots;
}

/** The sole runtime inventory path: discovery, dedupe, links and Git source evidence are dotagents-owned. */
export async function scanSyncInventoryWithDotagents(configs: AgentConfig[], sharedRoot = sharedSkillsDir()): Promise<SyncInventory> {
  const roots = syncInventoryRoots(configs, sharedRoot).map((root) => ({ path: root.path, kind: root.kind, ...(root.agentSlug ? { agent: root.agentSlug } : {}) }));
  const report = await discoverSkills(roots);
  const invalidEntries = new Map<string, SyncInventoryInvalidEntry>();
  for (const issue of report.issues) {
    if (issue.path) invalidEntries.set(issue.path, { displayName: basename(issue.path), reason: issue.message, sourcePath: issue.path });
  }
  const localSources = readLocalSkillSources();
  return {
    items: report.skills.map((skill) => {
      const local = localSources[skill.name];
      const upstream = local?.ownership === "forked" ? local.forked_from : null;
      const forkedFrom = upstream?.repository
        ? {
            url: upstream.repository,
            ...(upstream.ref ? { ref: upstream.ref } : {}),
            ...(upstream.skill_path ? { skillPath: upstream.skill_path } : {}),
          }
        : undefined;
      return {
      candidateKey: skill.candidateKey,
      displayName: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse,
      contentHash: skill.exportHash,
      sourcePath: skill.sourcePath,
      locations: orderedLocations(skill.locations.map((location) => ({ kind: location.kind, ...(location.agent ? { agentSlug: location.agent } : {}) }))),
      ...(skill.gitSource ? { gitSource: skill.gitSource } : {}),
      ...(forkedFrom ? { forkedFrom } : {}),
    };
    }).sort((left, right) => left.displayName.localeCompare(right.displayName)),
    collisions: report.collisions.map((collision) => ({ displayName: collision.name, candidateKeys: collision.candidateKeys })),
    invalidPaths: invalidEntries.size,
    invalidEntries: [...invalidEntries.values()].sort((left, right) => left.displayName.localeCompare(right.displayName)),
    linkedAliases: report.linkedAliases,
  };
}
