import { expect, test } from 'bun:test'
import { initTRPC } from '@trpc/server'
import { startTrpcHttpServer } from './trpc-server'

test('loopback tRPC rejects requests without its per-process capability token', async () => {
  let calls = 0
  const t = initTRPC.create()
  const router = t.router({
    ping: t.procedure.query(() => {
      calls += 1
      return { ok: true }
    }),
  })
  const server = await startTrpcHttpServer(router, 0)
  try {
    const url = `http://127.0.0.1:${server.port}/trpc/ping`
    const anonymous = await fetch(url)
    expect(anonymous.status).toBe(401)
    expect(await anonymous.json()).toEqual({
      error: { message: 'Skiller local service authentication failed.' },
    })
    expect(calls).toBe(0)

    const accepted = await fetch(url, {
      headers: { 'X-Skiller-Rpc-Token': server.authToken },
    })
    expect(accepted.status).toBe(200)
    expect(calls).toBe(1)
  } finally {
    server.close()
  }
})
