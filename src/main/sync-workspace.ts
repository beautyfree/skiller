import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import simpleGit from "simple-git";
import { appDataRootPath } from "./settings";
import { assertCredentialFreeGitRemote, assertSyncStableId } from "./sync-profile";

const DEFAULT_BRANCH = "main";
const SYNC_GIT_NAME = "Skiller Sync";
const SYNC_GIT_EMAIL = "sync@skiller.local";

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
	const git = gitAt(workspacePath);
	await git.add(["--all"]);
	const status = await git.status();
	if (status.isClean()) return null;
	const result = await git.commit(message);
	return result.commit;
}

export async function fetchSyncWorkspace(workspacePath: string): Promise<void> {
	const git = gitAt(workspacePath);
	await git.fetch(["origin", "--prune"]);
}

/**
 * Advance only a clean managed checkout. We never create a merge commit or
 * overwrite a locally-ahead profile while preparing a restore preview.
 */
export async function fastForwardSyncWorkspace(workspacePath: string): Promise<void> {
	const git = gitAt(workspacePath);
	const status = await git.status();
	if (!status.isClean()) throw new Error("Sync workspace has uncommitted changes; resolve them before pulling");
	if (status.ahead > 0) throw new Error("Sync workspace has local commits; push or reconcile them before pulling");
	if (status.behind > 0) await git.merge(["--ff-only", `origin/${status.current || DEFAULT_BRANCH}`]);
}

/** Push is intentionally separate from commit; callers must show a reviewed plan first. */
export async function pushSyncWorkspace(workspacePath: string): Promise<void> {
	const git = gitAt(workspacePath);
	const status = await git.status();
	await git.push(["-u", "origin", `HEAD:${status.current || DEFAULT_BRANCH}`]);
}
