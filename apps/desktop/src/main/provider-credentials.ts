import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { providerGitEnvironment } from 'dotagents'
import { appDataRootPath } from './settings'

type Provider = 'github' | 'gitlab'
type EncryptedProviderCredentials = Partial<Record<Provider, string>>

export function providerForRemoteUrl(remoteUrl: string | null | undefined): Provider | null {
  if (!remoteUrl) return null
  try {
    const host = new URL(remoteUrl).hostname.toLowerCase()
    return host === 'github.com' ? 'github' : host === 'gitlab.com' ? 'gitlab' : null
  } catch {
    const host = remoteUrl.match(/^git@(github\.com|gitlab\.com):/i)?.[1]?.toLowerCase()
    return host === 'github.com' ? 'github' : host === 'gitlab.com' ? 'gitlab' : null
  }
}

function encryptedCredentialPath(): string {
  return join(appDataRootPath(), 'secure-provider-credentials.json')
}

function retiredCredentialPath(): string {
  return join(appDataRootPath(), 'provider-credentials.json')
}

function readEncryptedCredentials(): EncryptedProviderCredentials {
  const path = encryptedCredentialPath()
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as EncryptedProviderCredentials
  } catch {
    // Treat a corrupted credential cache as an absent connection. No secret is
    // surfaced and the person can explicitly connect again.
    return {}
  }
}

async function secureStorage() {
  const { safeStorage } = await import('electron')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Skiller secure storage is unavailable. Unlock the system credential vault and try again.')
  }
  return safeStorage
}

function writeEncryptedCredentials(credentials: EncryptedProviderCredentials): void {
  const path = encryptedCredentialPath()
  mkdirSync(appDataRootPath(), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.tmp`
  writeFileSync(temporaryPath, JSON.stringify(credentials), { encoding: 'utf8', mode: 0o600 })
  renameSync(temporaryPath, path)
}

function removeRetiredCredentialStore(): void {
  // This was Skiller's pre-v0.3 encrypted-token format. It is deliberately
  // never read; removing it after a successful new sign-in avoids retaining a
  // duplicate usable credential on disk.
  try {
    rmSync(retiredCredentialPath(), { force: true })
  } catch {
    // The new credential remains valid even if an old protected file cannot
    // be removed on this machine.
  }
}

/**
 * Provider tokens are Skiller-owned encrypted application data. Electron
 * `safeStorage` keeps its encryption material in the operating system vault
 * (on macOS, one "Skiller Safe Storage" Keychain item), while the encrypted
 * token values live in Skiller's private app-data file.
 *
 * We intentionally do not read or write `dotagents:*` Keychain records. This
 * prevents background Skiller work from touching a shared credential item and
 * gives the app a stable, VS Code-like credential boundary.
 */
export async function readProviderToken(provider: Provider): Promise<string | null> {
  const encrypted = readEncryptedCredentials()[provider]
  if (!encrypted) return null
  try {
    return (await secureStorage()).decryptString(Buffer.from(encrypted, 'base64'))
  } catch {
    // A token encrypted by another macOS user or a reset Keychain cannot be
    // recovered safely. Treat it as disconnected rather than exposing a low-
    // level decryption failure in normal provider flows.
    return null
  }
}

/** Safe for background status rendering: it reads only encrypted file metadata,
 * never Electron safeStorage or macOS Keychain. */
export function hasStoredProviderToken(provider: Provider): boolean {
  return Boolean(readEncryptedCredentials()[provider])
}

/** Save a provider token only in Skiller's encrypted application store. */
export async function writeProviderToken(provider: Provider, token: string): Promise<void> {
  const storage = await secureStorage()
  const credentials = readEncryptedCredentials()
  credentials[provider] = storage.encryptString(token).toString('base64')
  writeEncryptedCredentials(credentials)
  removeRetiredCredentialStore()
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
