import { proxySkillsShCatalog } from '../../src/catalog-proxy'

export default async function handler(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url)
  const sort = requestUrl.searchParams.get('sort') ?? 'newest'
  const page = Number(requestUrl.searchParams.get('page') ?? '1')
  if (!['newest', 'trending', 'hot'].includes(sort) || !Number.isInteger(page) || page < 1 || page > 100) {
    return Response.json({ error: 'Invalid leaderboard request.', code: 'invalid_skill_identifier' }, { status: 400 })
  }
  const upstream = new URL('https://skills.sh/api/v1/skills')
  upstream.searchParams.set('view', sort === 'newest' ? 'all-time' : sort)
  upstream.searchParams.set('page', String(page - 1))
  upstream.searchParams.set('per_page', '50')
  return proxySkillsShCatalog(upstream, request.headers.get('x-vercel-oidc-token') ?? process.env.VERCEL_OIDC_TOKEN)
}
