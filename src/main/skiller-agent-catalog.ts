import type { AgentDescriptor, Platform } from "dotagents";
import { agentCatalogEntryToDescriptor } from "dotagents";

export interface SkillerReadablePath {
  path: string;
  source_agent?: string;
}

export interface SkillerAgentConfigInput {
  slug: string;
  name: string;
  global_paths: string[];
  cli_command?: string | null;
  detect_paths: string[];
  additional_readable_paths?: SkillerReadablePath[];
}

export interface SkillerAgentCatalogOptions {
  platforms?: Platform[];
  sharedSkillsPath?: string;
}

/**
 * Transitional adapter while Skiller's TOML catalog remains authoritative.
 * It maps only portable capabilities; install commands and UI metadata stay in Skiller.
 */
export function skillerAgentConfigToDescriptor(
  config: SkillerAgentConfigInput,
  options: SkillerAgentCatalogOptions = {},
): AgentDescriptor {
  return agentCatalogEntryToDescriptor(
    {
      slug: config.slug,
      displayName: config.name,
      skillRoots: [...config.global_paths],
      ...(config.cli_command ? { command: config.cli_command } : {}),
      detectionMarkers: [...config.detect_paths],
      readableRoots: (config.additional_readable_paths ?? []).map((entry) => ({
        path: entry.path,
        sourceAgent: entry.source_agent ?? "unknown",
      })),
    },
    options,
  );
}

export function skillerAgentCatalogToDescriptors(
  configs: SkillerAgentConfigInput[],
  options: SkillerAgentCatalogOptions = {},
): AgentDescriptor[] {
  return configs
    .map((config) => skillerAgentConfigToDescriptor(config, options))
    .sort((left, right) => left.slug.localeCompare(right.slug, "en"));
}
