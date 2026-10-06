import { expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareProjectSkill, updateProjectSkillToLibrary } from './projects'
import { scanAllSkills } from './scanner'

test('project comparison reuses full-package diff without writes or arbitrary path reads', () => {
  const root = mkdtempSync(join(tmpdir(), 'skiller-project-comparison-'))
  try {
    const project = join(root, 'project')
    const local = join(project, '.agents/skills/example')
    const library = join(root, 'library/example')
    for (const dir of [local, library]) {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(join(dir, 'SKILL.md'), '---\nname: Example\ndescription: Example instructions\n---\nSame instructions\n')
    }
    writeFileSync(join(local, 'scripts/check.sh'), 'project script\n')
    writeFileSync(join(library, 'scripts/check.sh'), 'library script\n')
    writeFileSync(join(local, 'project.txt'), 'project addition\n')
    writeFileSync(join(library, 'library.txt'), 'library addition\n')
    const inventory = scanAllSkills([], join(root, 'library'))
    const projects = [{ path: project, name: 'Project' }]
    const params = { projectPath: project, skillId: 'example', librarySourcePath: inventory[0]!.canonical_path }
    const result = compareProjectSkill(params, inventory, projects)
    expect(result.comparison).toMatchObject({ changed_files: ['scripts/check.sh'], only_on_computer: ['project.txt'], only_in_library: ['library.txt'], unchanged_file_count: 1 })
    expect(compareProjectSkill({ ...params, file: 'scripts/check.sh' }, inventory, projects).filePreview?.diff).toContain('- library script\n+ project script')
    expect(compareProjectSkill({ ...params, file: 'project.txt' }, inventory, projects).filePreview?.status).toBe('added')
    expect(compareProjectSkill({ ...params, file: 'library.txt' }, inventory, projects).filePreview?.status).toBe('deleted')
    expect(() => compareProjectSkill({ ...params, file: '../../outside' }, inventory, projects)).toThrow()
    expect(() => compareProjectSkill(params, inventory, [])).toThrow('registered')
    expect(() => compareProjectSkill({ ...params, librarySourcePath: root }, inventory, projects)).toThrow('Library source')
    expect(() => compareProjectSkill({ ...params, skillId: '../example' }, inventory, projects)).toThrow()
    expect(readFileSync(join(local, 'scripts/check.sh'), 'utf8')).toBe('project script\n')
    expect(readFileSync(join(library, 'scripts/check.sh'), 'utf8')).toBe('library script\n')
    writeFileSync(join(local, 'scripts/check.sh'), 'library script\n')
    rmSync(join(local, 'project.txt'))
    rmSync(join(library, 'library.txt'))
    const identical = compareProjectSkill(params, inventory, projects).comparison
    expect([...identical.changed_files, ...identical.only_on_computer, ...identical.only_in_library]).toEqual([])
    const outside = join(root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'SKILL.md'), '---\nname: Outside\n---\nPrivate content')
    symlinkSync(outside, join(project, '.agents/skills/escaped'))
    expect(() => compareProjectSkill({ ...params, skillId: 'escaped' }, inventory, projects)).toThrow('outside')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('reviewed project publication preserves the old package and rejects stale, linked and non-library targets', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'skiller-project-publish-')))
  const previousHome = process.env.SKILLER_TEST_HOME
  process.env.SKILLER_TEST_HOME = root
  try {
    const project = join(root, 'project')
    const local = join(project, '.agents/skills/example')
    const library = join(root, '.agents/skills/example')
    for (const dir of [local, library]) {
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(join(dir, 'SKILL.md'), '---\nname: Example\ndescription: Test\n---\nInstructions\n')
    }
    writeFileSync(join(local, 'scripts/check.sh'), 'echo Project\n')
    chmodSync(join(local, 'scripts/check.sh'), 0o755)
    writeFileSync(join(library, 'scripts/check.sh'), 'echo Library\n')
    writeFileSync(join(local, 'project-only.txt'), 'Project notes\n')
    writeFileSync(join(library, 'library-only.txt'), 'Library notes\n')
    const inventory = scanAllSkills([], join(root, '.agents/skills'))
    const projects = [{ path: project, name: 'QA project' }]
    const params = { projectPath: project, skillId: 'example', librarySourcePath: library }
    const review = () => compareProjectSkill(params, inventory, projects)
    const initial = review()
    expect(initial.libraryUpdate).toBeDefined()
    // macOS exposes /var and /private/var aliases for the same user-owned root.
    symlinkSync(root, join(root, 'home-alias'))
    process.env.SKILLER_TEST_HOME = join(root, 'home-alias')
    expect(review().libraryUpdate).toEqual(initial.libraryUpdate)
    process.env.SKILLER_TEST_HOME = root
    rmSync(join(root, 'home-alias'))
    const moved: string[] = []
    const trash = async (path: string) => { const target = join(root, `trash-${moved.length}`); renameSync(path, target); moved.push(target) }
    writeFileSync(join(local, 'project-only.txt'), 'Changed after review\n')
    await expect(updateProjectSkillToLibrary({ ...params, ...initial.libraryUpdate! }, inventory, trash, projects)).rejects.toThrow('changed')
    const fresh = review()
    writeFileSync(join(library, 'library-only.txt'), 'Library changed after review\n')
    await expect(updateProjectSkillToLibrary({ ...params, ...fresh.libraryUpdate! }, inventory, trash, projects)).rejects.toThrow('changed')
    expect(moved).toHaveLength(0)
    expect(() => compareProjectSkill({ ...params, skillId: 'example\0' }, inventory, projects)).toThrow()
    await expect(updateProjectSkillToLibrary({ ...params, ...review().libraryUpdate!, file: 'SKILL.md' }, inventory, trash, projects)).rejects.toThrow()
    await expect(updateProjectSkillToLibrary({ ...params, ...review().libraryUpdate! }, inventory, trash, [])).rejects.toThrow('registered')
    const unowned = [{ ...inventory[0]!, scope: { kind: 'AgentLocal' as const, agent: 'qa' } }]
    expect(compareProjectSkill(params, unowned, projects).libraryUpdate).toBeUndefined()
    const nested = [{ ...inventory[0]!, collection: 'collection' }]
    expect(compareProjectSkill(params, nested, projects).libraryUpdate).toBeUndefined()
    mkdirSync(join(local, '.git'))
    writeFileSync(join(local, '.git/config'), 'Do not publish metadata')
    expect(review().libraryUpdate).toBeUndefined()
    rmSync(join(local, '.git'), { recursive: true })
    writeFileSync(join(local, '.env'), 'SECRET=private')
    expect(review().libraryUpdate).toBeUndefined()
    rmSync(join(local, '.env'))
    const libraryElsewhere = join(root, 'elsewhere')
    renameSync(library, libraryElsewhere)
    symlinkSync(libraryElsewhere, library)
    expect(review().libraryUpdate).toBeUndefined()
    rmSync(library)
    renameSync(libraryElsewhere, library)
    const projectElsewhere = join(project, 'elsewhere')
    renameSync(local, projectElsewhere)
    symlinkSync(projectElsewhere, local)
    expect(review().libraryUpdate).toBeUndefined()
    rmSync(local)
    renameSync(projectElsewhere, local)
    await updateProjectSkillToLibrary({ ...params, ...review().libraryUpdate! }, inventory, trash, projects)
    expect(readFileSync(join(library, 'scripts/check.sh'), 'utf8')).toBe('echo Project\n')
    expect(statSync(join(library, 'scripts/check.sh')).mode & 0o777).toBe(0o755)
    expect(readFileSync(join(local, 'project-only.txt'), 'utf8')).toBe('Changed after review\n')
    expect(existsSync(join(library, 'library-only.txt'))).toBe(false)
    expect(readFileSync(join(moved[0]!, 'library-only.txt'), 'utf8')).toBe('Library changed after review\n')
    expect(review().comparison.changed_files).toEqual([])
    expect(review().comparison.only_on_computer).toEqual([])
    writeFileSync(join(local, 'SKILL.md'), '---\nname: Example\n---\nNew instructions\n')
    const fallback = await updateProjectSkillToLibrary({ ...params, ...review().libraryUpdate! }, inventory, async () => { throw new Error('Trash unavailable') }, projects)
    expect(readFileSync(join(fallback.backupPath!, 'SKILL.md'), 'utf8')).toContain('Instructions')
    expect(readFileSync(join(library, 'SKILL.md'), 'utf8')).toContain('New instructions')
  } finally {
    if (previousHome === undefined) delete process.env.SKILLER_TEST_HOME
    else process.env.SKILLER_TEST_HOME = previousHome
    rmSync(root, { recursive: true, force: true })
  }
})
