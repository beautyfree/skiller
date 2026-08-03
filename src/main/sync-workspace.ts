import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import simpleGit from "simple-git";
import {
	applyLibraryCommit,
	applyLibraryPull,
	applyLibraryPush,
	cloneLibrary,
	fetchLibrary,
	getLibraryGitStatus,
	initializeLibraryGit,
	planLibraryCommit,
	planLibraryPull,
	planLibraryPush,
	setLibraryRemote,
} from "@beautyfree/dotagent/git-workspace";
import { appDataRootPath } from "./settings";
import { assertCredentialFreeGitRemote, assertSyncStableId } from "./sync-profile";
import { isCanonicalSyncLibrary, readSyncManifestFromWorkspace } from "./sync-dotagent";

const DEFAULT_BRANCH = "main";
const SYNC_GIT_NAME = "Skiller Sync";
const SYNC_GIT_EMAIL = "sync@skiller.local";
const GIT_REFERENCE_RESOLUTION_TIMEOUT_MS = 12_000;
const execFileAsync = promisify(execFile);

export type SyncWorkspaceStatus = {
	branch: string;
	changed: boolean;
	ahead: number;
	behind: number;
	remoteUrl: string | null;
};

function gitAt(workspacePath: string) {
	return simpleGit(workspacePath);
}

