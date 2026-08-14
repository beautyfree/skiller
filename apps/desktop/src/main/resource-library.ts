import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { parsePortableConfig } from 'dotagents/config'
import { doctorLibrary } from 'dotagents/doctor'
import { applyDoctorRepair, planDoctorRepair, type DoctorRepairPlan } from 'dotagents/repair'
import { parseLibraryLock, parseLibraryManifest } from 'dotagents/library'
import { extractSkillMarkdownBody, skillMarkdownDescription } from '../shared/skill-markdown'
import type {
  DotagentsLibraryHealthJson,
  DotagentsLibraryRepairPreviewJson,
  DotagentsResourceOverviewJson,
  DotagentsResourceContentJson,
} from '../shared/rpc-schema'

const TOKEN_TTL_MS = 15 * 60_000
const PREVIEWABLE_RESOURCE_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.json', '.yaml', '.yml', '.toml', '.js', '.ts', '.tsx', '.jsx', '.sh', '.py', '.css', '.html'])
const PREVIEWABLE_IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
}
const IMAGE_PREVIEW_BYTES = 4 * 1024 * 1024

type RepairPlanned = { plan: DoctorRepairPlan; profileId: string; workspace: string; createdAt: number }

function compactSourceName(source: string): string {
  try {
    const url = new URL(source)
    const segments = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/').filter(Boolean)
    return [url.hostname, ...segments.slice(0, 2)].join('/') || url.hostname
  } catch {
    // SSH remotes are valid portable origins too. Keep the label bounded and
    // presentation-only; config parsing has already rejected credentials.
    return source.replace(/^git@/, '').replace(/:/, '/').replace(/\.git$/i, '').slice(0, 96)
  }
}

function sourceUrl(source: string): string | null {
  try {
    const url = new URL(source)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString().replace(/\.git$/i, '') : null
  } catch {
    const match = source.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i)
    return match ? `https://github.com/${match[1]}` : null
  }
}

function resourceSummary(workspace: string, resourcePath: string): string | undefined {
  try {
    const candidate = resolve(workspace, resourcePath)
    if (!isWithin(workspace, candidate)) return undefined
    const candidateMetadata = lstatSync(candidate)
    if (candidateMetadata.isSymbolicLink()) return undefined
    const source = candidateMetadata.isDirectory() ? join(candidate, 'SKILL.md') : candidate
    const metadata = lstatSync(source)
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > 64 * 1024) return undefined
    const text = readFileSync(source, 'utf8').replace(/\r\n/g, '\n')
    const described = skillMarkdownDescription(text)
    const body = extractSkillMarkdownBody(text)
    const paragraph = body.split(/\n\s*\n/).map((part) => part.replace(/^#{1,6}\s+.*$/gm, '').replace(/^>\s?/gm, '').trim()).find(Boolean)
    const summary = (described ?? paragraph)?.replace(/\s+/g, ' ').trim()
    return summary ? summary.slice(0, 220) : undefined
  } catch {
    return undefined
  }
}

function skillSourceLabels(workspace: string): Map<string, { label: string; url?: string; packageId?: string }> {
  const labels = new Map<string, { label: string; url?: string; packageId?: string }>()
  const lockPath = join(workspace, 'skills.lock')
  if (existsSync(lockPath)) {
    try {
      const lockMetadata = lstatSync(lockPath)
      if (!lockMetadata.isSymbolicLink() && lockMetadata.isFile() && lockMetadata.size <= 1024 * 1024) {
        const lock = parseLibraryLock(readFileSync(lockPath, 'utf8'))
        if (lock.ok) {
          for (const [packageId, resolved] of Object.entries(lock.value.resolved)) {
            const url = sourceUrl(resolved.url)
            for (const skill of resolved.skills) {
              labels.set(skill.name, { label: compactSourceName(resolved.url), ...(url ? { url } : {}), packageId })
            }
          }
        }
      }
    } catch {
      // A bad or missing lock is already surfaced by Library Health. Do not
      // discard source data that may still be present in dotagents.yaml.
    }
  }
  const configPath = join(workspace, 'dotagents.yaml')
  if (!existsSync(configPath)) return labels
  try {
    const metadata = lstatSync(configPath)
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > 1024 * 1024) return labels
    const config = parsePortableConfig(readFileSync(configPath, 'utf8'))
    for (const [skill, policy] of Object.entries(config.skills)) {
      const fork = policy.forked_from
      if (fork) {
        const url = sourceUrl(fork.url)
        labels.set(skill, { label: `Forked from ${compactSourceName(fork.url)}`, ...(url ? { url } : {}) })
        continue
      }
      if (policy.distribution === 'snapshot' && policy.snapshot) {
        const url = sourceUrl(policy.snapshot.url)
        labels.set(skill, { label: compactSourceName(policy.snapshot.url), ...(url ? { url } : {}) })
        continue
      }
      if (policy.distribution === 'vendored' && policy.origin) {
        const url = sourceUrl(policy.origin.url)
        labels.set(skill, { label: compactSourceName(policy.origin.url), ...(url ? { url } : {}) })
        continue
      }
      if (!labels.has(skill)) labels.set(skill, { label: 'Created in this library' })
    }
    return labels
  } catch {
    // A malformed portable config is reported by Library Health. The contents
    // view remains usable and simply avoids inventing provenance.
    return labels
  }
}

