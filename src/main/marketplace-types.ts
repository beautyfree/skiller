export type MarketplaceSkill = {
	name: string;
	description?: string | null;
	author?: string | null;
	repository?: string | null;
	/** Path to this skill inside its source repository, when the source exposes it. */
	skill_path?: string | null;
	installs?: number | null;
	source: string;
};
