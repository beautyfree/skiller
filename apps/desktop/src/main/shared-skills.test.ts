import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { migrateLegacySharedSkillHistory } from "./shared-skills";

const homes: string[] = [];

afterEach(() => {
	for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function home(): string {
	const directory = mkdtempSync(join(tmpdir(), "skiller-shared-history-"));
	homes.push(directory);
	return directory;
}

function writeLegacyRecord(homePath: string, id: string, content: string): string {
	const file = join(homePath, ".agents", "skills", ".dotagents", "history", id, "payload", "writing", "SKILL.md");
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content);
	return file;
}

describe("shared skill history migration", () => {
	test("moves the rollback payload to the user-level dotagents directory and is idempotent", () => {
		const homePath = home();
		const oldFile = writeLegacyRecord(homePath, "update-1", "# Previous skill\n");

		expect(migrateLegacySharedSkillHistory(homePath)).toBe("moved");
		expect(existsSync(oldFile)).toBe(false);
		expect(readFileSync(join(homePath, ".dotagents", "history", "update-1", "payload", "writing", "SKILL.md"), "utf8"))
			.toBe("# Previous skill\n");
		expect(migrateLegacySharedSkillHistory(homePath)).toBe("none");
	});

	test("leaves legacy history in place while an update recovery journal exists", () => {
		const homePath = home();
		const oldFile = writeLegacyRecord(homePath, "update-1", "# Previous skill\n");
		writeFileSync(join(homePath, ".agents", "skills", ".dotagents", "library-update-journal.json"), "{}\n");

		expect(migrateLegacySharedSkillHistory(homePath)).toBe("pending-recovery");
		expect(readFileSync(oldFile, "utf8")).toBe("# Previous skill\n");
		expect(existsSync(join(homePath, ".dotagents", "history"))).toBe(false);
	});

	test("preserves both histories when destination record IDs conflict", () => {
		const homePath = home();
		const oldFile = writeLegacyRecord(homePath, "update-1", "# Old previous skill\n");
		const newFile = join(homePath, ".dotagents", "history", "update-1", "payload", "writing", "SKILL.md");
		mkdirSync(dirname(newFile), { recursive: true });
		writeFileSync(newFile, "# Existing previous skill\n");

		expect(() => migrateLegacySharedSkillHistory(homePath)).toThrow("records already exist");
		expect(readFileSync(oldFile, "utf8")).toBe("# Old previous skill\n");
		expect(readFileSync(newFile, "utf8")).toBe("# Existing previous skill\n");
	});
});
