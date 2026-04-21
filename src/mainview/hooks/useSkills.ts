import { useQuery } from "@tanstack/react-query";
import { invoke } from "@/mainview/lib/native";

export interface SkillInstallation {
  agent_slug: string;
  path: string;
  is_symlink: boolean;
  is_inherited: boolean;
  inherited_from: string | null;
}

export type SkillScope =
  | { type: "SharedGlobal" }
  | { type: "AgentLocal"; agent: string };

export interface Skill {
  id: string;
  name: string;
  description: string | null;
  when_to_use?: string | null;
  canonical_path: string;
  source: unknown;
  metadata: unknown;
  collection: string | null;
  scope: SkillScope;
  installations: SkillInstallation[];
  /** Listing estimate: raw len(description + when_to_use) before per-skill cap. */
  footprint_listing_source_chars?: number;
  footprint_listing_slice_chars?: number;
  footprint_name_chars?: number;
  footprint_skill_md_chars?: number;
  listing_excluded?: boolean;
  /** When set, skill is mirrored into the sync repo at this relative path (Phase-4 bundling). */
  bundled_path?: string | null;
}

/** Direct (non-inherited) agent slugs */
export function installedAgents(skill: Skill): string[] {
  return skill.installations
    .filter((i) => !i.is_inherited)
    .map((i) => i.agent_slug);
}

/** All agent slugs including inherited */
export function allAgents(skill: Skill): string[] {
  return skill.installations.map((i) => i.agent_slug);
}

/** Get the install path for a specific agent */
export function agentPath(skill: Skill, agentSlug: string): string | undefined {
  return skill.installations.find((i) => i.agent_slug === agentSlug)?.path;
}

export function useSkills() {
  return useQuery<Skill[]>({
    queryKey: ["skills"],
    queryFn: async () => (await invoke("scan_all_skills")) as Skill[],
    staleTime: 30 * 1000, // filesystem scan is cheap but avoid on every mount
  });
}

export function useAgentSkills(agentSlug: string) {
  return useQuery<Skill[]>({
    queryKey: ["skills", agentSlug],
    queryFn: async () =>
      (await invoke("scan_agent_skills", { agentSlug })) as Skill[],
    enabled: !!agentSlug,
    staleTime: 30 * 1000,
  });
}
