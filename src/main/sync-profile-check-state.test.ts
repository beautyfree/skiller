import { describe, expect, it } from "bun:test";
import { SyncProfileCheckStore } from "./sync-profile-check-state";

describe("SyncProfileCheckStore", () => {
  it("preserves a failed check across later read-only profile listings", () => {
    const store = new SyncProfileCheckStore();
    store.remember("personal", {
      last_checked_at: null,
      check_error: "The Git server could not be reached.",
      check_error_kind: "unavailable",
    });

    expect(store.get("personal")).toEqual({
      last_checked_at: null,
      check_error: "The Git server could not be reached.",
      check_error_kind: "unavailable",
    });
  });

  it("clears the error after a successful retry", () => {
    const store = new SyncProfileCheckStore();
    store.remember("personal", {
      last_checked_at: null,
      check_error: "Sign in first.",
      check_error_kind: "authentication",
    });
    store.rememberSuccess("personal", "2026-08-09T00:00:00.000Z");

    expect(store.get("personal")).toEqual({
      last_checked_at: "2026-08-09T00:00:00.000Z",
      check_error: null,
      check_error_kind: null,
    });
  });

  it("forgets profiles that are no longer connected", () => {
    const store = new SyncProfileCheckStore();
    store.rememberSuccess("personal");
    store.rememberSuccess("team");
    store.prune(new Set(["team"]));

    expect(store.get("personal")).toBeUndefined();
    expect(store.get("team")?.check_error).toBeNull();
  });
});
