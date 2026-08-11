import type { MarketplaceProblem, MarketplaceSkillSnapshot } from '@skiller/marketplace-contracts'

const SKILLS_API_BASE = 'https://skills.sh/api/v1/skills'
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const CDN_CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=604800'

export interface ProxyEnvironment {
  oidcToken?: string
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}

function json(body: MarketplaceProblem, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}

export function normalizeSkillIdentifier(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length < 2 || parts.length > 3) return null
  if (parts.some((part) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(part))) return null
  return parts.join('/')
}

function responseWithCache(body: MarketplaceSkillSnapshot): Response {
  return Response.json(body, {
    headers: {
      'Cache-Control': CDN_CACHE_CONTROL,
      'Vercel-CDN-Cache-Control': CDN_CACHE_CONTROL,
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

export async function proxySkillsShSnapshot(
  identifier: string,
  environment: ProxyEnvironment,
): Promise<Response> {
  const normalized = normalizeSkillIdentifier(identifier)
  if (!normalized) {
    return json({ error: 'A skill identifier must have two or three safe path segments.', code: 'invalid_skill_identifier' }, 400)
  }

  const oidcToken = environment.oidcToken
  if (!oidcToken) {
    return json({ error: 'Marketplace authentication is unavailable. Retry from the deployed gateway.', code: 'authentication_unavailable' }, 503)
  }

  const upstreamFetch = environment.fetch ?? fetch
  let upstream: Response
  try {
    upstream = await upstreamFetch(`${SKILLS_API_BASE}/${normalized}`, {
      headers: { Authorization: `Bearer ${oidcToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    return json({ error: 'skills.sh is temporarily unavailable. Please try again shortly.', code: 'upstream_unavailable' }, 502)
  }

  if (!upstream.ok) {
    return json({ error: 'skills.sh could not provide this skill right now.', code: 'upstream_unavailable' }, 502)
  }

  const length = Number(upstream.headers.get('content-length') ?? 0)
  if (length > MAX_RESPONSE_BYTES) {
    return json({ error: 'This skill is too large for a safe marketplace preview.', code: 'response_too_large' }, 413)
  }

  const raw = await upstream.text()
  if (new TextEncoder().encode(raw).byteLength > MAX_RESPONSE_BYTES) {
    return json({ error: 'This skill is too large for a safe marketplace preview.', code: 'response_too_large' }, 413)
  }

  let snapshot: MarketplaceSkillSnapshot
  try {
    snapshot = JSON.parse(raw) as MarketplaceSkillSnapshot
  } catch {
    return json({ error: 'skills.sh returned an invalid skill response.', code: 'upstream_response_invalid' }, 502)
  }

  if (!Array.isArray(snapshot.files) || snapshot.files.some((file) => typeof file.path !== 'string' || typeof file.contents !== 'string')) {
    return json({ error: 'skills.sh returned an incomplete skill response.', code: 'upstream_response_invalid' }, 502)
  }

  return responseWithCache(snapshot)
}
