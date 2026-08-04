import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import simpleGit from "simple-git";
import {
  applyGitClonePlan,
  applyLibraryCommit,
  applyLibraryPull,
  applyLibraryPush,
  applyLibraryGitInitialization,
  fetchLibrary,
  getLibraryGitStatus,
  planLibraryClone,
  planGitCheckout,
  planLibraryGitInitialization,
  planLibraryCommit,
  planLibraryPull,
  planLibraryPush,
  type GitClonePlan,
} from "dotagents/git-workspace";
import {
  DENY_ALL_SOURCE_SECURITY_POLICY,
  exactSourceSecurityPolicy,
  parseSourceSecurityPolicy,
  requireTrustedSource,
  type SourceSecurityPolicy,
  type SourceSecurityPolicyInput,
} from "dotagents/source-policy";
import { computePlanId } from "dotagents";
import {
  applyGitFastForwardPlan,
  inspectGitFastForwardPlan,
  planGitFastForward,
  type GitFastForwardPlan,
} from "dotagents/git-fast-forward";
import { appDataRootPath } from "./settings";
import {
  assertCredentialFreeGitRemote,
  assertSyncStableId,
} from "./sync-profile";
import {
  isCanonicalSyncLibrary,
  readLocalSyncSourceSecurityPolicy,
  readSyncManifestFromWorkspace,
  writeLocalSyncSourceSecurityPolicy,
} from "./sync-dotagents";

const DEFAULT_BRANCH = "main";
const SYNC_GIT_NAME = "Skiller Sync";
const SYNC_GIT_EMAIL = "sync@skiller.local";
const LEGACY_SOURCE_POLICY_FILE = "skiller-source-policy.json";
export const SYNC_REMOTE_MINIMUM_RELEASE_AGE_MINUTES = 7 * 24 * 60;

export type SyncWorkspaceStatus = {
  branch: string;
  changed: boolean;
  ahead: number;
  behind: number;
  remoteUrl: string | null;
};

export type SyncWorkspaceRemoteTrustStatus = {
  required: boolean;
  remoteIdentity: string | null;
};

export type SyncWorkspaceRemoteTrustPlan = {
  kind: "sync-workspace-remote-trust";
  schemaVersion: 1;
  planId: string;
  remoteIdentity: string;
  sourcePolicy: SourceSecurityPolicy;
};

function gitAt(workspacePath: string) {
  return simpleGit(workspacePath);
}

function hasGitDirectory(workspacePath: string): boolean {
  return existsSync(join(workspacePath, ".git"));
}

function legacySourcePolicyPath(workspacePath: string): string {
  return join(workspacePath, ".git", LEGACY_SOURCE_POLICY_FILE);
}

function readSyncWorkspaceSourcePolicy(
  workspacePath: string,
): SourceSecurityPolicy {
  if (isCanonicalSyncLibrary(workspacePath))
    return readLocalSyncSourceSecurityPolicy(workspacePath);
  const policyPath = legacySourcePolicyPath(workspacePath);
  if (!existsSync(policyPath)) return DENY_ALL_SOURCE_SECURITY_POLICY;
  try {
    return parseSourceSecurityPolicy(
      JSON.parse(readFileSync(policyPath, "utf8")),
    );
  } catch {
    return DENY_ALL_SOURCE_SECURITY_POLICY;
  }
}

