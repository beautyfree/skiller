import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dotagentDescriptorsFromSkiller, scanDotagentMachine } from "./dotagent-catalog";
import { loadAgentConfigs } from "./registry";
import { defaultAgentConfig } from "./types";

const catalogRoot = join(import.meta.dir, "..", "..", "agents");

describe("dotagent catalog integration", () => {
	it("projects every Skiller agent into one unique capability descriptor", () => {
		const configs = loadAgentConfigs(catalogRoot);
		const descriptors = dotagentDescriptorsFromSkiller(configs);
		expect(descriptors).toHaveLength(configs.length);
		expect(new Set(descriptors.map((descriptor) => descriptor.slug)).size).toBe(configs.length);
		for (const descriptor of descriptors) expect(descriptor.skills.length).toBeGreaterThan(0);
	});

	it("preserves shared-reader capability without using it as detection evidence", () => {
		const descriptors = dotagentDescriptorsFromSkiller(loadAgentConfigs(catalogRoot));
		const codex = descriptors.find((descriptor) => descriptor.slug === "codex");
		expect(codex?.skills).toContainEqual({ kind: "native-shared" });
		expect(codex?.detection).not.toContainEqual(expect.objectContaining({ path: expect.stringContaining(".agents/skills") }));
	});

	it("matches the skills-only guard on an isolated machine fixture", async () => {
		const root = mkdtempSync(join(tmpdir(), "skiller-dotagent-catalog-"));
		try {
			const marker = join(root, ".agent");
			const skills = join(marker, "skills");
			mkdirSync(skills, { recursive: true });
			const config = defaultAgentConfig({
				slug: "fixture-agent",
				name: "Fixture Agent",
				global_paths: [skills],
				detect_paths: [marker],
			});
			const inventory = await scanDotagentMachine([config], { platform: process.platform as "darwin" | "linux" | "win32", home: root });
			expect(inventory.agents[0]).toMatchObject({ detected: false, reason: "skills-only" });
			mkdirSync(join(marker, "state"));
			const detected = await scanDotagentMachine([config], { platform: process.platform as "darwin" | "linux" | "win32", home: root });
			expect(detected.agents[0]).toMatchObject({ detected: true, reason: "marker" });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
