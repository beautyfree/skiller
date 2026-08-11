import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSyncPublishPlan, mergeBundledUpdateIntoManifest } from "./sync-publish";

describe("canonical library publish adapter", () => {
  it("uses dotagents planning while exposing only renderer-facing library data", () => {
    const root = mkdtempSync(join(tmpdir(), "skiller-canonical-publish-"));
    try {
      const writing = join(root, "writing");
      mkdirSync(writing);
      writeFileSync(join(writing, "SKILL.md"), "# Writing\n");
      const plan = createSyncPublishPlan("agent-library", "private", [
        { id: "writing", sourcePath: writing, installationAgentSlugs: ["codex"] },
        { kind: "reference", id: "review", repository: "https://github.com/example/review.git", ref: "a".repeat(40), skillPath: "." },
      ]);
      expect(plan.kind).toBe("dotagents-library-publish");
      expect(plan.manifest.skills).toMatchObject([
        { id: "writing", kind: "bundled", path: "skills/writing", installations: ["codex"] },
        { id: "review", kind: "reference", repository: "https://github.com/example/review.git" },
      ]);
      expect(plan.bundledSkills).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps untouched canonical entries during a reviewed local update", () => {
    const root = mkdtempSync(join(tmpdir(), "skiller-canonical-merge-"));
    try {
      const local = join(root, "local");
      mkdirSync(local);
      writeFileSync(join(local, "SKILL.md"), "# Local\n");
      const base = createSyncPublishPlan("agent-library", "private", [
        { id: "local", sourcePath: local },
        { kind: "reference", id: "remote", repository: "https://github.com/example/remote.git", ref: "b".repeat(40), skillPath: "." },
      ]);
      const updated = createSyncPublishPlan("agent-library", "private", [{ id: "local", sourcePath: local }]);
      expect(mergeBundledUpdateIntoManifest(base.manifest, updated).manifest.skills.map((skill) => skill.id)).toEqual(["local", "remote"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes fork lineage to dotagents without treating the fork as a dependency", () => {
    const root = mkdtempSync(join(tmpdir(), "skiller-canonical-fork-"));
    try {
      const local = join(root, "writing");
      mkdirSync(local);
      writeFileSync(join(local, "SKILL.md"), "# Writing\n");
      const plan = createSyncPublishPlan("agent-library", "private", [{
        id: "writing",
        sourcePath: local,
        forkedFrom: { url: "https://github.com/example/writing.git", ref: "a".repeat(40), skill_path: "skills/writing" },
      }]);
      expect(plan.forkedFrom).toEqual({
        writing: { url: "https://github.com/example/writing.git", ref: "a".repeat(40), skill_path: "skills/writing" },
      });
      expect(plan.manifest.skills).toMatchObject([{ id: "writing", kind: "bundled" }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
