import { join } from "node:path";
import { homedir } from "node:os";

/** Canonical shared skills directory per Agent Skills spec (~/.agents/skills). */
export function sharedSkillsDir(): string {
	return join(homedir(), ".agents", "skills");
}
