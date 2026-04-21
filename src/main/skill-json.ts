import type {
	AgentConfigJson,
	MarketplaceSkillJson,
	SkillInstallationJson,
	SkillJson,
	SkillScopeJson,
	SkillSourceJson,
} from "../shared/rpc-schema";
import type { Skill, SkillInstallation, SkillScope, SkillSource } from "./skill-types";

export function skillSourceToJson(s: SkillSource): SkillSourceJson {
	switch (s.kind) {
		case "LocalPath":
			return { LocalPath: { path: s.path } };
		case "GitRepository":
			return { GitRepository: { repo_url: s.repo_url, skill_path: s.skill_path } };
		case "SkillsSh":
			return { SkillsSh: { repository: s.repository } };
		case "ClawHub":
			return { ClawHub: { repository: s.repository } };
		case "Unknown":
			return "Unknown";
	}
}

export function skillScopeToJson(s: SkillScope): SkillScopeJson {
	if (s.kind === "SharedGlobal") return { type: "SharedGlobal" };
	return { type: "AgentLocal", agent: s.agent };
}

export function skillInstallationToJson(i: SkillInstallation): SkillInstallationJson {
	return {
		agent_slug: i.agent_slug,
		path: i.path,
		is_symlink: i.is_symlink,
		is_inherited: i.is_inherited,
		inherited_from: i.inherited_from ?? null,
	};
}

export function skillToJson(s: Skill): SkillJson {
	return {
		id: s.id,
		name: s.name,
		description: s.description ?? null,
		when_to_use: s.when_to_use ?? null,
		canonical_path: s.canonical_path,
		source: s.source ? skillSourceToJson(s.source) : null,
		metadata: s.metadata ?? null,
		collection: s.collection ?? null,
		scope: skillScopeToJson(s.scope),
		installations: s.installations.map(skillInstallationToJson),
		footprint_listing_source_chars: s.footprint_listing_source_chars,
		footprint_listing_slice_chars: s.footprint_listing_slice_chars,
		footprint_name_chars: s.footprint_name_chars,
		footprint_skill_md_chars: s.footprint_skill_md_chars,
		listing_excluded: s.listing_excluded,
		bundled_path: s.bundled_path ?? null,
	};
}

export function agentConfigToJson(
	a: import("./types").AgentConfig,
): AgentConfigJson {
	return {
		slug: a.slug,
		name: a.name,
		enabled: a.enabled,
		global_paths: a.global_paths,
		skill_format: a.skill_format,
		extra_config: a.extra_config,
		hooks: a.hooks,
		additional_readable_paths: a.additional_readable_paths,
		cli_command: a.cli_command ?? null,
		install_command: a.install_command ?? null,
		install_command_windows: a.install_command_windows ?? null,
		install_command_linux: a.install_command_linux ?? null,
		install_docs_url: a.install_docs_url ?? null,
		install_docs_url_linux: a.install_docs_url_linux ?? null,
		install_source_label: a.install_source_label ?? null,
		detect_paths: a.detect_paths,
		detected: a.detected,
	};
}

export function marketplaceSkillToJson(m: import("./marketplace-types").MarketplaceSkill): MarketplaceSkillJson {
	return {
		name: m.name,
		description: m.description ?? null,
		author: m.author ?? null,
		repository: m.repository ?? null,
		installs: m.installs ?? null,
		source: m.source,
	};
}
