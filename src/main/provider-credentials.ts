import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { KeyringProviderTokenStore, providerGitEnvironment } from 'dotagents'
import { appDataRootPath } from './settings'

type Provider = 'github' | 'gitlab'
type LegacyCredentialFile = Partial<Record<Provider, string>>

const tokenStore = new KeyringProviderTokenStore()

// Kept strictly for a one-time migration from the early Electron-only
// implementation. New connections never write this file: dotagents and
// Skiller share the operating-system credential vault instead.
function legacyCredentialPath() {
  return join(appDataRootPath(), 'provider-credentials.json')
}

async function legacyToken(provider: Provider): Promise<string | null> {
  const path = legacyCredentialPath()
  if (!existsSync(path)) return null
  let encrypted: string | undefined
  try {
    encrypted = (JSON.parse(readFileSync(path, 'utf8')) as LegacyCredentialFile)[provider]
  } catch {
    return null
  }
  if (!encrypted) return null
  const { safeStorage } = await import('electron')
  if (!safeStorage.isEncryptionAvailable()) return null
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
}

function removeLegacyToken(provider: Provider): void {
  const path = legacyCredentialPath()
  if (!existsSync(path)) return
  try {
    const credentials = JSON.parse(readFileSync(path, 'utf8')) as LegacyCredentialFile
    delete credentials[provider]
    if (Object.values(credentials).some(Boolean)) {
      writeFileSync(path, JSON.stringify(credentials), { mode: 0o600 })
    } else {
      rmSync(path, { force: true })
    }
  } catch {
    // A malformed retired file is neither a provider connection nor a reason
    // to fail an otherwise healthy Keychain-backed session.
  }
}

/**
 * Resolve a provider token from the same OS vault used by `dotagents setup`
 * and `dotagents sync`. The legacy Electron value, if present, is migrated
 * once and then removed so there is a single source of truth.
 */
export async function readProviderToken(provider: Provider): Promise<string | null> {
  const saved = await tokenStore.get(provider, 'default')
  if (saved) return saved
  const migrated = await legacyToken(provider)
  if (!migrated) return null
  await tokenStore.set(provider, 'default', migrated)
  removeLegacyToken(provider)
  return migrated
}

/** Save only in the shared system credential vault; never in a profile or remote. */
export async function writeProviderToken(provider: Provider, token: string): Promise<void> {
  await tokenStore.set(provider, 'default', token)
  removeLegacyToken(provider)
}

/**
 * One-operation HTTPS credential. The token reaches Git only as a child
 * process header; remotes and Git configuration stay credential-free.
 */
export function githubGitEnvironment(accessToken: string): NodeJS.ProcessEnv {
  return { GIT_TERMINAL_PROMPT: '0', ...providerGitEnvironment('github', accessToken) }
}

/** Equivalent ephemeral transport for GitLab OAuth. */
export function gitlabGitEnvironment(accessToken: string): NodeJS.ProcessEnv {
  return { GIT_TERMINAL_PROMPT: '0', ...providerGitEnvironment('gitlab', accessToken) }
}
