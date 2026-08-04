import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listOperationHistory } from 'dotagents/history'
import { ScopeCompositionSession, type ScopeProfileReference } from './scope-composition'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture(): {
  root: string
  stateFile: string
  profiles: ScopeProfileReference[]
  workspaces: Record<string, string>
} {
  const root = mkdtempSync(join(tmpdir(), 'skiller-scope-composition-'))
  roots.push(root)
  const workspaces: Record<string, string> = {}
  for (const [profileId, library, skill, body] of [
    ['personal-kit', 'personal-kit', 'alpha', 'Personal alpha'],
    ['project-kit', 'project-kit', 'beta', 'Project beta'],
  ]) {
    const workspace = join(root, profileId)
    workspaces[profileId] = workspace
    mkdirSync(join(workspace, 'skills', skill), { recursive: true })
    writeFileSync(join(workspace, 'skills', skill, 'SKILL.md'), '---\nname: ' + skill + '\n---\n\n' + body + '\n')
    writeFileSync(join(workspace, 'skills.json'), JSON.stringify({
      schema_version: 1,
      name: library,
      version: '1.0.0',
      skills: ['skills/' + skill],
      dependencies: {},
    }) + '\n')
  }
  return {
    root,
    stateFile: join(root, 'device', 'scope-composition.local.json'),
    profiles: [
      { profileId: 'personal-kit', canonical: true },
      { profileId: 'project-kit', canonical: true },
    ],
    workspaces,
  }
}

function session(current: ReturnType<typeof fixture>): ScopeCompositionSession {
  return new ScopeCompositionSession({
    stateFile: current.stateFile,
    resolveWorkspace: (profileId) => current.workspaces[profileId] ?? join(current.root, 'missing'),
  })
}

