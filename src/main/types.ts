/** Agent TOML model — same shape as the former Rust/Tauri implementation */

export type SkillFormat = "skill-md";

export interface AgentHooks {
	install?: string;
	uninstall?: string;
	sync?: string;
}

export interface ExtraConfig {
	template?: string;
	target_file?: string;
}

export interface ReadablePath {
	path: string;
	source_agent: string;
}

export interface AgentConfig {
	slug: string;
	name: string;
	enabled: boolean;
	global_paths: string[];
	/**
	 * Relative project path (from repo root) where this agent reads skills.
	 * Examples: ".claude/skills" (Claude Code), ".agents/skills" (universal), ".cursor/skills".
	 * Agents with `.agents/skills` are considered "universal" — they share the canonical
	 * project skills directory and do not need a symlink.
	 */
	project_skills_dir?: string;
	skill_format?: SkillFormat;
	extra_config?: ExtraConfig[];
	hooks?: AgentHooks;
	additional_readable_paths: ReadablePath[];
	cli_command?: string | null;
	install_command?: string | null;
	install_command_windows?: string | null;
	install_command_linux?: string | null;
	install_docs_url?: string | null;
	install_docs_url_linux?: string | null;
	install_source_label?: string | null;
	detect_paths: string[];
	detected: boolean;
}

export function defaultAgentConfig(partial: Partial<AgentConfig> & Pick<AgentConfig, "slug" | "name">): AgentConfig {
	return {
		enabled: true,
		global_paths: [],
		additional_readable_paths: [],
		detect_paths: [],
		detected: false,
		skill_format: "skill-md",
		...partial,
	};
}
