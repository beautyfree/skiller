import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyThreeWaySkill, makeSyncLedger, readSyncLedgerAt, writeSyncLedgerAt } from "./sync-ledger";

const cleanup: string[] = [];
afterEach(() => cleanup.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe("sync three-way ledger", () => {
	it("never turns an unknown local difference into an overwrite", () => {
		expect(classifyThreeWaySkill("writing", null, "local", "remote").action).toBe("unmanaged");
		expect(classifyThreeWaySkill("writing", null, null, "remote").action).toBe("take-remote");
		expect(classifyThreeWaySkill("writing", null, "remote", "remote").action).toBe("unchanged");
	});

	it("classifies local, remote, and concurrent changes from the last applied hash", () => {
		expect(classifyThreeWaySkill("a", "base", "base", "remote").action).toBe("take-remote");
		expect(classifyThreeWaySkill("a", "base", "local", "base").action).toBe("publish-local");
		expect(classifyThreeWaySkill("a", "base", "local", "remote").action).toBe("conflict");
		expect(classifyThreeWaySkill("a", "base", "same", "same").action).toBe("unchanged");
	});

	it("remembers an explicit keep-local decision until remote content changes", () => {
		expect(classifyThreeWaySkill("a", "base", "local", "remote", "remote").action).toBe("kept-local");
		expect(classifyThreeWaySkill("a", "base", "local", "new-remote", "remote").action).toBe("conflict");
	});

	it("writes a local-only ledger atomically", () => {
		const directory = mkdtempSync(join(tmpdir(), "skiller-ledger-"));
		cleanup.push(directory);
		const path = join(directory, "state", "profile.json");
		const ledger = makeSyncLedger("profile", [{ id: "writing", sha256: "a".repeat(64) }]);
		writeSyncLedgerAt(path, ledger);
		expect(readSyncLedgerAt(path)).toEqual(ledger);
	});

	it("stores an external keep-local decision only in the local ledger", () => {
		const ledger = makeSyncLedger("profile", [], {
			adapt: { repository: "https://github.com/example/skills.git", ref: "a".repeat(40) },
		});
		expect(ledger.external_kept_sources?.adapt).toEqual({
			repository: "https://github.com/example/skills.git",
			ref: "a".repeat(40),
		});
	});
});
