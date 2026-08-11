const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const CDN_CACHE_CONTROL = 'public, s-maxage=900, stale-while-revalidate=86400'

function unavailable(): Response {
  return Response.json(
    { error: 'Marketplace source is temporarily unavailable. Please try again shortly.', code: 'upstream_unavailable' },
    { status: 502, headers: { 'Cache-Control': 'no-store' } },
  )
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
  const body = await upstream.text()
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) return unavailable()
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': CDN_CACHE_CONTROL,
      'Vercel-CDN-Cache-Control': CDN_CACHE_CONTROL,
    },
  })
}