export function readResourceLibraryOverview(input: {
  workspace: string
  profileId: string
  mode: 'private' | 'team' | 'public'
  changed: boolean
  recentlyAdded?: Readonly<Record<string, string>>
}): DotagentsResourceOverviewJson {
  const parsed = parseLibraryManifest(readFileSync(join(input.workspace, 'skills.json'), 'utf8'))
  if (!parsed.ok) throw new Error('The canonical library manifest needs repair before resources can be managed')
  const sourceLabels = skillSourceLabels(input.workspace)
  const resources: DotagentsResourceOverviewJson['resources'] = parsed.value.skills.map((skillPath) => {
    const parts = skillPath.split('/')
    const id = parts[parts.length - 1] ?? skillPath
    const provenance = sourceLabels.get(id)
    const description = resourceSummary(input.workspace, skillPath)
    const recentlyAddedAt = input.recentlyAdded?.[id]
    return { key: `skill:${id}`, kind: 'skill', id, path: skillPath, source: 'skill-library', source_label: provenance?.label ?? 'Created in this library', ...(description ? { description } : {}), ...(provenance?.url ? { source_url: provenance.url } : {}), ...(provenance?.packageId ? { package_id: provenance.packageId } : {}), ...(recentlyAddedAt ? { recently_added_at: recentlyAddedAt } : {}) }
  })
  resources.sort((left, right) => {
    const newest = (right.recently_added_at ?? '').localeCompare(left.recently_added_at ?? '')
    return newest || left.key.localeCompare(right.key, 'en')
  })
  return { profile_id: input.profileId, mode: input.mode, changed: input.changed, resources }
}

/** Returns one bounded, regular library file for the renderer's read-only preview. */
export function readResourceLibraryContent(input: {
  workspace: string
  profileId: string
  mode: 'private' | 'team' | 'public'
  changed: boolean
  key: string
  file?: string
}): DotagentsResourceContentJson {
  const overview = readResourceLibraryOverview(input)
  const resource = overview.resources.find((entry) => entry.key === input.key)
  if (!resource) throw new Error('This library item no longer exists. Refresh the library and try again.')
  const candidate = resolve(input.workspace, resource.path)
  const withinWorkspace = relative(input.workspace, candidate)
  if (withinWorkspace.startsWith('..') || withinWorkspace === '') throw new Error('This library item has an unsafe path')
  const candidateMetadata = lstatSync(candidate)
  if (candidateMetadata.isSymbolicLink()) throw new Error('This library item is linked outside the library and cannot be previewed')
  const resourceRoot = candidateMetadata.isDirectory() ? candidate : null
  const files = resourceRoot ? previewableFiles(resourceRoot) : [basename(candidate)]
  if (files.length === 0) throw new Error('This library item has no supported text files to preview')
  const requestedFile = input.file?.trim()
  if (requestedFile && (!resourceRoot ? requestedFile !== basename(candidate) : !files.includes(requestedFile))) {
    throw new Error('This file is not available in the selected library item')
  }
  const contentPath = resourceRoot ? resolve(resourceRoot, requestedFile ?? files[0]!) : candidate
  if (resourceRoot && !isWithin(resourceRoot, contentPath)) throw new Error('This library item has an unsafe file path')
  const metadata = lstatSync(contentPath)
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error('This library item has no regular Markdown file to preview')
  const extension = contentPath.slice(contentPath.lastIndexOf('.')).toLowerCase()
  const imageMimeType = PREVIEWABLE_IMAGE_MIME_TYPES[extension]
  if (metadata.size > (imageMimeType ? IMAGE_PREVIEW_BYTES : 256 * 1024)) throw new Error('This library file is too large to preview safely')
  return {
    profile_id: input.profileId,
    key: resource.key,
    kind: resource.kind,
    id: resource.id,
    path: resource.path,
    files,
    content_path: relative(input.workspace, contentPath).replace(/\\/g, '/'),
    content: imageMimeType ? '' : readFileSync(contentPath, 'utf8'),
    ...(imageMimeType ? { image_data_url: `data:${imageMimeType};base64,${readFileSync(contentPath).toString('base64')}` } : {}),
  }
}

