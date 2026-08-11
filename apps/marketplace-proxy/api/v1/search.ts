import { proxySkillsShCatalog } from '../../src/catalog-proxy.js'
import { getRequestHeader, getRequestUrl, sendResponse } from '../../src/vercel-handler.js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  const requestUrl = getRequestUrl(request)
  const query = requestUrl.searchParams.get('q')?.trim() ?? ''
  if (!query || query.length > 120) {
    response.status(400).json({ error: 'Search text must be between 1 and 120 characters.', code: 'invalid_skill_identifier' })
    return
  }
  const upstream = new URL('https://skills.sh/api/v1/skills/search')
  upstream.searchParams.set('q', query)
  upstream.searchParams.set('limit', '50')
  await sendResponse(
    await proxySkillsShCatalog(upstream, getRequestHeader(request, 'x-vercel-oidc-token') ?? process.env.VERCEL_OIDC_TOKEN),
    response,
  )
}
