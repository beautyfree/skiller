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
    let detailAttempts = 0
    const response = await proxySkillsShCatalog(
      new URL('https://skills.sh/api/v1/skills?view=trending'),
      'gateway-token',
      async (url) => {
        if (String(url).endsWith('/vercel-labs/skills/find-skills')) {
          detailAttempts += 1
          if (detailAttempts === 1) return new Response('temporary failure', { status: 503 })
          return new Response(JSON.stringify({ files: [{ path: 'SKILL.md', contents: '---\ndescription: Find and install agent skills.\n---\n# Find skills' }] }))
        }
        return new Response(JSON.stringify({ data: [{ id: 'vercel-labs/skills/find-skills', name: 'find-skills' }] }))
      },
    )
    await expect(response.json()).resolves.toEqual({ data: [{ id: 'vercel-labs/skills/find-skills', name: 'find-skills', description: 'Find and install agent skills.' }] })
    expect(detailAttempts).toBe(2)
  })

  test('uses an honest source label when a snapshot is temporarily unavailable', async () => {
    const response = await proxySkillsShCatalog(
      new URL('https://skills.sh/api/v1/skills?view=trending'),
      'gateway-token',
      async (url) => String(url).endsWith('/vercel-labs/skills/find-skills')
        ? new Response('temporary failure', { status: 503 })
        : new Response(JSON.stringify({ data: [{ id: 'vercel-labs/skills/find-skills', source: 'vercel-labs/skills' }] })),
    )
    await expect(response.json()).resolves.toEqual({
      data: [{ id: 'vercel-labs/skills/find-skills', source: 'vercel-labs/skills', description: 'An agent skill published by vercel-labs/skills.' }],
    })
  })

  test('parses a multiline YAML frontmatter description', async () => {
    const response = await proxySkillsShCatalog(
      new URL('https://skills.sh/api/v1/skills?view=trending'),
      'gateway-token',
      async (url) => String(url).endsWith('/vercel-labs/skills/find-skills')
        ? new Response(JSON.stringify({ files: [{ path: 'SKILL.md', contents: '---\ndescription: >\n  Find and install agent skills\n  from a curated catalog.\n---\n# Find skills' }] }))
        : new Response(JSON.stringify({ data: [{ id: 'vercel-labs/skills/find-skills', source: 'vercel-labs/skills' }] })),
    )

    await expect(response.json()).resolves.toEqual({
      data: [{ id: 'vercel-labs/skills/find-skills', source: 'vercel-labs/skills', description: 'Find and install agent skills from a curated catalog.' }],
    })
  })

  test('replaces the upstream YAML marker with the parsed multiline description', async () => {
    const response = await proxySkillsShCatalog(
      new URL('https://skills.sh/api/v1/skills?view=trending'),
      'gateway-token',
      async (url) => String(url).endsWith('/hubeiqiao/apple-bento-grid/apple-bento-grid')
        ? new Response(JSON.stringify({ files: [{ path: 'SKILL.md', contents: '---\ndescription: |\n  Create presentation cards.\n  Keep the layout scannable.\n---\n# Apple Bento Grid' }] }))
        : new Response(JSON.stringify({ data: [{ id: 'hubeiqiao/apple-bento-grid/apple-bento-grid', source: 'hubeiqiao/apple-bento-grid', description: '|' }] })),
    )

    await expect(response.json()).resolves.toEqual({
      data: [{ id: 'hubeiqiao/apple-bento-grid/apple-bento-grid', source: 'hubeiqiao/apple-bento-grid', description: 'Create presentation cards. Keep the layout scannable.' }],
    })
  })
})
