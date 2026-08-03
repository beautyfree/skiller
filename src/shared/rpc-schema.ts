/** Shared JSON types — SkillSource uses Rust default (externally tagged enum) */
export type SkillSourceJson =
  | { LocalPath: { path: string } }
  | { GitRepository: { repo_url: string; skill_path?: string | null } }
  | { SkillsSh: { repository?: string | null } }
  | { ClawHub: { repository?: string | null } }
  | "Unknown";

export type SkillScopeJson =
	| { type: "SharedLibrary" }
  | { type: "SharedGlobal" }
  | { type: "AgentLocal"; agent: string };

export type SkillInstallationJson = {
  agent_slug: string;
  path: string;
  is_symlink: boolean;
	/** Deprecated. New scans always return false. */
  is_inherited: boolean;
  inherited_from?: string | null;
};

export type SkillJson = {
  id: string;
  name: string;
  description?: string | null;
  when_to_use?: string | null;
  canonical_path: string;
  source?: SkillSourceJson | null;
  metadata?: unknown;
  collection?: string | null;
  scope: SkillScopeJson;
  installations: SkillInstallationJson[];
  footprint_listing_source_chars?: number | null;
  footprint_listing_slice_chars?: number | null;
  footprint_name_chars?: number | null;
  footprint_skill_md_chars?: number | null;
  listing_excluded?: boolean | null;
  /** When set, the skill content is mirrored into the sync repo at this relative path. */
  bundled_path?: string | null;
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
  install_command_linux?: string | null;
  install_docs_url?: string | null;
  install_docs_url_linux?: string | null;
  install_source_label?: string | null;
  detect_paths: string[];
  detected: boolean;
  detection_reason: "cli" | "marker" | "skills-only" | "not-found";
};

/** Metadata read from the Skills CLI lock file; Skiller never writes this file. */
export type SkillsCliLockJson = {
  path: string;
  version: number;
  skills: {
    name: string;
    source: string;
    source_type: string;
    source_url: string;
    ref: string | null;
    skill_path: string | null;
    updated_at: string;
  }[];
} | null;

export type RuntimeAgentJson = {
  runtime_name: string;
  mapped_agent_slug: string | null;
  source: "AI_AGENT" | "@vercel/detect-agent";
} | null;

/** Read-only dotagent detector output; no machine path evidence crosses IPC. */
export type DotagentMachineInventoryJson = {
  platform: "darwin" | "linux" | "win32";
  detected_slugs: string[];
  agents: {
    slug: string;
    display_name: string;
    detected: boolean;
    reason: "command" | "marker" | "skills-only" | "not-found" | "unsupported-platform";
  }[];
};

export type DotagentDoctorJson = {
  ok: boolean;
  library: {
    name: string;
    version: string;
    owned_skill_count: number;
    dependency_count: number;
    locked: boolean;
  } | null;
  machine: DotagentMachineInventoryJson | null;
  issues: {
    code: string;
    severity: "error" | "warning" | "info";
    message: string;
    remediation: string;
    field?: string;
  }[];
};

export type DotagentMaterializationStatusJson = {
  targets: {
    agent_slug: string;
    skill_id: string;
    mode: "symlink" | "junction" | "copy";
    health: "missing" | "current" | "locally-modified" | "link-changed" | "invalid";
  }[];
};

/** Shared dotagent discovery output with every machine path removed. */
export type DotagentSkillDiscoveryJson = {
  skills: {
    candidate_key: string;
    name: string;
    description: string | null;
    when_to_use: string | null;
    integrity: string;
    file_count: number;
    total_bytes: number;
    metadata_valid: boolean;
    locations: { agent_slug?: string; kind: "shared" | "agent-local" | "inherited" }[];
    suggested: {
      kind: "owned" | "dependency" | "local-only" | "excluded";
      source?: "git" | "skills-cli";
      package?: string;
      reason?: string;
    };
  }[];
  collisions: { name: string; candidate_keys: string[] }[];
  issues: { code: string; severity: "error" | "warning" | "info"; message: string; remediation: string }[];
  linked_aliases: number;
};

export type DotagentAuditJson = {
  ok: boolean;
  public_ready: boolean;
  library: { name: string; version: string; owned_skill_count: number; dependency_count: number } | null;
  issues: { code: string; severity: "error" | "warning" | "info"; message: string; remediation: string; field?: string }[];
};

