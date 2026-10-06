import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanAllSkills, resolveSkillSource, discoverSkillDirs } from "./scanner";
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
	it("reports shared-library availability for an agent that explicitly reads it", () => {
		const shared = root();
		const codex = root();
		writeSkill(shared, "writing");

		const skills = scanAllSkills([agent(codex, shared)], shared);
		expect(skills).toHaveLength(1);
		expect(skills[0]?.scope).toEqual({ kind: "SharedLibrary" });
		expect(skills[0]?.installations).toEqual([
			expect.objectContaining({ agent_slug: "codex", is_inherited: true, inherited_from: "shared" }),
		]);
	});

	it("prefers a direct link over inherited shared-library availability", () => {
		const shared = root();
		const codex = root();
		const skill = writeSkill(shared, "writing");
		symlinkSync(skill, join(codex, "writing"));

		const skills = scanAllSkills([agent(codex, shared)], shared);
		expect(skills).toHaveLength(1);
		expect(skills[0]?.scope).toEqual({ kind: "SharedLibrary" });
		expect(skills[0]?.installations).toEqual([
			expect.objectContaining({ agent_slug: "codex", is_symlink: true, is_inherited: false }),
		]);
	});

	it("shows a configured non-shared readable path as an inherited agent link", () => {
		const shared = root();
		const claude = root();
		const warp = root();
		writeSkill(claude, "writing");
		const claudeAgent = defaultAgentConfig({ slug: "claude-code", name: "Claude Code", detected: true, detection_reason: "marker", global_paths: [claude] });
		const warpAgent = defaultAgentConfig({ slug: "warp", name: "Warp", detected: true, detection_reason: "marker", global_paths: [warp], additional_readable_paths: [{ path: claude, source_agent: "claude-code" }] });

		const skills = scanAllSkills([claudeAgent, warpAgent], shared);
		expect(skills).toHaveLength(1);
		expect(skills[0]?.installations).toEqual(expect.arrayContaining([
			expect.objectContaining({ agent_slug: "claude-code", is_inherited: false }),
			expect.objectContaining({ agent_slug: "warp", is_inherited: true, inherited_from: "claude-code" }),
		]));
	});

	it("does not mistake identical agent-local copies for the shared library", () => {
		const shared = root();
		const codex = root();
		const claude = root();
		writeSkill(codex, "writing");
		writeSkill(claude, "writing");
		const codexAgent = defaultAgentConfig({ slug: "codex", name: "Codex", detected: true, detection_reason: "marker", global_paths: [codex] });
		const claudeAgent = defaultAgentConfig({ slug: "claude-code", name: "Claude Code", detected: true, detection_reason: "marker", global_paths: [claude] });

		const skills = scanAllSkills([codexAgent, claudeAgent], shared);
		expect(skills[0]?.scope).toEqual({ kind: "AgentLocal", agent: "codex" });
		expect(skills[0]?.installations).toHaveLength(2);
	});
});


it("distinguishes recorded origins from discovery without provenance", () => {
  const base = { repository: null, skill_path: null, ref: null, content_sha256: null, first_seen_at: '2026-10-06T00:00:00Z', reviewed_at: null, ownership: 'unknown' as const, forked_from: null, updated_at: '2026-10-06T00:00:00Z' }
  expect(resolveSkillSource('example', {})).toEqual({ kind: 'Unknown' })
  expect(resolveSkillSource('example', { example: { ...base, source: 'local' } })).toEqual({ kind: 'Unknown' })
  expect(resolveSkillSource('example', { example: { ...base, source: 'local', repository: '/original/folder' } })).toEqual({ kind: 'LocalPath', path: '/original/folder' })
  expect(resolveSkillSource('example', { example: { ...base, source: 'git', repository: 'https://github.com/owner/repo', skill_path: 'skills/example' } })).toEqual({ kind: 'GitRepository', repo_url: 'https://github.com/owner/repo', skill_path: 'skills/example' })
  expect(resolveSkillSource('example', { example: { ...base, source: 'git' } })).toEqual({ kind: 'Unknown' })
  expect(resolveSkillSource('example', { example: { ...base, source: 'skills.sh', repository: 'https://github.com/owner/repo' } })).toEqual({ kind: 'SkillsSh', repository: 'https://github.com/owner/repo' })
  expect(resolveSkillSource('example', { example: { ...base, source: 'clawhub' } })).toEqual({ kind: 'ClawHub', repository: null })
})

it("does not display rollback snapshots as installed skills or repository candidates", () => {
  const shared = root(), personal = root();
  writeSkill(shared, "writing");
  writeSkill(shared, ".dotagents/history/old/payload/writing");
  writeSkill(shared, ".git/fixture");
  expect(scanAllSkills([agent(personal, shared)], shared).map(skill => skill.id)).toEqual(["writing"]);
  expect(discoverSkillDirs(shared).map(skill => skill.dir)).toEqual([join(shared, "writing")]);
});
