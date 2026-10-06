import { expect, test } from 'bun:test'
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installSkillToProjectFromPath, listProjectSkills, setProjectSkillEnabled, uninstallProjectSkill } from './projects'
import { defaultAgentConfig } from './types'

test('project disable/enable preserves packages and links, rejects unsafe or conflicting destinations', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'skiller-project-toggle-')))
  try {
    const project = join(root, 'project')
    const active = join(project, '.agents/skills/example')
    const disabled = join(project, '.agents/skills-disabled/example')
    const link = join(project, '.claude/skills/example')
    const disabledLink = join(project, '.claude/skills-disabled/example')
    mkdirSync(active, { recursive: true }); mkdirSync(join(project, '.claude/skills'), { recursive: true })
    const content = '---\nname: Example\n---\nOriginal instructions'
    writeFileSync(join(active, 'SKILL.md'), content)
    symlinkSync('../../.agents/skills/example', link)
    const projects = [{ name: 'QA', path: project }]
    const agents = [defaultAgentConfig({ slug: 'claude-code', name: 'Claude Code', project_skills_dir: '.claude/skills' })]
    const toggle = (enabled: boolean) => setProjectSkillEnabled({ projectPath: project, skillId: 'example', enabled }, projects, agents)
    expect(() => setProjectSkillEnabled({ projectPath: project, skillId: '../outside', enabled: false }, projects, agents)).toThrow()
    expect(() => setProjectSkillEnabled({ projectPath: root, skillId: 'example', enabled: false }, projects, agents)).toThrow('registered')
    writeFileSync(join(project, '.agents/skills-disabled'), 'Blocked destination')
    expect(() => toggle(false)).toThrow()
    expect(realpathSync(link)).toBe(active)
    expect(readFileSync(join(active, 'SKILL.md'), 'utf8')).toBe(content)
    rmSync(join(project, '.agents/skills-disabled'))
    toggle(false)
    expect(existsSync(active)).toBe(false)
    expect(lstatSync(disabledLink).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(disabled, 'SKILL.md'), 'utf8')).toBe(content)
    expect(listProjectSkills(project)).toMatchObject([{ id: 'example', enabled: false, path: disabled }])
    expect(() => installSkillToProjectFromPath(disabled, project, 'example')).toThrow('disabled')
    toggle(false); toggle(true); toggle(true)
    expect(realpathSync(link)).toBe(active)
    expect(readFileSync(join(active, 'SKILL.md'), 'utf8')).toBe(content)
    mkdirSync(disabled, { recursive: true })
    writeFileSync(join(disabled, 'SKILL.md'), 'Other copy')
    expect(() => toggle(false)).toThrow('Both')
    expect(readFileSync(join(active, 'SKILL.md'), 'utf8')).toBe(content)
    rmSync(disabled, { recursive: true })
    rmSync(link); mkdirSync(link); writeFileSync(join(link, 'SKILL.md'), 'Independent copy')
    expect(() => toggle(false)).toThrow('Separate')
    expect(existsSync(active)).toBe(true)
    rmSync(link, { recursive: true }); symlinkSync(active, link)
    toggle(false)
    mkdirSync(join(root, 'trash'))
    let n = 0
    await uninstallProjectSkill(project, 'example', async path => { renameSync(path, join(root, 'trash', String(n++))) }, projects, agents)
    expect(existsSync(disabled)).toBe(false)
    expect(n).toBe(2)
    const outside = join(root, 'outside')
    mkdirSync(outside); writeFileSync(join(outside, 'SKILL.md'), content)
    symlinkSync(outside, active)
    expect(() => toggle(false)).toThrow('project-owned')
    expect(readFileSync(join(outside, 'SKILL.md'), 'utf8')).toBe(content)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
