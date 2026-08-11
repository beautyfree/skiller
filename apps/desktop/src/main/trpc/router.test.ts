import { expect, test } from 'bun:test'
import { redactTrpcErrorData } from './error-data'

test('tRPC error data keeps the loopback renderer boundary free of stack details', () => {
  const result = redactTrpcErrorData({
    code: 'INTERNAL_SERVER_ERROR',
    httpStatus: 500,
    path: 'skill_quality_reveal_folder',
    stack: '/Users/example/private/worktree/src/main/rpc-handlers.ts:1',
    zodError: { secret: 'must-not-cross-the-boundary' },
  } as unknown as { code: string; httpStatus: number; path: string })

  expect(result).toEqual({
    code: 'INTERNAL_SERVER_ERROR',
    httpStatus: 500,
    path: 'skill_quality_reveal_folder',
  })
  expect(JSON.stringify(result)).not.toContain('/Users/example')
  expect(JSON.stringify(result)).not.toContain('must-not-cross-the-boundary')
})
