import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoverRestoreJournalAt, writeRestoreJournalAt } from "./sync-journal";

const cleanup: string[] = [];
afterEach(() => cleanup.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe("sync restore journal", () => {
	it("recognizes and cleans up a completed dotagent reconciliation journal", () => {
		const root = mkdtempSync(join(tmpdir(), "skiller-journal-"));
		cleanup.push(root);
		const journalPath = join(root, "journal.json");
		writeFileSync(journalPath, `${JSON.stringify({
			kind: "library-reconcile",
			schemaVersion: 1,
			planId: "reviewed-plan",
			phase: "completed",
			entries: [],
		})}\n`);
		expect(recoverRestoreJournalAt(journalPath)).toBe(true);
		expect(existsSync(journalPath)).toBe(false);
	});

	it("restores the old target after an interrupted apply", () => {
		const root = mkdtempSync(join(tmpdir(), "skiller-journal-"));
		cleanup.push(root);
		const target = join(root, "skills", "writing");
		const backup = join(root, "backup", "writing");
		mkdirSync(target, { recursive: true });
		writeFileSync(join(target, "SKILL.md"), "old");
		mkdirSync(join(backup, ".."), { recursive: true });
		renameSync(target, backup);
		mkdirSync(target, { recursive: true });
		writeFileSync(join(target, "SKILL.md"), "new");
		const journalPath = join(root, "journal.json");
		writeRestoreJournalAt(journalPath, {
			schema_version: 1, profile_id: "personal", staged_root: join(root, "staged"), backup_root: join(root, "backup"), phase: "applying",
			entries: [{ id: "writing", targetPath: target, backupPath: backup, hadPrevious: true, stage: "applied" }],
		});
		expect(recoverRestoreJournalAt(journalPath)).toBe(true);
		expect(readFileSync(join(target, "SKILL.md"), "utf8")).toBe("old");
		expect(existsSync(journalPath)).toBe(false);
	});
});
