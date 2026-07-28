import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { uninstallDirectSkillFromAll } from "./uninstall";
import { defaultAgentConfig } from "./types";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("uninstallDirectSkillFromAll", () => {
	it("removes direct installations without deleting inherited copies", () => {
		const root = mkdtempSync("skiller-uninstall-");
		tempDirs.push(root);
		const directRoot = join(root, "direct");
		const inheritedRoot = join(root, "shared");
		mkdirSync(join(directRoot, "my-skill"), { recursive: true });
		mkdirSync(join(inheritedRoot, "my-skill"), { recursive: true });

		uninstallDirectSkillFromAll("my-skill", [
			defaultAgentConfig({ slug: "direct", name: "Direct", global_paths: [directRoot] }),
			defaultAgentConfig({
				slug: "inherited",
				name: "Inherited",
				additional_readable_paths: [{ path: inheritedRoot, source_agent: "shared" }],
			}),
		]);

		expect(existsSync(join(directRoot, "my-skill"))).toBe(false);
		expect(existsSync(join(inheritedRoot, "my-skill"))).toBe(true);
	});
});
