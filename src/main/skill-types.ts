/** Internal skill model — same shape as the former Rust/Tauri implementation */

export type SkillSource =
	| { kind: "LocalPath"; path: string }
	| { kind: "GitRepository"; repo_url: string; skill_path?: string | null }
	| { kind: "SkillsSh"; repository?: string | null }
	| { kind: "ClawHub"; repository?: string | null }
	| { kind: "Unknown" };

export type SkillScope =
	| { kind: "SharedGlobal" }
	| { kind: "AgentLocal"; agent: string };

export interface SkillInstallation {
	agent_slug: string;
	path: string;
	is_symlink: boolean;
	is_inherited: boolean;
	inherited_from?: string | null;
}

export interface Skill {
	id: string;
	name: string;
	description?: string | null;
	canonical_path: string;
	source?: SkillSource | null;
	metadata?: unknown;
	collection?: string | null;
	scope: SkillScope;
	installations: SkillInstallation[];
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
