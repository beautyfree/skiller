import { GitHubTokenProviderAdapter, planProviderLibraryCreation, type GitHubRepositoryPreflight, type RemoteConnection } from "dotagents";

/** Public OAuth Device Flow client id. It is not a secret. */
export const GITHUB_DEVICE_FLOW_CLIENT_ID = 'Ov23libd9NpS8gZKtLbE'

export type GitHubSyncRepositoryPlan = {
	kind: "skiller-github-repository";
	schemaVersion: 1;
	planId: string;
	repository: string;
	visibility: "private" | "public";
};

/** Shared dotagents validation for a personal repository or `owner/repository`. */
export function assertGitHubRepositoryName(value: string): string {
	return planProviderLibraryCreation("github", value).name;
}

/**
 * Keeps Skiller's renderer contract while binding the plan ID to dotagents'
 * provider-neutral repository creation review.
 */
export function planGitHubSyncRepository(
	repository: string,
	visibility: "private" | "public",
): GitHubSyncRepositoryPlan {
	const shared = planProviderLibraryCreation("github", repository, visibility);
	return {
		kind: "skiller-github-repository",
		schemaVersion: 1,
		planId: shared.planId,
		repository: shared.name,
		visibility: shared.visibility,
	};
}

/** Creates the reviewed repository through GitHub's API without a local CLI. */
export async function createGitHubSyncRepository(plan: GitHubSyncRepositoryPlan, accessToken: string, signal?: AbortSignal): Promise<string> {
	const shared = planProviderLibraryCreation("github", plan.repository, plan.visibility);
	if (shared.planId !== plan.planId)
		throw new Error("GitHub repository name or visibility changed after review. Review it again.");
	return (await new GitHubTokenProviderAdapter(accessToken).createLibrary(shared, signal)).remote;
}

/** Checks access and availability before the user reaches final creation. */
export async function preflightGitHubSyncRepository(
	plan: GitHubSyncRepositoryPlan,
	accessToken: string,
	signal?: AbortSignal,
): Promise<GitHubRepositoryPreflight> {
	const shared = planProviderLibraryCreation("github", plan.repository, plan.visibility);
	if (shared.planId !== plan.planId)
		throw new Error("GitHub repository name or visibility changed after review. Review it again.");
	return new GitHubTokenProviderAdapter(accessToken).preflightLibrary(shared, signal);
}

export async function checkGitHubConnection(accessToken: string, signal?: AbortSignal): Promise<{ account: string }> {
	return new GitHubTokenProviderAdapter(accessToken).checkConnection(signal);
}

/** Explicit, token-backed repository picker. The renderer never receives the token. */
export async function listGitHubSyncRepositories(accessToken: string, signal?: AbortSignal): Promise<RemoteConnection[]> {
	return new GitHubTokenProviderAdapter(accessToken).listLibraries(signal);
}
