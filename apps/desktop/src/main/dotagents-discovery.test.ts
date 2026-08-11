import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyInitializeLibraryPlan, planInitializeLibrary } from "dotagents/init";
import { planImport } from "dotagents/import";
import { planDotagentsImportFromDiscovery, scanDotagentsSkillDiscovery } from "./dotagents-discovery";
import { defaultAgentConfig } from "./types";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("Skiller shared discovery adapter", () => {
	it("includes a direct global skill from an agent marked skills-only", async () => {
		const root = mkdtempSync(join(tmpdir(), "skiller-dotagents-direct-global-"));
		roots.push(root);
		const agentSkills = join(root, ".claude", "skills");
		const direct = join(agentSkills, "direct-writing");
		mkdirSync(direct, { recursive: true });
		writeFileSync(join(direct, "SKILL.md"), "---\nname: direct-writing\ndescription: Installed directly.\n---\n# Direct\n");
		const agent = defaultAgentConfig({
			slug: "claude-code",
			name: "Claude Code",
			detected: false,
			detection_reason: "skills-only",
			global_paths: [agentSkills],
		});

		const result = await scanDotagentsSkillDiscovery([agent], { sharedRoot: join(root, ".agents", "skills"), skillsCliLock: null });
		expect(result.report.skills).toEqual([
			expect.objectContaining({ name: "direct-writing", locations: [{ kind: "agent-local", agent: "claude-code" }] }),
		]);
	});

	it("uses dotagents deduplication and Skills CLI provenance for a safe default", async () => {
		const root = mkdtempSync(join(tmpdir(), "skiller-dotagents-discovery-"));
		roots.push(root);
		const shared = join(root, ".agents", "skills");
		const agentSkills = join(root, ".codex", "skills");
		const skill = join(shared, "writing");
		mkdirSync(skill, { recursive: true });
		mkdirSync(agentSkills, { recursive: true });
		writeFileSync(join(skill, "SKILL.md"), "---\nname: writing\ndescription: Writes clearly.\n---\n# Writing\n");
		symlinkSync(skill, join(agentSkills, "writing"), "dir");
		const agent = defaultAgentConfig({ slug: "codex", name: "Codex", detected: true, detection_reason: "marker", global_paths: [agentSkills] });
		const result = await scanDotagentsSkillDiscovery([agent], {
			sharedRoot: shared,
			skillsCliLock: {
				path: join(root, ".skill-lock.json"),
				version: 3,
				skills: [{ name: "writing", source: "owner/repo", source_type: "github", source_url: "https://github.com/owner/repo", ref: "main", skill_path: "skills/writing", updated_at: "" }],
			},
		});
		expect(result.report.skills).toHaveLength(1);
		expect(result.report.skills[0]?.locations).toEqual([{ kind: "agent-local", agent: "codex" }, { kind: "shared" }]);
		expect(result.suggestions).toEqual([{ kind: "dependency", skill: "writing", package: "owner-repo", url: "https://github.com/owner/repo", ref: "main", skillPath: "skills/writing", source: "skills-cli", agents: ["codex"] }]);

		const library = join(root, "library");
		await applyInitializeLibraryPlan(planInitializeLibrary(library, "portable-library"));
		const options = { sharedRoot: shared, skillsCliLock: {
			path: join(root, ".skill-lock.json"), version: 3 as const,
			skills: [{ name: "writing", source: "owner/repo", source_type: "github", source_url: "https://github.com/owner/repo", ref: "main", skill_path: "skills/writing", updated_at: "" }],
		} };
		const plan = await planDotagentsImportFromDiscovery(library, [agent], [{ candidateKey: "writing", disposition: "suggested" }], options);
		const cliCorePlan = await planImport(library, result.suggestions);
		expect(JSON.stringify(plan)).toBe(JSON.stringify(cliCorePlan));
		expect(plan.planId).toBe(cliCorePlan.planId);
		expect(plan.operations).toEqual([expect.objectContaining({ skill: "writing", action: "record-dependency", sourceKind: "dependency" })]);
		expect(JSON.stringify(plan.nextManifest)).not.toContain(shared);
		await expect(planDotagentsImportFromDiscovery(library, [agent], [{ candidateKey: "missing", disposition: "owned" }], options)).rejects.toThrow("changed or disappeared");
	});
});
