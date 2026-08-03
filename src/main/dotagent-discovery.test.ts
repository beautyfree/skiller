import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanDotagentSkillDiscovery } from "./dotagent-discovery";
import { defaultAgentConfig } from "./types";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("Skiller shared discovery adapter", () => {
	it("uses dotagent deduplication and Skills CLI provenance for a safe default", async () => {
		const root = mkdtempSync(join(tmpdir(), "skiller-dotagent-discovery-"));
		roots.push(root);
		const shared = join(root, ".agents", "skills");
		const agentSkills = join(root, ".codex", "skills");
		const skill = join(shared, "writing");
		mkdirSync(skill, { recursive: true });
		mkdirSync(agentSkills, { recursive: true });
		writeFileSync(join(skill, "SKILL.md"), "---\nname: writing\ndescription: Writes clearly.\n---\n# Writing\n");
		symlinkSync(skill, join(agentSkills, "writing"), "dir");
		const agent = defaultAgentConfig({ slug: "codex", name: "Codex", detected: true, detection_reason: "marker", global_paths: [agentSkills] });
		const result = await scanDotagentSkillDiscovery([agent], {
			sharedRoot: shared,
			provenance: {},
			skillsCliLock: {
				path: join(root, ".skill-lock.json"),
				version: 3,
				skills: [{ name: "writing", source: "owner/repo", source_type: "github", source_url: "https://github.com/owner/repo", ref: "main", skill_path: "skills/writing", updated_at: "" }],
			},
		});
		expect(result.report.skills).toHaveLength(1);
		expect(result.report.skills[0]?.locations).toEqual([{ kind: "agent-local", agent: "codex" }, { kind: "shared" }]);
		expect(result.suggestions).toEqual([{ kind: "dependency", skill: "writing", package: "owner-repo", url: "https://github.com/owner/repo", ref: "main", skillPath: "skills/writing", source: "skills-cli", agents: ["codex"] }]);
	});
});
