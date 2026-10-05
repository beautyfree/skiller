import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import type { Skill } from './skill-types'
import type { AgentConfig } from './types'
import type { ProjectEntryJson, SkillPresetJson, SkillPresetReviewJson } from '../shared/rpc-schema'
import { appDataRootPath } from './settings'
import { planBundledSkillExport } from './sync-export'

const idSchema = z.string().uuid()
const skillIdSchema = z.string().min(1).max(200).refine(id => !/[<>:"\\/|?*\x00-\x1f]/.test(id) && !/[. ]$/.test(id) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id))
const presetSchema = z.object({
  id: idSchema, name: z.string().trim().min(1).max(80),
  skills: z.array(z.object({ id: skillIdSchema, name: z.string(), sourcePath: z.string().refine(isAbsolute) }).strict()).min(1).max(200),
}).strict()
const saveSchema = z.object({ id: idSchema.optional(), name: z.string().trim().min(1).max(80), skillIds: z.array(skillIdSchema).min(1).max(200) }).strict()
const targetSchema = z.object({ agents: z.array(z.string().min(1)).max(100), projectPath: z.string().optional() }).strict()

function presetsDir() { return join(appDataRootPath(), 'skill-presets') }
function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new Error('Check the skill set name, selection and destination')
  return result.data
}

export function listSkillPresets(dir = presetsDir()): SkillPresetJson[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(name => name.endsWith('.json')).map(name => {
    const preset = parseInput(presetSchema, JSON.parse(readFileSync(join(dir, name), 'utf8')))
    if (name !== `${preset.id}.json`) throw new Error('Invalid skill set file')
    return preset
  }).sort((a, b) => a.name.localeCompare(b.name))
}

export function skillSelection(input: unknown, inventory: Skill[], previous?: SkillPresetJson | null): SkillPresetJson {
  const value = parseInput(saveSchema, input)
  const skills = [...new Set(value.skillIds)].map(id => {
    const skill = inventory.find(item => item.id === id && !item.collection)
    if (!skill) throw new Error(`Skill is no longer available: ${id}`)
    const sourcePath = realpathSync(skill.canonical_path)
    const existing = previous?.skills.find(ref => ref.id === id)
    if (existing && existing.sourcePath !== sourcePath) throw new Error(`Skill source changed: ${id}. Remove it from the set before selecting a replacement.`)
    return { id, name: skill.name, sourcePath }
  })
  return { id: value.id ?? randomUUID(), name: value.name, skills }
}

export function saveSkillPreset(input: unknown, inventory: Skill[], dir = presetsDir()): SkillPresetJson {
  const value = parseInput(saveSchema, input)
  const previous = value.id ? listSkillPresets(dir).find(preset => preset.id === value.id) : null
  if (value.id && !previous) throw new Error('Skill set no longer exists')
  const preset = skillSelection(value, inventory, previous)
  const file = join(dir, `${preset.id}.json`)
  if (value.id && !existsSync(file)) throw new Error('Skill set no longer exists')
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
    const current = inventory.find(item => item.id === ref.id && !item.collection && realpathSync(item.canonical_path) === ref.sourcePath)
    let hash: string | null = null
    try { if (current) hash = planBundledSkillExport(ref.id, ref.sourcePath).sha256 } catch { /* surfaced as unavailable */ }
    for (const root of roots) {
      const destination = join(root, ref.id)
      if (!inside(root, destination)) throw new Error('Unsafe skill destination')
      let state: SkillPresetReviewJson['rows'][number]['state'] = hash ? 'add' : 'unavailable'
      if (hash && present(destination)) {
        try { state = planBundledSkillExport(ref.id, destination).sha256 === hash ? 'installed' : 'conflict' } catch { state = 'conflict' }
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
      if (plan.sha256 !== row.hash) throw new Error('Source changed; review the skill set again')
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
