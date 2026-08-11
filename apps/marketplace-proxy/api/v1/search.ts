import { proxySkillsShCatalog } from '../../src/catalog-proxy.js'

export default {
  async fetch(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url)
    const query = requestUrl.searchParams.get('q')?.trim() ?? ''
    if (!query || query.length > 120) {
      return Response.json({ error: 'Search text must be between 1 and 120 characters.', code: 'invalid_skill_identifier' }, { status: 400 })
    }
    const upstream = new URL('https://skills.sh/api/v1/skills/search')
    upstream.searchParams.set('q', query)
    upstream.searchParams.set('limit', '50')
    return proxySkillsShCatalog(upstream, request.headers.get('x-vercel-oidc-token') ?? process.env.VERCEL_OIDC_TOKEN)
  },
}
