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
	it("recognizes CLI agents from real agent state when their CLI is absent from PATH", () => {
		const root = tempDir();
		for (const slug of [
			"antigravity",
			"claude-code",
			"cline",
			"codebuddy",
			"codex",
			"copilot-cli",
			"cursor",
			"factory",
			"gemini-cli",
			"kiro",
			"openclaw",
			"opencode",
			"qoder",
			"trae",
			"windsurf",
		]) {
			const marker = join(root, slug);
			mkdirSync(join(marker, "skills"), { recursive: true });
			mkdirSync(join(marker, "state"));

			const [agent] = detectAgents([
				defaultAgentConfig({
					slug,
					name: slug,
					cli_command: "definitely-not-on-path",
					detect_paths: [marker],
					global_paths: [join(marker, "skills")],
				}),
			]);

			expect(agent.detected).toBe(true);
			expect(agent.detection_reason).toBe("marker");
		}
	});

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
		expect(agent.detection_reason).toBe("not-found");
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
		expect(agent.detection_reason).toBe("marker");
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
		expect(agent.detection_reason).toBe("skills-only");
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
		expect(agent.detection_reason).toBe("marker");
	});

	it("reports CLI detection separately from filesystem markers", () => {
		const [agent] = detectAgents([
			defaultAgentConfig({
				slug: "bun",
				name: "Bun",
				cli_command: "bun",
			}),
		]);

		expect(agent.detected).toBe(true);
		expect(agent.detection_reason).toBe("cli");
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
