import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applySkillPreset, reviewSkillPreset, reviewSkillPresetRemoval, removeSkillPresetInstallations, skillSelection } from './skill-presets'
import { scanAllSkills } from './scanner'
import { defaultAgentConfig } from './types'

test('reviewed set removal trashes only unchanged private copies and preserves sources, shared paths and edits', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'skiller-set-removal-')))
  try {
    const library = join(root, 'library')
    for (const id of ['code', 'test']) {
      mkdirSync(join(library, id), { recursive: true })
      writeFileSync(join(library, id, 'SKILL.md'), `---\nname: ${id}\ndescription: Instructions\n---\nKeep me`)
    }
    const inventory = scanAllSkills([], library)
    const preset = skillSelection({ name: 'Workflow', skillIds: ['code', 'test'] }, inventory)
    const agent = defaultAgentConfig({ slug: 'qa', name: 'QA', detected: true, global_paths: [join(root, 'agent/skills')] })
    const target = { agents: [agent.slug] }
    applySkillPreset(reviewSkillPreset(preset, target, inventory, [agent], []))
    const plan = reviewSkillPresetRemoval(preset, target, inventory, [agent], [])
    expect(plan.rows.map(row => row.state)).toEqual(['remove', 'remove'])
    const sharedAgent = { ...agent, slug: 'other' }
    expect(reviewSkillPresetRemoval(preset, target, inventory, [agent, sharedAgent], []).rows.every(row => row.reason === 'Shared with another agent')).toBe(true)
    const inheritedAgent = { ...sharedAgent, global_paths: [join(root, 'elsewhere')], additional_readable_paths: [{ path: agent.global_paths[0]!, source_agent: agent.slug }] }
    expect(reviewSkillPresetRemoval(preset, target, inventory, [agent, inheritedAgent], []).rows.every(row => row.state === 'keep')).toBe(true)
    const libraryAgent = { ...agent, global_paths: [library] }
    expect(reviewSkillPresetRemoval(preset, target, inventory, [libraryAgent], []).rows.every(row => row.reason === 'Library source')).toBe(true)
    writeFileSync(join(agent.global_paths[0]!, 'code/SKILL.md'), 'Local edits')
    const calls: string[] = []
    mkdirSync(join(root, 'trash'))
    const result = await removeSkillPresetInstallations(plan, async path => { calls.push(path); renameSync(path, join(root, 'trash', String(calls.length))) })
    expect(result.removed).toHaveLength(1)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]!.reason).toContain('changed')
    expect(calls).toHaveLength(1)
    expect(existsSync(join(agent.global_paths[0]!, 'code/SKILL.md'))).toBe(true)
    expect(existsSync(join(library, 'test/SKILL.md'))).toBe(true)
    const partial = reviewSkillPresetRemoval(preset, target, inventory, [agent], [])
    expect(partial.rows.every(row => row.state === 'keep')).toBe(true)
    symlinkSync(join(library, 'test'), join(agent.global_paths[0]!, 'test'))
    expect(reviewSkillPresetRemoval(preset, target, inventory, [agent], []).rows[1]!.state).toBe('keep')
    const project = join(root, 'project')
    mkdirSync(project)
    const projectTarget = { agents: [], projectPath: project }
    const projects = [{ name: 'QA project', path: project }]
    applySkillPreset(reviewSkillPreset(preset, projectTarget, inventory, [agent], projects))
    const projectPlan = reviewSkillPresetRemoval(preset, projectTarget, inventory, [agent], projects)
    expect(projectPlan.rows.every(row => row.state === 'remove')).toBe(true)
    const refused = await removeSkillPresetInstallations(projectPlan, async () => { throw new Error('Trash unavailable') })
    expect(refused.failed).toHaveLength(2)
    expect(existsSync(join(project, '.agents/skills/code/SKILL.md'))).toBe(true)
    const extra = join(project, '.agents/skills/code/.git')
    mkdirSync(extra)
    writeFileSync(join(extra, 'config'), 'Local repository metadata')
    expect(reviewSkillPresetRemoval(preset, projectTarget, inventory, [agent], projects).rows[0]!.state).toBe('keep')
    const extraResult = await removeSkillPresetInstallations({ ...projectPlan, rows: [projectPlan.rows[0]!] }, async () => { throw new Error('Must not trash extra files') })
    expect(extraResult.failed[0]!.reason).toContain('changed')
    rmSync(extra, { recursive: true })
    const projectResult = await removeSkillPresetInstallations(projectPlan, async path => { calls.push(path); renameSync(path, join(root, 'trash', String(calls.length))) })
    expect(projectResult.removed).toHaveLength(2)
    expect(existsSync(join(library, 'code/SKILL.md'))).toBe(true)
    expect(() => reviewSkillPresetRemoval(preset, { agents: [], projectPath: '/unknown' }, inventory, [agent], projects)).toThrow('registered')
    expect(() => reviewSkillPresetRemoval(preset, { agents: ['unknown'] }, inventory, [agent], projects)).toThrow('available')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
