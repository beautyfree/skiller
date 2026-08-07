import { describe, expect, test } from 'bun:test'
import { withReviewTimeout } from './review-timeout'

describe('withReviewTimeout', () => {
  test('returns a completed review unchanged', async () => {
    await expect(withReviewTimeout(Promise.resolve('verified'), 'https://example.com/repo.git', 5)).resolves.toBe('verified')
  })

  test('bounds an unavailable source', async () => {
    await expect(withReviewTimeout(new Promise<never>(() => {}), 'https://example.com/repo.git', 1)).rejects.toThrow('Timed out while reviewing https://example.com/repo.git')
  })
})
