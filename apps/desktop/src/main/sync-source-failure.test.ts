import { describe, expect, it } from "bun:test";
import { SourceReleaseAgeError } from "dotagents/source-policy";
import { classifySyncSourceFailure, describeSyncCheckFailure } from "./sync-source-failure";

describe("sync source failure classification", () => {
  it.each([
    [new Error("operation timed out"), "timeout"],
    [new Error("Permission denied (publickey)"), "authentication"],
    [new Error("fatal: couldn't find remote ref release"), "invalid-source"],
    [new Error("selected skill path does not exist"), "missing-skill"],
    [new Error("unexpected resolver failure"), "unavailable"],
  ] as const)("classifies %s as %s", (error, expected) => {
    expect(classifySyncSourceFailure(error)).toBe(expected);
  });

  it("keeps minimum-age policy failures distinct from network failures", () => {
    const decision = {
      source: "https://github.com/example/skills",
      committedAt: "2026-08-08T00:00:00.000Z",
      ageMinutes: 1,
      minimumAgeMinutes: 10,
      excluded: false,
    };
    expect(classifySyncSourceFailure(new SourceReleaseAgeError(decision))).toBe("too-new");
  });
});

describe("describeSyncCheckFailure", () => {
  it("returns a safe authentication recovery action", () => {
    expect(describeSyncCheckFailure(new Error("Permission denied for https://token@example.test/private.git"))).toEqual({
      kind: "authentication",
      message: "Sign in to this Git server, then try the update check again.",
    });
  });

  it("distinguishes an invalid saved source", () => {
    expect(describeSyncCheckFailure(new Error("fatal: couldn't find remote ref main"))).toEqual({
      kind: "invalid-source",
      message: "The saved Git source could not be verified. Review storage details before trying again.",
    });
  });

  it("uses a retryable unavailable state for connectivity failures", () => {
    expect(describeSyncCheckFailure(new Error("connection timed out"))).toEqual({
      kind: "unavailable",
      message: "The Git server could not be reached. Check your connection and try again.",
    });
  });
});
