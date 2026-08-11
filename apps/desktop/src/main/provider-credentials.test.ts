import { expect, test } from 'bun:test'
import { githubGitEnvironment, gitlabGitEnvironment } from './provider-credentials'

test('passes a GitHub OAuth credential only as an ephemeral Git HTTP header', () => {
  const environment = githubGitEnvironment('example-token')
  expect(environment.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader')
  expect(environment.GIT_CONFIG_VALUE_0).toMatch(/^Authorization: Basic /)
  expect(environment.GIT_CONFIG_VALUE_0).not.toContain('example-token')
  expect(Object.keys(environment).some((name) => /token|password/i.test(name))).toBe(false)
})

test('passes a GitLab OAuth credential only as an ephemeral Git HTTP header', () => {
  const environment = gitlabGitEnvironment('example-token')
  expect(environment.GIT_CONFIG_KEY_0).toBe('http.https://gitlab.com/.extraheader')
  expect(environment.GIT_CONFIG_VALUE_0).toMatch(/^Authorization: Basic /)
  expect(environment.GIT_CONFIG_VALUE_0).not.toContain('example-token')
  expect(Object.keys(environment).some((name) => /token|password/i.test(name))).toBe(false)
})
