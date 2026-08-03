/** Read-only compatibility facade shared with the dotagent CLI engine. */
export {
	SKILLS_CLI_LOCK_VERSION,
	getSkillsCliLockPath,
	parseSkillsCliLock,
	readSkillsCliLock,
} from "@beautyfree/dotagent/adapters/skills-cli";

export type {
	SkillsCliLock,
	SkillsCliLockEntry,
} from "@beautyfree/dotagent/adapters/skills-cli";
