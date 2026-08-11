import { join } from "node:path";
import { userHomePath } from "./fsutil";

/** Canonical shared skills directory for Skiller (~/.agents/skills). */
export function sharedSkillsDir(): string {
	return join(userHomePath(), ".agents", "skills");
}
