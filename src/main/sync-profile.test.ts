import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planBundledSkillExport } from "./sync-export";
import {
	applySyncPublishPlan,
	createSyncPublishPlan,
	createSyncPublishWorkspacePlan,
	mergeBundledUpdateIntoManifest,
} from "./sync-publish";
import { applySyncRestorePlan, createSyncRestorePlan, syncRestorePlanId } from "./sync-restore";
import { createLegacySyncRestorePlan } from "./sync-restore-legacy";
import { makeSyncLedger } from "./sync-ledger";
import {
	assertPortableRelativePath,
	createSyncManifest,
	parseSyncManifest,
	syncProfileIdFromRemote,
	stringifySyncManifest,
} from "./sync-profile";
import { scanTextForSecrets } from "./sync-secret-scan";
import {
	cloneSyncWorkspace,
	commitSyncWorkspace,
	fastForwardSyncWorkspace,
	fetchSyncWorkspace,
	getSyncWorkspaceStatus,
	initializeSyncWorkspace,
	pushSyncWorkspace,
	refreshSyncWorkspaceStatus,
	resolveGitReferenceToCommit,
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
	it("derives a stable private workspace id from HTTPS and SSH remotes", () => {
		expect(syncProfileIdFromRemote("https://github.com/beautyfree/My Agent Library.git")).toBe("my-agent-library");
		expect(syncProfileIdFromRemote("git@github.com:beautyfree/dotagents.git")).toBe("dotagents");
	});

	it("round-trips a portable private profile", () => {
		const manifest = createSyncManifest("personal-backup", "private", {
			mode: "selected",
			agent_slugs: ["claude-code", "codex"],
		});
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
		expect(manifest.schema_version).toBe(3);
	});

	it("records a pinned skills.sh dependency without vendoring its files", () => {
		const manifest = parseSyncManifest(`schema_version: 3
profile: { id: personal-backup, mode: private }
agent_policy: { mode: detected }
skills:
  - { id: frontend-design, kind: skills_sh, source_url: https://github.com/vercel-labs/agent-skills, ref: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, skill_path: skills/frontend-design, installations: [codex] }
`);
		expect(manifest.skills).toEqual([expect.objectContaining({
			id: "frontend-design",
			kind: "skills_sh",
			installations: ["codex"],
		})]);
	});

	it("allows a skills.sh skill at the root of its source repository", () => {
		const manifest = parseSyncManifest(`schema_version: 3
profile: { id: personal-backup, mode: private }
agent_policy: { mode: detected }
skills:
  - { id: root-skill, kind: skills_sh, source_url: https://github.com/example/root-skill, ref: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, skill_path: . }
`);
		expect(manifest.skills[0]).toMatchObject({ kind: "skills_sh", skill_path: "." });
	});

	it("reads a v1 profile without changing it until a reviewed v3 publish", () => {
		const legacy = parseSyncManifest(`schema_version: 1
profile: { id: personal, mode: private }
agent_policy: { mode: detected }
skills:
  - { id: writing, kind: bundled, path: skills/writing, sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa }
`);
		expect(legacy).toMatchObject({ schema_version: 3, skills: [{ id: "writing" }] });
		expect(stringifySyncManifest(legacy)).toContain("schema_version: 3");
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

	it("does not block documentation examples that merely assign credential-shaped names", () => {
		expect(scanTextForSecrets("API_KEY=your_key_here\nTOKEN=replace_me\n")).toEqual([]);
	});

	it("does not block an explicitly labelled connection-string placeholder", () => {
		expect(scanTextForSecrets("Build-time placeholder: DATABASE_URL=postgres://postgres:postgres@localhost:5432/app\n")).toEqual([]);
	});

	it("does not block a connection string used in an e.g. documentation example", () => {
		expect(scanTextForSecrets("Use e.g. DATABASE_URL=postgres://postgres:postgres@localhost:5432/app\n")).toEqual([]);
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

	it("fast-forwards a clean restore workspace after fetching a reviewed remote", async () => {
		const root = mkdtempSync(join(tmpdir(), "skiller-sync-git-"));
		tempDirs.push(root);
		const remote = join(root, "remote.git");
		const publisher = join(root, "publisher");
		const restore = join(root, "restore");
		await simpleGit().raw(["init", "--bare", remote]);
		await initializeSyncWorkspace(publisher, remote);
		writeFileSync(join(publisher, "skiller-sync.yaml"), "first\n");
		await commitSyncWorkspace(publisher, "first");
		await pushSyncWorkspace(publisher);
		await cloneSyncWorkspace(remote, restore);

		writeFileSync(join(publisher, "skiller-sync.yaml"), "second\n");
		await commitSyncWorkspace(publisher, "second");
		await pushSyncWorkspace(publisher);
		await fetchSyncWorkspace(restore);
		await fastForwardSyncWorkspace(restore);

		expect(readFileSync(join(restore, "skiller-sync.yaml"), "utf8")).toBe("second\n");
	});

	it("checks remote metadata without merging a remote change into the managed checkout", async () => {
		const root = mkdtempSync(join(tmpdir(), "skiller-sync-git-"));
		tempDirs.push(root);
		const remote = join(root, "remote.git");
		const publisher = join(root, "publisher");
		const observer = join(root, "observer");
		await simpleGit().raw(["init", "--bare", remote]);
		await initializeSyncWorkspace(publisher, remote);
		writeFileSync(join(publisher, "skiller-sync.yaml"), "first\n");
		await commitSyncWorkspace(publisher, "first");
		await pushSyncWorkspace(publisher);
		await cloneSyncWorkspace(remote, observer);

		writeFileSync(join(publisher, "skiller-sync.yaml"), "second\n");
		await commitSyncWorkspace(publisher, "second");
		await pushSyncWorkspace(publisher);
		await refreshSyncWorkspaceStatus(observer);

		expect(await getSyncWorkspaceStatus(observer)).toMatchObject({ behind: 1, changed: false });
		expect(readFileSync(join(observer, "skiller-sync.yaml"), "utf8")).toBe("first\n");
	});

	it("pins a branch to the remote commit before it enters a portable manifest", async () => {
		const root = mkdtempSync(join(tmpdir(), "skiller-sync-git-"));
		tempDirs.push(root);
		const remote = join(root, "remote.git");
		const publisher = join(root, "publisher");
		await simpleGit().raw(["init", "--bare", remote]);
		await initializeSyncWorkspace(publisher, remote);
		writeFileSync(join(publisher, "skiller-sync.yaml"), "first\n");
		await commitSyncWorkspace(publisher, "first");
		await pushSyncWorkspace(publisher);
		const expected = (await simpleGit(publisher).revparse(["HEAD"])).trim();
		await simpleGit(remote).raw(["symbolic-ref", "HEAD", "refs/heads/main"]);

		expect(await resolveGitReferenceToCommit(remote, "main")).toBe(expected);
		expect(await resolveGitReferenceToCommit(remote, "HEAD")).toBe(expected);
	});
});

describe("sync publish plan", () => {
	it("records an immutable Git reference without copying its skill files", () => {
		const workspace = mkdtempSync(join(tmpdir(), "skiller-sync-workspace-"));
		tempDirs.push(workspace);
		const plan = createSyncPublishPlan("personal", "team", [{
			kind: "reference",
			id: "upstream",
			repository: "https://github.com/example/skills.git",
			ref: "a".repeat(40),
			skillPath: "skills/upstream",
		}]);
		expect(plan.bundledSkills).toEqual([]);
		applySyncPublishPlan(workspace, plan);
		expect(existsSync(join(workspace, "skills", "upstream"))).toBe(false);
		expect(parseSyncManifest(readFileSync(join(workspace, "skiller-sync.yaml"), "utf8")).skills).toEqual([{
			id: "upstream",
			kind: "reference",
			repository: "https://github.com/example/skills.git",
			ref: "a".repeat(40),
			skill_path: "skills/upstream",
		}]);
	});

	it("records a pinned skills.sh dependency without copying its skill files", () => {
		const workspace = mkdtempSync(join(tmpdir(), "skiller-sync-workspace-"));
		tempDirs.push(workspace);
		const plan = createSyncPublishPlan("personal", "private", [{
			kind: "skills_sh",
			id: "frontend-design",
			sourceUrl: "https://github.com/vercel-labs/agent-skills",
			ref: "a".repeat(40),
			skillPath: "skills/frontend-design",
			installationAgentSlugs: ["codex"],
		}]);
		expect(plan.bundledSkills).toEqual([]);
		applySyncPublishPlan(workspace, plan);
		expect(existsSync(join(workspace, "skills", "frontend-design"))).toBe(false);
		expect(parseSyncManifest(readFileSync(join(workspace, "skiller-sync.yaml"), "utf8")).skills).toEqual([{
			id: "frontend-design",
			kind: "skills_sh",
			source_url: "https://github.com/vercel-labs/agent-skills",
			ref: "a".repeat(40),
			skill_path: "skills/frontend-design",
			installations: ["codex"],
		}]);
	});

	it("preserves a reviewed external content hash for future conflict detection", () => {
		const plan = createSyncPublishPlan("personal", "private", [{
			kind: "reference",
			id: "upstream",
			repository: "https://github.com/example/skills.git",
			ref: "a".repeat(40),
			skillPath: "skills/upstream",
			contentHash: "b".repeat(64),
		}]);
		expect(plan.manifest.skills).toContainEqual(expect.objectContaining({
			id: "upstream",
			kind: "reference",
			sha256: "b".repeat(64),
		}));
	});

	it("requires a clean reviewed plan before writing a bundled skill and manifest", () => {
		const root = makeSkill({ "SKILL.md": "# Writing\n", "references/style.md": "Short sentences.\n" });
		const workspace = mkdtempSync(join(tmpdir(), "skiller-sync-workspace-"));
		tempDirs.push(workspace);
		const plan = createSyncPublishPlan("personal", "private", [{ id: "writing", sourcePath: root }]);
		const portableFiles = { "skiller-sync.yaml": stringifySyncManifest(plan.manifest) };
		const update = createSyncPublishWorkspacePlan(workspace, plan, portableFiles);
		expect(update.planId).toBe(createSyncPublishWorkspacePlan(workspace, plan, portableFiles).planId);
		expect(update.operations.map((operation) => operation.path)).toEqual(["skiller-sync.yaml", "skills/writing"]);
		expect(existsSync(join(workspace, "skiller-sync.yaml"))).toBe(false);
		applySyncPublishPlan(workspace, plan);
		expect(readFileSync(join(workspace, "skills/writing/SKILL.md"), "utf8")).toBe("# Writing\n");
		expect(parseSyncManifest(readFileSync(join(workspace, "skiller-sync.yaml"), "utf8"))).toMatchObject({
			profile: { id: "personal", mode: "private" },
			skills: [{ id: "writing", path: "skills/writing" }],
		});
	});

	it("stores portable agent routing without storing local agent paths", () => {
		const root = makeSkill({ "SKILL.md": "# Writing\n" });
		const plan = createSyncPublishPlan("personal", "private", [{
			id: "writing",
			sourcePath: root,
			installationAgentSlugs: ["codex", "claude-code", "codex"],
		}]);
		expect(plan.manifest.skills).toContainEqual(expect.objectContaining({
			id: "writing",
			installations: ["claude-code", "codex"],
		}));
		expect(stringifySyncManifest(plan.manifest)).not.toContain(root);
	});

	it("keeps unrelated remote skills when publishing one reviewed local change", () => {
		const first = makeSkill({ "SKILL.md": "# First\n" });
		const second = makeSkill({ "SKILL.md": "# Second\n" });
		const changed = makeSkill({ "SKILL.md": "# First, local revision\n" });
		const base = createSyncPublishPlan("personal", "private", [
			{ id: "first", sourcePath: first },
			{ id: "second", sourcePath: second },
		]);
		const update = createSyncPublishPlan("personal", "private", [{ id: "first", sourcePath: changed }]);
		const merged = mergeBundledUpdateIntoManifest(base.manifest, update);
		expect(merged.manifest.skills.map((skill) => skill.id)).toEqual(["first", "second"]);
		expect(merged.manifest.skills.find((skill) => skill.id === "second")).toEqual(base.manifest.skills[1]);
	});

	it("requires an explicit adoption decision before replacing a dependency with an owned local skill", () => {
		const local = makeSkill({ "SKILL.md": "# Local fork\n" });
		const base = createSyncPublishPlan("personal", "private", [{
			kind: "reference",
			id: "review",
			repository: "https://github.com/example/review",
			ref: "a".repeat(40),
			skillPath: "skills/review",
		}]);
		const owned = createSyncPublishPlan("personal", "private", [{ id: "review", sourcePath: local }]);
		expect(() => mergeBundledUpdateIntoManifest(base.manifest, owned)).toThrow("not a known bundled skill");
		const adopted = mergeBundledUpdateIntoManifest(base.manifest, owned, { allowSourceConversion: true });
		expect(adopted.manifest.skills).toMatchObject([{ id: "review", kind: "bundled" }]);
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
	it("keeps the dotagent adapter compatible with the legacy restore preview", () => {
		const source = makeSkill({ "SKILL.md": "# Writing\n" });
		const workspace = mkdtempSync(join(tmpdir(), "skiller-sync-workspace-"));
		const canonical = mkdtempSync(join(tmpdir(), "skiller-sync-canonical-"));
		tempDirs.push(workspace, canonical);
		applySyncPublishPlan(workspace, createSyncPublishPlan("personal", "private", [{ id: "writing", sourcePath: source }]));

		const comparable = (entries: ReturnType<typeof createLegacySyncRestorePlan>["entries"]) => entries.map((entry) => ({
			id: entry.id,
			sourcePath: entry.sourcePath,
			targetPath: entry.targetPath,
			action: entry.action,
			remoteSha256: entry.remoteSha256,
			localSha256: entry.localSha256,
		}));
		const compareCurrent = () => {
			const current = createSyncRestorePlan(workspace, canonical);
			expect(current.engine).toBe("dotagent");
			expect(comparable(current.entries)).toEqual(comparable(createLegacySyncRestorePlan(workspace, canonical).entries));
			return current;
		};

		const first = compareCurrent();
		const repeated = createSyncRestorePlan(workspace, canonical);
		expect(first.engine).toBe("dotagent");
		expect(repeated.engine).toBe("dotagent");
		if (first.engine !== "dotagent" || repeated.engine !== "dotagent") throw new Error("dotagent reconciliation is required");
		expect(first.corePlan.planId).toBe(repeated.corePlan.planId);
		expect(syncRestorePlanId(first)).toBe(first.corePlan.planId);
		mkdirSync(join(canonical, "writing"));
		writeFileSync(join(canonical, "writing", "SKILL.md"), "# Local\n");
		compareCurrent();
		writeFileSync(join(canonical, "writing", "SKILL.md"), "# Writing\n");
		compareCurrent();
	});

	it("supports a temporary legacy kill switch while parity is monitored", () => {
		const source = makeSkill({ "SKILL.md": "# Writing\n" });
		const workspace = mkdtempSync(join(tmpdir(), "skiller-sync-workspace-"));
		const canonical = mkdtempSync(join(tmpdir(), "skiller-sync-canonical-"));
		tempDirs.push(workspace, canonical);
		applySyncPublishPlan(workspace, createSyncPublishPlan("personal", "private", [{ id: "writing", sourcePath: source }]));
		const previous = process.env.SKILLER_SYNC_RECONCILE_ENGINE;
		try {
			process.env.SKILLER_SYNC_RECONCILE_ENGINE = "legacy";
			const legacy = createSyncRestorePlan(workspace, canonical);
			expect(legacy).toMatchObject({
				engine: "legacy",
				entries: [{ id: "writing", action: "create", threeWayAction: "take-remote" }],
			});
			expect(syncRestorePlanId(legacy)).toBe(syncRestorePlanId(createSyncRestorePlan(workspace, canonical)));
			expect(syncRestorePlanId(legacy)).toMatch(/^[a-f0-9]{64}$/);
		} finally {
			if (previous === undefined) delete process.env.SKILLER_SYNC_RECONCILE_ENGINE;
			else process.env.SKILLER_SYNC_RECONCILE_ENGINE = previous;
		}
	});

	it("maps ledger state into the shared three-way plan", () => {
		const source = makeSkill({ "SKILL.md": "# Base\n" });
		const workspace = mkdtempSync(join(tmpdir(), "skiller-sync-workspace-"));
		const canonical = mkdtempSync(join(tmpdir(), "skiller-sync-canonical-"));
		tempDirs.push(workspace, canonical);
		applySyncPublishPlan(workspace, createSyncPublishPlan("personal", "private", [{ id: "writing", sourcePath: source }]));
		mkdirSync(join(canonical, "writing"));
		writeFileSync(join(canonical, "writing", "SKILL.md"), "# Base\n");
		const basePlan = createSyncRestorePlan(workspace, canonical);
		const base = basePlan.entries[0].remoteSha256;
		writeFileSync(join(canonical, "writing", "SKILL.md"), "# Local\n");
		writeFileSync(join(source, "SKILL.md"), "# Remote\n");
		applySyncPublishPlan(workspace, createSyncPublishPlan("personal", "private", [{ id: "writing", sourcePath: source }]));
		const plan = createSyncRestorePlan(workspace, canonical, makeSyncLedger("personal", [{ id: "writing", sha256: base }]));
		expect(plan.entries).toMatchObject([{ id: "writing", threeWayAction: "conflict" }]);
	});

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
		applySyncRestorePlan(createSyncRestorePlan(workspace, canonical), ["writing"]);
		expect(readFileSync(join(canonical, "writing", "SKILL.md"), "utf8")).toBe("# Remote\n");

		writeFileSync(join(canonical, "writing", "SKILL.md"), "# Local\n");
		const conflictPlan = createSyncRestorePlan(workspace, canonical);
		writeFileSync(join(canonical, "writing", "SKILL.md"), "# Changed after preview\n");
		expect(() => applySyncRestorePlan(conflictPlan, ["writing"])).toThrow("changed after review");
		expect(readFileSync(join(canonical, "writing", "SKILL.md"), "utf8")).toBe("# Changed after preview\n");
	});
});