function writeLegacySyncSourceSecurityPolicy(
  workspacePath: string,
  sourcePolicy: SourceSecurityPolicyInput,
): void {
  const policyPath = legacySourcePolicyPath(workspacePath);
  const temporary = `${policyPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(
      temporary,
      `${JSON.stringify(parseSourceSecurityPolicy(sourcePolicy), null, 2)}\n`,
      { mode: 0o600 },
    );
    renameSync(temporary, policyPath);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function writeSyncWorkspaceSourcePolicy(
  workspacePath: string,
  sourcePolicy: SourceSecurityPolicyInput,
): void {
  if (isCanonicalSyncLibrary(workspacePath)) {
    writeLocalSyncSourceSecurityPolicy(workspacePath, sourcePolicy);
    return;
  }
  writeLegacySyncSourceSecurityPolicy(workspacePath, sourcePolicy);
}

/** Managed worktrees are never renderer-provided paths. */
export function syncProfilesDirectory(): string {
  return join(appDataRootPath(), "sync");
}

export function syncWorkspacePath(profileId: string): string {
  assertSyncStableId(profileId);
  return join(syncProfilesDirectory(), profileId);
}

export function hasSyncWorkspace(profileId: string): boolean {
  return hasGitDirectory(syncWorkspacePath(profileId));
}

export async function initializeSyncWorkspace(
  workspacePath: string,
  remoteUrl?: string | null,
  sourcePolicy: SourceSecurityPolicyInput = {},
): Promise<void> {
  if (remoteUrl) {
    assertCredentialFreeGitRemote(remoteUrl);
    requireTrustedSource(remoteUrl, sourcePolicy);
  }
  if (isCanonicalSyncLibrary(workspacePath)) {
    await applyLibraryGitInitialization(
      await planLibraryGitInitialization(workspacePath, remoteUrl ?? undefined),
    );
    if (remoteUrl)
      writeLocalSyncSourceSecurityPolicy(workspacePath, sourcePolicy);
    return;
  }
  mkdirSync(workspacePath, { recursive: true });
  if (!hasGitDirectory(workspacePath)) {
    const entries = readdirSync(workspacePath);
    if (entries.length > 0)
      throw new Error(
        `Sync workspace must be empty before initialization: ${workspacePath}`,
      );
    const git = gitAt(workspacePath);
    await git.raw(["init", "--initial-branch", DEFAULT_BRANCH]);
    // The identity is deliberately non-personal. A future profile may offer an
    // explicit opt-in identity, but backup should not leak one by default.
    await git.raw(["config", "user.name", SYNC_GIT_NAME]);
    await git.raw(["config", "user.email", SYNC_GIT_EMAIL]);
  }
  if (remoteUrl)
    await setSyncWorkspaceRemote(workspacePath, remoteUrl, sourcePolicy);
}

export async function planSyncWorkspaceClone(
  remoteUrl: string,
  workspacePath: string,
  sourcePolicy: SourceSecurityPolicyInput,
): Promise<GitClonePlan> {
  assertCredentialFreeGitRemote(remoteUrl);
  requireTrustedSource(remoteUrl, sourcePolicy);
  const portableRemote = isAbsolute(remoteUrl)
    ? pathToFileURL(remoteUrl).href
    : remoteUrl;
  return planLibraryClone(portableRemote, workspacePath, sourcePolicy);
}

export async function cloneSyncWorkspace(
  remoteUrl: string,
  workspacePath: string,
  sourcePolicy: SourceSecurityPolicyInput,
  expectedPlanId?: string,
): Promise<void> {
  assertCredentialFreeGitRemote(remoteUrl);
  requireTrustedSource(remoteUrl, sourcePolicy);
  if (existsSync(workspacePath) && readdirSync(workspacePath).length > 0) {
    throw new Error(
      `Sync workspace must be empty before clone: ${workspacePath}`,
    );
  }
  const plan = await planSyncWorkspaceClone(
    remoteUrl,
    workspacePath,
    sourcePolicy,
  );
  if (expectedPlanId && plan.planId !== expectedPlanId) {
    throw new Error(
      "Clone destination or remote changed after review. Review the connection again.",
    );
  }
  try {
    // The shared core checks out only the immutable commit resolved by the
    // reviewed clone preview. Format validation stays in Skiller so canonical
    // dotagents and legacy skiller-sync manifests use the same safe transport.
    await applyGitClonePlan(plan);
  } catch (error) {
    rmSync(workspacePath, { recursive: true, force: true });
    throw error;
  }
  const git = gitAt(workspacePath);
  await git.raw(["config", "user.name", SYNC_GIT_NAME]);
  await git.raw(["config", "user.email", SYNC_GIT_EMAIL]);
  writeSyncWorkspaceSourcePolicy(workspacePath, sourcePolicy);
}

export async function setSyncWorkspaceRemote(
  workspacePath: string,
  remoteUrl: string,
  sourcePolicy: SourceSecurityPolicyInput = {},
): Promise<void> {
  assertCredentialFreeGitRemote(remoteUrl);
  requireTrustedSource(remoteUrl, sourcePolicy);
  if (isCanonicalSyncLibrary(workspacePath)) {
    await applyLibraryGitInitialization(
      await planLibraryGitInitialization(workspacePath, remoteUrl),
    );
    writeLocalSyncSourceSecurityPolicy(workspacePath, sourcePolicy);
    return;
  }
  const git = gitAt(workspacePath);
  const remotes = await git.getRemotes(true);
  const origin = remotes.find((remote) => remote.name === "origin");
  if (origin) {
    await git.remote(["set-url", "origin", remoteUrl]);
  } else {
    await git.addRemote("origin", remoteUrl);
  }
  writeLegacySyncSourceSecurityPolicy(workspacePath, sourcePolicy);
}

export async function getSyncWorkspaceStatus(
  workspacePath: string,
): Promise<SyncWorkspaceStatus> {
  if (isCanonicalSyncLibrary(workspacePath)) {
    const status = await getLibraryGitStatus(workspacePath);
    return {
      branch: status.branch,
      changed: status.changed,
      ahead: status.ahead,
      behind: status.behind,
      remoteUrl: status.remoteIdentity,
    };
  }
  const git = gitAt(workspacePath);
  const [status, remotes] = await Promise.all([
    git.status(),
    git.getRemotes(true),
  ]);
  const origin = remotes.find((remote) => remote.name === "origin");
  return {
    branch: status.current || DEFAULT_BRANCH,
    changed: !status.isClean(),
    ahead: status.ahead,
    behind: status.behind,
    remoteUrl: origin?.refs.fetch ?? null,
  };
}

/** Inspect only local Git/config state. This function never contacts the remote. */
export async function inspectSyncWorkspaceRemoteTrust(
  workspacePath: string,
): Promise<SyncWorkspaceRemoteTrustStatus> {
  const remoteIdentity = (await getSyncWorkspaceStatus(workspacePath))
    .remoteUrl;
  if (!remoteIdentity) return { required: false, remoteIdentity: null };
  try {
    requireTrustedSource(
      remoteIdentity,
      readSyncWorkspaceSourcePolicy(workspacePath),
    );
    return { required: false, remoteIdentity };
  } catch {
    return { required: true, remoteIdentity };
  }
}

/** Build a deterministic, network-free one-time review for an existing profile. */
export async function planSyncWorkspaceRemoteTrust(
  workspacePath: string,
  minimumReleaseAgeMinutes = SYNC_REMOTE_MINIMUM_RELEASE_AGE_MINUTES,
): Promise<SyncWorkspaceRemoteTrustPlan> {
  const remoteIdentity = (await getSyncWorkspaceStatus(workspacePath))
    .remoteUrl;
  if (!remoteIdentity) throw new Error("Sync workspace has no origin remote");
  assertCredentialFreeGitRemote(remoteIdentity);
  const sourcePolicy = exactSourceSecurityPolicy([remoteIdentity], {
    minimum_release_age_minutes: minimumReleaseAgeMinutes,
  });
  const trust = requireTrustedSource(remoteIdentity, sourcePolicy);
  const payload = {
    kind: "sync-workspace-remote-trust" as const,
    schemaVersion: 1 as const,
    remoteIdentity: trust.source,
    sourcePolicy,
  };
  return { ...payload, planId: computePlanId(payload) };
}

/** Persist only the exact remote shown by the reviewed plan; no fetch occurs here. */
export async function applySyncWorkspaceRemoteTrust(
  workspacePath: string,
  expectedPlanId: string,
  minimumReleaseAgeMinutes = SYNC_REMOTE_MINIMUM_RELEASE_AGE_MINUTES,
): Promise<void> {
  const plan = await planSyncWorkspaceRemoteTrust(
    workspacePath,
    minimumReleaseAgeMinutes,
  );
  if (!expectedPlanId || plan.planId !== expectedPlanId) {
    throw new Error(
      "The library remote changed after review. Review it again before allowing network access.",
    );
  }
  writeSyncWorkspaceSourcePolicy(workspacePath, plan.sourcePolicy);
}

export async function commitSyncWorkspace(
  workspacePath: string,
  message: string,
): Promise<string | null> {
  if (isCanonicalSyncLibrary(workspacePath)) {
    const visibility =
      readSyncManifestFromWorkspace(workspacePath).profile.mode;
    const plan = await planLibraryCommit(workspacePath, message, visibility);
    if (plan.hasBlockers) {
      const detail =
        plan.secretFindings.length > 0
          ? `${plan.secretFindings.length} possible secret(s)`
          : plan.unsafePaths.length > 0
            ? `unsafe portable paths: ${plan.unsafePaths.join(", ")}`
            : plan.auditErrors.map((issue) => issue.message).join("; ");
      throw new Error(`Canonical library commit is blocked: ${detail}`);
    }
    return applyLibraryCommit(plan);
  }
  const git = gitAt(workspacePath);
  await git.add(["--all"]);
  const status = await git.status();
  if (status.isClean()) return null;
  const result = await git.commit(message);
  return result.commit;
}

/**
 * Metadata-only background check. It deliberately disables terminal prompts:
 * a periodic status refresh must never steal focus or wait for a password.
 * Fetching updates only Git's remote-tracking metadata; it never merges,
 * writes a managed skill, commits, or pushes.
 */
export async function refreshSyncWorkspaceStatus(
  workspacePath: string,
): Promise<void> {
  const sourcePolicy = readSyncWorkspaceSourcePolicy(workspacePath);
  if (isCanonicalSyncLibrary(workspacePath)) {
    await fetchLibrary(workspacePath, sourcePolicy);
    return;
  }
  const git = gitAt(workspacePath).env({ GIT_TERMINAL_PROMPT: "0" });
  const remote = await git.remote(["get-url", "origin"]);
  if (typeof remote !== "string" || !remote.trim())
    throw new Error("Sync workspace has no origin remote");
  requireTrustedSource(remote, sourcePolicy);
  await git.raw([
    "-c",
    "credential.interactive=false",
    "fetch",
    "origin",
    "--prune",
    "--no-tags",
  ]);
}

/** Build a remote review without changing the managed checkout's files. */
export async function planSyncWorkspaceFastForward(
  workspacePath: string,
): Promise<GitFastForwardPlan> {
  return planGitFastForward(
    workspacePath,
    readSyncWorkspaceSourcePolicy(workspacePath),
  );
}

/** Inspect the exact reviewed remote commit in a disposable detached worktree. */
export async function inspectSyncWorkspaceFastForward<T>(
  plan: GitFastForwardPlan,
  inspect: (checkout: string) => T | Promise<T>,
): Promise<T> {
  return inspectGitFastForwardPlan(plan, inspect);
}

/** Apply only the exact Git state shown by the previous remote review. */
export async function applyReviewedSyncWorkspaceFastForward(
  workspacePath: string,
  expectedPlanId: string,
): Promise<string> {
  const sourcePolicy = readSyncWorkspaceSourcePolicy(workspacePath);
  const plan = await planGitFastForward(workspacePath, sourcePolicy);
  if (!expectedPlanId || plan.planId !== expectedPlanId) {
    throw new Error(
      "Remote or local Git state changed after review. Review it again before applying changes.",
    );
  }
  if (isCanonicalSyncLibrary(workspacePath)) {
    const visibility =
      readSyncManifestFromWorkspace(workspacePath).profile.mode;
    const canonical = await planLibraryPull(
      workspacePath,
      visibility,
      sourcePolicy,
    );
    if (
      canonical.baseHead !== plan.baseHead ||
      canonical.remoteHead !== plan.remoteHead
    ) {
      throw new Error(
        "Remote or local Git state changed after review. Review it again before applying changes.",
      );
    }
    if (canonical.hasBlockers)
      throw new Error(
        "Remote canonical library did not pass its safety review",
      );
    return applyLibraryPull(canonical);
  }
  return applyGitFastForwardPlan(plan);
}

/** Push is intentionally separate from commit; callers must show a reviewed plan first. */
export async function pushSyncWorkspace(
  workspacePath: string,
  explicitSourcePolicy?: SourceSecurityPolicyInput,
): Promise<void> {
  const sourcePolicy =
    explicitSourcePolicy ?? readSyncWorkspaceSourcePolicy(workspacePath);
  if (isCanonicalSyncLibrary(workspacePath)) {
    await applyLibraryPush(await planLibraryPush(workspacePath, sourcePolicy));
    return;
  }
  const git = gitAt(workspacePath);
  const remote = await git.remote(["get-url", "origin"]);
  if (typeof remote !== "string" || !remote.trim())
    throw new Error("Sync workspace has no origin remote");
  requireTrustedSource(remote, sourcePolicy);
  const status = await git.status();
  await git.push(["-u", "origin", `HEAD:${status.current || DEFAULT_BRANCH}`]);
}

/**
 * A branch or tag in an external skill lock is not reproducible. Resolve it
 * once, without a checkout, before recording it in the portable manifest.
 * Authentication stays in the user's normal Git credential flow; prompts are
 * explicitly disabled because this is called while preparing a UI preview.
 */
export async function resolveGitReferenceToCommit(
  repository: string,
  ref: string,
  sourcePolicy: SourceSecurityPolicyInput,
): Promise<string> {
  requireTrustedSource(repository, sourcePolicy);
  assertCredentialFreeGitRemote(repository);
  const requested = ref.trim();
  if (!requested)
    throw new Error("An external skill source has no Git revision to pin");
  const unusedDestination = join(
    tmpdir(),
    `skiller-ref-review-${randomUUID()}`,
  );
  const plan = await planGitCheckout(
    repository,
    unusedDestination,
    requested,
    sourcePolicy,
  );
  return plan.resolvedCommit;
}
