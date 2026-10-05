import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, normalize, parse } from 'node:path'
import { stringify } from '@iarna/toml'
import { z } from 'zod'
import { expandHome } from './fsutil'
import { getAgentsDir } from './paths'
import { loadAgentConfigs } from './registry'
import { appDataRootPath } from './settings'

const customSlug = z.string().regex(/^custom-[0-9a-f-]{36}$/)
const inputSchema = z.object({
  slug: customSlug.optional(),
  name: z.string().trim().min(1).max(80),
  globalPath: z.string().trim().min(1).max(4096),
  projectPath: z.string().trim().max(4096).default(''),
  command: z.string().trim().max(128).default(''),
  marker: z.string().trim().max(4096).default(''),
}).strict()

export function customAgentsDir(): string {
  return join(appDataRootPath(), 'custom-agents')
}

/** One registry for scanning, installing, projects, libraries and watchers. */
export function loadRegisteredAgents(builtinDir = getAgentsDir(), customDir = customAgentsDir()) {
  const builtin = loadAgentConfigs(builtinDir)
  const custom = existsSync(customDir) ? loadAgentConfigs(customDir) : []
  const reserved = new Set(builtin.map(agent => agent.slug))
  for (const agent of custom) {
    if (!customSlug.safeParse(agent.slug).success || reserved.has(agent.slug)) {
      throw new Error('Invalid custom agent configuration')
    }
    reserved.add(agent.slug)
  }
  return [...builtin, ...custom].sort((a, b) => a.slug.localeCompare(b.slug))
}

function absolutePath(value: string): string {
  const expanded = expandHome(value)
  if (!isAbsolute(expanded) || expanded.includes('\0') || normalize(expanded) === parse(expanded).root) {
    throw new Error('Choose an absolute folder path, not a filesystem root')
  }
  return normalize(expanded)
}

export function saveCustomAgent(value: unknown, dir = customAgentsDir()): string {
  const result = inputSchema.safeParse(value)
  if (!result.success) throw new Error('Check the custom agent name and fields')
  const input = result.data
  const globalPath = absolutePath(input.globalPath)
  const marker = input.marker ? absolutePath(input.marker) : ''
  const projectPath = input.projectPath.replace(/\\/g, '/')
  if (projectPath && (isAbsolute(projectPath) || /^[A-Za-z]:/.test(projectPath) || projectPath.split('/').some(part => !part || part === '.' || part === '..') || projectPath.includes('\0'))) {
    throw new Error('Project skills path must be relative, for example .my-agent/skills')
  }
  if (input.command && !/^[A-Za-z0-9_.-]+$/.test(input.command)) {
    throw new Error('Enter a command name without arguments, for example my-agent')
  }
  if (!marker && !input.command) throw new Error('Provide a command or an agent configuration marker for detection')
  if (marker === globalPath) throw new Error('The detection marker must identify the agent, not its skills folder')
  const slug = input.slug ?? `custom-${randomUUID()}`
  const target = join(dir, `${slug}.toml`)
  if (input.slug && !existsSync(target)) throw new Error('Custom agent no longer exists; refresh and try again')
  const content = stringify({
    slug, name: input.name, enabled: true, skill_format: 'skill-md',
    global_paths: [globalPath], detect_paths: marker ? [marker] : [],
    ...(projectPath ? { project_skills_dir: projectPath } : {}),
    ...(input.command ? { cli_command: input.command } : {}),
  })
  mkdirSync(dir, { recursive: true })
  const temp = `${target}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    renameSync(temp, target)
  } finally {
    rmSync(temp, { force: true })
  }
  return slug
}

/** Removes registration only; installed skills are deliberately preserved. */
export function removeCustomAgent(value: unknown, dir = customAgentsDir()): void {
  const result = customSlug.safeParse(value)
  if (!result.success) throw new Error('Only custom agents can be removed')
  rmSync(join(dir, `${result.data}.toml`), { force: true })
}
