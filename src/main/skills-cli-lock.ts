/** Read-only compatibility facade shared with the dotagents CLI engine. */
export {
	SKILLS_CLI_LOCK_VERSION,
	getSkillsCliLockPath,
	parseSkillsCliLock,
	readSkillsCliLock,
} from "dotagents/adapters/skills-cli";

export type {
	SkillsCliLock,
	SkillsCliLockEntry,
} from "dotagents/adapters/skills-cli";
