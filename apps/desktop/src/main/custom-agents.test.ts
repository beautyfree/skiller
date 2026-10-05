import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRegisteredAgents, removeCustomAgent, saveCustomAgent } from './custom-agents'
import { installSkillToProjectFromPath } from './projects'
import { detectAgents } from './registry'
import { installSkillFromPath, resolveInstallTargets } from './install'

test('custom agent registration uses the normal detection/install flow and preserves skills on removal', () => {
  const root = mkdtempSync(join(tmpdir(), 'skiller-custom-agent-'))
  const previousRoot = process.env.SKILLER_TEST_DATA_ROOT
  process.env.SKILLER_TEST_DATA_ROOT = root
  const previousHome = process.env.SKILLER_TEST_HOME
  const previousConfig = process.env.DOTAGENTS_CONFIG_HOME
  process.env.SKILLER_TEST_HOME = join(root, 'home')
  process.env.DOTAGENTS_CONFIG_HOME = join(root, 'dotagents')
  try {
    const builtin = join(root, 'builtin')
    const custom = join(root, 'custom-agents')
    mkdirSync(builtin)
    writeFileSync(join(builtin, 'builtin.toml'), 'slug = "existing-agent"\nname = "Existing"\n')
    const input = { name: 'My agent', globalPath: join(root, 'agent/skills'), projectPath: '.my-agent/skills', command: '', marker: join(root, 'agent') }
    const slug = saveCustomAgent(input, custom)
    const configs = loadRegisteredAgents(builtin, custom)
    expect(configs).toHaveLength(2)
    expect(configs.find(agent => agent.slug === slug)?.project_skills_dir).toBe('.my-agent/skills')
    expect(() => resolveInstallTargets([slug], detectAgents(configs))).toThrow('not detected')
    mkdirSync(input.globalPath, { recursive: true })
    expect(detectAgents(configs).find(agent => agent.slug === slug)?.detection_reason).toBe('skills-only')
    writeFileSync(join(root, 'agent/config.json'), '{}')
    const detected = detectAgents(configs)
    expect(resolveInstallTargets([slug], detected)).toHaveLength(1)
    const source = join(root, 'source')
    mkdirSync(source)
    writeFileSync(join(source, 'SKILL.md'), '---\nname: example\ndescription: A test skill\n---\nTest')
    installSkillFromPath(source, [slug], detected, 'example')
    expect(readFileSync(join(input.globalPath, 'example/SKILL.md'), 'utf8')).toContain('A test skill')
    const project = join(root, 'project')
    mkdirSync(project)
    installSkillToProjectFromPath(source, project, 'example')
    expect(readFileSync(join(project, '.my-agent/skills/example/SKILL.md'), 'utf8')).toContain('A test skill')
    expect(saveCustomAgent({ ...input, slug, name: 'Renamed' }, custom)).toBe(slug)
    expect(loadRegisteredAgents(builtin, custom).find(agent => agent.slug === slug)?.name).toBe('Renamed')
    for (const bad of [
      { ...input, globalPath: 'relative/skills' },
      { ...input, globalPath: '/' },
      { ...input, projectPath: '../outside' },
      { ...input, projectPath: 'C:\\outside' },
      { ...input, marker: input.globalPath },
      { ...input, marker: '', command: '' },
      { ...input, command: 'agent --run' },
      { ...input, slug: '../existing-agent' },
    ]) expect(() => saveCustomAgent(bad, custom)).toThrow()
    expect(() => removeCustomAgent('existing-agent', custom)).toThrow()
    expect(existsSync(join(builtin, 'builtin.toml'))).toBe(true)
    removeCustomAgent(slug, custom)
    expect(loadRegisteredAgents(builtin, custom)).toHaveLength(1)
    expect(existsSync(join(input.globalPath, 'example/SKILL.md'))).toBe(true)
    expect(() => saveCustomAgent({ ...input, slug }, custom)).toThrow('no longer exists')
  } finally {
    if (previousRoot === undefined) delete process.env.SKILLER_TEST_DATA_ROOT
    else process.env.SKILLER_TEST_DATA_ROOT = previousRoot
    if (previousHome === undefined) delete process.env.SKILLER_TEST_HOME
    else process.env.SKILLER_TEST_HOME = previousHome
    if (previousConfig === undefined) delete process.env.DOTAGENTS_CONFIG_HOME
    else process.env.DOTAGENTS_CONFIG_HOME = previousConfig
    rmSync(root, { recursive: true, force: true })
  }
})
