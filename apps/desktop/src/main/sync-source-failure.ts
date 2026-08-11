import { SourceReleaseAgeError } from "dotagents/source-policy";

export type SyncSourceFailureReason =
  | "authentication"
  | "timeout"
  | "invalid-source"
  | "missing-skill"
  | "unavailable"
  | "too-new";

export type SyncCheckFailure = {
  kind: "authentication" | "unavailable" | "invalid-source";
  message: string;
};

/** Turns low-level Git/resolver failures into stable, actionable product states. */
export function classifySyncSourceFailure(error: unknown): SyncSourceFailureReason {
  if (error instanceof SourceReleaseAgeError) return "too-new";
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out|timeout|ETIMEDOUT/i.test(message)) return "timeout";
  if (/authentication|not authenticated|could not read username|permission denied|authorization failed|access denied|repository not found/i.test(message)) {
    return "authentication";
  }
  if (/couldn.t find remote ref|invalid commit|unknown revision|not our ref|bad object/i.test(message)) return "invalid-source";
  if (/no compatible skills\.json|selected .*path|missing .*SKILL\.md|does not exist/i.test(message)) return "missing-skill";
  return "unavailable";
}

/** Describes a failed background check without exposing arbitrary Git output. */
export function describeSyncCheckFailure(error: unknown): SyncCheckFailure {
  const reason = classifySyncSourceFailure(error);
  if (reason === "authentication") {
    return {
      kind: "authentication",
      message: "Sign in to this Git server, then try the update check again.",
    };
  }
  if (reason === "invalid-source" || reason === "missing-skill") {
    return {
      kind: "invalid-source",
      message: "The saved Git source could not be verified. Review storage details before trying again.",
    };
  }
  return {
    kind: "unavailable",
    message: "The Git server could not be reached. Check your connection and try again.",
  };
}
