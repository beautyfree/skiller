import type { VercelRequest, VercelResponse } from '@vercel/node'

export function getRequestUrl(request: VercelRequest): URL {
  const host = request.headers.host ?? 'localhost'
  return new URL(request.url ?? '/', `https://${host}`)
}

export function getRequestHeader(request: VercelRequest, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

export async function sendResponse(response: Response, result: VercelResponse): Promise<void> {
  for (const [name, value] of response.headers) {
    result.setHeader(name, value)
  }

  result.status(response.status)
  const body = response.body === null ? undefined : Buffer.from(await response.arrayBuffer())
  result.end(body)
}
