import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSyncInventoryFromRoots } from "./sync-inventory";

const cleanup: string[] = [];
afterEach(() => cleanup.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

function root(): string {
	const path = mkdtempSync(join(tmpdir(), "skiller-inventory-"));
	cleanup.push(path);
	return path;
}

function skill(rootPath: string, directory: string, content: string): void {
	const path = join(rootPath, directory);
	mkdirSync(path, { recursive: true });
	writeFileSync(join(path, "SKILL.md"), content);
}

describe("sync inventory", () => {
	it("groups byte-identical skills across agent roots but surfaces divergent same-name skills", () => {
		const codex = root();
		const claude = root();
		const matching = "---\nname: Writing guide\ndescription: Write well\n---\n# Guide\n";
		skill(codex, "writing", matching);
		skill(claude, "writing-copy", matching);
		skill(claude, "writing-local", "---\nname: Writing guide\ndescription: Different\n---\n# Local\n");

		const inventory = scanSyncInventoryFromRoots([
			{ agentSlug: "codex", path: codex, kind: "agent-local" },
			{ agentSlug: "claude-code", path: claude, kind: "agent-local" },
		]);

		expect(inventory.items).toHaveLength(2);
		expect(inventory.items.find((item) => item.locations.length === 2)?.locations)
			.toEqual(expect.arrayContaining([
				{ agentSlug: "codex", kind: "agent-local" },
				{ agentSlug: "claude-code", kind: "agent-local" },
			]));
		expect(inventory.collisions).toEqual([{ displayName: "Writing guide", candidateKeys: expect.any(Array) }]);
		expect(inventory.items.find((item) => item.description === "Write well")?.whenToUse).toBeNull();
	});

	it("keeps a skill summary for review before it is selected", () => {
		const codex = root();
		skill(codex, "adapt", "---\nname: Adapt\ndescription: Adapt an existing interface to a new context.\nwhen_to_use: Use when adapting a feature to another platform.\n---\n# Adapt\n");
		const inventory = scanSyncInventoryFromRoots([{ agentSlug: "codex", path: codex, kind: "agent-local" }]);
		expect(inventory.items[0]).toMatchObject({
			displayName: "Adapt",
			description: "Adapt an existing interface to a new context.",
			whenToUse: "Use when adapting a feature to another platform.",
		});
	});

	it("keeps a unique skill key stable when its content changes", () => {
		const codex = root();
		skill(codex, "writing", "---\nname: Writing guide\ndescription: First\n---\n# Guide\n");
		const first = scanSyncInventoryFromRoots([{ agentSlug: "codex", path: codex, kind: "agent-local" }]);
		skill(codex, "writing", "---\nname: Writing guide\ndescription: Updated\n---\n# Guide\n");
		const second = scanSyncInventoryFromRoots([{ agentSlug: "codex", path: codex, kind: "agent-local" }]);
		expect(first.items[0]?.candidateKey).toBe("writing-guide");
		expect(second.items[0]?.candidateKey).toBe("writing-guide");
		expect(first.items[0]?.contentHash).not.toBe(second.items[0]?.contentHash);
	});

	it("models the shared library once without assigning it to each reader", () => {
		const shared = root();
		const codex = root();
		skill(shared, "writing", "---\nname: Writing guide\ndescription: Shared\n---\n# Guide\n");

		const inventory = scanSyncInventoryFromRoots([
			{ path: shared, kind: "shared" },
			// A configured reader must not add an inherited copy of the same path.
			{ agentSlug: "codex", path: codex, kind: "agent-local" },
		]);

		expect(inventory.items).toHaveLength(1);
		expect(inventory.items[0]?.locations).toEqual([{ kind: "shared" }]);
	});

	it("treats an in-library SKILL.md symlink as an already-covered alias", () => {
		const shared = root();
		skill(shared, "gstack/canonical", "---\nname: Canonical skill\ndescription: Shared source\n---\n# Skill\n");
		mkdirSync(join(shared, "shortcut"), { recursive: true });
		symlinkSync(join(shared, "gstack/canonical/SKILL.md"), join(shared, "shortcut/SKILL.md"));

		const inventory = scanSyncInventoryFromRoots([{ path: shared, kind: "shared" }]);
		expect(inventory.items).toHaveLength(1);
		expect(inventory.invalidPaths).toBe(0);
		expect(inventory.invalidEntries).toEqual([]);
		expect(inventory.linkedAliases).toBe(1);
	});

	it("names a skill when a linked resource prevents a safe export", () => {
		const shared = root();
		skill(shared, "unsafe", "---\nname: Unsafe skill\ndescription: Has linked resource\n---\n# Skill\n");
		symlinkSync(join(shared, "outside"), join(shared, "unsafe/linked-resource"));

		const inventory = scanSyncInventoryFromRoots([{ path: shared, kind: "shared" }]);
		expect(inventory.items).toHaveLength(0);
		expect(inventory.invalidPaths).toBe(1);
		expect(inventory.invalidEntries).toEqual([{ displayName: "unsafe", reason: "Contains a linked file, so Skiller will not follow it outside this skill." }]);
	});
});
