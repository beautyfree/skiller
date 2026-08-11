import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSyncInventoryWithDotagents } from "./sync-inventory";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("Agent Library inventory adapter", () => {
  it("uses dotagents discovery to deduplicate a shared skill and a real agent link", async () => {
    const root = mkdtempSync(join(tmpdir(), "skiller-inventory-"));
    roots.push(root);
    const shared = join(root, "shared");
    const codex = join(root, "codex");
    const skill = join(shared, "writing");
    mkdirSync(skill, { recursive: true });
    mkdirSync(codex);
    writeFileSync(join(skill, "SKILL.md"), "---\nname: writing\ndescription: Write well\n---\n# Writing\n");
    symlinkSync(skill, join(codex, "writing"), "dir");
    const inventory = await scanSyncInventoryWithDotagents([
      { slug: "codex", global_paths: [codex], additional_readable_paths: [], detected: true } as never,
    ], shared);
    expect(inventory.items).toMatchObject([{ displayName: "writing", locations: [{ kind: "shared" }, { agentSlug: "codex", kind: "agent-local" }] }]);
    expect(inventory.collisions).toEqual([]);
  });
});
