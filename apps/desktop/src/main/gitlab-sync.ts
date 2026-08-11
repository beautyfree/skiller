import { GitLabTokenProviderAdapter, planProviderLibraryCreation, type GitLabProjectPreflight, type RemoteConnection } from "dotagents";

/** Public Device Flow client id. GitLab native clients do not use a secret. */
export const GITLAB_DEVICE_FLOW_CLIENT_ID = '9dee80d3aa4a816814c1153a11fbd2dac53b3f1a80b6e16f09d43424e418f1a9'

export type GitLabSyncProjectPlan = {
  kind: 'skiller-gitlab-project'
  schemaVersion: 1
  planId: string
  project: string
  visibility: 'private' | 'public'
}

/** Shared dotagents validation for a project or nested group project. */
export function assertGitLabProjectPath(value: string): string {
  return planProviderLibraryCreation('gitlab', value).name
}

/** Keeps Skiller's renderer contract while sharing the provider creation plan. */
export function planGitLabSyncProject(
  project: string,
  visibility: 'private' | 'public',
): GitLabSyncProjectPlan {
  const shared = planProviderLibraryCreation('gitlab', project, visibility)
  return {
    kind: 'skiller-gitlab-project',
    schemaVersion: 1,
    planId: shared.planId,
    project: shared.name,
    visibility: shared.visibility,
  }
}

/**
 * Creates the reviewed project through GitLab's API without relying on `glab`.
 */
export async function createGitLabSyncProject(plan: GitLabSyncProjectPlan, accessToken: string, signal?: AbortSignal): Promise<string> {
  const shared = planProviderLibraryCreation('gitlab', plan.project, plan.visibility)
  if (shared.planId !== plan.planId)
    throw new Error('GitLab project name or visibility changed after review. Review it again.')
  return (await new GitLabTokenProviderAdapter(accessToken).createLibrary(shared, signal)).remote
}

export async function preflightGitLabSyncProject(plan: GitLabSyncProjectPlan, accessToken: string, signal?: AbortSignal): Promise<GitLabProjectPreflight> {
  const shared = planProviderLibraryCreation('gitlab', plan.project, plan.visibility)
  if (shared.planId !== plan.planId)
    throw new Error('GitLab project name or visibility changed after review.')
  return new GitLabTokenProviderAdapter(accessToken).preflightLibrary(shared, signal)
}

export async function checkGitLabConnection(accessToken: string, signal?: AbortSignal): Promise<{ account: string }> {
  return new GitLabTokenProviderAdapter(accessToken).checkConnection(signal)
}

/** Explicit, token-backed project picker. The renderer never receives the token. */
export async function listGitLabSyncProjects(
  accessToken: string,
  signal?: AbortSignal,
  client: Pick<GitLabTokenProviderAdapter, 'listLibraries'> = new GitLabTokenProviderAdapter(accessToken),
): Promise<RemoteConnection[]> {
  return client.listLibraries(signal)
}
