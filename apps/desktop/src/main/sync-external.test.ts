import { describe, expect, it } from "bun:test";
import { classifyExternalRestore, externalKeptSourceMatches, externalSkillDirectory } from "./sync-external";

const gitSkill = {
	id: "adapt",
	kind: "reference" as const,
	repository: "https://github.com/example/skills.git",
	ref: "a".repeat(40),
	skill_path: "skills/adapt",
};

describe("external sync restore policy", () => {
	it("creates an absent pinned skill", () => {
		expect(classifyExternalRestore(gitSkill, false, null)).toBe("create");
	});

	it("leaves a matching pinned skill untouched", () => {
		expect(classifyExternalRestore(gitSkill, true, {
			source: "sync-reference",
			repository: gitSkill.repository,
			ref: gitSkill.ref,
			skill_path: gitSkill.skill_path,
		})).toBe("unchanged");
	});

	it("never overwrites a local skill with different or missing provenance", () => {
		expect(classifyExternalRestore(gitSkill, true, null)).toBe("conflict");
		expect(classifyExternalRestore(gitSkill, true, {
			source: "sync-reference",
			repository: gitSkill.repository,
			ref: "b".repeat(40),
			skill_path: gitSkill.skill_path,
		})).toBe("conflict");
	});

	it("treats a manually edited locally managed skill as a conflict", () => {
		const pinned = { ...gitSkill, sha256: "c".repeat(64) };
		const provenance = {
			source: "sync-reference",
			repository: gitSkill.repository,
			ref: gitSkill.ref,
			skill_path: gitSkill.skill_path,
		};
		expect(classifyExternalRestore(pinned, true, provenance, "d".repeat(64))).toBe("conflict");
		expect(classifyExternalRestore(pinned, true, provenance, pinned.sha256)).toBe("unchanged");
	});

	it("treats a new source commit with identical reviewed content as metadata-only", () => {
		const pinned = { ...gitSkill, ref: "b".repeat(40), sha256: "c".repeat(64) };
		const provenance = {
			source: "sync-reference",
			repository: gitSkill.repository,
			ref: gitSkill.ref,
			skill_path: gitSkill.skill_path,
		};
		expect(classifyExternalRestore(pinned, true, provenance, pinned.sha256)).toBe("unchanged");
		expect(classifyExternalRestore(pinned, true, provenance, "d".repeat(64))).toBe("conflict");
	});

	it("normalizes lockfile paths that point at SKILL.md", () => {
		expect(externalSkillDirectory("SKILL.md")).toBe(".");
		expect(externalSkillDirectory(".claude/skills/adapt/SKILL.md")).toBe(".claude/skills/adapt");
	});

	it("expires a local keep decision when the pinned source changes", () => {
		expect(externalKeptSourceMatches(gitSkill, { repository: gitSkill.repository, ref: gitSkill.ref })).toBe(true);
		expect(externalKeptSourceMatches(gitSkill, { repository: gitSkill.repository, ref: "b".repeat(40) })).toBe(false);
		expect(externalKeptSourceMatches(gitSkill, { repository: "https://example.test/other.git", ref: gitSkill.ref })).toBe(false);
	});
});
