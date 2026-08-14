export type MarketplaceSkill = {
	name: string;
	description?: string | null;
	author?: string | null;
	repository?: string | null;
	/** Stable skills.sh catalogue identity, including non-GitHub sources. */
	catalog_id?: string | null;
	/** Direct public page supplied by the marketplace source. */
	url?: string | null;
	/** Path to this skill inside its source repository, when the source exposes it. */
	skill_path?: string | null;
	installs?: number | null;
	source: string;
};