function hasGitDirectory(workspacePath: string): boolean {
	return existsSync(join(workspacePath, ".git"));
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

export async function initializeSyncWorkspace(workspacePath: string, remoteUrl?: string | null): Promise<void> {
	if (remoteUrl) assertCredentialFreeGitRemote(remoteUrl);
	if (isCanonicalSyncLibrary(workspacePath)) {
		await initializeLibraryGit(workspacePath, remoteUrl ?? undefined);
		return;
	}
	mkdirSync(workspacePath, { recursive: true });
	if (!hasGitDirectory(workspacePath)) {
		const entries = readdirSync(workspacePath);
		if (entries.length > 0) throw new Error(`Sync workspace must be empty before initialization: ${workspacePath}`);
		const git = gitAt(workspacePath);
		await git.raw(["init", "--initial-branch", DEFAULT_BRANCH]);
		// The identity is deliberately non-personal. A future profile may offer an
		// explicit opt-in identity, but backup should not leak one by default.
		await git.raw(["config", "user.name", SYNC_GIT_NAME]);
		await git.raw(["config", "user.email", SYNC_GIT_EMAIL]);
	}
	if (remoteUrl) await setSyncWorkspaceRemote(workspacePath, remoteUrl);
}

export async function cloneSyncWorkspace(remoteUrl: string, workspacePath: string): Promise<void> {
	assertCredentialFreeGitRemote(remoteUrl);
	if (existsSync(workspacePath) && readdirSync(workspacePath).length > 0) {
		throw new Error(`Sync workspace must be empty before clone: ${workspacePath}`);
	}
	try {
		await cloneLibrary(remoteUrl, workspacePath);
		return;
	} catch {
		// Existing Skiller profiles predate the canonical dotagent manifest. Fall
		// back only to preserve those repositories; the caller still validates the
		// legacy manifest before exposing the clone as a profile.
	}
	await simpleGit().clone(remoteUrl, workspacePath);
	const git = gitAt(workspacePath);
	// A newly created bare/self-hosted remote can still advertise `master` as
	// HEAD even after a client pushed `main`. Sync profiles always use main, so
	// restore it explicitly instead of accepting an empty checkout.
	await git.checkout(["-B", DEFAULT_BRANCH, `origin/${DEFAULT_BRANCH}`]);
	await git.raw(["config", "user.name", SYNC_GIT_NAME]);
	await git.raw(["config", "user.email", SYNC_GIT_EMAIL]);
}

export async function setSyncWorkspaceRemote(workspacePath: string, remoteUrl: string): Promise<void> {
	assertCredentialFreeGitRemote(remoteUrl);
	if (isCanonicalSyncLibrary(workspacePath)) {
		await setLibraryRemote(workspacePath, remoteUrl);
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
}

export async function getSyncWorkspaceStatus(workspacePath: string): Promise<SyncWorkspaceStatus> {
	if (isCanonicalSyncLibrary(workspacePath)) {
		const status = await getLibraryGitStatus(workspacePath);
		return { branch: status.branch, changed: status.changed, ahead: status.ahead, behind: status.behind, remoteUrl: status.remoteIdentity };
	}
	const git = gitAt(workspacePath);
	const [status, remotes] = await Promise.all([git.status(), git.getRemotes(true)]);
	const origin = remotes.find((remote) => remote.name === "origin");
	return {
		branch: status.current || DEFAULT_BRANCH,
		changed: !status.isClean(),
		ahead: status.ahead,
		behind: status.behind,
		remoteUrl: origin?.refs.fetch ?? null,
	};
}

export async function commitSyncWorkspace(workspacePath: string, message: string): Promise<string | null> {
	if (isCanonicalSyncLibrary(workspacePath)) {
		const visibility = readSyncManifestFromWorkspace(workspacePath).profile.mode;
		const plan = await planLibraryCommit(workspacePath, message, visibility);
		if (plan.hasBlockers) {
			const detail = plan.secretFindings.length > 0
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

export async function fetchSyncWorkspace(workspacePath: string): Promise<void> {
	if (isCanonicalSyncLibrary(workspacePath)) {
		await fetchLibrary(workspacePath);
		return;
	}
	const git = gitAt(workspacePath);
	await git.fetch(["origin", "--prune"]);
}

/**
 * Metadata-only background check. It deliberately disables terminal prompts:
 * a periodic status refresh must never steal focus or wait for a password.
 * Fetching updates only Git's remote-tracking metadata; it never merges,
 * writes a managed skill, commits, or pushes.
 */
export async function refreshSyncWorkspaceStatus(workspacePath: string): Promise<void> {
	if (isCanonicalSyncLibrary(workspacePath)) {
		await fetchLibrary(workspacePath);
		return;
	}
	const git = gitAt(workspacePath).env({ GIT_TERMINAL_PROMPT: "0" });
	await git.raw(["-c", "credential.interactive=false", "fetch", "origin", "--prune", "--no-tags"]);
}

/**
 * Advance only a clean managed checkout. We never create a merge commit or
 * overwrite a locally-ahead profile while preparing a restore preview.
 */
export async function fastForwardSyncWorkspace(workspacePath: string): Promise<void> {
	if (isCanonicalSyncLibrary(workspacePath)) {
		const visibility = readSyncManifestFromWorkspace(workspacePath).profile.mode;
		const plan = await planLibraryPull(workspacePath, visibility);
		if (plan.hasBlockers) throw new Error("Remote canonical library did not pass its safety review");
		await applyLibraryPull(plan);
		return;
	}
	const git = gitAt(workspacePath);
	const status = await git.status();
	if (!status.isClean()) throw new Error("Sync workspace has uncommitted changes; resolve them before pulling");
	if (status.ahead > 0) throw new Error("Sync workspace has local commits; push or reconcile them before pulling");
	if (status.behind > 0) await git.merge(["--ff-only", `origin/${status.current || DEFAULT_BRANCH}`]);
}

/** Push is intentionally separate from commit; callers must show a reviewed plan first. */
export async function pushSyncWorkspace(workspacePath: string): Promise<void> {
	if (isCanonicalSyncLibrary(workspacePath)) {
		await applyLibraryPush(await planLibraryPush(workspacePath));
		return;
	}
	const git = gitAt(workspacePath);
	const status = await git.status();
	await git.push(["-u", "origin", `HEAD:${status.current || DEFAULT_BRANCH}`]);
}

/**
 * A branch or tag in an external skill lock is not reproducible. Resolve it
 * once, without a checkout, before recording it in the portable manifest.
 * Authentication stays in the user's normal Git credential flow; prompts are
 * explicitly disabled because this is called while preparing a UI preview.
 */
export async function resolveGitReferenceToCommit(repository: string, ref: string): Promise<string> {
	assertCredentialFreeGitRemote(repository);
	const requested = ref.trim();
	if (/^[a-f0-9]{40}$/i.test(requested)) return requested.toLowerCase();
	if (!requested) throw new Error("An external skill source has no Git revision to pin");
	let output: string;
	try {
		// --refs deliberately omits the symbolic HEAD pseudo-ref. Ask Git for
		// it explicitly when a Skills CLI lock did not retain a branch/ref.
		const args = requested === "HEAD"
			? ["ls-remote", "--symref", repository, "HEAD"]
			: ["ls-remote", "--refs", repository, requested];
		const result = await execFileAsync("git", args, {
			timeout: GIT_REFERENCE_RESOLUTION_TIMEOUT_MS,
			maxBuffer: 1024 * 1024,
			env: {
				...process.env,
				GIT_TERMINAL_PROMPT: "0",
				GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=10",
			},
		});
		output = result.stdout;
	} catch {
		throw new Error(`Could not resolve ${requested} to an immutable commit. Connect or authenticate, then retry.`);
	}
	const commit = requested === "HEAD"
		? output.match(/^([a-f0-9]{40})\s+HEAD\s*$/m)?.[1]
		: output.match(/^([a-f0-9]{40})\s/m)?.[1];
	if (!commit) {
		throw new Error(`Could not resolve ${requested} to an immutable commit. Check that the source and revision still exist.`);
	}
	return commit.toLowerCase();
}
