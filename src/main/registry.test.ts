import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInstallTargets } from "./install";
import { detectAgents } from "./registry";
import { defaultAgentConfig } from "./types";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "skiller-registry-"));
	tempDirs.push(dir);
	return dir;
}

describe("detectAgents", () => {
	it("does not treat a skills directory as proof that its agent is installed", () => {
		const root = tempDir();
		const skillsDir = join(root, "skills");
		mkdirSync(skillsDir);

		const [agent] = detectAgents([
			defaultAgentConfig({
				slug: "absent-agent",
				name: "Absent Agent",
				global_paths: [skillsDir],
			}),
		]);

		expect(agent.detected).toBe(false);
	});

	it("still recognizes an explicit detection marker", () => {
		const root = tempDir();
		const marker = join(root, "agent-config");
		mkdirSync(marker);

		const [agent] = detectAgents([
			defaultAgentConfig({
				slug: "present-agent",
				name: "Present Agent",
				detect_paths: [marker],
			}),
		]);

		expect(agent.detected).toBe(true);
	});

	it("does not treat a marker containing only Skiller's skills path as an agent install", () => {
		const root = tempDir();
		const marker = join(root, "agent-config");
		const skillsDir = join(marker, "skills");
		mkdirSync(skillsDir, { recursive: true });

		const [agent] = detectAgents([
			defaultAgentConfig({
				slug: "absent-agent",
				name: "Absent Agent",
				detect_paths: [marker],
				global_paths: [skillsDir],
			}),
		]);

		expect(agent.detected).toBe(false);
	});

	it("recognizes a marker with agent state in addition to the skills path", () => {
		const root = tempDir();
		const marker = join(root, "agent-config");
		const skillsDir = join(marker, "skills");
		mkdirSync(skillsDir, { recursive: true });
		mkdirSync(join(marker, "agent-state"));

		const [agent] = detectAgents([
			defaultAgentConfig({
				slug: "present-agent",
				name: "Present Agent",
				detect_paths: [marker],
				global_paths: [skillsDir],
			}),
		]);

		expect(agent.detected).toBe(true);
	});
});

describe("resolveInstallTargets", () => {
	it("rejects an absent agent before any install can create its skills directory", () => {
		const agent = defaultAgentConfig({
			slug: "absent-agent",
			name: "Absent Agent",
			global_paths: [join(tempDir(), "skills")],
			detected: false,
		});

		expect(() => resolveInstallTargets([agent.slug], [agent])).toThrow(
			"agent `absent-agent` is not detected",
		);
	});
});
