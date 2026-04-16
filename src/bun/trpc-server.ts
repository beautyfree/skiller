import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import type { AnyRouter } from '@trpc/server'

/** If preferred port is busy, try the next ports (stale process / second instance). */
const TRPC_PORT_TRY_MAX = 48

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'content-type, trpc-accept, x-trpc-source, authorization',
}

export function startTrpcHttpServer(
  router: AnyRouter,
  preferredPort: number,
): { server: ReturnType<typeof Bun.serve>; port: number } {
  const maxPort = Math.min(preferredPort + TRPC_PORT_TRY_MAX, 65535)
  let lastErr: unknown

  for (let port = preferredPort; port <= maxPort; port++) {
    try {
      const server = Bun.serve({
        port,
        hostname: '127.0.0.1',
        fetch(req) {
          if (req.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders })
          }
          return fetchRequestHandler({
            endpoint: '/trpc',
            req,
            router,
            createContext: () => ({}),
          }).then((res) => {
            const headers = new Headers(res.headers)
            for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v)
            return new Response(res.body, {
              status: res.status,
              statusText: res.statusText,
              headers,
            })
          })
        },
      })
      const bound = server.port ?? port
      if (bound !== preferredPort) {
        console.warn(
          `[tRPC] Port ${preferredPort} in use; bound to ${bound}. Webview gets the URL via executeJavascript (not views:// ?/#).`,
        )
      }
      return { server, port: bound }
    } catch (err) {
      lastErr = err
      const code = (err as { code?: string })?.code
      if (code !== 'EADDRINUSE') {
        throw err
      }
    }
  }

  throw lastErr ?? new Error('Failed to bind tRPC HTTP server')
}