export type DotagentImportPlanJson = {
  plan_id: string;
  has_conflicts: boolean;
  requires_resolve: boolean;
  owned_skill_count: number;
  dependency_count: number;
  operations: {
    skill_id: string;
    action: "copy-owned" | "record-dependency" | "unchanged" | "leave-local" | "exclude" | "conflict";
    source_kind: "owned" | "dependency" | "local-only" | "excluded";
    package?: string;
    reason?: string;
  }[];
  secret_findings: SyncSecretFindingJson[];
};

export type RepoEntryJson = {
  repo_url?: string | null;
  local_path?: string | null;
  last_synced?: string | null;
};

export type ProjectEntryJson = {
  path: string;
  name: string;
  /** Optional user-defined group (folder) label. Null/undefined = "Ungrouped". */
  group?: string | null;
  added_at?: string | null;
  last_used_at?: string | null;
};

export type ProjectSkillJson = {
  id: string;
  name: string;
  description?: string | null;
  path: string;
};

export type AppSettingsJson = {
  theme?: string | null;
  language?: string | null;
  path_overrides?: Record<string, string[]> | null;
  repos?: RepoEntryJson[] | null;
  projects?: ProjectEntryJson[] | null;
  /** Folder labels for grouping projects. A folder may exist without any projects yet. */
  project_folders?: string[] | null;
  close_action?: string | null;
  /** macOS translucent window + NSVisualEffectView; default true when omitted */
  macos_window_blur?: boolean | null;
  /** Optional global character budget for aggregated listing text (legacy / advanced use). */
  assumed_listing_char_budget?: number | null;
  /** Optional context window size (chars); 1% can derive a listing budget when budget is unset. */
  assumed_context_window_chars?: number | null;
  /** Product telemetry and analytics (PostHog). Default true when omitted. */
  analytics_enabled?: boolean | null;
  /** One-time GitHub star prompt cadence metadata. */
  github_star_prompt?: {
    first_seen_at?: string | null;
    launch_count?: number | null;
    prompted_at?: string | null;
    cta_clicked_at?: string | null;
    dismissed_at?: string | null;
    dismissed_launch_count?: number | null;
    dismiss_count?: number | null;
  } | null;
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
  /** Public release page for manual install when auto-update download fails. */
  manualDownloadUrl?: string | null;
  /** Wall-clock ms since epoch of the most recent checkForUpdate(). */
  lastCheckedAt?: number | null;
};

/** Safe, renderer-facing summary only; secret values and filesystem roots never cross IPC. */
export type SyncSecretFindingJson = {
  rule: string;
  skill_id: string;
  relative_path: string;
  line: number;
  column: number;
};

export type SyncPublishPreviewJson = {
  profile_id: string;
  mode: "private" | "team" | "public";
  skills: {
    id: string;
    file_count: number;
    total_bytes: number;
    files: string[];
    excluded_paths: string[];
  }[];
  secret_findings: SyncSecretFindingJson[];
  references: { id: string; repository: string; ref: string; skill_path: string }[];
  /** Dependencies installed through skills.sh, pinned before publication. */
  skills_sh: { id: string; source_url: string; ref: string; skill_path: string }[];
  /**
   * External sources that could not be pinned for this attempt. They are
   * deliberately left out of the remote library and untouched locally.
   */
  unresolved_sources?: { id: string; kind: "reference" | "skills_sh" }[];
};

/** Full local SKILL.md body, loaded only when a user opens its review popover. */
export type SyncSkillPreviewJson = {
  skill_id: string;
  body: string;
};

export type SyncRestorePreviewJson = {
  profile_id: string;
  mode: "private" | "team" | "public";
  skills: {
    id: string;
    kind: "bundled" | "reference" | "skills_sh";
    action: "create" | "unchanged" | "conflict" | "kept-local";
    repository?: string | null;
    ref?: string | null;
  }[];
  secret_findings: SyncSecretFindingJson[];
};

export type SyncProfileStatusJson = {
  profile_id: string;
  mode: "private" | "team" | "public";
  skill_count: number;
  remote_url: string | null;
  branch: string;
  changed: boolean;
  ahead: number;
  behind: number;
	/** Timestamp of the last non-interactive remote metadata check. */
	last_checked_at: string | null;
	/** Authentication/network problem from the last check, never credential text. */
	check_error: string | null;
};

