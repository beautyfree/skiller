import type { ImportDecision, ImportDisposition } from "dotagents/decisions";

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

export type SkillLibraryStateJson = {
  first_seen_at: string;
  reviewed_at: string | null;
  ownership: "external" | "owned" | "forked" | "unknown";
  forked_from: { repository: string | null; skill_path: string | null; ref: string | null } | null;
};

export type SkillImprovementNoteJson = {
  id: string;
  created_at: string;
  prompt: string;
  actual: string;
  expected: string;
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
  library_state?: SkillLibraryStateJson | null;
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

/** Read-only dotagents detector output; no machine path evidence crosses IPC. */
export type DotagentsMachineInventoryJson = {
  platform: "darwin" | "linux" | "win32";
  detected_slugs: string[];
  agents: {
    slug: string;
    display_name: string;
    detected: boolean;
    reason: "command" | "marker" | "skills-only" | "not-found" | "unsupported-platform";
  }[];
};

export type DotagentsDoctorJson = {
  ok: boolean;
  library: {
    name: string;
    version: string;
    owned_skill_count: number;
    dependency_count: number;
    locked: boolean;
  } | null;
  machine: DotagentsMachineInventoryJson | null;
  issues: {
    code: string;
    severity: "error" | "warning" | "info";
    message: string;
    remediation: string;
    field?: string;
  }[];
};

export type DotagentsMaterializationStatusJson = {
  targets: {
    agent_slug: string;
    skill_id: string;
    mode: "symlink" | "junction" | "copy";
    health: "missing" | "current" | "locally-modified" | "link-changed" | "invalid";
  }[];
};

/** Shared dotagents discovery output with every machine path removed. */
export type DotagentsSkillDiscoveryJson = {
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
      /** `adopt-owned` means the reviewed skill is already inside the canonical library. */
      kind: "owned" | "adopt-owned" | "dependency" | "vendored" | "local-only" | "excluded";
      source?: "git" | "skills-cli";
      package?: string;
      reason?: string;
    };
  }[];
  collisions: { name: string; candidate_keys: string[] }[];
  issues: { code: string; severity: "error" | "warning" | "info"; message: string; remediation: string }[];
  linked_aliases: number;
};

export type DotagentsAuditJson = {
  ok: boolean;
  public_ready: boolean;
  library: { name: string; version: string; owned_skill_count: number; dependency_count: number } | null;
  issues: { code: string; severity: "error" | "warning" | "info"; message: string; remediation: string; field?: string }[];
};

