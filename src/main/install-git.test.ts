import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { planBundledSkillExport } from "./sync-export";
import { prepareGitSkillInstall } from "./install";

const tempDirs: string[] = [];

afterEach(() => {
	for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function createPinnedSkillSource(): Promise<{ repository: string; commit: string; hash: string }> {
	const repository = mkdtempSync(join(tmpdir(), "skiller-pinned-source-"));
	tempDirs.push(repository);
	writeFileSync(join(repository, "SKILL.md"), "---\nname: portable-test\n---\n\n# Portable test\n", "utf8");
	writeFileSync(join(repository, "guide.md"), "This must arrive on the second machine.\n", "utf8");
	const git = simpleGit(repository);
	await git.init();
	await git.addConfig("user.email", "test@skiller.local");
	await git.addConfig("user.name", "Skiller test");
	await git.add(".");
	await git.commit("Add portable skill");
	return {
		repository,
		commit: (await git.revparse(["HEAD"])).trim(),
		hash: planBundledSkillExport("portable-test", repository).sha256,
	};
}

function installInCleanHome(options: { repository: string; commit: string; hash: string; home: string }): ReturnType<typeof Bun.spawnSync> {
	const installModule = join(import.meta.dir, "install.ts");
	const provenanceModule = join(import.meta.dir, "provenance.ts");
	const typesModule = join(import.meta.dir, "types.ts");
	const script = `
import { installSkillFromGit } from ${JSON.stringify(installModule)};
import { readProvenance } from ${JSON.stringify(provenanceModule)};
import { defaultAgentConfig } from ${JSON.stringify(typesModule)};
import { exactSourceSecurityPolicy } from "dotagents/source-policy";
import { join } from "node:path";
const agentSkillRoot = join(process.env.HOME, ".skiller-test-agent", "skills");
const agent = defaultAgentConfig({
  slug: "test-agent", name: "Test agent", detected: true, global_paths: [agentSkillRoot],
});
const installed = await installSkillFromGit(
  ${JSON.stringify(options.repository)}, ".", [agent.slug], [agent], "sync-reference",
  ${JSON.stringify(options.commit)}, "portable-test", ${JSON.stringify(options.hash)},
  exactSourceSecurityPolicy([${JSON.stringify(options.repository)}]),
);
console.log(JSON.stringify({ installed, agentSkillRoot, provenance: readProvenance()["portable-test"] }));
`;
	return Bun.spawnSync({
		cmd: [process.execPath, "-e", script],
		cwd: process.cwd(),
		// node:os.homedir() reads HOME on Unix but USERPROFILE on Windows.
		// Set both so this subprocess is genuinely a clean second device on
		// every supported platform.
		env: { ...process.env, HOME: options.home, USERPROFILE: options.home },
		stdout: "pipe",
		stderr: "pipe",
	});
}

describe("pinned Git skill restore", () => {
	test("rejects a source without device trust before cloning it", async () => {
		const source = await createPinnedSkillSource();
		await expect(
			prepareGitSkillInstall(source.repository, ".", source.commit, "portable-test", source.hash),
		).rejects.toThrow(/explicit allow_local|allowlist|not trusted/i);
	});

	test("reproduces a verified external skill in an isolated second-device home", async () => {
		const source = await createPinnedSkillSource();
		const secondHome = mkdtempSync(join(tmpdir(), "skiller-second-device-"));
		tempDirs.push(secondHome);

		const result = installInCleanHome({ ...source, home: secondHome });
		expect(result.exitCode).toBe(0);
		const output = JSON.parse(new TextDecoder().decode(result.stdout));
		expect(output.installed).toBe(join(secondHome, ".agents", "skills", "portable-test"));
		expect(readFileSync(join(output.installed, "guide.md"), "utf8")).toContain("second machine");
		expect(readFileSync(join(output.agentSkillRoot, "portable-test", "guide.md"), "utf8")).toContain("second machine");
		expect(output.provenance).toMatchObject({
			source: "sync-reference",
			repository: source.repository,
			ref: source.commit,
			skill_path: null,
		});
	});

	test("rejects a mismatched pinned source before writing to the second-device library", async () => {
		const source = await createPinnedSkillSource();
		const secondHome = mkdtempSync(join(tmpdir(), "skiller-second-device-"));
		tempDirs.push(secondHome);

		const result = installInCleanHome({ ...source, hash: "f".repeat(64), home: secondHome });
		expect(result.exitCode).not.toBe(0);
		expect(existsSync(join(secondHome, ".agents", "skills", "portable-test"))).toBe(false);
	});
});
