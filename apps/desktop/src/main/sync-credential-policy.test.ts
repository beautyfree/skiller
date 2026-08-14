import { expect, test } from 'bun:test'
import { mayReadProviderCredentials } from './sync-credential-policy'

test('background sync checks never read provider credentials', () => {
  expect(mayReadProviderCredentials('background')).toBe(false)
})

test('an explicit user action may read provider credentials', () => {
  expect(mayReadProviderCredentials('user-action')).toBe(true)
})
