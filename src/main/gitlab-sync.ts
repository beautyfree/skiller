import { createProviderAdapter, planProviderLibraryCreation, type RemoteConnection, type RemoteProviderAdapter } from "dotagents";

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
 * Delegates sign-in and creation to the shared provider adapter. Skiller never
 * receives or persists the GitLab token, and `--skipGitInit` prevents a CLI
 * side effect in Skiller's own working directory.
 */
export async function createGitLabSyncProject(plan: GitLabSyncProjectPlan): Promise<string> {
  const shared = planProviderLibraryCreation('gitlab', plan.project, plan.visibility)
  if (shared.planId !== plan.planId)
    throw new Error('GitLab project name or visibility changed after review. Review it again.')
  return (await createProviderAdapter('gitlab').createLibrary(shared)).remote
}

/** See the explicit GitLab chooser action in Sync Center. No token enters Skiller. */
export async function listGitLabSyncProjects(
  adapter: Pick<RemoteProviderAdapter, 'listLibraries'> = createProviderAdapter('gitlab'),
): Promise<RemoteConnection[]> {
  return adapter.listLibraries()
}