export type SyncInventoryJson = {
  items: {
    candidate_key: string;
    display_name: string;
    description: string | null;
		when_to_use: string | null;
    content_hash: string;
    /** Provenance observed locally; it is resolved to an immutable commit only in the reviewed publish plan. */
    source:
      | { kind: "local" }
      | { kind: "skills_sh"; source_url: string; ref: string | null; skill_path: string | null }
      | { kind: "git_reference"; repository: string; ref: string | null; skill_path: string | null };
    locations: { agent_slug?: string; kind: "shared" | "agent-local" | "inherited" }[];
  }[];
  collisions: { display_name: string; candidate_keys: string[] }[];
  invalid_paths: number;
	invalid_entries: { display_name: string; reason: string }[];
	linked_aliases: number;
};

export type SyncThreeWayReviewJson = {
  profile_id: string;
  dependency_changes: {
    dependency: string;
    action: "added" | "updated" | "removed";
    from_commit: string | null;
    to_commit: string | null;
    from_license: string | null;
    to_license: string | null;
    skills_added: string[];
    skills_removed: string[];
  }[];
  skills: {
    id: string;
    kind: "bundled" | "reference" | "skills_sh";
    action: "take-remote" | "publish-local" | "unchanged" | "kept-local" | "conflict" | "unmanaged";
		/** Present for externally sourced skills so a conflict is actionable. */
		source?: { repository: string; ref: string };
  }[];
};

export type SkillSourceParam =
  | { LocalPath: { path: string } }
  | { GitRepository: { repo_url: string; skill_path?: string | null } }
  | { SkillsSh: { repository?: string | null } }
  | { ClawHub: { repository?: string | null } }
  | "Unknown";

/**
 * Main process handles `requests` from the renderer (delivered via tRPC HTTP).
 * Main pushes `messages` to the renderer (via IPC under Electron). The `bun`
 * key name is kept for compatibility with existing generated types; rename to
 * `main` is a future code-golf opportunity once the renderer is updated.
 */
