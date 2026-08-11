import { describe, expect, test } from 'bun:test'
import { classifyLibraryLocalChanges } from './sync-library-local-changes'

const hash = (character: string) => character.repeat(64)

describe('Agent Library local change classification', () => {
  test('compares direct agent roots as well as the shared root', () => {
    const changes = classifyLibraryLocalChanges({
      inventory: {
        items: [
          {
            candidateKey: 'review',
            displayName: 'review',
            description: null,
            whenToUse: null,
            contentHash: hash('b'),
            sourcePath: '/private/agent/skills/review',
            locations: [{ agentSlug: 'codex', kind: 'agent-local' }],
          },
          {
            candidateKey: 'new-tool',
            displayName: 'new-tool',
            description: null,
            whenToUse: null,
            contentHash: hash('c'),
            sourcePath: '/private/agent/skills/new-tool',
            locations: [{ agentSlug: 'claude', kind: 'agent-local' }],
          },
        ],
        collisions: [],
        invalidPaths: 0,
        invalidEntries: [],
        linkedAliases: 0,
      },
      manifest: {
        schema_version: 3,
        profile: { id: 'personal', mode: 'private' },
        agent_policy: { mode: 'detected' },
        skills: [
          { id: 'review', kind: 'bundled', path: 'skills/review', sha256: hash('a') },
          { id: 'missing', kind: 'bundled', path: 'skills/missing', sha256: hash('d') },
        ],
      },
      ledger: {
        schema_version: 1,
        profile_id: 'personal',
        updated_at: '2026-08-10T00:00:00.000Z',
        skills: { review: { sha256: hash('a') }, missing: { sha256: hash('d') } },
        observed_content_hashes: { review: hash('a'), missing: hash('d') },
      },
      restoreEntries: [],
    })

    expect(changes).toEqual([
      expect.objectContaining({ id: 'review', kind: 'changed-local' }),
      expect.objectContaining({ id: 'new-tool', kind: 'new-local' }),
      expect.objectContaining({ id: 'missing', kind: 'missing-local' }),
    ])
    expect(JSON.stringify(changes)).not.toContain('/private/agent')
  })

  test('does not report a library skill as missing before this computer has used it', () => {
    const changes = classifyLibraryLocalChanges({
      inventory: { items: [], collisions: [], invalidPaths: 0, invalidEntries: [], linkedAliases: 0 },
      manifest: {
        schema_version: 3,
        profile: { id: 'personal', mode: 'team' },
        agent_policy: { mode: 'detected' },
        skills: [{ id: 'team-tool', kind: 'bundled', path: 'skills/team-tool', sha256: hash('a') }],
      },
      ledger: null,
      restoreEntries: [],
    })

    expect(changes).toEqual([])
  })

  test('does not turn first-time restore-plan conflicts into local changes', () => {
    const changes = classifyLibraryLocalChanges({
      inventory: {
        items: [{
          candidateKey: 'existing', displayName: 'existing', description: null,
          whenToUse: null, contentHash: hash('a'), sourcePath: '/private/skills/existing', locations: [{ kind: 'shared' }],
        }],
        collisions: [], invalidPaths: 0, invalidEntries: [], linkedAliases: 0,
      },
      manifest: {
        schema_version: 3,
        profile: { id: 'personal', mode: 'private' },
        agent_policy: { mode: 'detected' },
        skills: [{ id: 'existing', kind: 'bundled', path: 'skills/existing', sha256: hash('a') }],
      },
      ledger: null,
      restoreEntries: [{ id: 'existing', localState: 'directory', threeWayAction: 'conflict' }],
    })

    expect(changes).toEqual([])
  })

  test('keeps an unmanaged skill untracked even after an earlier filesystem scan', () => {
    const changes = classifyLibraryLocalChanges({
      inventory: {
        items: [{
          candidateKey: 'iphone-use', displayName: 'iPhone Use', description: null,
          whenToUse: null, contentHash: hash('i'), sourcePath: '/private/skills/iphone-use', locations: [{ kind: 'shared' }],
        }],
        collisions: [], invalidPaths: 0, invalidEntries: [], linkedAliases: 0,
      },
      manifest: {
        schema_version: 3,
        profile: { id: 'personal', mode: 'private' },
        agent_policy: { mode: 'detected' },
        skills: [],
      },
      ledger: {
        schema_version: 1,
        profile_id: 'personal',
        updated_at: '2026-08-10T00:00:00.000Z',
        skills: {},
        observed_content_hashes: { 'iphone-use': hash('i') },
      },
      restoreEntries: [],
    })

    expect(changes).toEqual([
      expect.objectContaining({ id: 'iphone-use', kind: 'new-local' }),
    ])
  })
})
