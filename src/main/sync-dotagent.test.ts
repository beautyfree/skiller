import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parsePortableConfig } from "@beautyfree/dotagent/config";
import { scanOwnedSkill } from "@beautyfree/dotagent/inventory";
import { createSyncPublishPlan, applySyncPublishFiles } from "./sync-publish";
import { canonicalSyncAgentRouting, isCanonicalSyncLibrary, planCanonicalSyncLibrary, readLocalSyncAgentSelection, readSyncManifestFromWorkspace, writeLocalSyncAgentSelection } from "./sync-dotagent";
import { cloneSyncWorkspace, commitSyncWorkspace, getSyncWorkspaceStatus, initializeSyncWorkspace, pushSyncWorkspace } from "./sync-workspace";
import { createSyncRestorePlan } from "./sync-restore";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("canonical dotagent Sync Center library", () => {
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
	// A second reviewed write must replace portable root files on Windows too,
	// where rename-over-existing is not atomic or consistently permitted.
	applySyncPublishFiles(workspace, publish, canonical.portableFiles);

    const remoteUrl = pathToFileURL(remote).href;
    await initializeSyncWorkspace(workspace, remoteUrl);
    expect(await commitSyncWorkspace(workspace, "Create canonical library")).toMatch(/^[a-f0-9]{40}$/);
    await pushSyncWorkspace(workspace);
    await cloneSyncWorkspace(remoteUrl, clone);
    expect(readSyncManifestFromWorkspace(clone)).toMatchObject({
      profile: { id: "agent-library", mode: "private" },
      skills: [{ id: "writing", kind: "bundled", path: "skills/writing" }],
    });
    const restore = createSyncRestorePlan(clone, restored);
    expect(restore.entries).toMatchObject([{ id: "writing", action: "create" }]);
  }, 20_000);

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
      id: "pinned-review",
      kind: "reference",
      ref: commit,
      skill_path: "skills/review",
      sha256: "a".repeat(64),
    }]);
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
    expect(parsePortableConfig(readFileSync(join(workspace, "dotagent.yaml"), "utf8")).skills.review).toEqual({
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
    expect(readFileSync(join(workspace, ".gitignore"), "utf8")).toContain("dotagent.local.yaml");
    expect(await getSyncWorkspaceStatus(workspace)).toMatchObject({ changed: false });
  });
});
