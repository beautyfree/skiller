import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBundledConflictComparison, previewBundledConflictFile, previewNewLocalBundleFile } from "./sync-conflict-preview";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("bundled conflict preview", () => {
  it("compares portable file names and bounded SKILL.md bodies without returning machine paths", () => {
    const root = mkdtempSync(join(tmpdir(), "skiller-conflict-preview-"));
    roots.push(root);
    const local = join(root, "local");
    const library = join(root, "library");
    mkdirSync(local);
    mkdirSync(library);
    writeFileSync(join(local, "SKILL.md"), "# Local\n");
    writeFileSync(join(library, "SKILL.md"), "# Library\n");
    writeFileSync(join(local, "local.txt"), "local");
    writeFileSync(join(library, "remote.txt"), "remote");
    writeFileSync(join(local, "same.txt"), "same");
    writeFileSync(join(library, "same.txt"), "same");

    const result = buildBundledConflictComparison({ id: "review", localPath: local, libraryPath: library });

    expect(result).toMatchObject({
      local_state: "directory",
      local_file_count: 3,
      library_file_count: 3,
      changed_files: ["SKILL.md"],
      only_on_computer: ["local.txt"],
      only_in_library: ["remote.txt"],
      unchanged_file_count: 1,
      local_skill_md: "# Local\n",
      library_skill_md: "# Library\n",
    });
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it("does not follow a conflicting local symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "skiller-conflict-link-"));
    roots.push(root);
    const library = join(root, "library");
    const outside = join(root, "outside");
    const local = join(root, "local");
    mkdirSync(library);
    mkdirSync(outside);
    writeFileSync(join(library, "SKILL.md"), "# Library\n");
    writeFileSync(join(outside, "SKILL.md"), "# Outside\n");
    symlinkSync(outside, local);

    const result = buildBundledConflictComparison({ id: "review", localPath: local, libraryPath: library });
    expect(result).toMatchObject({
      local_state: "symlink",
      local_file_count: null,
    });
    expect(result.local_skill_md).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("# Outside");
  });

  it("returns a bounded Git-style diff for a selected changed file", () => {
    const root = mkdtempSync(join(tmpdir(), "skiller-conflict-diff-"));
    roots.push(root);
    const library = join(root, "library");
    const local = join(root, "local");
    mkdirSync(library);
    mkdirSync(local);
    writeFileSync(join(library, "SKILL.md"), "# Review\nOld instruction\n");
    writeFileSync(join(local, "SKILL.md"), "# Review\nNew instruction\n");
    const comparison = buildBundledConflictComparison({ id: "review", localPath: local, libraryPath: library });

    expect(previewBundledConflictFile({ libraryPath: library, localPath: local, file: "SKILL.md", comparison })).toEqual({
      path: "SKILL.md",
      status: "modified",
      diff: "--- Saved library\n+++ This computer\n  … 1 unchanged line\n- Old instruction\n+ New instruction\n  … 1 unchanged line",
    });
    expect(previewNewLocalBundleFile({ localPath: local, file: "SKILL.md", files: ["SKILL.md"] }).diff).toContain("+ # Review");
  });
});
