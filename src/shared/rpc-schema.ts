import type { ElectrobunRPCSchema } from "electrobun";

/** Shared JSON types — SkillSource uses Rust default (externally tagged enum) */
export type SkillSourceJson =
  | { LocalPath: { path: string } }
  | { GitRepository: { repo_url: string; skill_path?: string | null } }
  | { SkillsSh: { repository?: string | null } }
  | { ClawHub: { repository?: string | null } }
  | "Unknown";

export type SkillScopeJson =
  | { type: "SharedGlobal" }
  | { type: "AgentLocal"; agent: string };

export type SkillInstallationJson = {
  agent_slug: string;
  path: string;
  is_symlink: boolean;
  is_inherited: boolean;
  inherited_from?: string | null;
};

export type SkillJson = {
  id: string;
  name: string;
  description?: string | null;
  canonical_path: string;
  source?: SkillSourceJson | null;
  metadata?: unknown;
  collection?: string | null;
  scope: SkillScopeJson;
  installations: SkillInstallationJson[];
};

export type AgentConfigJson = {
  slug: string;
  name: string;
  enabled: boolean;
  global_paths: string[];
  skill_format?: string;
  extra_config?: unknown;
  hooks?: unknown;
  additional_readable_paths: { path: string; source_agent: string }[];
  cli_command?: string | null;
  install_command?: string | null;
  install_command_windows?: string | null;
  install_docs_url?: string | null;
  install_source_label?: string | null;
  detect_paths: string[];
  detected: boolean;
};

export type RepoEntryJson = {
  repo_url?: string | null;
  local_path?: string | null;
  last_synced?: string | null;
};

export type AppSettingsJson = {
  theme?: string | null;
  language?: string | null;
  path_overrides?: Record<string, string[]> | null;
  repos?: RepoEntryJson[] | null;
  close_action?: string | null;
  /** macOS translucent window + NSVisualEffectView; default true when omitted */
  macos_window_blur?: boolean | null;
};

export type MarketplaceSkillJson = {
  name: string;
  description?: string | null;
  author?: string | null;
  repository?: string | null;
  installs?: number | null;
  source: string;
};

export type SkillRepoJson = {
  id: string;
  name: string;
  description?: string | null;
  repo_url: string;
  local_path: string;
  last_synced?: string | null;
  skill_count: number;
};

export type AddRepoResultJson = {
  repo: SkillRepoJson;
  skills: SkillJson[];
};

export type UpdateProgressJson = {
  done: number;
  total: number;
  current_skill: string;
};

export type UpdateAllResultJson = {
  updated: string[];
  failed: [string, string][];
  skipped: number;
};

export type RepoProgressJson = {
  stage: string;
  detail?: string | null;
};

/** Mirrors electrobun/bun Updater's own snapshot. */
export type AppUpdateStatusJson = {
  /** High-level lifecycle state so the UI can pick the right label/affordance. */
  state:
    | "idle"
    | "checking"
    | "up-to-date"
    | "available"
    | "downloading"
    | "ready"
    | "error";
  localVersion: string;
  localHash: string;
  channel: string;
  remoteVersion?: string | null;
  remoteHash?: string | null;
  /** 0–100 when downloading; undefined otherwise. */
  progress?: number | null;
  error?: string | null;
  /** Wall-clock ms since epoch of the most recent checkForUpdate(). */
  lastCheckedAt?: number | null;
};

export type SkillSourceParam =
  | { LocalPath: { path: string } }
  | { GitRepository: { repo_url: string; skill_path?: string | null } }
  | { SkillsSh: { repository?: string | null } }
  | { ClawHub: { repository?: string | null } }
  | "Unknown";

/**
 * Bun handles `requests` from the webview (former Tauri `invoke`).
 * Bun sends `messages` to the webview (former `emit` to frontend).
 */