function isWithin(root: string, path: string): boolean {
  const remainder = relative(root, path)
  return remainder !== '' && !remainder.startsWith('..') && !remainder.includes('..' + '/')
}

function previewableFiles(root: string): string[] {
  const files: string[] = []
  const walk = (directory: string, relativeDirectory: string, depth: number) => {
    if (depth > 6 || files.length >= 128) return
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      if (files.length >= 128 || entry.isSymbolicLink()) continue
      const absolute = join(directory, entry.name)
      const portable = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(absolute, portable, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      const metadata = lstatSync(absolute)
      const extension = portable.slice(portable.lastIndexOf('.')).toLowerCase()
      const isText = PREVIEWABLE_RESOURCE_EXTENSIONS.has(extension)
      const isImage = extension in PREVIEWABLE_IMAGE_MIME_TYPES
      if ((isText && metadata.size <= 256 * 1024) || (isImage && metadata.size <= IMAGE_PREVIEW_BYTES)) files.push(portable)
    }
  }
  walk(root, '', 0)
  return files.sort((left, right) => (left === 'SKILL.md' ? -1 : right === 'SKILL.md' ? 1 : left.localeCompare(right, 'en')))
}

/**
 * Keeps native library paths and repair preconditions in the main process.
 * The renderer receives only value-free findings and a deterministic plan id.
 */
export class LibraryRepairSession {
  private plans = new Map<string, RepairPlanned>()

  private prune(): void {
    const cutoff = Date.now() - TOKEN_TTL_MS
    for (const [id, plan] of this.plans) if (plan.createdAt < cutoff) this.plans.delete(id)
  }

  async health(workspace: string, profileId: string): Promise<DotagentsLibraryHealthJson> {
    const report = await doctorLibrary({ root: workspace })
    return {
      profile_id: profileId,
      ok: report.ok,
      issues: report.issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity ?? 'error',
        message: issue.message,
        remediation: issue.remediation,
        repairable: issue.code === 'local-state-not-ignored',
      })),
    }
  }

  async preview(input: {
    workspace: string
    profileId: string
    selectedCodes: string[]
  }): Promise<DotagentsLibraryRepairPreviewJson> {
    this.prune()
    const selectedCodes = [...new Set(input.selectedCodes)]
    if (selectedCodes.length === 0) throw new Error('Choose at least one repairable finding')
    const report = await doctorLibrary({ root: input.workspace })
    const plan = planDoctorRepair(report, selectedCodes)
    this.plans.set(plan.planId, {
      plan,
      profileId: input.profileId,
      workspace: input.workspace,
      createdAt: Date.now(),
    })
    return {
      profile_id: input.profileId,
      plan_id: plan.planId,
      has_blockers: plan.hasBlockers,
      actions: plan.actions.map((action) => ({ kind: action.kind, path: action.path, add: action.add })),
      unsupported: plan.unsupported,
    }
  }

  apply(input: { workspace: string; profileId: string; planId: string }): { history_id: string } {
    this.prune()
    if (!/^[a-f0-9]{64}$/.test(input.planId)) throw new Error('Invalid reviewed repair plan')
    const cached = this.plans.get(input.planId)
    if (!cached || cached.profileId !== input.profileId || cached.workspace !== input.workspace) {
      throw new Error('This repair review expired; review it again')
    }
    if (cached.plan.actions.length === 0) throw new Error('The reviewed repair has no changes to apply')
    const result = applyDoctorRepair(input.workspace, cached.plan, input.planId)
    this.plans.delete(input.planId)
    if (!result) throw new Error('The reviewed repair is no longer needed')
    return { history_id: result.historyId }
  }
}
