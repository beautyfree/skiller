import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planBundledSkillExport } from "./sync-export";
import { applySyncPublishPlan, createSyncPublishPlan } from "./sync-publish";
import { applySyncRestorePlan, createSyncRestorePlan } from "./sync-restore";
import {
	assertPortableRelativePath,
	createSyncManifest,
	parseSyncManifest,
	stringifySyncManifest,
} from "./sync-profile";
import { scanTextForSecrets } from "./sync-secret-scan";
import {
	cloneSyncWorkspace,
	commitSyncWorkspace,
	getSyncWorkspaceStatus,
	initializeSyncWorkspace,
	pushSyncWorkspace,
} from "./sync-workspace";
import simpleGit from "simple-git";

const tempDirs: string[] = [];

afterEach(() => {
	for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function makeSkill(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "skiller-sync-"));
	tempDirs.push(root);
	for (const [path, content] of Object.entries(files)) {
		const destination = join(root, path);
		mkdirSync(join(destination, ".."), { recursive: true });
		writeFileSync(destination, content);
	}
	return root;
}

describe("sync profile manifest", () => {
	it("round-trips a portable private profile", () => {
		const manifest = createSyncManifest("personal-backup");
		expect(parseSyncManifest(stringifySyncManifest(manifest))).toEqual(manifest);
	});

	it("accepts bundled and pinned reference skills", () => {
		const manifest = parseSyncManifest(`schema_version: 1
profile:
  id: personal-backup
  mode: private
agent_policy:
  mode: selected
  agent_slugs: [claude-code, codex]
skills:
  - id: writing-guide
    kind: bundled
    path: skills/writing-guide
    sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  - id: upstream-skill
    kind: reference
    repository: git@github.com:example/skills.git
    ref: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
    skill_path: skills/upstream-skill
`);
		expect(manifest.skills).toHaveLength(2);
	});

	it("rejects traversal and duplicate ids", () => {
		expect(() => assertPortableRelativePath("skills/../secret")).toThrow("traversal");
		expect(() => parseSyncManifest(`schema_version: 1
profile: { id: private, mode: private }
agent_policy: { mode: detected }
skills:
  - { id: same, kind: bundled, path: skills/same, sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa }
  - { id: same, kind: reference, repository: https://user:password@example.test/repo.git, ref: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, skill_path: skills/same }
`)).toThrow("Duplicate sync skill id");
	});

	it("rejects remote URLs with embedded credentials", () => {
		expect(() => parseSyncManifest(`schema_version: 1
profile: { id: private, mode: private }
agent_policy: { mode: detected }
skills:
  - { id: remote, kind: reference, repository: https://user:password@example.test/repo.git, ref: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, skill_path: skills/remote }
`)).toThrow("must not embed credentials");
	});
});

describe("sync secret scanner", () => {
	it("reports locations without returning the secret value", () => {
		const text = "name: demo\nGITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456\n";
		const findings = scanTextForSecrets(text);
		expect(findings).toContainEqual({ rule: "github-token", line: 2, column: 14 });
		expect(JSON.stringify(findings)).not.toContain("ghp_");
	});

	it("detects private keys and connection strings", () => {
		expect(scanTextForSecrets("-----BEGIN PRIVATE KEY-----\n")[0]?.rule).toBe("private-key");
		expect(scanTextForSecrets("DATABASE_URL=postgres://user:password@db.example/app\n").map((finding) => finding.rule))
			.toContain("connection-string");
	});
});

describe("bundled skill export plan", () => {
	it("builds a stable, allowlisted file plan and skips repository/build directories", () => {
		const root = makeSkill({
			"SKILL.md": "# Writing\n",
			"references/tone.md": "Be concise.\n",
			".git/config": "not exported",
			"node_modules/example.js": "not exported",
		});
		const plan = planBundledSkillExport("writing", root);
		expect(plan.bundledPath).toBe("skills/writing");
		expect(plan.files.map((file) => file.relativePath)).toEqual(["SKILL.md", "references/tone.md"]);
		expect(plan.excludedPaths).toEqual([".git", "node_modules"]);
		expect(plan.secretFindings).toEqual([]);
		expect(plan.sha256).toHaveLength(64);
	});

	it("reports secret locations and rejects symlinks before export", () => {
		const root = makeSkill({
			"SKILL.md": "# Private\nTOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456\n",
		});
		const secretPlan = planBundledSkillExport("private", root);
		expect(secretPlan.secretFindings).toContainEqual({
			rule: "github-token",
			line: 2,
			column: 7,
			relativePath: "SKILL.md",
		});

		const linked = makeSkill({ "SKILL.md": "# Linked\n" });
		symlinkSync(join(root, "SKILL.md"), join(linked, "copied.md"));
		expect(() => planBundledSkillExport("linked", linked)).toThrow("rejects symlink");
	});
});

