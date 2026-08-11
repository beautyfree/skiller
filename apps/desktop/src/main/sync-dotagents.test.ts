import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parsePortableConfig } from "dotagents/config";
import { applyInitializeLibraryPlan, planInitializeLibrary } from "dotagents/init";
import { scanOwnedSkill } from "dotagents/inventory";
import { exactSourceSecurityPolicy } from "dotagents/source-policy";
import { readPortableScopeDescriptor } from "dotagents/scope";
import { createSyncPublishPlan, applySyncPublishFiles } from "./sync-publish";
import { canonicalSyncAgentRouting, isCanonicalSyncLibrary, planCanonicalSyncLibrary, readCanonicalSyncLock, readLocalSyncAgentSelection, readLocalSyncSourceSecurityPolicy, readSyncManifestFromWorkspace, writeLocalSyncAgentSelection } from "./sync-dotagents";
import { applyReviewedSyncWorkspaceLocalPublish, assertSyncRemoteEmpty, cloneSyncWorkspace, commitSyncWorkspace, getSyncWorkspaceStatus, initializeSyncWorkspace, planSyncWorkspaceLocalPublish, pushSyncWorkspace } from "./sync-workspace";
import { createSyncRestorePlan } from "./sync-restore";
import { scanSyncInventoryWithDotagents } from "./sync-inventory";
import { defaultAgentConfig } from "./types";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("canonical dotagents Sync Center library", () => {
  it("connects a generic empty library created by dotagents init without requiring Skiller metadata or an empty lockfile", async () => {
    const root = mkdtempSync(join(tmpdir(), "skiller-generic-dotagents-"));
    roots.push(root);
    const source = join(root, "source");
    const remote = join(root, "library.git");
    const clone = join(root, "clone");
    await applyInitializeLibraryPlan(planInitializeLibrary(source, "portable-toolkit"));
    execFileSync("git", ["init", "--initial-branch", "main"], { cwd: source });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: source });
    execFileSync("git", ["config", "user.name", "test"], { cwd: source });
    execFileSync("git", ["add", "."], { cwd: source });
    execFileSync("git", ["commit", "-m", "initialize generic library"], { cwd: source });
    execFileSync("git", ["init", "--bare", "--initial-branch", "main", remote]);
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: source });
    execFileSync("git", ["push", "-u", "origin", "main"], { cwd: source });

    const remoteUrl = pathToFileURL(remote).href;
    await cloneSyncWorkspace(remoteUrl, clone, exactSourceSecurityPolicy([remoteUrl]));
    expect(readCanonicalSyncLock(clone)).toBeNull();
    expect(readSyncManifestFromWorkspace(clone)).toMatchObject({
      profile: { id: "portable-toolkit", mode: "private" },
      agent_policy: { mode: "detected" },
      skills: [],
    });
    writeLocalSyncAgentSelection(clone, ["codex"]);
    expect(readLocalSyncAgentSelection(clone)).toEqual(["codex"]);
  }, 20_000);

  it("publishes, clones, and restores without creating a legacy Skiller manifest", async () => {
    const root = mkdtempSync(join(tmpdir(), "skiller-canonical-sync-"));
    roots.push(root);
    const source = join(root, "source");
    const workspace = join(root, "publisher");
    const remote = join(root, "library.git");
    const clone = join(root, "clone");
    const restored = join(root, "restored-skills");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "SKILL.md"), "---\nname: writing\ndescription: Writes clearly.\n---\n# Writing\n");
    execFileSync("git", ["init", "--bare", "--initial-branch", "main", remote]);

    const publish = createSyncPublishPlan("agent-library", "private", [{ id: "writing", sourcePath: source }]);
    const canonical = await planCanonicalSyncLibrary(workspace, publish);
    applySyncPublishFiles(workspace, publish, canonical.portableFiles);
    expect(isCanonicalSyncLibrary(workspace)).toBe(true);
    expect(existsSync(join(workspace, "skiller-sync.yaml"))).toBe(false);
    expect(JSON.parse(readFileSync(join(workspace, "skills.json"), "utf8"))).toMatchObject({
      name: "agent-library",
      skills: ["skills/writing"],
      dependencies: {},
    });
	expect(readPortableScopeDescriptor(workspace)).toEqual({ schema_version: 1, scope: "personal" });
	const generatedReadme = readFileSync(join(workspace, "README.md"), "utf8");
	expect(generatedReadme).toContain("dotagents setup");
	expect(generatedReadme).toContain("`writing`");
	expect(generatedReadme).not.toContain("Skiller");
	// A second reviewed write must replace portable root files on Windows too,
	// where rename-over-existing is not atomic or consistently permitted.
	applySyncPublishFiles(workspace, publish, canonical.portableFiles);

    const remoteUrl = pathToFileURL(remote).href;
    const librarySourcePolicy = exactSourceSecurityPolicy([remoteUrl]);
    await initializeSyncWorkspace(workspace, remoteUrl, librarySourcePolicy);
    expect(readLocalSyncSourceSecurityPolicy(workspace)).toEqual(librarySourcePolicy);
    expect(await commitSyncWorkspace(workspace, "Create canonical library")).toMatch(/^[a-f0-9]{40}$/);
    await pushSyncWorkspace(workspace);
    await cloneSyncWorkspace(remoteUrl, clone, exactSourceSecurityPolicy([remoteUrl]));
    expect(readSyncManifestFromWorkspace(clone)).toMatchObject({
      profile: { id: "agent-library", mode: "private" },
      skills: [{ id: "writing", kind: "bundled", path: "skills/writing" }],
    });
    const restore = createSyncRestorePlan(clone, restored);
    expect(restore.entries).toMatchObject([{ id: "writing", action: "create" }]);
  }, 20_000);

  it("carries a direct global agent skill through the canonical library without treating a skills-only folder as an install target", async () => {
    const root = mkdtempSync(join(tmpdir(), "skiller-direct-global-routing-"));
    roots.push(root);
    const shared = join(root, ".agents", "skills");
    const directRoot = join(root, ".claude", "skills");
    const workspace = join(root, "library");
    const directSkill = join(directRoot, "direct-writing");
    mkdirSync(directSkill, { recursive: true });
    writeFileSync(join(directSkill, "SKILL.md"), "---\nname: direct-writing\ndescription: Installed directly.\n---\n# Direct\n");

    const inventory = await scanSyncInventoryWithDotagents([
      defaultAgentConfig({
        slug: "claude-code",
        name: "Claude Code",
        detected: false,
        detection_reason: "skills-only",
        global_paths: [directRoot],
      }),
    ], shared);
    const item = inventory.items[0];
    if (!item) throw new Error("Direct skill fixture was not discovered");

    const publish = createSyncPublishPlan("personal", "private", [{
      id: item.candidateKey,
      sourcePath: item.sourcePath,
      installationAgentSlugs: item.locations.flatMap((location) => location.agentSlug ? [location.agentSlug] : []),
    }]);
    const canonical = await planCanonicalSyncLibrary(workspace, publish);
    applySyncPublishFiles(workspace, publish, canonical.portableFiles);

    expect(readSyncManifestFromWorkspace(workspace).skills).toEqual([
      expect.objectContaining({ id: "direct-writing", installations: ["claude-code"] }),
    ]);
    // A second computer can materialize this only after it actually detects
    // Claude Code. Merely discovering ~/.claude/skills never grants a write target.
    expect(canonicalSyncAgentRouting(workspace, ["claude-code"])?.forSkill("direct-writing")).toEqual(["claude-code"]);
    expect(canonicalSyncAgentRouting(workspace, [])?.forSkill("direct-writing")).toEqual([]);
  });

  it("maps a new team library to project scope and preserves a custom README", async () => {
    const root = mkdtempSync(join(tmpdir(), "skiller-canonical-team-scope-"));
    roots.push(root);
    const source = join(root, "source");
    const workspace = join(root, "library");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "SKILL.md"), "---\nname: team-review\ndescription: Reviews team work.\n---\n# Team review\n");

    const publish = createSyncPublishPlan("team-library", "team", [{ id: "team-review", sourcePath: source }]);
    const initial = await planCanonicalSyncLibrary(workspace, publish);
    applySyncPublishFiles(workspace, publish, initial.portableFiles);
    expect(readPortableScopeDescriptor(workspace)).toEqual({ schema_version: 1, scope: "project" });

    writeFileSync(join(workspace, "README.md"), "# Our team toolkit\n\nTeam-owned guidance.\n");
    const update = await planCanonicalSyncLibrary(workspace, publish);
    applySyncPublishFiles(workspace, publish, update.portableFiles);

    expect(readFileSync(join(workspace, "README.md"), "utf8")).toBe("# Our team toolkit\n\nTeam-owned guidance.\n");
    expect(readPortableScopeDescriptor(workspace)).toEqual({ schema_version: 1, scope: "project" });
  });

  it("records an external skill as an immutable dependency instead of copying it", async () => {
    const root = mkdtempSync(join(tmpdir(), "skiller-canonical-dependency-"));
    roots.push(root);
    const upstream = join(root, "upstream");
    const workspace = join(root, "library");
    mkdirSync(join(upstream, "skills", "review"), { recursive: true });
    writeFileSync(join(upstream, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Reviews work.\n---\n# Review\n");
    execFileSync("git", ["init", "--initial-branch", "main"], { cwd: upstream });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: upstream });
    execFileSync("git", ["config", "user.name", "test"], { cwd: upstream });
    execFileSync("git", ["add", "."], { cwd: upstream });
    execFileSync("git", ["commit", "-m", "review skill"], { cwd: upstream });
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: upstream, encoding: "utf8" }).trim();
    const sourceUrl = pathToFileURL(upstream).href;
    const publish = createSyncPublishPlan("agent-library", "private", [{
      kind: "reference",
      id: "pinned-review",
      repository: sourceUrl,
      ref: commit,
      skillPath: "skills/review",
      contentHash: "a".repeat(64),
    }]);
    const canonical = await planCanonicalSyncLibrary(workspace, publish);
    const exactPolicy = exactSourceSecurityPolicy([sourceUrl]);
    expect(canonical.sourcePolicy).toEqual(exactPolicy);
    const alternatePolicy = exactSourceSecurityPolicy([sourceUrl], { minimum_release_age_exclude: [sourceUrl] });
    const alternate = await planCanonicalSyncLibrary(workspace, publish, {
      cacheRoot: join(root, "alternate-cache"),
      sourcePolicy: alternatePolicy,
    });
    expect(alternate.sourcePolicy).toEqual(alternatePolicy);
    expect(alternate.resolutionPlanId).not.toBe(canonical.resolutionPlanId);
    applySyncPublishFiles(workspace, publish, canonical.portableFiles);

    expect(existsSync(join(workspace, "skills", "pinned-review"))).toBe(false);
    expect(JSON.parse(readFileSync(join(workspace, "skills.json"), "utf8")).dependencies).toEqual({
      "pinned-review": { url: sourceUrl, ref: commit, select: ["skills/review"] },
    });
    expect(JSON.parse(readFileSync(join(workspace, "skills.lock"), "utf8")).resolved["pinned-review"]).toMatchObject({
      commit,
      skills: [{ name: "review", path: "skills/review" }],
    });
    expect(readSyncManifestFromWorkspace(workspace).skills).toMatchObject([{
      id: "review",
      kind: "reference",
      ref: commit,
      skill_path: "skills/review",
      sha256: "a".repeat(64),
    }]);
    expect(JSON.parse(readFileSync(join(workspace, "skills.json"), "utf8")).metadata.skiller_sync).toMatchObject({
      source_kinds: { review: "reference" },
      content_hashes: { review: "a".repeat(64) },
    });
    expect(parsePortableConfig(readFileSync(join(workspace, "dotagents.yaml"), "utf8")).skills).toHaveProperty("review");
    expect(parsePortableConfig(readFileSync(join(workspace, "dotagents.yaml"), "utf8")).skills).not.toHaveProperty("pinned-review");
  }, 20_000);

  it("uses each resolved skill name when one dependency package exposes multiple skills", () => {
    const workspace = mkdtempSync(join(tmpdir(), "skiller-canonical-multi-skill-"));
    roots.push(workspace);
    writeFileSync(join(workspace, "skills.json"), `${JSON.stringify({
      schema_version: 1,
      name: "team-library",
      version: "0.1.0",
      skills: [],
      dependencies: {
        "design-pack": {
          url: "https://github.com/example/design-pack",
          ref: "main",
          select: ["skills/review", "skills/critique"],
        },
      },
      metadata: {
        skiller_sync: {
          schema_version: 1,
          profile: { id: "team-library", mode: "team" },
          agent_policy: { mode: "detected" },
          source_kinds: { review: "reference", critique: "reference" },
          content_hashes: { review: "a".repeat(64), critique: "b".repeat(64) },
          installations: {},
        },
      },
    }, null, 2)}\n`);
    writeFileSync(join(workspace, "skills.lock"), `${JSON.stringify({
      lockfile_version: 1,
      generated_by: "dotagents test",
      resolved: {
        "design-pack": {
          url: "https://github.com/example/design-pack",
          requested_ref: "main",
          commit: "c".repeat(40),
          integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
          skills: [
            { name: "review", path: "skills/review" },
            { name: "critique", path: "skills/critique" },
          ],
        },
      },
    }, null, 2)}\n`);

    expect(readSyncManifestFromWorkspace(workspace).skills).toEqual([
      expect.objectContaining({ id: "review", skill_path: "skills/review", sha256: "a".repeat(64) }),
      expect.objectContaining({ id: "critique", skill_path: "skills/critique", sha256: "b".repeat(64) }),
    ]);
  });

  it("enforces the reviewed commit cooling-off policy before producing portable files", async () => {
    const root = mkdtempSync(join(tmpdir(), "skiller-canonical-cooling-off-"));
    roots.push(root);
    const upstream = join(root, "upstream");
    const workspace = join(root, "library");
    mkdirSync(join(upstream, "skills", "fresh"), { recursive: true });
    writeFileSync(join(upstream, "skills", "fresh", "SKILL.md"), "---\nname: fresh\ndescription: Fresh source.\n---\n# Fresh\n");
    execFileSync("git", ["init", "--initial-branch", "main"], { cwd: upstream });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: upstream });
    execFileSync("git", ["config", "user.name", "test"], { cwd: upstream });
    execFileSync("git", ["add", "."], { cwd: upstream });
    execFileSync("git", ["commit", "-m", "fresh skill"], { cwd: upstream });
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: upstream, encoding: "utf8" }).trim();
    const sourceUrl = pathToFileURL(upstream).href;
    const publish = createSyncPublishPlan("agent-library", "private", [{
      kind: "reference",
      id: "fresh",
      repository: sourceUrl,
      ref: commit,
      skillPath: "skills/fresh",
      contentHash: "b".repeat(64),
    }]);

    await expect(planCanonicalSyncLibrary(workspace, publish, {
      cacheRoot: join(root, "cache"),
      sourcePolicy: exactSourceSecurityPolicy([sourceUrl], { minimum_release_age_minutes: 7 * 24 * 60 }),
    })).rejects.toThrow("reviewed minimum is 10080 minutes");
    expect(existsSync(join(workspace, "skills.json"))).toBe(false);
  }, 20_000);

  it("vendors an external skill only with immutable origin and license metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "skiller-canonical-vendored-"));
    roots.push(root);
    const source = join(root, "review");
    const workspace = join(root, "library");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "SKILL.md"), "---\nname: review\ndescription: Reviews work.\n---\n# Review\n");
    const scanned = await scanOwnedSkill(root, "review");
    if (!scanned.ok) throw new Error("Vendored fixture did not scan");
    const publish = createSyncPublishPlan("agent-library", "public", [{
      kind: "vendored",
      id: "review",
      sourcePath: source,
      origin: {
        url: "https://github.com/example/review-skills",
        commit: "a".repeat(40),
        skill_path: "skills/review",
        integrity: scanned.value.integrity,
        license: "MIT",
      },
    }]);
    const canonical = await planCanonicalSyncLibrary(workspace, publish, { license: "MIT" });
    applySyncPublishFiles(workspace, publish, canonical.portableFiles);

    expect(existsSync(join(workspace, "skills", "review", "SKILL.md"))).toBe(true);
    expect(JSON.parse(readFileSync(join(workspace, "skills.json"), "utf8"))).toMatchObject({
      skills: ["skills/review"],
      dependencies: {},
    });
    expect(parsePortableConfig(readFileSync(join(workspace, "dotagents.yaml"), "utf8")).skills.review).toEqual({
      distribution: "vendored",
      origin: {
        url: "https://github.com/example/review-skills",
        commit: "a".repeat(40),
        skill_path: "skills/review",
        integrity: scanned.value.integrity,
        license: "MIT",
      },
    });
  });

  it("keeps fork lineage in the portable dotagents config", async () => {
    const root = mkdtempSync(join(tmpdir(), "skiller-canonical-fork-lineage-"));
    roots.push(root);
    const source = join(root, "writing");
    const workspace = join(root, "library");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "SKILL.md"), "# Writing\n");
    const publish = createSyncPublishPlan("agent-library", "private", [{
      id: "writing",
      sourcePath: source,
      forkedFrom: { url: "https://github.com/example/writing.git", ref: "a".repeat(40), skill_path: "skills/writing" },
    }]);
    const canonical = await planCanonicalSyncLibrary(workspace, publish);
    applySyncPublishFiles(workspace, publish, canonical.portableFiles);

    expect(parsePortableConfig(readFileSync(join(workspace, "dotagents.yaml"), "utf8")).skills.writing).toEqual({
      forked_from: { url: "https://github.com/example/writing.git", ref: "a".repeat(40), skill_path: "skills/writing" },
    });
  });

  it("stores a private external copy as a portable snapshot with provenance", async () => {
    const root = mkdtempSync(join(tmpdir(), "skiller-canonical-snapshot-"));
    roots.push(root);
    const source = join(root, "review");
    const workspace = join(root, "library");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "SKILL.md"), "---\nname: review\ndescription: Reviews work.\n---\n# Review\n");
    const scanned = await scanOwnedSkill(root, "review");
    if (!scanned.ok) throw new Error("Snapshot fixture did not scan");
    const publish = createSyncPublishPlan("personal-library", "private", [{
      kind: "snapshot",
      id: "review",
      sourcePath: source,
      origin: {
        url: "https://github.com/example/review-skills",
        requested_ref: "main",
        skill_path: "skills/review",
        integrity: scanned.value.integrity,
      },
    }]);
    const canonical = await planCanonicalSyncLibrary(workspace, publish);
    applySyncPublishFiles(workspace, publish, canonical.portableFiles);

    expect(existsSync(join(workspace, "skills", "review", "SKILL.md"))).toBe(true);
    expect(JSON.parse(readFileSync(join(workspace, "skills.json"), "utf8"))).toMatchObject({
      skills: ["skills/review"],
      dependencies: {},
    });
    expect(parsePortableConfig(readFileSync(join(workspace, "dotagents.yaml"), "utf8")).skills.review).toEqual({
      distribution: "snapshot",
      snapshot: {
        url: "https://github.com/example/review-skills",
        requested_ref: "main",
        skill_path: "skills/review",
        integrity: scanned.value.integrity,
      },
    });
    expect(canonical.sourcePolicy.trust.repositories).toEqual([]);
  });

  it("checks an empty custom Git destination through the injected runner", async () => {
    const calls: string[][] = [];
    const runner = {
      async run(args: string[]) {
        calls.push(args);
        return "";
      },
    };
    const remoteUrl = "https://git.example.com/team/agent-library.git";

    await expect(assertSyncRemoteEmpty(remoteUrl, exactSourceSecurityPolicy([remoteUrl]), runner)).resolves.toBeUndefined();
    expect(calls).toEqual([["ls-remote", "--heads", "--tags", remoteUrl]]);
  });

  it("reviews and uploads local canonical-library changes without mixing them into remote restore", async () => {
    const root = mkdtempSync(join(tmpdir(), "skiller-canonical-local-publish-"));
    roots.push(root);
    const source = join(root, "writing");
    const workspace = join(root, "library");
    const remote = join(root, "library.git");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "SKILL.md"), "---\nname: writing\ndescription: Writes clearly.\n---\n# Writing\n");
    execFileSync("git", ["init", "--bare", "--initial-branch", "main", remote]);
    const publish = createSyncPublishPlan("personal", "private", [{ id: "writing", sourcePath: source }]);
    const canonical = await planCanonicalSyncLibrary(workspace, publish);
    applySyncPublishFiles(workspace, publish, canonical.portableFiles);
    const remoteUrl = pathToFileURL(remote).href;
    await expect(assertSyncRemoteEmpty(remoteUrl, exactSourceSecurityPolicy([remoteUrl]))).resolves.toBeUndefined();
    await initializeSyncWorkspace(workspace, remoteUrl, exactSourceSecurityPolicy([remoteUrl]));
    await commitSyncWorkspace(workspace, "Create library");
    await pushSyncWorkspace(workspace);
    await expect(assertSyncRemoteEmpty(remoteUrl, exactSourceSecurityPolicy([remoteUrl]))).rejects.toThrow("Connect library");

    writeFileSync(join(workspace, "README.md"), "# Personal library\n\nUpdated locally.\n");
    const reviewed = await planSyncWorkspaceLocalPublish(workspace);
    expect(reviewed.files.map((file) => file.path)).toEqual(["README.md"]);
    expect(reviewed.hasBlockers).toBe(false);
    expect(await applyReviewedSyncWorkspaceLocalPublish(workspace, reviewed.planId)).toMatchObject({ pushed: true });
    expect(await getSyncWorkspaceStatus(workspace)).toMatchObject({ changed: false, ahead: 0 });

    writeFileSync(join(workspace, "README.md"), "# Personal library\n\nFirst draft.\n");
    const stale = await planSyncWorkspaceLocalPublish(workspace);
    writeFileSync(join(workspace, "README.md"), "# Personal library\n\nChanged after review.\n");
    await expect(applyReviewedSyncWorkspaceLocalPublish(workspace, stale.planId)).rejects.toThrow("changed after review");

    writeFileSync(join(workspace, "README.md"), "TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456\n");
    const blocked = await planSyncWorkspaceLocalPublish(workspace);
    expect(blocked.hasBlockers).toBe(true);
    expect(blocked.secretFindings).toHaveLength(1);
  }, 20_000);

  it("keeps this computer's selected agents in a gitignored local overlay", async () => {
    const root = mkdtempSync(join(tmpdir(), "skiller-canonical-routing-"));
    roots.push(root);
    const source = join(root, "source");
    const workspace = join(root, "library");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "SKILL.md"), "---\nname: writing\ndescription: Writes clearly.\n---\n# Writing\n");
    const publish = createSyncPublishPlan("public-toolkit", "public", [{ id: "writing", sourcePath: source, installationAgentSlugs: ["codex"] }]);
    const canonical = await planCanonicalSyncLibrary(workspace, publish, { license: "MIT" });
    applySyncPublishFiles(workspace, publish, canonical.portableFiles);
    await initializeSyncWorkspace(workspace);
    await commitSyncWorkspace(workspace, "Create library");

    writeLocalSyncAgentSelection(workspace, ["codex", "claude-code", "codex"]);

    expect(readLocalSyncAgentSelection(workspace)).toEqual(["claude-code", "codex"]);
    expect(JSON.parse(readFileSync(join(workspace, "skills.json"), "utf8"))).toMatchObject({ license: "MIT" });
    expect(canonicalSyncAgentRouting(workspace, ["claude-code", "codex", "cursor"])?.forSkill("writing")).toEqual(["codex"]);
    expect(readFileSync(join(workspace, ".gitignore"), "utf8")).toContain("dotagents.local.yaml");
    expect(await getSyncWorkspaceStatus(workspace)).toMatchObject({ changed: false });
  });
});
