import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	classifyThreeWaySkill,
	bootstrapSyncLedgerFromManifest,
	makeSyncLedger,
	readSyncLedgerAt,
	recordSyncLedgerDeviceChoices,
	writeSyncLedgerAt,
} from "./sync-ledger";

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

	it("bootstraps a missing device ledger from bundled manifest skills only", () => {
		const ledger = bootstrapSyncLedgerFromManifest("profile", [
			{ kind: "bundled", id: "writing", sha256: "a".repeat(64) },
			{ kind: "reference", id: "external", sha256: "b".repeat(64) },
		], null);
		expect(ledger.skills).toEqual({ writing: { sha256: "a".repeat(64) } });

		const existing = makeSyncLedger("profile", [{ id: "kept", sha256: "c".repeat(64) }]);
		expect(bootstrapSyncLedgerFromManifest("profile", [], existing)).toBe(existing);
	});

	it("records an undone restore as a reviewed per-device choice", () => {
		const remote = "b".repeat(64);
		const ledger = recordSyncLedgerDeviceChoices(
			"profile",
			makeSyncLedger("profile", [{ id: "existing", sha256: "a".repeat(64) }]),
			[{ id: "writing", remoteSha256: remote }],
		);
		expect(ledger.skills.existing).toEqual({ sha256: "a".repeat(64) });
		expect(ledger.skills.writing).toEqual({ sha256: remote, kept_remote_sha256: remote });
		expect(classifyThreeWaySkill("writing", remote, null, remote, remote).action).toBe("kept-local");
	});
});
