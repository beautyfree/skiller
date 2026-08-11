import {
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import simpleGit from "simple-git";
import type { GitRunner } from "dotagents";
import { type WorkspaceGitPort } from "dotagents/git-workspace";
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
  type GitCommitPlan,
} from "dotagents/git-workspace";
import {
  exactSourceSecurityPolicy,
  requireTrustedSource,
  type SourceSecurityPolicy,
  type SourceSecurityPolicyInput,
} from "dotagents/source-policy";
import { computePlanId } from "dotagents";
import {
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

const SYNC_GIT_NAME = "Skiller Sync";
const SYNC_GIT_EMAIL = "sync@skiller.local";
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

function hasGitDirectory(workspacePath: string): boolean {
  return existsSync(join(workspacePath, ".git"));
}

function readSyncWorkspaceSourcePolicy(
  workspacePath: string,
): SourceSecurityPolicy {
  if (!isCanonicalSyncLibrary(workspacePath))
    throw new Error("Sync requires a canonical dotagents library");
  return readLocalSyncSourceSecurityPolicy(workspacePath);
}

function writeSyncWorkspaceSourcePolicy(
  workspacePath: string,
  sourcePolicy: SourceSecurityPolicyInput,
): void {
  if (!isCanonicalSyncLibrary(workspacePath))
    throw new Error("Sync requires a canonical dotagents library");
  writeLocalSyncSourceSecurityPolicy(workspacePath, sourcePolicy);
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
  git?: WorkspaceGitPort,
): Promise<void> {
  if (remoteUrl) {
    assertCredentialFreeGitRemote(remoteUrl);
    requireTrustedSource(remoteUrl, sourcePolicy);
  }
  if (!isCanonicalSyncLibrary(workspacePath))
    throw new Error("Initialize a canonical dotagents library before enabling sync");
  await applyLibraryGitInitialization(
    await planLibraryGitInitialization(workspacePath, remoteUrl ?? undefined, git),
    git,
  );
  if (remoteUrl) writeLocalSyncSourceSecurityPolicy(workspacePath, sourcePolicy);
}

/** A new library may only publish into an empty remote; existing repositories use the connect flow. */
export async function assertSyncRemoteEmpty(
  remoteUrl: string,
  sourcePolicy: SourceSecurityPolicyInput,
	gitRunner?: GitRunner,
	gitEnvironment?: NodeJS.ProcessEnv,
): Promise<void> {
  assertCredentialFreeGitRemote(remoteUrl);
  requireTrustedSource(remoteUrl, sourcePolicy);
  let refs: string;
  try {
		refs = gitRunner
			? await gitRunner.run(["ls-remote", "--heads", "--tags", remoteUrl])
			: await simpleGit().env(gitEnvironment ?? {}).listRemote(["--heads", "--tags", remoteUrl]);
  } catch {
    throw new Error("Skiller could not verify the destination repository. Connect or authenticate, then try again.");
  }
  if (refs.trim()) {
    throw new Error("This repository already contains Git history. Use ‘Connect library’ instead so nothing is overwritten.");
  }
}

export async function planSyncWorkspaceClone(
  remoteUrl: string,
  workspacePath: string,
  sourcePolicy: SourceSecurityPolicyInput,
  signal?: AbortSignal,
  workspaceGit?: WorkspaceGitPort,
): Promise<GitClonePlan> {
  assertCredentialFreeGitRemote(remoteUrl);
  requireTrustedSource(remoteUrl, sourcePolicy);
  const portableRemote = isAbsolute(remoteUrl)
    ? pathToFileURL(remoteUrl).href
    : remoteUrl;
  return planLibraryClone(portableRemote, workspacePath, sourcePolicy, workspaceGit, { signal });
}

export async function cloneSyncWorkspace(
  remoteUrl: string,
  workspacePath: string,
  sourcePolicy: SourceSecurityPolicyInput,
  expectedPlanId?: string,
	signal?: AbortSignal,
	workspaceGit?: WorkspaceGitPort,
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
		signal,
		workspaceGit,
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
		await applyGitClonePlan(plan, workspaceGit, { signal });
  } catch (error) {
    rmSync(workspacePath, { recursive: true, force: true });
    throw error;
  }
  const git = simpleGit(workspacePath);
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
  if (!isCanonicalSyncLibrary(workspacePath))
    throw new Error("Sync requires a canonical dotagents library");
  await applyLibraryGitInitialization(await planLibraryGitInitialization(workspacePath, remoteUrl));
  writeLocalSyncSourceSecurityPolicy(workspacePath, sourcePolicy);
}

