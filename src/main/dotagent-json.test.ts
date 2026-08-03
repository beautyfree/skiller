import { describe, expect, it } from "bun:test";
import { dotagentAuditToJson, dotagentDiscoveryToJson, dotagentDoctorToJson, dotagentStatusToJson } from "./dotagent-json";

describe("dotagent renderer JSON mapping", () => {
	it("removes machine paths from doctor issues and detection evidence", () => {
		const json = dotagentDoctorToJson({
			ok: false,
			root: "/private/library",
			library: null,
			machine: {
				platform: "darwin",
				detectedSlugs: ["codex"],
				agents: [{ slug: "codex", displayName: "Codex", detected: true, reason: "marker", evidence: "/Users/private/.codex" }],
			},
			issues: [{ code: "invalid-config", severity: "error", message: "Invalid config", remediation: "Fix it", path: "/private/library/dotagent.yaml" }],
		});
		expect(JSON.stringify(json)).not.toContain("/private");
		expect(JSON.stringify(json)).not.toContain("/Users/private");
		expect(json.machine?.agents[0]).toMatchObject({ slug: "codex", reason: "marker" });
	});

	it("maps managed status without target or source paths", () => {
		const json = dotagentStatusToJson({
			library: "/private/library",
			byAgent: {},
			targets: [{ target: "/private/agent/writing", agent: "codex", skill: "writing", mode: "copy", health: "locally-modified", source: "/private/library/skills/writing", sourceIntegrity: "hash", currentIntegrity: "local" }],
		});
		expect(json).toEqual({ targets: [{ agent_slug: "codex", skill_id: "writing", mode: "copy", health: "locally-modified" }] });
		expect(JSON.stringify(json)).not.toContain("/private");
	});

	it("maps discovery suggestions without exposing source or issue paths", () => {
		const json = dotagentDiscoveryToJson({
			skills: [{ candidateKey: "writing", name: "writing", description: "Writes", whenToUse: null, integrity: "sha256-safe", fileCount: 2, bytes: 42, sourcePath: "/Users/private/.agents/skills/writing", locations: [{ kind: "shared" }, { kind: "agent-local", agent: "codex" }], metadataValid: true }],
			collisions: [],
			issues: [{ code: "unsafe-link", severity: "warning", message: "Linked file skipped", remediation: "Keep it local", path: "/Users/private/linked" }],
			linkedAliases: 3,
		}, [{ kind: "dependency", skill: "writing", package: "owner-repo", url: "https://secret-user@example.com/repo", ref: "main", skillPath: "skills/writing", source: "skills-cli" }]);
		expect(json.skills[0]).toMatchObject({ suggested: { kind: "dependency", source: "skills-cli", package: "owner-repo" } });
		expect(JSON.stringify(json)).not.toContain("/Users/private");
		expect(JSON.stringify(json)).not.toContain("secret-user");
	});

	it("maps audit findings without library roots", () => {
		const json = dotagentAuditToJson({
			ok: false,
			publicReady: false,
			library: { root: "/private/library", name: "personal", version: "1.0.0", ownedSkills: [], dependencyCount: 1, locked: true },
			issues: [{ code: "missing-license", severity: "error", message: "No license", remediation: "Choose one", path: "/private/library/skills.json", field: "license" }],
		});
		expect(json).toMatchObject({ ok: false, library: { name: "personal", dependency_count: 1 }, issues: [{ field: "license" }] });
		expect(JSON.stringify(json)).not.toContain("/private");
	});
});
