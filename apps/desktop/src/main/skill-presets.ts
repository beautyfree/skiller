import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import type { Skill } from './skill-types'
import type { AgentConfig } from './types'
import type { ProjectEntryJson, SkillPresetJson, SkillPresetReviewJson, SkillPresetRemovalReviewJson } from '../shared/rpc-schema'
import { appDataRootPath } from './settings'
import { planBundledSkillExport } from './sync-export'

const idSchema = z.string().uuid()
const skillIdSchema = z.string().min(1).max(200).refine(id => !/[<>:"\\/|?*\x00-\x1f]/.test(id) && !/[. ]$/.test(id) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id))
const presetSchema = z.object({
  id: idSchema, name: z.string().trim().min(1).max(80),
  skills: z.array(z.object({ id: skillIdSchema, name: z.string(), sourcePath: z.string().refine(isAbsolute) }).strict()).max(200),
}).strict()
const saveSchema = z.object({ id: idSchema.optional(), name: z.string().trim().min(1).max(80), skillIds: z.array(skillIdSchema).max(200) }).strict()
const targetSchema = z.object({ agents: z.array(z.string().min(1)).max(100), projectPath: z.string().optional() }).strict()

function presetsDir() { return join(appDataRootPath(), 'skill-presets') }
function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new Error('Check the skill pack name, selection and destination')
  return result.data
}

export function listSkillPresets(dir = presetsDir()): SkillPresetJson[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(name => name.endsWith('.json')).map(name => {
    const preset = parseInput(presetSchema, JSON.parse(readFileSync(join(dir, name), 'utf8')))
    if (name !== `${preset.id}.json`) throw new Error('Invalid skill pack file')
    return preset
  }).sort((a, b) => a.name.localeCompare(b.name))
}

export function skillSelection(input: unknown, inventory: Skill[], previous?: SkillPresetJson | null): SkillPresetJson {
  const value = parseInput(saveSchema, input)
  const skills = [...new Set(value.skillIds)].map(id => {
    const skill = inventory.find(item => item.id === id && !item.collection)
    const existing = previous?.skills.find(ref => ref.id === id)
    // Renaming/curating a set must not discard a temporarily unavailable member.
    if (!skill && existing) return existing
    if (!skill) throw new Error(`Skill is no longer available: ${id}`)
    const sourcePath = realpathSync(skill.canonical_path)
    if (existing && existing.sourcePath !== sourcePath) throw new Error(`Skill source changed: ${id}. Remove it from the pack before selecting a replacement.`)
    return { id, name: skill.name, sourcePath }
  })
  return { id: value.id ?? randomUUID(), name: value.name, skills }
}

export function saveSkillPreset(input: unknown, inventory: Skill[], dir = presetsDir()): SkillPresetJson {
  const value = parseInput(saveSchema, input)
  const previous = value.id ? listSkillPresets(dir).find(preset => preset.id === value.id) : null
  if (value.id && !previous) throw new Error('Skill pack no longer exists')
  const preset = skillSelection(value, inventory, previous)
  if (value.id && !existsSync(join(dir, `${value.id}.json`))) throw new Error('Skill pack no longer exists')
  return writeSkillPreset(preset, dir)
}

export function writeSkillPreset(input: SkillPresetJson, dir = presetsDir()): SkillPresetJson {
  const preset = parseInput(presetSchema, input)
  const file = join(dir, `${preset.id}.json`)
  mkdirSync(dir, { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, JSON.stringify(preset), { flag: 'wx', mode: 0o600 })
    renameSync(temp, file)
  } finally { rmSync(temp, { force: true }) }
  return preset
}

export function removeSkillPreset(id: unknown, dir = presetsDir()): void {
  rmSync(join(dir, `${parseInput(idSchema, id)}.json`), { force: true })
}

export function setSkillPresetMember(input: unknown, inventory: Skill[], dir = presetsDir()): SkillPresetJson {
  const value = parseInput(z.object({ id: idSchema, skillId: skillIdSchema, sourcePath: z.string().refine(isAbsolute), enabled: z.boolean() }).strict(), input)
  const preset = listSkillPresets(dir).find(item => item.id === value.id)
  if (!preset) throw new Error('Skill pack no longer exists')
  if (value.enabled) {
    const skill = inventory.find(item => item.id === value.skillId && !item.collection)
    if (!skill || realpathSync(skill.canonical_path) !== value.sourcePath) throw new Error('Skill source changed; reload skills before adding it')
  }
  const skillIds = preset.skills.map(ref => ref.id)
  return saveSkillPreset({ id: preset.id, name: preset.name, skillIds: value.enabled ? [...new Set([...skillIds, value.skillId])] : skillIds.filter(id => id !== value.skillId) }, inventory, dir)
}

function present(path: string) {
  try { lstatSync(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
function inside(root: string, path: string) {
  const rel = relative(root, path)
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\')
}
function canonicalRoot(path: string): string {
  let ancestor = resolve(path)
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor)
    if (parent === ancestor) throw new Error('Destination filesystem is unavailable')
    ancestor = parent
  }
  return resolve(realpathSync(ancestor), relative(ancestor, resolve(path)))
}

export function reviewSkillPreset(preset: SkillPresetJson, input: unknown, inventory: Skill[], agents: AgentConfig[], projects: ProjectEntryJson[]): SkillPresetReviewJson {
  if (!preset.skills.length) throw new Error('Add skills to this pack before applying it')
  const target = parseInput(targetSchema, input)
  const selected = [...new Set(target.agents)].map(slug => {
    const agent = agents.find(item => item.slug === slug && item.detected && item.enabled)
    if (!agent) throw new Error('Selected agent is no longer available')
    return agent
  })
  let roots: string[]
  let projectRoot: string | null = null
  if (target.projectPath) {
    const project = projects.find(item => item.path === target.projectPath)
    if (!project) throw new Error('Choose a project registered in Skiller')
    const root = realpathSync(project.path)
    projectRoot = root
    roots = [join(root, '.agents/skills'), ...selected.map(agent => {
      if (!agent.project_skills_dir) throw new Error(`${agent.name} has no project skills path`)
      const path = resolve(root, agent.project_skills_dir)
      if (!inside(root, path)) throw new Error('Unsafe project skills path')
      return path
    })]
  } else {
    if (!selected.length) throw new Error('Select at least one agent')
    roots = selected.map(agent => {
      if (!agent.global_paths[0]) throw new Error(`${agent.name} has no personal skills path`)
      return agent.global_paths[0]
    })
  }
  roots = [...new Set(roots.map(canonicalRoot))]
  if (projectRoot && roots.some(root => !inside(projectRoot, root))) throw new Error('Project skills folder links outside the selected project')
  const rows: SkillPresetReviewJson['rows'] = []
  for (const ref of preset.skills) {
    const current = inventory.find(item => {
      if (item.id !== ref.id || item.collection) return false
      try { return realpathSync(item.canonical_path) === ref.sourcePath } catch { return false }
    })
    let hash: string | null = null
    try { if (current) hash = planBundledSkillExport(ref.id, ref.sourcePath).sha256 } catch { /* surfaced as unavailable */ }
    for (const root of roots) {
      let destination = join(root, ref.id)
      if (!inside(root, destination)) throw new Error('Unsafe skill destination')
      let state: SkillPresetReviewJson['rows'][number]['state'] = hash ? 'add' : 'unavailable'
      if (hash && present(destination)) {
        try { state = planBundledSkillExport(ref.id, destination).sha256 === hash ? 'installed' : 'conflict' } catch { state = 'conflict' }
      }
      // Personal agents may already read this skill from a shared or secondary root.
      // Projects still need their own copies; personal availability does not deploy to a project.
      if (hash && state === 'add' && !projectRoot) {
        const owners = selected.filter(agent => canonicalRoot(agent.global_paths[0]!) === root)
        const available = owners.map(agent => current!.installations.filter(item => item.agent_slug === agent.slug && present(item.path)))
        if (available.some(items => items.length)) {
          try {
            if (available.some(items => items.some(item => planBundledSkillExport(ref.id, item.path).sha256 !== hash))) state = 'conflict'
            else if (available.every(items => items.length)) { state = 'installed'; destination = available[0]![0]!.path }
          } catch { state = 'conflict' }
        }
      }
      rows.push({ skillId: ref.id, name: ref.name, sourcePath: ref.sourcePath, destination, hash, state })
    }
  }
  return { presetId: preset.id, presetName: preset.name, target, rows }
}

/** Additive only: reserve each destination exclusively, never overwrite a skill. */
export function applySkillPreset(review: SkillPresetReviewJson) {
  const added: string[] = []
  const failed: { destination: string; reason: string }[] = []
  for (const row of review.rows.filter(row => row.state === 'add')) {
    let reserved = false
    try {
      const plan = planBundledSkillExport(row.skillId, row.sourcePath)
      if (plan.sha256 !== row.hash) throw new Error('Source changed; review the skill pack again')
      const files = plan.files.map(file => {
        const bytes = readFileSync(join(row.sourcePath, file.relativePath))
        if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Source changed; review again')
        return { path: file.relativePath, bytes, mode: statSync(join(row.sourcePath, file.relativePath)).mode & 0o777 }
      })
      mkdirSync(dirname(row.destination), { recursive: true })
      mkdirSync(row.destination) // EEXIST also protects empty folders and broken symlinks.
      reserved = true
      for (const file of files) {
        const path = join(row.destination, file.path)
        if (!inside(row.destination, path)) throw new Error('Unsafe exported skill file')
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, file.bytes, { flag: 'wx', mode: file.mode })
      }
      added.push(row.destination)
    } catch (error) {
      if (reserved) {
        try { rmSync(row.destination, { recursive: true, force: true }) } catch {
          failed.push({ destination: row.destination, reason: 'Installation failed and its incomplete folder could not be removed; check permissions before retrying' })
          continue
        }
      }
      failed.push({ destination: row.destination, reason: error instanceof Error && error.message.startsWith('Source changed') ? error.message : 'Could not add skill; existing files were preserved' })
    }
  }
  return { added, failed, skipped: review.rows.filter(row => row.state !== 'add').length }
}

/** Removing a set from a workspace never removes library sources or shared deployments. */
export function reviewSkillPresetRemoval(preset: SkillPresetJson, target: unknown, inventory: Skill[], agents: AgentConfig[], projects: ProjectEntryJson[]): SkillPresetRemovalReviewJson {
  const review = reviewSkillPreset(preset, target, inventory, agents, projects)
  const selected = new Set(review.target.agents)
  const rows = review.rows.map(row => {
    let reason = 'Not installed here'
    if (present(row.destination)) {
      reason = 'Source unavailable or local changes'
      if (row.state === 'installed') {
        const destination = realpathSync(row.destination)
        const source = realpathSync(row.sourcePath)
        const shared = !review.target.projectPath && agents.some(agent => !selected.has(agent.slug) &&
          [...agent.global_paths, ...agent.additional_readable_paths.map(item => item.path)].some(root => {
            const canonical = canonicalRoot(root)
            return canonical === destination || inside(canonical, destination)
          }))
        reason = destination === source || inventory.some(skill => realpathSync(skill.canonical_path) === destination)
          ? 'Library source'
          : lstatSync(row.destination).isSymbolicLink() ? 'Linked skill'
          : shared ? 'Shared with another agent'
          : destination !== row.destination ? 'Linked destination'
          : ''
        if (!reason) {
          const packagePlan = planBundledSkillExport(row.skillId, destination)
          if (packagePlan.excludedPaths.length || packagePlan.secretFindings.length) reason = 'Extra or sensitive files'
        }
      }
    }
    return { name: row.name, destination: row.destination, hash: row.hash, state: reason ? 'keep' as const : 'remove' as const, reason }
  })
  return { presetId: preset.id, presetName: preset.name, target: review.target, rows }
}

export async function removeSkillPresetInstallations(review: SkillPresetRemovalReviewJson, trash: (path: string) => Promise<void>) {
  const removed: string[] = []
  const failed: { destination: string; reason: string }[] = []
  for (const row of review.rows.filter(row => row.state === 'remove')) {
    try {
      const packagePlan = planBundledSkillExport('reviewed-removal', row.destination)
      if (lstatSync(row.destination).isSymbolicLink() || realpathSync(row.destination) !== row.destination ||
          packagePlan.sha256 !== row.hash || packagePlan.excludedPaths.length || packagePlan.secretFindings.length) throw new Error('Skill changed; review again')
      await trash(row.destination)
      removed.push(row.destination)
    } catch (error) {
      failed.push({ destination: row.destination, reason: error instanceof Error ? error.message : 'Could not move skill to Trash' })
    }
  }
  return { removed, failed, skipped: review.rows.filter(row => row.state === 'keep').length }
}