export async function getSyncWorkspaceStatus(
  workspacePath: string,
): Promise<SyncWorkspaceStatus> {
  if (!isCanonicalSyncLibrary(workspacePath))
    throw new Error("Sync requires a canonical dotagents library");
  const status = await getLibraryGitStatus(workspacePath);
  return {
    branch: status.branch,
    changed: status.changed,
    ahead: status.ahead,
    behind: status.behind,
    remoteUrl: status.remoteIdentity,
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
  if (!isCanonicalSyncLibrary(workspacePath)) throw new Error("Sync requires a canonical dotagents library");
  const visibility = readSyncManifestFromWorkspace(workspacePath).profile.mode;
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

/** Build a no-write review for portable changes already made inside a managed library. */
export async function planSyncWorkspaceLocalPublish(
  workspacePath: string,
  message = "Update agent library",
): Promise<GitCommitPlan> {
  if (!isCanonicalSyncLibrary(workspacePath)) {
    throw new Error("Reviewing local library changes requires a canonical dotagents library");
  }
  const visibility = readSyncManifestFromWorkspace(workspacePath).profile.mode;
  return planLibraryCommit(workspacePath, message, visibility);
}

/** Commit exactly the reviewed portable bytes, then push through the device's approved remote policy. */
export async function applyReviewedSyncWorkspaceLocalPublish(
  workspacePath: string,
  expectedPlanId: string,
  message = "Update agent library",
  workspaceGit?: WorkspaceGitPort,
): Promise<{ commit: string | null; pushed: boolean }> {
  const plan = await planSyncWorkspaceLocalPublish(workspacePath, message);
  if (plan.planId !== expectedPlanId) {
    throw new Error("The local library changed after review. Review it again before saving.");
  }
  const commit = await applyLibraryCommit(plan);
  if (commit) await pushSyncWorkspace(workspacePath, undefined, workspaceGit);
  return { commit, pushed: Boolean(commit) };
}

/**
 * Metadata-only background check. It deliberately disables terminal prompts:
 * a periodic status refresh must never steal focus or wait for a password.
 * Fetching updates only Git's remote-tracking metadata; it never merges,
 * writes a managed skill, commits, or pushes.
 */
export async function refreshSyncWorkspaceStatus(
  workspacePath: string,
  workspaceGit?: WorkspaceGitPort,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  const sourcePolicy = readSyncWorkspaceSourcePolicy(workspacePath);
  if (!isCanonicalSyncLibrary(workspacePath)) throw new Error("Sync requires a canonical dotagents library");
  await fetchLibrary(workspacePath, sourcePolicy, workspaceGit, options);
}

/** Build a remote review without changing the managed checkout's files. */
export async function planSyncWorkspaceFastForward(
  workspacePath: string,
  signal?: AbortSignal,
  workspaceGit?: WorkspaceGitPort,
): Promise<GitFastForwardPlan> {
  return planGitFastForward(
    workspacePath,
    readSyncWorkspaceSourcePolicy(workspacePath),
    workspaceGit,
    { signal },
  );
}

/** Inspect the exact reviewed remote commit in a disposable detached worktree. */
export async function inspectSyncWorkspaceFastForward<T>(
  plan: GitFastForwardPlan,
  inspect: (checkout: string) => T | Promise<T>,
  signal?: AbortSignal,
  workspaceGit?: WorkspaceGitPort,
): Promise<T> {
  return inspectGitFastForwardPlan(plan, inspect, workspaceGit, { signal });
}

/** Apply only the exact Git state shown by the previous remote review. */
export async function applyReviewedSyncWorkspaceFastForward(
  workspacePath: string,
  expectedPlanId: string,
  workspaceGit?: WorkspaceGitPort,
): Promise<string> {
  const sourcePolicy = readSyncWorkspaceSourcePolicy(workspacePath);
  const plan = await planGitFastForward(workspacePath, sourcePolicy, workspaceGit);
  if (!expectedPlanId || plan.planId !== expectedPlanId) {
    throw new Error(
      "Remote or local Git state changed after review. Review it again before applying changes.",
    );
  }
  if (!isCanonicalSyncLibrary(workspacePath)) throw new Error("Sync requires a canonical dotagents library");
  const visibility = readSyncManifestFromWorkspace(workspacePath).profile.mode;
  const canonical = await planLibraryPull(workspacePath, visibility, sourcePolicy, workspaceGit);
  if (canonical.baseHead !== plan.baseHead || canonical.remoteHead !== plan.remoteHead) {
    throw new Error("Remote or local Git state changed after review. Review it again before applying changes.");
  }
  if (canonical.hasBlockers) throw new Error("Remote canonical library did not pass its safety review");
  return applyLibraryPull(canonical, workspaceGit);
}

/** Push is intentionally separate from commit; callers must show a reviewed plan first. */
export async function pushSyncWorkspace(
  workspacePath: string,
  explicitSourcePolicy?: SourceSecurityPolicyInput,
  workspaceGit?: WorkspaceGitPort,
): Promise<void> {
  const sourcePolicy =
    explicitSourcePolicy ?? readSyncWorkspaceSourcePolicy(workspacePath);
  if (!isCanonicalSyncLibrary(workspacePath)) throw new Error("Sync requires a canonical dotagents library");
  await applyLibraryPush(await planLibraryPush(workspacePath, sourcePolicy, workspaceGit), workspaceGit);
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
