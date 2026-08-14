import { parse } from 'yaml'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
// A skill's SKILL.md can be small while its supporting examples make the
// snapshot larger. Keep the same ceiling as catalog forwarding so descriptions
// remain available without permitting unbounded responses.
const MAX_SKILL_RESPONSE_BYTES = MAX_RESPONSE_BYTES
// A catalog page has 50 rows. Keep this below the upstream's 600/minute
// budget, but high enough that a cold CDN page does not serialize descriptions
// into several seconds of renderer-side loading.
const SUMMARY_CONCURRENCY = 24
const SUMMARY_ATTEMPTS = 3
const CDN_CACHE_CONTROL = 'public, s-maxage=900, stale-while-revalidate=86400'

function unavailable(): Response {
  return Response.json(
    { error: 'Marketplace source is temporarily unavailable. Please try again shortly.', code: 'upstream_unavailable' },
    { status: 502, headers: { 'Cache-Control': 'no-store' } },
  )
}

function compactSummary(markdown: string): string | null {
  const normalized = markdown.replace(/\r\n/g, '\n')
  const frontmatter = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  let described: string | null = null
  if (frontmatter) {
    try {
      const parsed = parse(frontmatter[1])
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.description === 'string') {
        described = parsed.description
      }
    } catch {
      // Continue with the Markdown body when a third-party frontmatter block
      // is malformed; a catalog row must not fail because of its summary.
    }
  }
  const body = normalized.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '')
  const paragraph = body
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#{1,6}\s+.*$/gm, '').replace(/^>\s?/gm, '').trim())
    .find(Boolean)
  const summary = (described ?? paragraph)?.replace(/\s+/g, ' ').trim()
  return summary ? summary.slice(0, 220) : null
}

function fallbackSummary(item: Record<string, unknown>): string {
  const source = typeof item.source === 'string' && item.source.trim() ? item.source.trim() : null
  return source ? `An agent skill published by ${source}.` : 'An agent skill from the skills.sh catalog.'
}

async function readSummary(
  identifier: string,
  oidcToken: string,
  upstreamFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): Promise<string | null> {
  for (let attempt = 0; attempt < SUMMARY_ATTEMPTS; attempt += 1) {
    try {
      const response = await upstreamFetch(`https://skills.sh/api/v1/skills/${identifier}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${oidcToken}` },
        signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok || Number(response.headers.get('content-length') ?? 0) > MAX_SKILL_RESPONSE_BYTES) continue
      const raw = await response.text()
      if (new TextEncoder().encode(raw).byteLength > MAX_SKILL_RESPONSE_BYTES) return null
      const value = JSON.parse(raw) as { files?: Array<{ path?: unknown; contents?: unknown }> }
      const skillMd = value.files?.find((file) => typeof file.path === 'string' && /(^|\/)SKILL\.md$/i.test(file.path) && typeof file.contents === 'string')
      const summary = typeof skillMd?.contents === 'string' ? compactSummary(skillMd.contents) : null
      if (summary) return summary
      // A valid snapshot without a useful summary cannot improve on retry.
      return null
    } catch {
      // Retry a transient upstream timeout once. Individual failures should not
      // turn an otherwise useful catalog response into an error page.
    }
  }
  return null
}

async function enrichCatalogSummaries(
  body: string,
  oidcToken: string,
  upstreamFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): Promise<string> {
  let value: { data?: Array<Record<string, unknown>> }
  try {
    value = JSON.parse(body) as { data?: Array<Record<string, unknown>> }
  } catch {
    return body
  }
  if (!Array.isArray(value.data) || value.data.length === 0) return body
  const enriched = [...value.data]
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(SUMMARY_CONCURRENCY, enriched.length) }, async () => {
    while (cursor < enriched.length) {
      const index = cursor++
      const item = enriched[index]
      const identifier = typeof item?.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{1,383}$/.test(item.id) ? item.id : null
      const description = identifier ? await readSummary(identifier, oidcToken, upstreamFetch) : null
      // The upstream's catalog intentionally has no summary field. A temporary
      // snapshot failure should therefore degrade to a truthful source label,
      // never an empty row or an invented claim about the skill's purpose.
      enriched[index] = { ...item, description: description ?? fallbackSummary(item) }
    }
  }))
  return JSON.stringify({ ...value, data: enriched })
}

/**
 * Cached forwarding for skills.sh catalog requests. All API calls are
 * authenticated server-side: desktop clients never possess Vercel OIDC tokens.
 */
export async function proxySkillsShCatalog(
  url: URL,
  oidcToken?: string,
  upstreamFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch,
): Promise<Response> {
  if (!oidcToken) {
    return Response.json(
      { error: 'Marketplace authentication is unavailable. Retry from the deployed gateway.', code: 'authentication_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  let upstream: Response
  try {
    upstream = await upstreamFetch(url, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${oidcToken}` },
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    return unavailable()
  }
  if (!upstream.ok) return unavailable()
  const contentLength = Number(upstream.headers.get('content-length') ?? 0)
  if (contentLength > MAX_RESPONSE_BYTES) return unavailable()
  const rawBody = await upstream.text()
  if (new TextEncoder().encode(rawBody).byteLength > MAX_RESPONSE_BYTES) return unavailable()
  const body = await enrichCatalogSummaries(rawBody, oidcToken, upstreamFetch)
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': CDN_CACHE_CONTROL,
      'Vercel-CDN-Cache-Control': CDN_CACHE_CONTROL,
    },
  })
}