export type AppRPCSchema = ElectrobunRPCSchema & {
  bun: {
    requests: {
      list_agents: { params?: void; response: AgentConfigJson[] };
      detect_agents: { params?: void; response: AgentConfigJson[] };
      scan_all_skills: { params?: void; response: SkillJson[] };
      scan_agent_skills: { params: { agentSlug: string }; response: SkillJson[] };
      install_skill: { params: { source: SkillSourceParam; targetAgents: string[] }; response: void };
      uninstall_skill: { params: { skillId: string; agentSlug: string }; response: void };
      uninstall_skill_all: { params: { skillId: string }; response: void };
      unlink_inherited_skill: { params: { skillId: string }; response: void };
      sync_skill: { params: { skillId: string; targetAgents: string[] }; response: void };
      update_skill: { params: { skillId: string }; response: void };
      update_all_skills: { params?: void; response: UpdateAllResultJson };
      read_skill_content: { params: { path: string }; response: string };
      write_skill_content: { params: { path: string; content: string }; response: void };
      install_from_git: { params: { repoUrl: string; skillRelativePath: string; targetAgents: string[] }; response: void };
      fetch_remote_skill_content: { params: { repoUrl: string; skillName?: string | null }; response: string };
      fetch_skillssh: { params: { sort: string; page: number }; response: MarketplaceSkillJson[] };
      fetch_clawhub: { params: { endpoint: string; params: Record<string, string> }; response: MarketplaceSkillJson[] };
      search_marketplace: { params: { query: string; source: string }; response: MarketplaceSkillJson[] };
      install_from_marketplace: { params: { skill: MarketplaceSkillJson; targetAgents: string[] }; response: void };
      shell_runtime: {
        params?: void;
        response: {
          macosWindowBlur: boolean;
          macosWindowBlurLockedByEnv: boolean;
        };
      };
      read_settings: { params?: void; response: AppSettingsJson };
      write_settings: {
        params: { settings: AppSettingsJson };
        response: void;
      };
      clear_marketplace_cache: { params?: void; response: void };
      close_minimize: { params?: void; response: void };
      close_quit: { params?: void; response: void };
      add_skill_repo: { params: { repoUrl: string }; response: AddRepoResultJson };
      add_local_dir: { params: { path: string }; response: AddRepoResultJson };
      remove_skill_repo: { params: { repoIdParam: string }; response: void };
      list_skill_repos: { params?: void; response: SkillRepoJson[] };
      sync_skill_repo: { params: { repoIdParam: string }; response: SkillRepoJson };
      list_repo_skills: { params: { repoIdParam: string }; response: SkillJson[] };
      install_repo_skill: {
        params: { repoIdParam: string; skillId: string; targetAgents: string[] };
        response: void;
      };
      get_app_version: { params?: void; response: string };
      window_minimize: { params?: void; response: void };
      window_toggle_maximize: { params?: void; response: void };
      window_show: { params?: void; response: void };
      pick_folder: { params?: { title?: string }; response: string | null };
      open_external: { params: { url: string }; response: boolean };
      reveal_path_in_folder: { params: { path: string }; response: void };
      app_update_status: { params?: void; response: AppUpdateStatusJson };
      app_update_check: { params?: void; response: AppUpdateStatusJson };
      app_update_download: { params?: void; response: AppUpdateStatusJson };
      app_update_apply: { params?: void; response: void };
    };
    messages: {
      skills_changed: void;
      close_requested: void;
      skill_update_progress: UpdateProgressJson;
      repo_progress: RepoProgressJson;
      shell_runtime_changed: { macosWindowBlur: boolean };
      /** Bun → webview: actual http://127.0.0.1:<port> for tRPC (port may differ if default was busy). */
      trpc_endpoint: { baseUrl: string };
      /** Emitted on every Updater status change so the UI stays live. */
      app_update_status_changed: AppUpdateStatusJson;
    };
  };
  /** Same keys as bun.messages — webview handlers for push events from bun */
  webview: {
    requests: Record<string, never>;
    messages: {
      skills_changed: void;
      close_requested: void;
      skill_update_progress: UpdateProgressJson;
      repo_progress: RepoProgressJson;
      shell_runtime_changed: { macosWindowBlur: boolean };
      trpc_endpoint: { baseUrl: string };
      app_update_status_changed: AppUpdateStatusJson;
    };
  };
};
