import { describe, expect, test } from 'bun:test'
import { normalizeSkillIdentifier, proxySkillsShSnapshot } from './skillssh-proxy'

describe('skills.sh marketplace gateway', () => {
  test('accepts only a source plus a skill slug', () => {
    expect(normalizeSkillIdentifier('vercel-labs/skills/find-skills')).toBe('vercel-labs/skills/find-skills')
    expect(normalizeSkillIdentifier('mintlify.com/mintlify')).toBe('mintlify.com/mintlify')
    expect(normalizeSkillIdentifier('../token')).toBeNull()
    expect(normalizeSkillIdentifier('owner/repo/skill/extra')).toBeNull()
  })

  test('keeps upstream authentication inside the gateway and returns cache headers', async () => {
    let authorization = ''
    const response = await proxySkillsShSnapshot('vercel-labs/skills/find-skills', {
      oidcToken: 'server-only-token',
      fetch: async (_url, init) => {
        authorization = new Headers(init?.headers).get('authorization') ?? ''
        return new Response(JSON.stringify({ files: [{ path: 'SKILL.md', contents: '# Find skills' }] }), {
          headers: { 'content-type': 'application/json' },
        })
      },
    })

    expect(authorization).toBe('Bearer server-only-token')
    expect(response.status).toBe(200)
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toContain('s-maxage=86400')
    await expect(response.json()).resolves.toEqual({ files: [{ path: 'SKILL.md', contents: '# Find skills' }] })
  })
})
