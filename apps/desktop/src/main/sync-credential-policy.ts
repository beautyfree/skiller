/**
 * A Keychain read is observable user-facing work on macOS. Background checks
 * must therefore never read a provider token; only an action the person chose
 * in the UI may do that.
 */
export type ProviderCredentialAccess = 'background' | 'user-action'

export function mayReadProviderCredentials(access: ProviderCredentialAccess): boolean {
  return access === 'user-action'
}
