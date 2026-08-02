import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanAllSkills } from "./scanner";
import { defaultAgentConfig } from "./types";

const cleanup: string[] = [];
afterEach(() => cleanup.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

function root(): string {
	const path = mkdtempSync(join(tmpdir(), "skiller-scanner-"));
	cleanup.push(path);
	return path;
}

function writeSkill(rootPath: string, id: string): string {
	const path = join(rootPath, id);
	mkdirSync(path, { recursive: true });
	writeFileSync(join(path, "SKILL.md"), "---\nname: Writing guide\ndescription: Write well\n---\n# Guide\n");
	return path;
}

function agent(globalPath: string, sharedPath: string) {
	return defaultAgentConfig({
		slug: "codex",
		name: "Codex",
		detected: true,
		detection_reason: "marker",
		global_paths: [globalPath],
		additional_readable_paths: [{ path: sharedPath, source_agent: "shared" }],
	});
}

describe("shared skills scanner", () => {
	it("keeps a readable shared library separate from agent installations", () => {
		const shared = root();
		const codex = root();
		writeSkill(shared, "writing");

		const skills = scanAllSkills([agent(codex, shared)], shared);
		expect(skills).toHaveLength(1);
		expect(skills[0]?.scope).toEqual({ kind: "SharedGlobal" });
		expect(skills[0]?.installations).toEqual([]);
	});

	it("shows an agent only when its folder explicitly links the shared skill", () => {
		const shared = root();
		const codex = root();
		const skill = writeSkill(shared, "writing");
		symlinkSync(skill, join(codex, "writing"));

		const skills = scanAllSkills([agent(codex, shared)], shared);
		expect(skills).toHaveLength(1);
		expect(skills[0]?.scope).toEqual({ kind: "SharedGlobal" });
		expect(skills[0]?.installations).toEqual([expect.objectContaining({ agent_slug: "codex", is_symlink: true, is_inherited: false })]);
	});
});
