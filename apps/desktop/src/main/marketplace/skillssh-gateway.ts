import { fetchTimeoutSignal } from './fetch-signal'

type GatewayFile = { path: string; contents: string }
type GatewaySnapshot = { files: GatewayFile[] }
const DEFAULT_MARKETPLACE_GATEWAY_URL = 'https://skiller-marketplace-proxy.vercel.app'

function configuredGatewayBaseUrl(): string {
  const value = process.env.SKILLER_MARKETPLACE_PROXY_URL?.trim() || DEFAULT_MARKETPLACE_GATEWAY_URL
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
      throw new Error('Marketplace gateway must use HTTPS')
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    throw new Error('Marketplace gateway URL is invalid')
  }
}

function skillIdentifier(repoUrl: string, skillPath?: string | null, skillName?: string | null, catalogId?: string | null): string | null {
  const explicitId = catalogId?.trim().split('/').filter(Boolean)
  if (explicitId?.length && explicitId.length <= 3 && explicitId.every((segment) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(segment))) {
    return explicitId.map(encodeURIComponent).join('/')
  }
  try {
    const repository = new URL(repoUrl)
    if (repository.protocol !== 'https:') return null
    const source = repository.hostname === 'github.com'
      ? repository.pathname.replace(/\.git$/, '').split('/').filter(Boolean)
      : [repository.hostname]
    if (source.length === 0 || source.length > 2) return null
    const pathSegments = (skillPath ?? '').split('/').filter(Boolean)
    const id = pathSegments[0] === 'skills' ? pathSegments[pathSegments.length - 1] : skillName
    if (!id) return null
    const segments = [...source, id]
    if (segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(segment))) return null
    return segments.map(encodeURIComponent).join('/')
  } catch {
    return null
  }
}

/**
 * Uses the Skiller-owned gateway. The desktop never receives a skills.sh
 * credential; Vercel injects it server-side.
 */
export async function fetchSkillsShGatewaySnapshot(
  repoUrl: string,
  skillPath?: string | null,
  skillName?: string | null,
  catalogId?: string | null,
): Promise<GatewaySnapshot | null> {
  const baseUrl = configuredGatewayBaseUrl()
  const identifier = skillIdentifier(repoUrl, skillPath, skillName, catalogId)
  if (!identifier) return null
  try {
    const response = await fetch(`${baseUrl}/api/v1/skills/${identifier}`, {
      headers: { Accept: 'application/json' },
      signal: fetchTimeoutSignal(15_000),
    })
    if (!response.ok) return null
    const value = await response.json() as Partial<GatewaySnapshot>
    if (!Array.isArray(value.files) || value.files.some((file) => typeof file?.path !== 'string' || typeof file?.contents !== 'string')) return null
    return { files: value.files }
  } catch {
    return null
  }
}

export function fileFromGatewaySnapshot(snapshot: GatewaySnapshot, requestedFile?: string | null): string | null {
  const requested = requestedFile?.replace(/^\/+/, '') || 'SKILL.md'
  const match = snapshot.files.find((file) => file.path === requested)
    ?? snapshot.files.find((file) => file.path.endsWith(`/${requested}`))
    ?? (requested === 'SKILL.md' ? snapshot.files.find((file) => /(^|\/)SKILL\.md$/i.test(file.path)) : undefined)
  return match?.contents ?? null
}

export function filesFromGatewaySnapshot(snapshot: GatewaySnapshot): string[] {
  return snapshot.files
    .map((file) => file.path.replace(/^.*?skills\/[^/]+\//, ''))
    .filter((path) => path && !path.split('/').some((part) => part === '.git' || part === 'node_modules'))
    .sort((a, b) => a === 'SKILL.md' ? -1 : b === 'SKILL.md' ? 1 : a.localeCompare(b))
    .slice(0, 128)
}
