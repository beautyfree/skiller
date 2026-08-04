import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { computePlanId } from "dotagents";

const execFileAsync = promisify(execFile);

/** A personal repo or owner/repo; no shell interpolation is ever used. */
export function assertGitHubRepositoryName(value: string): string {
	const name = value.trim();
	if (!/^(?:[A-Za-z0-9-]+\/)?[A-Za-z0-9._-]{1,100}$/.test(name)) {
		throw new Error("GitHub repository must be `name` or `owner/name`");
	}
	return name;
}

export type GitHubSyncRepositoryPlan = {
	kind: "skiller-github-repository";
	schemaVersion: 1;
	planId: string;
	repository: string;
	visibility: "private" | "public";
};

export function planGitHubSyncRepository(
	repository: string,
	visibility: "private" | "public",
): GitHubSyncRepositoryPlan {
	const payload = {
		kind: "skiller-github-repository" as const,
		schemaVersion: 1 as const,
		repository: assertGitHubRepositoryName(repository),
		visibility,
	};
	return { ...payload, planId: computePlanId(payload) };
}

/**
 * Uses the user's existing GitHub CLI session. Skiller deliberately never sees
 * or stores a GitHub token; `gh` owns authentication and creates the repo only
 * after an explicit UI action.
 */
export async function createGitHubSyncRepository(plan: GitHubSyncRepositoryPlan): Promise<string> {
	const current = planGitHubSyncRepository(plan.repository, plan.visibility);
	if (current.planId !== plan.planId) {
		throw new Error("GitHub repository name or visibility changed after review. Review it again.");
	}
	const name = current.repository;
	try {
		await execFileAsync("gh", ["repo", "create", name, `--${current.visibility}`, "--disable-wiki"]);
		const { stdout } = await execFileAsync("gh", ["repo", "view", name, "--json", "sshUrl", "--jq", ".sshUrl"]);
		const remote = stdout.trim();
		if (!/^git@github\.com:[^\s]+\.git$/.test(remote)) {
			throw new Error("GitHub CLI did not return an SSH remote URL");
		}
		return remote;
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Could not create GitHub repository via gh: ${detail}`);
	}
}
