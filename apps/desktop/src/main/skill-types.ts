/** Internal skill model — same shape as the former Rust/Tauri implementation */

export type SkillSource =
	| { kind: "LocalPath"; path: string }
	| { kind: "GitRepository"; repo_url: string; skill_path?: string | null }
	| { kind: "SkillsSh"; repository?: string | null }
	| { kind: "ClawHub"; repository?: string | null }
	| { kind: "Unknown" };

export type SkillScope =
	/** The canonical ~/.agents/skills library, owned by the user rather than an agent. */
	| { kind: "SharedLibrary" }
	| { kind: "SharedGlobal" }
	| { kind: "AgentLocal"; agent: string };

export interface SkillInstallation {
	agent_slug: string;
	path: string;
	is_symlink: boolean;
	/** The agent reads this skill from another declared root, rather than owning a copy. */
	is_inherited: boolean;
	inherited_from?: string | null;
}

/** Device-local lifecycle facts supplied by dotagents, never stored in a synced library. */
export interface SkillLibraryState {
	first_seen_at: string;
	reviewed_at: string | null;
	ownership: "external" | "owned" | "forked" | "unknown";
	forked_from: {
		repository: string | null;
		skill_path: string | null;
		ref: string | null;
	} | null;
}

export interface Skill {
	id: string;
	name: string;
	description?: string | null;
	/** Frontmatter when_to_use (combined with description for listing-size estimate). */
	when_to_use?: string | null;
	canonical_path: string;
	source?: SkillSource | null;
	metadata?: unknown;
	collection?: string | null;
	scope: SkillScope;
	installations: SkillInstallation[];
	/** Len(description + when_to_use) before per-entry cap. */
	footprint_listing_source_chars: number;
	/** Capped description+when slice used for listing estimate (0 if disable_model_invocation). */
	footprint_listing_slice_chars: number;
	/** Display name length (names always included in listing). */
	footprint_name_chars: number;
	/** Full SKILL.md file size in characters. */
	footprint_skill_md_chars: number;
	/** True when model listing omits description slice (manual invoke). */
	listing_excluded: boolean;
	/** When set, skill content is mirrored into the sync repo at this relative path. */
	bundled_path?: string | null;
	/** Device-local provenance and review state managed by dotagents. */
	library_state?: SkillLibraryState | null;
}

export interface UpdateProgress {
	done: number;
	total: number;
	current_skill: string;
}

export interface UpdateAllResult {
	updated: string[];
	failed: [string, string][];
	skipped: number;
}
