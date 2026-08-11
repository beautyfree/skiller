import type { SyncProfileStatusJson } from "../shared/rpc-schema";

export type SyncProfileCheckState = Pick<
  SyncProfileStatusJson,
  "last_checked_at" | "check_error" | "check_error_kind"
>;

/** Keeps the latest device-local check result stable across read-only listings. */
export class SyncProfileCheckStore {
  readonly #states = new Map<string, SyncProfileCheckState>();

  get(profileId: string): SyncProfileCheckState | undefined {
    return this.#states.get(profileId);
  }

  remember(profileId: string, state: SyncProfileCheckState): void {
    this.#states.set(profileId, state);
  }

  rememberSuccess(profileId: string, checkedAt = new Date().toISOString()): void {
    this.remember(profileId, {
      last_checked_at: checkedAt,
      check_error: null,
      check_error_kind: null,
    });
  }

  forget(profileId: string): void {
    this.#states.delete(profileId);
  }

  clear(): void {
    this.#states.clear();
  }

  prune(profileIds: ReadonlySet<string>): void {
    for (const profileId of this.#states.keys()) {
      if (!profileIds.has(profileId)) this.#states.delete(profileId);
    }
  }
}
