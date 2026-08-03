import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgentConfigs } from "./registry";
import { classifyRuntimeAgent } from "./runtime-agent";
import { getSkillsCliLockPath, readSkillsCliLock } from "./skills-cli-lock";

const root = join(import.meta.dir, "..", "..", "agents");

describe("Skills CLI compatibility", () => {
	it("keeps every upstream universal agent represented by a Skiller config or explicit alias", () => {
		const manifest = JSON.parse(readFileSync(join(root, "skills-sh-universal.json"), "utf8")) as {
			agents: string[];
			pseudoAgents?: string[];
			aliases: Record<string, string>;
		};
		const slugs = new Set(loadAgentConfigs(root).map((agent) => agent.slug));
		for (const upstreamSlug of manifest.agents) {
			if (manifest.pseudoAgents?.includes(upstreamSlug)) continue;
			expect(slugs.has(manifest.aliases[upstreamSlug] ?? upstreamSlug)).toBe(true);
		}
	});

	it("maps runtime aliases without making them installation detections", () => {
		expect(classifyRuntimeAgent("github-copilot", "AI_AGENT")).toEqual({
			runtime_name: "github-copilot",
			mapped_agent_slug: "copilot-cli",
			source: "AI_AGENT",
		});
		expect(classifyRuntimeAgent("  ", "AI_AGENT")).toBeNull();
	});

	it("reads a valid Skills CLI v3 lock without rewriting it", () => {
		const dir = mkdtempSync(join(tmpdir(), "skiller-skills-lock-"));
		try {
			const path = join(dir, ".skill-lock.json");
			const original = JSON.stringify({
				version: 3,
				skills: {
					"react-best-practices": {
						source: "vercel-labs/agent-skills",
						sourceType: "github",
						sourceUrl: "https://github.com/vercel-labs/agent-skills",
						ref: "main",
						skillPath: "skills/react-best-practices",
						updatedAt: "2026-07-31T00:00:00.000Z",
					},
				},
			});
			writeFileSync(path, original);
			expect(readSkillsCliLock(path)).toMatchObject({ version: 3, skills: [{ name: "react-best-practices", ref: "main" }] });
			expect(readFileSync(path, "utf8")).toBe(original);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("uses the documented XDG lock location", () => {
		expect(getSkillsCliLockPath({ XDG_STATE_HOME: "/state" }, "/home/test")).toBe("/state/skills/.skill-lock.json");
		expect(getSkillsCliLockPath({}, "/home/test")).toBe("/home/test/.agents/.skill-lock.json");
	});

	it("does not guess an unrecognised Skills CLI lockfile schema", () => {
		const dir = mkdtempSync(join(tmpdir(), "skiller-skills-lock-"));
		try {
			const path = join(dir, ".skill-lock.json");
			writeFileSync(path, JSON.stringify({
				version: 999,
				skills: { unknown: { source: "owner/repo", sourceType: "github", sourceUrl: "https://example.test/repo" } },
			}));
			expect(readSkillsCliLock(path)).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
