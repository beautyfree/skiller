import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dotagentsDescriptorsFromSkiller, scanDotagentsMachine } from "./dotagents-catalog";
import { loadAgentConfigs } from "./registry";
import { defaultAgentConfig } from "./types";
import { parse as parseToml } from "@iarna/toml";
import { builtinAgentCatalog } from "dotagents/catalog";

const catalogRoot = join(import.meta.dir, "..", "..", "agents");

describe("dotagents catalog integration", () => {
	it("keeps every bundled TOML capability field equal to the authoritative core catalog", () => {
		const tomlCapabilities = readdirSync(catalogRoot)
			.filter((name) => name.endsWith(".toml"))
			.map((name) => parseToml(readFileSync(join(catalogRoot, name), "utf8")) as Record<string, unknown>)
			.map((entry) => ({
				slug: String(entry.slug),
				displayName: String(entry.name ?? entry.slug),
				skillRoots: entry.global_paths ?? [],
				...(entry.project_skills_dir ? { projectSkillsDir: entry.project_skills_dir } : {}),
				...(entry.cli_command ? { command: entry.cli_command } : {}),
				detectionMarkers: entry.detect_paths ?? [],
				readableRoots: ((entry.additional_readable_paths ?? []) as Array<{ path: string; source_agent: string }>).map((root) => ({
					path: root.path,
					sourceAgent: root.source_agent,
				})),
			}))
			.sort((left, right) => left.slug.localeCompare(right.slug));
		expect(tomlCapabilities).toEqual(builtinAgentCatalog());
	});

	it("projects every Skiller agent into one unique capability descriptor", () => {
		const configs = loadAgentConfigs(catalogRoot);
		const descriptors = dotagentsDescriptorsFromSkiller(configs);
		expect(descriptors).toHaveLength(configs.length);
		expect(new Set(descriptors.map((descriptor) => descriptor.slug)).size).toBe(configs.length);
		for (const descriptor of descriptors) expect(descriptor.skills.length).toBeGreaterThan(0);
	});

	it("preserves shared-reader capability without using it as detection evidence", () => {
		const descriptors = dotagentsDescriptorsFromSkiller(loadAgentConfigs(catalogRoot));
		const codex = descriptors.find((descriptor) => descriptor.slug === "codex");
		expect(codex?.skills).toContainEqual({ kind: "native-shared" });
		expect(codex?.detection).not.toContainEqual(expect.objectContaining({ path: expect.stringContaining(".agents/skills") }));
	});

	it("matches the skills-only guard on an isolated machine fixture", async () => {
		const root = mkdtempSync(join(tmpdir(), "skiller-dotagents-catalog-"));
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
			const inventory = await scanDotagentsMachine([config], { platform: process.platform as "darwin" | "linux" | "win32", home: root });
			expect(inventory.agents[0]).toMatchObject({ detected: false, reason: "skills-only" });
			mkdirSync(join(marker, "state"));
			const detected = await scanDotagentsMachine([config], { platform: process.platform as "darwin" | "linux" | "win32", home: root });
			expect(detected.agents[0]).toMatchObject({ detected: true, reason: "marker" });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
