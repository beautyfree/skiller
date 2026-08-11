import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installFromMarketplace } from "./marketplace/install-from-marketplace";
import { installSkillToProjectFromGit } from "./projects";
import { addSkillRepo } from "./repos";
import { SkillSourceSession } from "dotagents/source-session";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("legacy remote skill boundaries", () => {
	it("routes every legacy Git content path through the immutable dotagents transport", () => {
		for (const relativePath of [
			"install.ts",
			"projects.ts",
			"repos.ts",
			"update.ts",
			"marketplace/install-from-marketplace.ts",
		]) {
			const source = readFileSync(join(import.meta.dir, relativePath), "utf8");
			expect(source).not.toMatch(/simpleGit\s*\(\s*\)\s*\.clone|\.pull\s*\(/);
			expect(source).toMatch(/checkoutReviewedGitSource|fastForwardReviewedGitSource|SkillSourceSession/);
		}
	});

	it("deny every direct Git content path before clone or pull when no Device policy is supplied", async () => {
		const source = "https://example.invalid/untrusted/skills.git";
		const project = mkdtempSync(join(tmpdir(), "skiller-project-trust-"));
		roots.push(project);

		await expect(
			installFromMarketplace(
				{ name: "untrusted", description: null, author: null, repository: source, installs: null, source: "skills.sh" },
				[],
				[],
			),
		).rejects.toThrow("blocked because no device trust decision");
		await expect(installSkillToProjectFromGit(source, ".", project)).rejects.toThrow(
			"blocked because no device trust decision",
		);
		await expect(addSkillRepo(source, () => undefined)).rejects.toThrow(
			"blocked because no device trust decision",
		);
		await expect(SkillSourceSession.open({ repository: source, sourcePolicy: {} })).rejects.toThrow(
			"blocked because no device trust decision",
		);
	});
});
