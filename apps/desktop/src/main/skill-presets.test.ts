import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applySkillPreset, listSkillPresets, removeSkillPreset, reviewSkillPreset, saveSkillPreset, skillSelection } from './skill-presets'
import { scanAllSkills } from './scanner'
import { defaultAgentConfig } from './types'

test('sets retain source identity, review changes, and add only missing skills across agents/projects', () => {
  const root = mkdtempSync(join(tmpdir(), 'skiller-presets-'))
  try {
    const source = join(root, 'library')
    for (const id of ['react', 'testing']) {
      const dir = join(source, id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${id}\ndescription: Useful ${id} instructions\n---\nHello`)
    }
    mkdirSync(join(source, 'react/scripts'))
    writeFileSync(join(source, 'react/scripts/check.sh'), '#!/bin/sh\ntrue\n', { mode: 0o755 })
    const inventory = scanAllSkills([], source)
    const dir = join(root, 'sets')
    const preset = saveSkillPreset({ name: 'Frontend', skillIds: ['react', 'testing', 'react'] }, inventory, dir)
    expect(preset.skills).toHaveLength(2)
    expect(listSkillPresets(dir)[0]).toEqual(preset)
    const selection = skillSelection({ name: 'Selected skills', skillIds: ['react', 'testing'] }, inventory)
    expect(selection.skills).toEqual(preset.skills)
    expect(listSkillPresets(dir)).toHaveLength(1)
    const agent = defaultAgentConfig({ slug: 'test-agent', name: 'Test agent', detected: true, global_paths: [join(root, 'agent/skills')], project_skills_dir: '.test/skills' })
    const target = { agents: [agent.slug] }
    const review = reviewSkillPreset(selection, target, inventory, [agent], [])
    expect(review.rows.map(row => row.state)).toEqual(['add', 'add'])
    expect(applySkillPreset(review).added).toHaveLength(2)
    expect(readFileSync(join(agent.global_paths[0]!, 'react/SKILL.md'), 'utf8')).toContain('Hello')
    if (process.platform !== 'win32') expect(statSync(join(agent.global_paths[0]!, 'react/scripts/check.sh')).mode & 0o111).toBe(0o111)
    const installed = reviewSkillPreset(preset, target, inventory, [agent], [])
    expect(installed.rows.every(row => row.state === 'installed')).toBe(true)
    expect(applySkillPreset(installed)).toEqual({ added: [], failed: [], skipped: 2 })
    writeFileSync(join(agent.global_paths[0]!, 'react/SKILL.md'), 'Local edits')
    const conflict = reviewSkillPreset(preset, target, inventory, [agent], [])
    expect(conflict.rows[0]?.state).toBe('conflict')
    applySkillPreset(conflict)
    expect(readFileSync(join(agent.global_paths[0]!, 'react/SKILL.md'), 'utf8')).toBe('Local edits')
    const project = join(root, 'project')
    mkdirSync(project)
    writeFileSync(join(project, 'unrelated.txt'), 'Keep me')
    const projectReview = reviewSkillPreset(preset, { agents: [agent.slug], projectPath: project }, inventory, [agent], [{ path: project, name: 'Project' }])
    expect(projectReview.rows).toHaveLength(4)
    expect(applySkillPreset(projectReview).added).toHaveLength(4)
    expect(readFileSync(join(project, '.test/skills/react/SKILL.md'), 'utf8')).toContain('Hello')
    expect(readFileSync(join(project, 'unrelated.txt'), 'utf8')).toBe('Keep me')
    const secondProject = join(root, 'second-project')
    mkdirSync(secondProject)
    const secondReview = reviewSkillPreset(preset, { agents: [], projectPath: secondProject }, inventory, [agent], [{ path: secondProject, name: 'Second' }])
    expect(applySkillPreset(secondReview).added).toHaveLength(2)
    const linkedProject = join(root, 'linked-project')
    mkdirSync(linkedProject)
    symlinkSync(source, join(linkedProject, '.agents'))
    expect(() => reviewSkillPreset(preset, { agents: [], projectPath: linkedProject }, inventory, [agent], [{ path: linkedProject, name: 'Linked' }])).toThrow('outside')
    expect(() => reviewSkillPreset(preset, { agents: [], projectPath: '/unknown' }, inventory, [agent], [])).toThrow('registered')
    const staleAgent = { ...agent, global_paths: [join(root, 'stale/skills')] }
    const stale = reviewSkillPreset(preset, target, inventory, [staleAgent], [])
    writeFileSync(join(source, 'react/SKILL.md'), 'Changed after review')
    const partial = applySkillPreset(stale)
    expect(partial.failed).toHaveLength(1)
    expect(partial.added).toHaveLength(1)
    expect(partial.failed[0]?.reason).toContain('Source changed')
    expect(reviewSkillPreset(preset, target, [], [agent], []).rows.every(row => row.state === 'unavailable')).toBe(true)
    const moved = inventory.map(skill => ({ ...skill, canonical_path: root }))
    expect(reviewSkillPreset(preset, target, moved, [agent], []).rows.every(row => row.state === 'unavailable')).toBe(true)
    expect(() => saveSkillPreset({ id: preset.id, name: 'Rename', skillIds: ['react', 'testing'] }, moved, dir)).toThrow('source changed')
    const raceAgent = { ...agent, global_paths: [join(root, 'race/skills')] }
    const race = reviewSkillPreset(preset, target, inventory, [raceAgent], [])
    mkdirSync(raceAgent.global_paths[0]!, { recursive: true })
    symlinkSync(join(root, 'absent'), join(raceAgent.global_paths[0]!, 'react'))
    expect(applySkillPreset(race).failed).toHaveLength(1)
    for (const id of ['../outside', '.', 'a/b', 'a:stream', 'CON', 'trailing.']) expect(() => saveSkillPreset({ name: 'Bad', skillIds: [id] }, inventory, dir)).toThrow()
    expect(() => removeSkillPreset('../outside', dir)).toThrow()
    removeSkillPreset(preset.id, dir)
    expect(listSkillPresets(dir)).toHaveLength(0)
    expect(readFileSync(join(agent.global_paths[0]!, 'react/SKILL.md'), 'utf8')).toBe('Local edits')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