export type DotagentsImportPlanJson = {
  plan_id: string;
  has_conflicts: boolean;
  requires_resolve: boolean;
  owned_skill_count: number;
  dependency_count: number;
  operations: {
    skill_id: string;
    action:
      | "copy-owned"
      | "adopt-owned"
      | "copy-vendored"
      | "record-dependency"
      | "unchanged"
      | "leave-local"
      | "exclude"
      | "conflict";
    source_kind: "owned" | "adopt-owned" | "dependency" | "vendored" | "local-only" | "excluded";
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
	/** Device-local library selection. Never written into a portable library. */
	active_sync_profile_id?: string | null;
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
  skill_path?: string | null;
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

/** Safe aggregate-only progress while Sync Center checks approved Git sources. */
export type SyncSourceReviewProgressJson = {
  completed: number;
  total: number;
  verified: number;
  kept_local: number;
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
  /** Stable identifier of the exact source/manifest preview. */
  plan_id: string;
  /** Pre-network authorization bound to the reviewed exact source set and policy. */
  source_authorization_id: string;
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
  /** Exact device-reviewed sources contacted while building this preview. */
  source_trust: {
    source: string;
    kind: "git" | "local";
    rule: "allow-all" | "repository" | "host" | "github-organization" | "local-repository";
  }[];
  /** Device-only cooling-off policy and value-redacted commit-age evidence. */
  source_security: {
    minimum_release_age_minutes: number;
    commit_ages: {
      source: string;
      committed_at: string;
      age_minutes: number;
      minimum_age_minutes: number;
      excluded: boolean;
    }[];
  };
  decisions: {
    candidate_key: string;
    disposition: Exclude<ImportDisposition, "suggested">;
    license?: string;
  }[];
  /**
   * External sources that could not be pinned for this attempt. They are
   * deliberately left out of the remote library and untouched locally.
   */
  unresolved_sources?: {
    id: string;
    kind: "reference" | "skills_sh";
    /** Credential-free normalized Git source shared by every affected skill. */
    source: string;
    requested_ref: string;
    reason: "authentication" | "timeout" | "invalid-source" | "missing-skill" | "unavailable" | "too-new";
    age_minutes?: number;
    minimum_age_minutes?: number;
  }[];
};

export type SyncLibraryDecisionJson = ImportDecision;

/** Full local SKILL.md body, loaded only when a user opens its review popover. */
export type SyncSkillPreviewJson = {
  skill_id: string;
  body: string;
};

export type SyncConnectPreviewJson = {
  profile_id: string;
  plan_id: string;
  remote_identity: string;
  resolved_commit: string;
  committed_at: string;
  minimum_release_age_minutes: number;
  agent_slugs: string[];
};

export type SyncGitHubRepositoryPreviewJson = {
  plan_id: string;
  repository: string;
  visibility: "private" | "public";
};

export type SyncGitLabProjectPreviewJson = {
  plan_id: string;
  project: string;
  visibility: "private" | "public";
};

export type SyncGitDestinationPreviewJson = {
	remote_identity: string;
};

/** A credential-free remote the user explicitly asked the provider CLI to list. */
export type SyncProviderLibraryJson = {
  provider: "github" | "gitlab";
  label: string;
  remote_url: string;
};

export type SyncProviderProblemJson = {
  kind: "authentication" | "cli-missing" | "unavailable" | "conflict" | "permission" | "created-unresolved" | "unknown";
};

export type SyncProviderLibrariesResultJson = {
  libraries: SyncProviderLibraryJson[];
  problem: SyncProviderProblemJson | null;
};

export type SyncProviderCreateResultJson = {
  remoteUrl: string | null;
  problem: SyncProviderProblemJson | null;
};

export type SyncProfileStatusJson = {
  profile_id: string;
  mode: "private" | "team" | "public";
  skill_count: number;
	/** Reviewed per-device choices that intentionally differ from the saved library. */
	device_choice_count: number;
  remote_url: string | null;
  /** Credential-free HTTPS identity suitable for display and sharing. */
  remote_identity: string | null;
  branch: string;
  changed: boolean;
  ahead: number;
  behind: number;
	/** Timestamp of the last non-interactive remote metadata check. */
	last_checked_at: string | null;
	/** Authentication/network problem from the last check, never credential text. */
	check_error: string | null;
	check_error_kind: "authentication" | "unavailable" | "invalid-source" | null;
	/** True when this device has not yet approved the profile's current remote. */
	remote_trust_required: boolean;
};

export type SyncRemoteTrustPreviewJson = {
	plan_id: string;
	remote_identity: string;
	minimum_release_age_minutes: number;
};

export type SyncDisconnectPreviewJson = {
	plan_id: string;
	profile_id: string;
	remote_identity: string | null;
	can_disconnect: boolean;
	blockers: string[];
};

export type SyncLocalPublishPreviewJson = {
  plan_id: string;
  files: string[];
  has_blockers: boolean;
  secret_findings: { file: string; rule: string; line: number; column: number }[];
  unsafe_paths: string[];
  audit_errors: { code: string; message: string; remediation: string; field?: string }[];
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
	invalid_entries: { invalid_id: string; display_name: string; reason: string }[];
	linked_aliases: number;
};

export type SyncConflictComparisonJson = {
	local_state: "absent" | "directory" | "file" | "symlink" | "unsupported";
	local_file_count: number | null;
	library_file_count: number;
	changed_files: string[];
	only_on_computer: string[];
	only_in_library: string[];
	unchanged_file_count: number;
	local_skill_md?: string;
	library_skill_md?: string;
	local_skill_md_truncated?: boolean;
	library_skill_md_truncated?: boolean;
};

export type SyncThreeWayReviewJson = {
  profile_id: string;
  /** Stable identifier of the exact remote Git fast-forward reviewed in a disposable checkout. */
  workspace_plan_id: string;
  /** Stable identifier of the exact no-write reconciliation preview. */
  reconciliation_plan_id: string;
  reconciliation_engine: "dotagents";
  /** The remote changed only library documentation or other non-managed files. */
  library_update_only: boolean;
  /** Safe, repository-relative file names changed by that library-only update. */
  library_update_files: string[];
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
		/** Detected agents that will receive this skill if its library version is applied. */
		target_agents: string[];
		/** Portable, read-only comparison for bundled conflicts. Machine paths are never returned. */
		comparison?: SyncConflictComparisonJson;
  }[];
};

export type SyncHistoryEntryJson = {
  id: string;
  operation: string;
  source_plan_id: string;
  completed_at: string;
  undone_at: string | null;
  undo_available: boolean;
	undo_unavailable_reason: "sensitive-previous-content" | "unsupported-previous-target" | null;
  changes: { path: string; item_kind: "file" | "skill" }[];
};

export type SyncUndoPreviewJson = {
  plan_id: string;
  history_id: string;
  source_plan_id: string;
  has_conflicts: boolean;
  changes: {
    path: string;
    item_kind: "file" | "skill";
    action: "remove-created" | "restore-previous";
    reason?: string;
  }[];
};

export type DotagentsResourceKindJson = "skill" | "instruction" | "command" | "subagent";

export type DotagentsResourceOverviewJson = {
  profile_id: string;
  mode: "private" | "team" | "public";
  changed: boolean;
  resources: {
    key: string;
    kind: DotagentsResourceKindJson;
    id: string;
    path: string;
    source: "skill-library" | "resource-v2";
    /** Short portable provenance label; never exposes a local machine path. */
    source_label: string;
    /** Safe HTTPS provenance URL when the library recorded one. */
    source_url?: string;
  }[];
};

export type DotagentsResourceContentJson = {
  profile_id: string;
  key: string;
  kind: DotagentsResourceKindJson;
  id: string;
  path: string;
  files: string[];
  content_path: string;
  content: string;
  /** Present for a bounded raster image; never exposes a machine path. */
  image_data_url?: string;
};

/**
 * A redacted, read-only comparison between the active library and the agent
 * folders Skiller can currently see. This is deliberately separate from Git
 * status: it represents work that happened in the user's toolkit itself.
 */
export type DotagentsLibraryLocalChangesJson = {
  profile_id: string;
  scanned_at: string;
  changes: {
    id: string;
    display_name: string;
    kind: "new-local" | "changed-local" | "missing-local";
    detail: string;
  }[];
};

/** A path-free, read-only Git-style detail view for one local toolkit change. */
export type DotagentsLibraryLocalChangePreviewJson = {
  profile_id: string;
  id: string;
  kind: "new-local" | "changed-local" | "missing-local";
  /** Portable relative files present on this computer for an untracked skill. */
  local_files: string[];
  /** Present when a saved bundled skill was modified locally. */
  comparison?: SyncConflictComparisonJson;
  /** Present after selecting a file in the local-change inspector. */
  file_preview?: {
    path: string;
    status: "added" | "modified" | "deleted";
    /** A compact, safe unified view. It never includes a machine path. */
    diff?: string;
    /** Current (or, for a deletion, saved) bounded raster image. */
    image_data_url?: string;
    unavailable_reason?: string;
  };
};

export type DotagentsLibraryNewLocalPreviewJson = {
  profile_id: string;
  plan_id: string;
  /** Existing bundled skills that this reviewed private plan would update. */
  updated_skill_ids: string[];
  skills: { id: string; display_name: string; files: number; paths: string[] }[];
  linked_skills: { id: string; display_name: string; source: "Git" | "skills.sh" }[];
  skipped_skills: { id: string; display_name: string; reason: string }[];
  secret_findings: { skill_id: string; rule: string; file: string; line: number }[];
  has_blockers: boolean;
};

export type DotagentsLibraryHealthJson = {
  profile_id: string;
  ok: boolean;
  issues: {
    code: string;
    severity: "info" | "warning" | "error";
    message: string;
    remediation: string;
    repairable: boolean;
  }[];
};

export type DotagentsLibraryRepairPreviewJson = {
  profile_id: string;
  plan_id: string;
  has_blockers: boolean;
  actions: {
    kind: "update-gitignore";
    path: ".gitignore";
    add: string[];
  }[];
  unsupported: { code: string; reason: string }[];
};

export type DotagentsScopeProfileJson = {
  profile_id: string;
  library: string;
  scope: "personal" | "project" | null;
  migration_required: boolean;
  error: string | null;
};

export type DotagentsScopeCompositionPreviewJson = {
  plan_id: string;
  personal_profile_id: string | null;
  project_profile_id: string | null;
  exclusions: string[];
  resources: {
    key: string;
    kind: DotagentsResourceKindJson;
    id: string;
    excluded_by_device: boolean;
    origins: {
      scope: "personal" | "project";
      library: string;
      kind: "owned" | "dependency";
      resource_kind: DotagentsResourceKindJson;
    }[];
  }[];
  conflicts: {
    resource_key: string;
    origins: {
      scope: "personal" | "project";
      library: string;
      kind: "owned" | "dependency";
      resource_kind: DotagentsResourceKindJson;
    }[];
  }[];
  issues: {
    code: string;
    scope: "personal" | "project";
    library: string;
    resource_key: string;
    message: string;
  }[];
  has_blockers: boolean;
};

export type DotagentsScopeCompositionUndoPreviewJson = {
  plan_id: string;
  history_id: string;
  has_conflicts: boolean;
  target: {
    personal_profile_id: string | null;
    project_profile_id: string | null;
    exclusions: string[];
  };
  composition: DotagentsScopeCompositionPreviewJson | null;
};

export type DotagentsScopeOverviewJson = {
  profiles: DotagentsScopeProfileJson[];
  active: DotagentsScopeCompositionPreviewJson | null;
  active_error: string | null;
};

export type DotagentsScopeMigrationPreviewJson = {
  profile_id: string;
  plan_id: string;
  library: string;
  scope: "personal" | "project";
  file: "dotagents.scope.json";
  content: { schema_version: 1; scope: "personal" | "project" };
};

export type DotagentsResourceSelectionJson = {
  selection_id: string;
  kind: DotagentsResourceKindJson;
  name: string;
  entry_type: "file" | "directory";
};

export type DotagentsResourceAdoptionRequestJson = {
  profileId: string;
  selectionId: string;
  kind: DotagentsResourceKindJson;
  id: string;
  activation?: "always" | "conditional";
  condition?: string;
  invocation?: string;
  role?: string;
};

export type DotagentsResourceAdoptionPreviewJson = {
  plan_id: string;
  profile_id: string;
  source_name: string;
  resource: { key: string; kind: DotagentsResourceKindJson; id: string; path: string };
  files: number;
  bytes: number;
  license: { visibility: "private" | "team" | "public"; value: string | null; status: "private-only" | "reviewed" | "blocked" };
  secret_findings: { rule: string; file: string; line: number; column: number }[];
  blockers: { code: string; message: string }[];
};

export type SkillQualityIssueJson = {
  area: "spec" | "skill" | "evals" | "coverage" | "safety";
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  hint?: string;
  file?: string;
  line?: number;
  revealable?: boolean;
};

export type SkillQualityStatusJson = {
  /** Opaque device-local identity for same-name skills from different roots. */
  quality_id: string;
  skill_id: string;
  name: string;
  description: string | null;
  origin_label: string;
  state: "ready" | "needs-spec" | "needs-skill" | "stale" | "needs-evals" | "blocked";
  spec: {
    present: boolean;
    valid: boolean;
    hash: string | null;
    title: string | null;
    behavior_count: number;
    constraint_count: number;
    behaviors: {
      id: string;
      name: string;
      scenario_count: number;
      covered_by: string[];
    }[];
  };
  skill: {
    present: boolean;
    recorded_spec_hash: string | null;
    stale: boolean | null;
  };
  evals: {
    case_count: number;
    covered_behavior_count: number;
    deterministic_check_count: number;
    judge_check_count: number;
    shell_check_count: number;
    setup_script_count: number;
  };
  issues: SkillQualityIssueJson[];
};

export type SkillQualityOverviewJson = {
  scanned_at: string;
  execution: {
    mode: "structural-only";
    agent_sessions_started: false;
    shell_commands_started: false;
    network_started: false;
  };
  summary: {
    total: number;
    ready: number;
    needs_work: number;
    covered_behaviors: number;
    total_behaviors: number;
  };
  skills: SkillQualityStatusJson[];
};

export type SkillQualityEvalPreviewRequestJson = {
  qualityId: string;
  mode: "dry" | "measured";
  harness?: "codex" | "claude";
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh";
  baseline?: boolean;
  trials?: number;
  concurrency?: number;
  sandboxImage?: string;
  network?: boolean;
  credentialProfile?: "none" | "codex" | "claude";
  environmentNames?: string[];
};

export type SkillQualityEvalPlanJson = {
  plan_id: string;
  quality_id: string;
  skill: { name: string; origin_label: string };
  mode: "dry" | "measured";
  artifacts: {
    snapshot_sha256: string;
    file_count: number;
    total_bytes: number;
    spec_hash: string | null;
  };
  cases: {
    id: string;
    behavior: string;
    fixture: string | null;
    trials: number;
    timeout_seconds: number;
    deterministic_checks: number;
    judge_checks: number;
    shell_checks: number;
    has_setup: boolean;
  }[];
  harness: {
    name: "none" | "codex" | "claude";
    model: string | null;
    effort: "low" | "medium" | "high" | "xhigh" | null;
    baseline: boolean;
    concurrency: number;
  };
  sandbox: {
    kind: "docker";
    image: string;
    image_id: string | null;
    available: boolean;
    network: boolean;
    credential_profile: "none" | "codex" | "claude";
    environment_names: string[];
    direct_host_fallback: false;
  };
  command_review: {
    case_id: string;
    kind: "setup" | "shell-check";
    command: string;
    file: string;
  }[];
  blockers: {
    code: string;
    message: string;
    file?: string;
    line?: number;
  }[];
  report: {
    resume_id: string;
    local_destination: string;
    includes_baseline_lift: boolean;
  };
  ready_to_start: boolean;
};

export type SkillQualityDryRunReportJson = {
  schema: 1;
  report_id: string;
  plan_id: string;
  quality_id: string;
  skill: { name: string; origin_label: string };
  mode: "dry";
  status: "completed" | "completed-with-findings" | "blocked";
  started_at: string;
  completed_at: string;
  sandbox: {
    image_id: string;
    network: false;
    direct_host_fallback: false;
  };
  summary: {
    cases: number;
    vacuous: number;
    requires_action: number;
    indeterminate: number;
    errors: number;
  };
  cases: {
    id: string;
    behavior: string;
    status: "vacuous" | "requires-action" | "indeterminate" | "error";
    duration_ms: number;
    resumed: boolean;
    checks: {
      kind: "file_exists" | "shell" | "judge" | "setup";
      status: "pass" | "fail" | "skipped" | "error";
      output?: string;
      output_redacted?: boolean;
    }[];
  }[];
  local_destination: string;
};

export type SkillQualityMeasuredReportJson = {
  schema: 1;
  report_id: string;
  plan_id: string;
  quality_id: string;
  skill: { name: string; origin_label: string };
  mode: "measured";
  status: "completed" | "completed-with-failures" | "blocked";
  started_at: string;
  completed_at: string;
  harness: {
    name: "codex" | "claude";
    model: string | null;
    effort: "low" | "medium" | "high" | "xhigh";
  };
  sandbox: {
    image_id: string;
    network: true;
    credential_profile: "codex" | "claude";
    environment_names: string[];
    direct_host_fallback: false;
  };
  summary: {
    cases: number;
    trials: number;
    passed: number;
    failed: number;
    errored: number;
  };
  behaviors: {
    behavior: string;
    skill_pass_rate: number;
    baseline_pass_rate: number | null;
    lift: number | null;
    trials: number;
  }[];
  cases: {
    id: string;
    behavior: string;
    skill_pass_rate: number;
    baseline_pass_rate: number | null;
    lift: number | null;
    trials: {
      variant: "skill" | "baseline";
      trial: number;
      status: "pass" | "fail" | "error";
      duration_ms: number;
      resumed: boolean;
      checks: {
        kind: "file_exists" | "shell" | "judge" | "setup" | "harness";
        status: "pass" | "fail" | "error";
        output?: string;
        output_redacted?: boolean;
      }[];
    }[];
  }[];
  local_destination: string;
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
      dotagents_machine_inventory: { params?: void; response: DotagentsMachineInventoryJson };
      dotagents_doctor: { params: { libraryRoot: string }; response: DotagentsDoctorJson };
      dotagents_materialization_status: { params: { libraryRoot: string }; response: DotagentsMaterializationStatusJson };
      dotagents_skill_discovery: { params?: void; response: DotagentsSkillDiscoveryJson };
      dotagents_audit: { params: { libraryRoot: string; visibility: "private" | "team" | "public" }; response: DotagentsAuditJson };
      dotagents_import_plan: {
        params: {
          libraryRoot: string;
          decisions: { candidateKey: string; disposition: "suggested" | "owned" | "dependency" | "local-only" | "excluded"; reason?: string }[];
        };
        response: DotagentsImportPlanJson;
      };
      read_skills_cli_lock: { params?: void; response: SkillsCliLockJson };
      scan_all_skills: { params?: void; response: SkillJson[] };
      scan_agent_skills: { params: { agentSlug: string }; response: SkillJson[] };
		mark_skill_reviewed: { params: { skillId: string }; response: void };
		claim_skill_ownership: { params: { skillId: string }; response: void };
		list_skill_improvement_notes: { params: { skillId: string }; response: SkillImprovementNoteJson[] };
		add_skill_improvement_note: { params: { skillId: string; prompt: string; actual: string; expected: string }; response: SkillImprovementNoteJson };
		fork_skill_to_library: { params: { skillId: string; forkId: string }; response: SkillJson };
      skill_quality_overview: { params?: void; response: SkillQualityOverviewJson };
      skill_quality_reveal_file: { params: { qualityId: string; relativePath: string }; response: void };
      skill_quality_reveal_folder: { params: { qualityId: string }; response: void };
      skill_quality_eval_preview: { params: SkillQualityEvalPreviewRequestJson; response: SkillQualityEvalPlanJson };
      skill_quality_dry_start: { params: { request: SkillQualityEvalPreviewRequestJson; expectedPlanId: string }; response: SkillQualityDryRunReportJson };
      skill_quality_measured_start: { params: { request: SkillQualityEvalPreviewRequestJson; expectedPlanId: string }; response: SkillQualityMeasuredReportJson };
      list_sync_profiles: { params?: void; response: SyncProfileStatusJson[] };
	  refresh_sync_profiles: { params?: { requestId?: string }; response: SyncProfileStatusJson[] };
	  sync_select_profile: { params: { profileId: string }; response: { selected: boolean } };
	  sync_disconnect_preview: { params: { profileId: string }; response: SyncDisconnectPreviewJson };
	  sync_disconnect_apply: { params: { profileId: string; planId: string }; response: { disconnected: boolean } };
	  sync_remote_trust_preview: { params: { profileId: string; minimumReleaseAgeMinutes?: number }; response: SyncRemoteTrustPreviewJson };
	  sync_remote_trust_apply: { params: { profileId: string; planId: string; minimumReleaseAgeMinutes: number }; response: void };
      scan_sync_inventory: { params?: void; response: SyncInventoryJson };
		get_sync_skill_preview: { params: { skillId: string }; response: SyncSkillPreviewJson };
		reveal_sync_secret_finding: { params: { skillId: string; relativePath: string }; response: void };
		reveal_sync_invalid_entry: { params: { invalidId: string }; response: void };
      sync_center_publish_preview: {
        params?: {
          requestId?: string;
          selectedKeys?: string[];
          decisions?: SyncLibraryDecisionJson[];
          mode?: "private" | "team" | "public";
          minimumReleaseAgeMinutes?: number;
        };
        response: SyncPublishPreviewJson;
      };
      sync_center_publish_preview_cancel: { params: { requestId: string }; response: { cancelled: boolean } };
		sync_git_destination_preview: { params: { remoteUrl: string; requestId?: string }; response: SyncGitDestinationPreviewJson };
      sync_local_publish_preview: { params: { profileId: string }; response: SyncLocalPublishPreviewJson };
      sync_local_publish_apply: {
        params: { profileId: string; planId: string };
        response: { commit: string | null; pushed: boolean };
      };
      sync_push_pending: { params: { profileId: string }; response: { pushed: boolean } };
      sync_center_publish: {
        params: {
          remoteUrl: string;
          selectedKeys?: string[];
          decisions?: SyncLibraryDecisionJson[];
          mode: "private" | "team" | "public";
          license?: "MIT" | "Apache-2.0" | "CC0-1.0";
          planId: string;
          sourceAuthorizationId: string;
          minimumReleaseAgeMinutes: number;
        };
        response: { profile_id: string; commit: string | null; pushed: boolean };
      };
      sync_provider_sign_in_start: {
		params: { provider: "github" | "gitlab"; requestId: string };
        response:
          | { started: true; verification_url: string; user_code: string; expires_in: number }
          | { started: false; problem: SyncProviderProblemJson };
      };
      sync_provider_sign_in_finish: {
		params: { provider: "github" | "gitlab"; requestId: string };
        response:
          | { connected: true; account: string | null; problem: null }
          | { connected: false; account: null; problem: SyncProviderProblemJson };
      };
      sync_provider_check: {
        params: { provider: "github" | "gitlab"; requestId?: string };
        response:
          | { connected: true; account: string; problem: null }
          | { connected: false; account: null; problem: SyncProviderProblemJson };
      };
      sync_three_way_review: { params: { profileId: string; requestId?: string }; response: SyncThreeWayReviewJson };
		sync_external_conflict_preview: {
			params: { profileId: string; skillId: string; workspacePlanId: string; reconciliationPlanId: string; requestId?: string };
			response: SyncConflictComparisonJson;
		};
      sync_history: { params: { profileId: string }; response: SyncHistoryEntryJson[] };
      sync_undo_preview: { params: { profileId: string; historyId: string }; response: SyncUndoPreviewJson };
      sync_undo_apply: {
        params: { profileId: string; historyId: string; planId: string };
        response: { restored: string[] };
      };
      dotagents_resource_overview: { params: { profileId: string }; response: DotagentsResourceOverviewJson };
      dotagents_library_local_changes: { params: { profileId: string }; response: DotagentsLibraryLocalChangesJson };
		dotagents_library_local_change_preview: { params: { profileId: string; skillId: string; file?: string }; response: DotagentsLibraryLocalChangePreviewJson };
      dotagents_library_new_local_preview: { params: { profileId: string; skillIds: string[] }; response: DotagentsLibraryNewLocalPreviewJson };
      dotagents_library_new_local_apply: { params: { profileId: string; planId: string }; response: { pushed: boolean } };
      dotagents_resource_content: { params: { profileId: string; key: string; file?: string }; response: DotagentsResourceContentJson };
      dotagents_library_health: { params: { profileId: string }; response: DotagentsLibraryHealthJson };
      dotagents_library_repair_preview: {
        params: { profileId: string; selectedCodes: string[] };
        response: DotagentsLibraryRepairPreviewJson;
      };
      dotagents_library_repair_apply: {
        params: { profileId: string; planId: string };
        response: { history_id: string };
      };
      dotagents_scope_overview: { params: Record<string, never>; response: DotagentsScopeOverviewJson };
      dotagents_scope_migration_preview: {
        params: { profileId: string; scope: "personal" | "project" };
        response: DotagentsScopeMigrationPreviewJson;
      };
      dotagents_scope_migration_apply: {
        params: { profileId: string; planId: string };
        response: { history_id: string };
      };
      dotagents_scope_composition_preview: {
        params: {
          personalProfileId: string | null;
          projectProfileId: string | null;
          exclusions: string[];
        };
        response: DotagentsScopeCompositionPreviewJson;
      };
      dotagents_scope_composition_apply: {
        params: { planId: string };
        response: DotagentsScopeCompositionPreviewJson;
      };
      dotagents_scope_composition_undo_preview: {
        params: Record<string, never>;
        response: DotagentsScopeCompositionUndoPreviewJson | null;
      };
      dotagents_scope_composition_undo_apply: {
        params: { planId: string };
        response: DotagentsScopeCompositionPreviewJson | null;
      };
      dotagents_resource_pick_source: { params: { kind: DotagentsResourceKindJson }; response: DotagentsResourceSelectionJson | null };
      dotagents_resource_adopt_preview: { params: DotagentsResourceAdoptionRequestJson; response: DotagentsResourceAdoptionPreviewJson };
      dotagents_resource_adopt_apply: { params: { planId: string }; response: { history_id: string; resource_key: string } };
      sync_apply_remote_changes: { params: { profileId: string; skillIds: string[]; workspacePlanId: string; reconciliationPlanId: string }; response: { restored: string[] } };
      sync_accept_remote_library_update: { params: { profileId: string; workspacePlanId: string; reconciliationPlanId: string }; response: { updated: boolean } };
      sync_apply_conflicting_remote_changes: { params: { profileId: string; skillIds: string[]; workspacePlanId: string; reconciliationPlanId: string }; response: { restored: string[] } };
      sync_publish_local_changes: { params: { profileId: string; skillIds: string[]; workspacePlanId: string; reconciliationPlanId: string }; response: { commit: string | null; pushed: boolean } };
	  sync_adopt_local_changes: { params: { profileId: string; skillIds: string[]; workspacePlanId: string; reconciliationPlanId: string }; response: { commit: string | null; pushed: boolean } };
	  sync_keep_local_changes: { params: { profileId: string; skillIds: string[]; workspacePlanId: string; reconciliationPlanId: string }; response: { kept: string[] } };
	  sync_keep_external_local_changes: { params: { profileId: string; skillIds: string[]; workspacePlanId: string; reconciliationPlanId: string }; response: { kept: string[] } };
      sync_recovery_status: {
        params: { profileId: string };
        response: {
          pending: boolean;
          operations: Array<{
            kind: "restore" | "library-update";
            item_count: number | null;
            changed_item_count: number | null;
          }>;
        };
      };
      sync_recovery_rollback: { params: { profileId: string }; response: { recovered: boolean } };
      sync_center_connect: {
		params: { profileId: string; remoteUrl: string; agentSlugs: string[]; planId: string; minimumReleaseAgeMinutes: number; requestId?: string };
        response: SyncProfileStatusJson;
      };
      sync_center_connect_preview: {
        params: { remoteUrl: string; agentSlugs: string[]; minimumReleaseAgeMinutes: number; requestId?: string };
        response: SyncConnectPreviewJson;
      };
      sync_library_check_cancel: { params: { requestId: string }; response: { cancelled: boolean } };
      sync_github_create_repo_preview: {
        params: { repository: string; visibility: "private" | "public" };
        response: SyncGitHubRepositoryPreviewJson;
      };
      sync_github_create_repo: {
        params: { repository: string; visibility: "private" | "public"; planId: string };
        response: SyncProviderCreateResultJson;
      };
      sync_gitlab_create_project_preview: {
        params: { project: string; visibility: "private" | "public" };
        response: SyncGitLabProjectPreviewJson;
      };
      sync_gitlab_create_project: {
        params: { project: string; visibility: "private" | "public"; planId: string };
        response: SyncProviderCreateResultJson;
      };
      sync_provider_libraries: {
        params: { provider: "github" | "gitlab"; requestId?: string };
        response: SyncProviderLibrariesResultJson;
      };
      sync_provider_libraries_cancel: {
        params: { requestId: string };
        response: { cancelled: boolean };
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
      list_skill_files: { params: { path: string }; response: string[] };
      read_skill_content: { params: { path: string }; response: string };
      write_skill_content: { params: { path: string; content: string }; response: void };
      install_from_git: { params: { repoUrl: string; skillRelativePath: string; targetAgents: string[] }; response: void };
      fetch_remote_skill_content: { params: { repoUrl: string; skillName?: string | null; skillPath?: string | null; filePath?: string | null; source?: string | null }; response: string };
      list_remote_skill_files: { params: { repoUrl: string; skillName?: string | null; skillPath?: string | null; source?: string | null }; response: string[] };
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
      sync_source_review_progress: SyncSourceReviewProgressJson;
      shell_runtime_changed: { macosWindowBlur: boolean };
      /** Bun → webview: actual http://127.0.0.1:<port> for tRPC (port may differ if default was busy). */
      trpc_endpoint: { baseUrl: string; token: string };
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
      sync_source_review_progress: SyncSourceReviewProgressJson;
      shell_runtime_changed: { macosWindowBlur: boolean };
      trpc_endpoint: { baseUrl: string; token: string };
      app_update_status_changed: AppUpdateStatusJson;
    };
  };
};
