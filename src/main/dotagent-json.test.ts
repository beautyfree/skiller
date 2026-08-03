import { describe, expect, it } from "bun:test";
import { dotagentDoctorToJson, dotagentStatusToJson } from "./dotagent-json";

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
});
