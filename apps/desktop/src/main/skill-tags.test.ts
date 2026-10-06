import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanAllSkills } from './scanner'
import { editSkillTags, listSkillTags, renameSkillTag } from './skill-tags'

test('tags are atomic local metadata keyed by source, with additive batches and global rename/remove', () => {
  const root = mkdtempSync(join(tmpdir(), 'skiller-tags-'))
  try {
    for (const id of ['react', 'testing']) {
      const path = join(root, 'library', id)
      mkdirSync(path, { recursive: true })
      writeFileSync(join(path, 'SKILL.md'), `---\nname: ${id}\ndescription: Instructions\n---\nKeep me`)
    }
    const inventory = scanAllSkills([], join(root, 'library'))
    const refs = inventory.map(skill => ({ id: skill.id, sourcePath: skill.canonical_path }))
    const dir = join(root, 'metadata')
    expect(listSkillTags(inventory, dir)).toEqual([])
    editSkillTags({ skills: refs, add: [' frontend ', 'frontend', 'shared'], remove: [] }, inventory, dir)
    expect(listSkillTags(inventory, dir).map(row => row.tags)).toEqual([['frontend', 'shared'], ['frontend', 'shared']])
    editSkillTags({ skills: [refs[0]], add: ['testing'], remove: ['shared'] }, inventory, dir)
    expect(listSkillTags(inventory, dir).find(row => row.id === refs[0]!.id)?.tags).toEqual(['frontend', 'testing'])
    // Labels stay attached through edits, and aliases resolve to the same source.
    const alias = join(root, 'alias')
    symlinkSync(refs[0]!.sourcePath, alias)
    editSkillTags({ skills: [{ ...refs[0], sourcePath: alias }], add: ['aliased'], remove: [] }, inventory, dir)
    const contentPath = join(refs[0]!.sourcePath, 'SKILL.md')
    const original = readFileSync(contentPath, 'utf8')
    expect(original).toContain('Keep me')
    writeFileSync(contentPath, original + '\nLocal edit')
    expect(listSkillTags(inventory, dir).find(row => row.id === refs[0]!.id)?.tags).toContain('aliased')
    // An unrelated source using the same id must not acquire these tags.
    const otherRoot = join(root, 'other')
    mkdirSync(otherRoot)
    expect(listSkillTags([{ ...inventory[0]!, canonical_path: otherRoot }], dir)).toEqual([])
    const metadataFile = join(dir, 'skill-tags.json')
    const before = readFileSync(metadataFile, 'utf8')
    expect(() => editSkillTags({ skills: [refs[0], { id: refs[1]!.id, sourcePath: otherRoot }], add: ['bad'], remove: [] }, inventory, dir)).toThrow('source changed')
    expect(readFileSync(metadataFile, 'utf8')).toBe(before)
    expect(() => editSkillTags({ skills: refs, add: ['bad\nlabel'], remove: [] }, inventory, dir)).toThrow()
    expect(() => editSkillTags({ skills: refs, add: ['x'.repeat(65)], remove: [] }, inventory, dir)).toThrow()
    expect(() => editSkillTags({ skills: refs, add: Array.from({ length: 32 }, (_, i) => `tag${i}`), remove: [] }, inventory, dir)).toThrow('at most 32')
    expect(readFileSync(metadataFile, 'utf8')).toBe(before)
    renameSkillTag({ oldName: 'frontend', newName: 'testing' }, dir)
    const renamed = listSkillTags(inventory, dir)
    expect(renamed.every(row => !row.tags.includes('frontend'))).toBe(true)
    expect(renamed.every(row => row.tags.filter(tag => tag === 'testing').length === 1)).toBe(true)
    renameSkillTag({ oldName: 'testing', newName: 'testing' }, dir)
    expect(listSkillTags(inventory, dir)).toEqual(renamed)
    renameSkillTag({ oldName: 'testing', newName: null }, dir)
    expect(listSkillTags(inventory, dir).every(row => !row.tags.includes('testing'))).toBe(true)
    expect(readFileSync(contentPath, 'utf8')).toBe(original + '\nLocal edit')
    const remaining = readFileSync(metadataFile, 'utf8')
    writeFileSync(metadataFile, '{corrupt')
    expect(() => editSkillTags({ skills: refs, add: ['recover'], remove: [] }, inventory, dir)).toThrow()
    expect(readFileSync(metadataFile, 'utf8')).toBe('{corrupt')
    writeFileSync(metadataFile, remaining)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