export type AppRPCSchema = {
  bun: {
    requests: {
      list_agents: { params?: void; response: AgentConfigJson[] };
      detect_agents: { params?: void; response: AgentConfigJson[] };
      detect_runtime_agent: { params?: void; response: RuntimeAgentJson };
      dotagent_machine_inventory: { params?: void; response: DotagentMachineInventoryJson };
      dotagent_doctor: { params: { libraryRoot: string }; response: DotagentDoctorJson };
      dotagent_materialization_status: { params: { libraryRoot: string }; response: DotagentMaterializationStatusJson };
      dotagent_skill_discovery: { params?: void; response: DotagentSkillDiscoveryJson };
      dotagent_audit: { params: { libraryRoot: string; visibility: "private" | "team" | "public" }; response: DotagentAuditJson };
      dotagent_import_plan: {
        params: {
          libraryRoot: string;
          decisions: { candidateKey: string; disposition: "suggested" | "owned" | "dependency" | "local-only" | "excluded"; reason?: string }[];
        };
        response: DotagentImportPlanJson;
      };
      read_skills_cli_lock: { params?: void; response: SkillsCliLockJson };
      scan_all_skills: { params?: void; response: SkillJson[] };
      scan_agent_skills: { params: { agentSlug: string }; response: SkillJson[] };
      list_sync_profiles: { params?: void; response: SyncProfileStatusJson[] };
	  refresh_sync_profiles: { params?: void; response: SyncProfileStatusJson[] };
      scan_sync_inventory: { params?: void; response: SyncInventoryJson };
		get_sync_skill_preview: { params: { skillId: string }; response: SyncSkillPreviewJson };
		reveal_sync_secret_finding: { params: { skillId: string; relativePath: string }; response: void };
      sync_center_publish_preview: {
        params?: { selectedKeys?: string[] };
        response: SyncPublishPreviewJson;
      };
      sync_center_publish: {
        params: {
          remoteUrl: string;
          selectedKeys?: string[];
          mode: "private" | "public";
          license?: "MIT" | "Apache-2.0" | "CC0-1.0";
        };
        response: { commit: string | null; pushed: boolean };
      };
      sync_three_way_review: { params: { profileId: string }; response: SyncThreeWayReviewJson };
      sync_apply_remote_changes: { params: { profileId: string; skillIds: string[] }; response: { restored: string[] } };
	  sync_apply_conflicting_remote_changes: { params: { profileId: string; skillIds: string[] }; response: { restored: string[] } };
      sync_publish_local_changes: { params: { profileId: string; skillIds: string[] }; response: { commit: string | null; pushed: boolean } };
	  sync_keep_local_changes: { params: { profileId: string; skillIds: string[] }; response: { kept: string[] } };
	  sync_keep_external_local_changes: { params: { profileId: string; skillIds: string[] }; response: { kept: string[] } };
      sync_recovery_status: { params: { profileId: string }; response: { pending: boolean } };
      sync_recovery_rollback: { params: { profileId: string }; response: { recovered: boolean } };
      sync_publish_preview: {
        params: {
          profileId: string;
          mode: "private" | "team" | "public";
          skillIds: string[];
          skillKinds?: Record<string, "bundled" | "reference">;
          agentSlugs?: string[];
        };
        response: SyncPublishPreviewJson;
      };
      sync_profile_publish: {
        params: {
          profileId: string;
          mode: "private" | "team" | "public";
          skillIds: string[];
          skillKinds?: Record<string, "bundled" | "reference">;
          agentSlugs?: string[];
          remoteUrl?: string | null;
          push: boolean;
        };
        response: { commit: string | null; pushed: boolean };
      };
      sync_profile_clone: {
        params: { profileId: string; remoteUrl: string; agentSlugs?: string[] };
        response: SyncProfileStatusJson;
      };
      sync_center_connect: {
        params: { remoteUrl: string; agentSlugs: string[] };
        response: SyncProfileStatusJson;
      };
      sync_github_create_repo: {
        params: { repository: string; visibility: "private" | "public" };
        response: { remoteUrl: string };
      };
      sync_pull_preview: { params: { profileId: string }; response: SyncRestorePreviewJson };
      sync_restore_apply: {
        params: { profileId: string; skillIds: string[] };
        response: { restored: string[]; installed_to_detected_agents: string[] };
      };
      install_skill: { params: { source: SkillSourceParam; targetAgents: string[] }; response: void };
      uninstall_skill: { params: { skillId: string; agentSlug: string }; response: void };
      uninstall_skill_all: { params: { skillId: string }; response: void };
      uninstall_skills_all: {
        params: { skillIds: string[] };
        response: {
          removed: string[];
          failed: { id: string; error: string }[];
        };
      };
      detach_shared_skill: {
        params: { skillId: string; removeFromAgent: string };
        response: { preservedOn: string[]; removedFrom: string };
      };
      uninstall_all_skills_from_agent: {
        params: { agentSlug: string };
        response: {
          removed: string[];
          failed: { id: string; error: string }[];
        };
      };
      sync_all_skills_to_agent: {
        params: { targetAgent: string; sourceAgent: string | null };
        response: {
          copied: string[];
          skipped: string[];
          failed: { id: string; error: string }[];
        };
      };
      sync_skill: { params: { skillId: string; targetAgents: string[] }; response: void };
	  /** Deprecated safe stub; it no longer mutates agent configuration. */
	  unlink_inherited_skill: { params: { skillId: string }; response: void };
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
      list_projects: { params?: void; response: ProjectEntryJson[] };
      add_project: { params: { path: string }; response: ProjectEntryJson };
      remove_project: { params: { path: string }; response: void };
      list_project_skills: { params: { path: string }; response: ProjectSkillJson[] };
      install_skill_to_project: {
        params: { source: SkillSourceParam; projectPath: string };
        response: void;
      };
      install_repo_skill_to_project: {
        params: { repoIdParam: string; skillId: string; projectPath: string };
        response: void;
      };
      install_marketplace_skill_to_project: {
        params: { skill: MarketplaceSkillJson; projectPath: string };
        response: void;
      };
      uninstall_project_skill: {
        params: { projectPath: string; skillId: string };
        response: void;
      };
      set_project_group: {
        params: { path: string; group: string | null };
        response: ProjectEntryJson;
      };
      list_project_folders: { params?: void; response: string[] };
      add_project_folder: { params: { name: string }; response: string[] };
      remove_project_folder: { params: { name: string }; response: string[] };
      rename_project_folder: {
        params: { from: string; to: string };
        response: string[];
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