describe('Skiller scope composition adapter', () => {
  test('migrates a legacy canonical library only after an explicit path-free review', async () => {
    const current = fixture()
    const adapter = session(current)
    const before = await adapter.overview(current.profiles)
    expect(before.profiles[0]).toMatchObject({ scope: null, migration_required: true })

    const preview = await adapter.previewMigration({ profileId: 'personal-kit', scope: 'personal' })
    expect(preview).toMatchObject({
      profile_id: 'personal-kit',
      scope: 'personal',
      file: 'dotagents.scope.json',
      content: { schema_version: 1, scope: 'personal' },
    })
    expect(JSON.stringify(preview)).not.toContain(current.root)
    expect(() => readFileSync(join(current.workspaces['personal-kit'], 'dotagents.scope.json'), 'utf8')).toThrow()

    const applied = await adapter.applyMigration({ profileId: 'personal-kit', planId: preview.plan_id })
    expect(applied.history_id).toBeString()
    expect(listOperationHistory(current.workspaces['personal-kit'])[0]?.operation).toBe('scope-migration')
    expect((await adapter.overview(current.profiles)).profiles[0]).toMatchObject({
      scope: 'personal',
      migration_required: false,
    })
  })

  test('stores only reviewed profile ids and exclusions in the Device overlay', async () => {
    const current = fixture()
    writeFileSync(join(current.workspaces['personal-kit'], 'dotagents.scope.json'), '{"schema_version":1,"scope":"personal"}\n')
    writeFileSync(join(current.workspaces['project-kit'], 'dotagents.scope.json'), '{"schema_version":1,"scope":"project"}\n')
    const adapter = session(current)
    const preview = await adapter.previewComposition({
      profiles: current.profiles,
      personalProfileId: 'personal-kit',
      projectProfileId: 'project-kit',
      exclusions: ['skill:beta'],
    })
    expect(preview.has_blockers).toBe(false)
    expect(preview.resources.map((resource) => [resource.key, resource.excluded_by_device])).toEqual([
      ['skill:alpha', false],
      ['skill:beta', true],
    ])
    expect(JSON.stringify(preview)).not.toContain(current.root)

    await adapter.applyComposition(preview.plan_id, current.profiles)
    const stored = JSON.parse(readFileSync(current.stateFile, 'utf8'))
    expect(stored).toEqual({
      schema_version: 1,
      personal_profile_id: 'personal-kit',
      project_profile_id: 'project-kit',
      exclusions: ['skill:beta'],
    })
    expect(statSync(current.stateFile).mode & 0o777).toBe(0o600)
    expect((await adapter.overview(current.profiles)).active?.resources).toEqual(preview.resources)
  })

  test('rejects composition when selected library content changes after review', async () => {
    const current = fixture()
    writeFileSync(join(current.workspaces['personal-kit'], 'dotagents.scope.json'), '{"schema_version":1,"scope":"personal"}\n')
    writeFileSync(join(current.workspaces['project-kit'], 'dotagents.scope.json'), '{"schema_version":1,"scope":"project"}\n')
    const adapter = session(current)
    const preview = await adapter.previewComposition({
      profiles: current.profiles,
      personalProfileId: 'personal-kit',
      projectProfileId: 'project-kit',
      exclusions: [],
    })
    writeFileSync(join(current.workspaces['project-kit'], 'skills', 'beta', 'SKILL.md'), '---\nname: beta\n---\n\nChanged\n')
    await expect(adapter.applyComposition(preview.plan_id, current.profiles)).rejects.toThrow('changed after review')
  })

  test('records a private Device change and restores it only through reviewed Undo', async () => {
    const current = fixture()
    writeFileSync(join(current.workspaces['personal-kit'], 'dotagents.scope.json'), '{"schema_version":1,"scope":"personal"}\n')
    writeFileSync(join(current.workspaces['project-kit'], 'dotagents.scope.json'), '{"schema_version":1,"scope":"project"}\n')
    const adapter = session(current)
    const preview = await adapter.previewComposition({
      profiles: current.profiles,
      personalProfileId: 'personal-kit',
      projectProfileId: 'project-kit',
      exclusions: ['skill:beta'],
    })
    await adapter.applyComposition(preview.plan_id, current.profiles)

    const undo = await adapter.previewCompositionUndo(current.profiles)
    expect(undo).toMatchObject({
      has_conflicts: false,
      target: { personal_profile_id: null, project_profile_id: null, exclusions: [] },
      composition: null,
    })
    expect(JSON.stringify(undo)).not.toContain(current.root)
    const historyPath = current.stateFile + '.history.json'
    expect(statSync(historyPath).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(historyPath, 'utf8')).records).toHaveLength(1)

    await adapter.applyCompositionUndo(undo!.plan_id, current.profiles)
    expect(JSON.parse(readFileSync(current.stateFile, 'utf8'))).toEqual({
      schema_version: 1,
      personal_profile_id: null,
      project_profile_id: null,
      exclusions: [],
    })
    expect(JSON.parse(readFileSync(historyPath, 'utf8')).records.map((record: { operation: string }) => record.operation)).toEqual([
      'scope-composition',
      'scope-composition-undo',
    ])
  })

  test('rejects Device Undo when the active overlay changes after review', async () => {
    const current = fixture()
    writeFileSync(join(current.workspaces['personal-kit'], 'dotagents.scope.json'), '{"schema_version":1,"scope":"personal"}\n')
    const adapter = session(current)
    const preview = await adapter.previewComposition({
      profiles: current.profiles,
      personalProfileId: 'personal-kit',
      projectProfileId: null,
      exclusions: [],
    })
    await adapter.applyComposition(preview.plan_id, current.profiles)
    const undo = await adapter.previewCompositionUndo(current.profiles)
    writeFileSync(current.stateFile, '{"schema_version":1,"personal_profile_id":"personal-kit","project_profile_id":null,"exclusions":["skill:alpha"]}\n')
    await expect(adapter.applyCompositionUndo(undo!.plan_id, current.profiles)).rejects.toThrow('changed after review')
  })

  test('recovers a completed Device write whose history append was interrupted', async () => {
    const current = fixture()
    writeFileSync(join(current.workspaces['personal-kit'], 'dotagents.scope.json'), '{"schema_version":1,"scope":"personal"}\n')
    mkdirSync(join(current.root, 'device'), { recursive: true })
    const after = { schema_version: 1, personal_profile_id: 'personal-kit', project_profile_id: null, exclusions: [] }
    writeFileSync(current.stateFile, JSON.stringify(after) + '\n')
    const journalPath = current.stateFile + '.journal.json'
    writeFileSync(journalPath, JSON.stringify({
      schema_version: 1,
      record: {
        schema_version: 1,
        id: 'a7fca3e5-dfe0-44f5-a48f-a1b5327376a5',
        operation: 'scope-composition',
        source_plan_id: 'a'.repeat(64),
        completed_at: '2026-08-04T00:00:00.000Z',
        before: { schema_version: 1, personal_profile_id: null, project_profile_id: null, exclusions: [] },
        after,
      },
    }) + '\n')

    const adapter = session(current)
    expect((await adapter.overview(current.profiles)).active?.personal_profile_id).toBe('personal-kit')
    const history = JSON.parse(readFileSync(current.stateFile + '.history.json', 'utf8'))
    expect(history.records).toHaveLength(1)
    expect(existsSync(journalPath)).toBe(false)
  })

  test('refuses oversized Device history before reading it into an Undo review', async () => {
    const current = fixture()
    mkdirSync(join(current.root, 'device'), { recursive: true })
    writeFileSync(current.stateFile + '.history.json', 'x'.repeat(512 * 1024 + 1))

    await expect(session(current).previewCompositionUndo(current.profiles)).rejects
      .toThrow('Device scope history needs repair')
  })

  test('refuses oversized Device state before composing with it', async () => {
    const current = fixture()
    mkdirSync(join(current.root, 'device'), { recursive: true })
    writeFileSync(current.stateFile, 'x'.repeat(512 * 1024 + 1))

    await expect(session(current).overview(current.profiles)).rejects
      .toThrow('Device scope settings need repair')
  })

  test('refuses a Device change whose inverse cannot fit in bounded local history', async () => {
    const current = fixture()
    writeFileSync(join(current.workspaces['personal-kit'], 'dotagents.scope.json'), '{"schema_version":1,"scope":"personal"}\n')
    const adapter = session(current)
    const preview = await adapter.previewComposition({
      profiles: current.profiles,
      personalProfileId: 'personal-kit',
      projectProfileId: null,
      exclusions: ['skill:' + 'a'.repeat(512 * 1024)],
    })

    await expect(adapter.applyComposition(preview.plan_id, current.profiles)).rejects
      .toThrow('too large to retain safely')
    expect(existsSync(current.stateFile)).toBe(false)
    expect(existsSync(current.stateFile + '.journal.json')).toBe(false)
  })
})
