import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
	});
});