describe("sync Git workspace", () => {
	it("publishes and restores through a generic local Git remote without a personal identity", async () => {
		const root = mkdtempSync(join(tmpdir(), "skiller-sync-git-"));
		tempDirs.push(root);
		const remote = join(root, "remote.git");
		const publisher = join(root, "publisher");
		const restore = join(root, "restore");
		await simpleGit().raw(["init", "--bare", remote]);

		await initializeSyncWorkspace(publisher, remote);
		writeFileSync(join(publisher, "skiller-sync.yaml"), "schema_version: 1\n");
		expect(await commitSyncWorkspace(publisher, "Skiller sync: publish profile")).toMatch(/^[a-f0-9]{40}$/);
		await pushSyncWorkspace(publisher);
		expect(await getSyncWorkspaceStatus(publisher)).toMatchObject({ changed: false, ahead: 0, remoteUrl: remote });

		await cloneSyncWorkspace(remote, restore);
		expect(readFileSync(join(restore, "skiller-sync.yaml"), "utf8")).toBe("schema_version: 1\n");
		expect(await simpleGit(restore).raw(["config", "user.email"])).toBe("sync@skiller.local\n");
	});
});

describe("sync publish plan", () => {
	it("requires a clean reviewed plan before writing a bundled skill and manifest", () => {
		const root = makeSkill({ "SKILL.md": "# Writing\n", "references/style.md": "Short sentences.\n" });
		const workspace = mkdtempSync(join(tmpdir(), "skiller-sync-workspace-"));
		tempDirs.push(workspace);
		const plan = createSyncPublishPlan("personal", "private", [{ id: "writing", sourcePath: root }]);
		applySyncPublishPlan(workspace, plan);
		expect(readFileSync(join(workspace, "skills/writing/SKILL.md"), "utf8")).toBe("# Writing\n");
		expect(parseSyncManifest(readFileSync(join(workspace, "skiller-sync.yaml"), "utf8"))).toMatchObject({
			profile: { id: "personal", mode: "private" },
			skills: [{ id: "writing", path: "skills/writing" }],
		});
	});

	it("blocks writes when the reviewed skill contains a secret", () => {
		const root = makeSkill({ "SKILL.md": "TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456\n" });
		const workspace = mkdtempSync(join(tmpdir(), "skiller-sync-workspace-"));
		tempDirs.push(workspace);
		const plan = createSyncPublishPlan("personal", "private", [{ id: "private", sourcePath: root }]);
		expect(() => applySyncPublishPlan(workspace, plan)).toThrow("blocked");
		expect(existsSync(join(workspace, "skiller-sync.yaml"))).toBe(false);
	});
});

describe("sync restore preview", () => {
	it("classifies bundled skills before restoring them", () => {
		const source = makeSkill({ "SKILL.md": "# Writing\n" });
		const workspace = mkdtempSync(join(tmpdir(), "skiller-sync-workspace-"));
		const canonical = mkdtempSync(join(tmpdir(), "skiller-sync-canonical-"));
		tempDirs.push(workspace, canonical);
		applySyncPublishPlan(workspace, createSyncPublishPlan("personal", "private", [{ id: "writing", sourcePath: source }]));

		expect(createSyncRestorePlan(workspace, canonical).entries).toMatchObject([{ id: "writing", action: "create" }]);
		mkdirSync(join(canonical, "writing"));
		writeFileSync(join(canonical, "writing", "SKILL.md"), "# Local change\n");
		expect(createSyncRestorePlan(workspace, canonical).entries).toMatchObject([{ id: "writing", action: "conflict" }]);
		writeFileSync(join(canonical, "writing", "SKILL.md"), "# Writing\n");
		expect(createSyncRestorePlan(workspace, canonical).entries).toMatchObject([{ id: "writing", action: "unchanged" }]);
	});

	it("rejects a remote bundle whose contents no longer match its manifest", () => {
		const source = makeSkill({ "SKILL.md": "# Writing\n" });
		const workspace = mkdtempSync(join(tmpdir(), "skiller-sync-workspace-"));
		const canonical = mkdtempSync(join(tmpdir(), "skiller-sync-canonical-"));
		tempDirs.push(workspace, canonical);
		applySyncPublishPlan(workspace, createSyncPublishPlan("personal", "private", [{ id: "writing", sourcePath: source }]));
		writeFileSync(join(workspace, "skills", "writing", "SKILL.md"), "# Tampered\n");
		expect(() => createSyncRestorePlan(workspace, canonical)).toThrow("integrity mismatch");
	});

	it("restores only explicitly selected entries and protects a changed local skill", () => {
		const source = makeSkill({ "SKILL.md": "# Remote\n" });
		const workspace = mkdtempSync(join(tmpdir(), "skiller-sync-workspace-"));
		const canonical = mkdtempSync(join(tmpdir(), "skiller-sync-canonical-"));
		tempDirs.push(workspace, canonical);
		applySyncPublishPlan(workspace, createSyncPublishPlan("personal", "private", [{ id: "writing", sourcePath: source }]));

		const createPlan = createSyncRestorePlan(workspace, canonical);
		applySyncRestorePlan(createPlan, ["writing"]);
		expect(readFileSync(join(canonical, "writing", "SKILL.md"), "utf8")).toBe("# Remote\n");

		writeFileSync(join(canonical, "writing", "SKILL.md"), "# Local\n");
		const conflictPlan = createSyncRestorePlan(workspace, canonical);
		writeFileSync(join(canonical, "writing", "SKILL.md"), "# Changed after preview\n");
		expect(() => applySyncRestorePlan(conflictPlan, ["writing"])).toThrow("changed after preview");
		expect(readFileSync(join(canonical, "writing", "SKILL.md"), "utf8")).toBe("# Changed after preview\n");
	});
});
