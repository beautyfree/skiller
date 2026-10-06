import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { uninstallProjectSkill } from './projects'
import { defaultAgentConfig } from './types'

test('project removal trashes only canonical copies and their links, preserving unrelated or external sources', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'skiller-project-trash-')))
  try {
    const project = join(root, 'project')
    const canonical = join(project, '.agents/skills/example')
    mkdirSync(canonical, { recursive: true })
    const content = '---\nname: Example\ndescription: Test\n---\nLocal instructions'
    writeFileSync(join(canonical, 'SKILL.md'), content)
    const external = join(root, 'library/example')
    mkdirSync(external, { recursive: true })
    writeFileSync(join(external, 'SKILL.md'), content)
    const linkedRoot = join(project, '.linked/skills')
    mkdirSync(linkedRoot, { recursive: true })
    symlinkSync(canonical, join(linkedRoot, 'example'))
    const separate = join(project, '.other/skills/example')
    mkdirSync(separate, { recursive: true })
    writeFileSync(join(separate, 'SKILL.md'), 'Separate copy')
    const projects = [{ name: 'QA', path: project }]
    const agents = [defaultAgentConfig({ slug: 'linked', name: 'Linked', project_skills_dir: '.linked/skills' }), defaultAgentConfig({ slug: 'other', name: 'Other', project_skills_dir: '.other/skills' })]
    const moved: string[] = []
    mkdirSync(join(root, 'trash'))
    const trash = async (path: string) => { moved.push(path); renameSync(path, join(root, 'trash', String(moved.length))) }
    await expect(uninstallProjectSkill(project, '../outside', trash, projects, agents)).rejects.toThrow('registered')
    await expect(uninstallProjectSkill(root, 'example', trash, projects, agents)).rejects.toThrow('registered')
    await expect(uninstallProjectSkill(project, 'example', async () => { throw new Error('Trash unavailable') }, projects, agents)).rejects.toThrow('Trash unavailable')
    expect(existsSync(join(canonical, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(linkedRoot, 'example'))).toBe(true)
    const removed = await uninstallProjectSkill(project, 'example', trash, projects, agents)
    expect(removed.removed).toEqual([join(linkedRoot, 'example'), canonical])
    expect(removed.kept).toEqual([separate])
    expect(readFileSync(join(external, 'SKILL.md'), 'utf8')).toBe(content)
    expect(readFileSync(join(separate, 'SKILL.md'), 'utf8')).toBe('Separate copy')
    symlinkSync(external, canonical)
    await expect(uninstallProjectSkill(project, 'example', trash, projects, agents)).rejects.toThrow('Linked')
    expect(moved).toHaveLength(2)
    expect(existsSync(join(external, 'SKILL.md'))).toBe(true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
