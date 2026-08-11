import { describe, expect, test } from 'bun:test'
import { parseElectronTrpcEndpoint, readableTrpcError } from './native'

describe('renderer tRPC errors', () => {
  test('shows only the server message and drops stack and transport metadata', () => {
    const message = readableTrpcError('sync_center_publish', {
      error: {
        message: 'Connect or authenticate, then retry.\n at file:///Users/private/work/out/main/index.js:10:2',
        code: -32603,
        data: { stack: 'private stack' },
      },
    }, 500)
    expect(message).toBe('Connect or authenticate, then retry.')
    expect(message).not.toContain('/Users/private')
    expect(message).not.toContain('-32603')
  })

  test('uses a concise fallback for an invalid error response', () => {
    expect(readableTrpcError('resource_apply', {}, 503)).toBe('resource apply failed (HTTP 503)')
  })
})

describe('Electron tRPC endpoint handshake', () => {
  test('accepts only the exact loopback endpoint returned by this main process', () => {
    expect(parseElectronTrpcEndpoint({
      baseUrl: 'http://127.0.0.1:17889',
      token: 'a'.repeat(43),
    })).toEqual({ baseUrl: 'http://127.0.0.1:17889', token: 'a'.repeat(43) })
  })

  test.each([
    undefined,
    { baseUrl: 'http://localhost:17889', token: 'a'.repeat(43) },
    { baseUrl: 'https://127.0.0.1:17889', token: 'a'.repeat(43) },
    { baseUrl: 'http://127.0.0.1:17889/trpc', token: 'a'.repeat(43) },
    { baseUrl: 'http://user:secret@127.0.0.1:17889', token: 'a'.repeat(43) },
    { baseUrl: 'http://127.0.0.1:17889' },
    { baseUrl: 'http://127.0.0.1:17889', token: 'too-short' },
  ])('rejects an endpoint that could route RPC outside the owned local server', (payload) => {
    expect(() => parseElectronTrpcEndpoint(payload)).toThrow(
      'Skiller could not connect to its local service.',
    )
  })
})
