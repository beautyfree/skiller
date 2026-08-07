import { createProviderAdapter, planProviderLibraryCreation, type RemoteConnection, type RemoteProviderAdapter } from "dotagents";

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

/**
 * Uses the user's existing GitHub CLI session. Skiller never reads or stores a
 * token; the shared core creates only the reviewed private/public repository.
 */
export async function createGitHubSyncRepository(plan: GitHubSyncRepositoryPlan): Promise<string> {
	const shared = planProviderLibraryCreation("github", plan.repository, plan.visibility);
	if (shared.planId !== plan.planId)
		throw new Error("GitHub repository name or visibility changed after review. Review it again.");
	return (await createProviderAdapter("github").createLibrary(shared)).remote;
}

/**
 * Reads only repositories writable through the user's existing `gh` session.
 * This stays behind an explicit renderer action; Skiller never asks GitHub in
 * the background and never receives the session token.
 */
export async function listGitHubSyncRepositories(
	adapter: Pick<RemoteProviderAdapter, "listLibraries"> = createProviderAdapter("github"),
): Promise<RemoteConnection[]> {
	return adapter.listLibraries();
}
