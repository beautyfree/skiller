import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import type { Skill } from './skill-types'
import type { SkillTagsJson } from '../shared/rpc-schema'
import { appDataRootPath } from './settings'

const tagSchema = z.string().trim().min(1).max(64).refine(tag => !/[\x00-\x1f\x7f]/.test(tag), 'Tags cannot contain control characters')
const refSchema = z.object({ id: z.string().min(1).max(200), sourcePath: z.string().refine(isAbsolute) }).strict()
const storeSchema = z.array(refSchema.extend({ tags: z.array(tagSchema).max(32) }).strict())
const editSchema = z.object({ skills: z.array(refSchema).min(1).max(200), add: z.array(tagSchema).max(32), remove: z.array(tagSchema).max(6400) }).strict()
const renameSchema = z.object({ oldName: tagSchema, newName: tagSchema.nullable() }).strict()

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) throw new Error('Check the selected sources and tags. Use 1–64 characters per tag and at most 32 tags per skill.')
  return result.data
}

function readTags(dir: string): SkillTagsJson[] {
  const file = join(dir, 'skill-tags.json')
  if (!existsSync(file)) return []
  return storeSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
}
function writeTags(rows: SkillTagsJson[], dir: string) {
  const data = storeSchema.parse(rows)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'skill-tags.json')
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, JSON.stringify(data), { flag: 'wx', mode: 0o600 })
    renameSync(temp, file)
  } finally { rmSync(temp, { force: true }) }
}
function sameSource(ref: { id: string; sourcePath: string }, skill: Skill) {
  if (ref.id !== skill.id) return false
  try { return ref.sourcePath === realpathSync(skill.canonical_path) } catch { return false }
}
export function listSkillTags(inventory: Skill[], dir = appDataRootPath()): SkillTagsJson[] {
  return readTags(dir).flatMap(row => {
    const skill = inventory.find(skill => sameSource(row, skill))
    // Return the scanner's path spelling so renderer joins do not depend on /private aliases.
    return skill ? [{ ...row, sourcePath: skill.canonical_path }] : []
  })
}
/** Local organization only. A whole batch is validated before one atomic metadata write. */
export function editSkillTags(input: unknown, inventory: Skill[], dir = appDataRootPath()): void {
  const params = parseInput(editSchema, input)
  const rows = readTags(dir)
  const refs = params.skills.map(ref => {
    const skill = inventory.find(skill => skill.id === ref.id && sameSource({ ...ref, sourcePath: realpathSync(ref.sourcePath) }, skill))
    if (!skill) throw new Error(`Skill source changed or is unavailable: ${ref.id}. Refresh the library.`)
    return { id: skill.id, sourcePath: realpathSync(skill.canonical_path) }
  })
  for (const ref of refs) {
    const index = rows.findIndex(row => row.id === ref.id && row.sourcePath === ref.sourcePath)
    const tags = [...new Set([...(index < 0 ? [] : rows[index]!.tags).filter(tag => !params.remove.includes(tag)), ...params.add])].sort()
    if (tags.length > 32) throw new Error('A skill can have at most 32 tags')
    if (index >= 0) rows.splice(index, 1)
    if (tags.length) rows.push({ ...ref, tags })
  }
  writeTags(rows, dir)
}
/** Rename merges an existing label; null removes the label, never the skill. */
export function renameSkillTag(input: unknown, dir = appDataRootPath()): void {
  const { oldName, newName } = parseInput(renameSchema, input)
  const rows = readTags(dir).map(row => ({ ...row, tags: [...new Set(row.tags.flatMap(tag => tag === oldName ? (newName ? [newName] : []) : [tag]))].sort() })).filter(row => row.tags.length)
  writeTags(rows, dir)
}
