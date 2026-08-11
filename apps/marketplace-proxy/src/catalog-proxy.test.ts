import { describe, expect, test } from 'bun:test'
import { proxySkillsShCatalog } from './catalog-proxy'

describe('skills.sh catalog gateway', () => {
  test('uses server-side OIDC and caches the catalog response', async () => {
    let authorization = ''
    const response = await proxySkillsShCatalog(
      new URL('https://skills.sh/api/v1/skills?view=trending'),
      'gateway-token',
      async (_url, init) => {
      authorization = new Headers(init?.headers).get('authorization') ?? ''
      return new Response(JSON.stringify({ data: [] }), { headers: { 'content-type': 'application/json' } })
      },
    )
    expect(authorization).toBe('Bearer gateway-token')
    expect(response.status).toBe(200)
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toContain('s-maxage=900')
  })

  test('refuses catalog forwarding without an OIDC credential', async () => {
    const response = await proxySkillsShCatalog(new URL('https://skills.sh/api/v1/skills'))
    expect(response.status).toBe(503)
  })

  test('returns stable descriptions with the catalog rather than after rows render', async () => {
    const response = await proxySkillsShCatalog(
      new URL('https://skills.sh/api/v1/skills?view=trending'),
      'gateway-token',
      async (url) => {
        if (String(url).endsWith('/vercel-labs/skills/find-skills')) {
          return new Response(JSON.stringify({ files: [{ path: 'SKILL.md', contents: '---\ndescription: Find and install agent skills.\n---\n# Find skills' }] }))
        }
        return new Response(JSON.stringify({ data: [{ id: 'vercel-labs/skills/find-skills', name: 'find-skills' }] }))
      },
    )
    await expect(response.json()).resolves.toEqual({ data: [{ id: 'vercel-labs/skills/find-skills', name: 'find-skills', description: 'Find and install agent skills.' }] })
  })
})
