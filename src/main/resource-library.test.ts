import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryRepairSession, ResourceAdoptionSession, readResourceLibraryOverview } from './resource-library'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture(): { workspace: string; source: string } {
  const root = mkdtempSync(join(tmpdir(), 'skiller-resource-library-'))
  roots.push(root)
  const workspace = join(root, 'library')
  mkdirSync(workspace)
  writeFileSync(join(workspace, 'skills.json'), `${JSON.stringify({ schema_version: 1, name: 'library', version: '1.0.0', license: 'MIT', skills: [], dependencies: {} })}\n`)
  writeFileSync(join(workspace, 'dotagents.yaml'), 'schema_version: 1\nskills: {}\n')
  writeFileSync(join(workspace, '.gitignore'), '')
  const source = join(root, 'review.md')
  writeFileSync(source, '# Review\n')
  return { workspace, source }
}

describe('Skiller resource library adapter', () => {
  test('keeps native paths behind opaque selections and exposes only portable review data', async () => {
    const current = fixture()
    const session = new ResourceAdoptionSession()
    const selected = session.registerSelection(current.source, 'command')
    expect(JSON.stringify(selected)).not.toContain(current.source)
    const preview = await session.preview({
      workspace: current.workspace, profileId: 'personal', mode: 'public',
      request: { profileId: 'personal', selectionId: selected.selection_id, kind: 'command', id: 'review', invocation: 'review' },
    })
    expect(preview).toMatchObject({ resource: { key: 'command:review', path: 'commands/review.md' }, blockers: [] })
    expect(JSON.stringify(preview)).not.toContain(current.workspace)
    const applied = await session.apply(preview.plan_id)
    expect(applied.resource_key).toBe('command:review')
    expect(readResourceLibraryOverview({ workspace: current.workspace, profileId: 'personal', mode: 'public', changed: true }).resources).toContainEqual(
      expect.objectContaining({ key: 'command:review', source: 'resource-v2' }),
    )
    expect(readFileSync(join(current.workspace, 'commands/review.md'), 'utf8')).toBe('# Review\n')
  })

  test('blocks secret-bearing sources without returning the value', async () => {
    const current = fixture()
    const secret = 'ghp_abcdefghijklmnopqrstuvwxyz123456'
    writeFileSync(current.source, secret)
    const session = new ResourceAdoptionSession()
    const selected = session.registerSelection(current.source, 'instruction')
    const preview = await session.preview({
      workspace: current.workspace, profileId: 'personal', mode: 'private',
      request: { profileId: 'personal', selectionId: selected.selection_id, kind: 'instruction', id: 'review' },
    })
    expect(preview.blockers).toContainEqual(expect.objectContaining({ code: 'secret' }))
    expect(JSON.stringify(preview)).not.toContain(secret)
    await expect(session.apply(preview.plan_id)).rejects.toThrow('blockers')
  })

  test('reviews and applies a path-free repair through durable history', async () => {
    const current = fixture()
    const session = new LibraryRepairSession()
    const health = await session.health(current.workspace, 'personal')
    expect(health.issues).toContainEqual(expect.objectContaining({ code: 'local-state-not-ignored', repairable: true }))
    expect(JSON.stringify(health)).not.toContain(current.workspace)

    const preview = await session.preview({
      workspace: current.workspace,
      profileId: 'personal',
      selectedCodes: ['local-state-not-ignored'],
    })
    expect(preview).toMatchObject({
      profile_id: 'personal',
      has_blockers: false,
      actions: [{ kind: 'update-gitignore', path: '.gitignore', add: ['dotagents.local.yaml', '.dotagents/'] }],
    })
    expect(JSON.stringify(preview)).not.toContain(current.workspace)
    expect(readFileSync(join(current.workspace, '.gitignore'), 'utf8')).toBe('')

    const applied = session.apply({ workspace: current.workspace, profileId: 'personal', planId: preview.plan_id })
    expect(applied.history_id).toBeString()
    expect(readFileSync(join(current.workspace, '.gitignore'), 'utf8')).toBe('dotagents.local.yaml\n.dotagents/\n')
    expect((await session.health(current.workspace, 'personal')).issues).not.toContainEqual(
      expect.objectContaining({ code: 'local-state-not-ignored' }),
    )
  })

  test('rejects a repair after its reviewed target changes', async () => {
    const current = fixture()
    const session = new LibraryRepairSession()
    const preview = await session.preview({
      workspace: current.workspace,
      profileId: 'personal',
      selectedCodes: ['local-state-not-ignored'],
    })
    writeFileSync(join(current.workspace, '.gitignore'), 'dist/\n')
    expect(() => session.apply({ workspace: current.workspace, profileId: 'personal', planId: preview.plan_id })).toThrow(
      'changed after review',
    )
  })
})
