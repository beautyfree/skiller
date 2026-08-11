import { describe, expect, it } from 'bun:test'
import { planProviderLibraryCreation } from 'dotagents'
import { assertGitLabProjectPath, createGitLabSyncProject, listGitLabSyncProjects, planGitLabSyncProject } from './gitlab-sync'

describe('GitLab sync setup', () => {
  it('accepts a project or nested group project without accepting a URL or shell syntax', () => {
    expect(assertGitLabProjectPath('skiller-skills')).toBe('skiller-skills')
    expect(assertGitLabProjectPath('team/subgroup/skiller-skills')).toBe('team/subgroup/skiller-skills')
    expect(() => assertGitLabProjectPath('https://gitlab.com/team/repo')).toThrow()
    expect(() => assertGitLabProjectPath('repo; command')).toThrow()
    expect(() => assertGitLabProjectPath('team/../other-project')).toThrow()
    expect(() => assertGitLabProjectPath('./project')).toThrow()
  })

  it('binds the exact reviewed project and visibility to the creation plan', () => {
    const first = planGitLabSyncProject(' team/skills ', 'private')
    expect(first).toEqual(planGitLabSyncProject('team/skills', 'private'))
    expect(first.planId).toMatch(/^[a-f0-9]{64}$/)
    expect(planGitLabSyncProject('team/skills', 'public').planId).not.toBe(first.planId)
  })

  it('uses the same provider-neutral reviewed plan as the CLI', () => {
    const plan = planGitLabSyncProject('team/skills', 'private')
    expect(plan.planId).toBe(planProviderLibraryCreation('gitlab', 'team/skills', 'private').planId)
  })

it('rejects a changed project plan before invoking GitLab', async () => {
    const plan = planGitLabSyncProject('team/skills', 'private')
    await expect(createGitLabSyncProject({ ...plan, visibility: 'public' })).rejects.toThrow('changed after review')
  })
})

it('lists existing writable GitLab projects only after the explicit chooser action', async () => {
  const projects = await listGitLabSyncProjects('test-token', undefined, {
    listLibraries: async () => [
      { provider: 'gitlab', label: 'team/agent-library', remote: 'git@gitlab.com:team/agent-library.git' },
    ],
  })
  expect(projects).toEqual([
    { provider: 'gitlab', label: 'team/agent-library', remote: 'git@gitlab.com:team/agent-library.git' },
  ])
})
