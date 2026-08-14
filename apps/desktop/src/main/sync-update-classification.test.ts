import { expect, test } from 'bun:test'
import { isLibraryDocumentationOnlyUpdate } from './sync-update-classification'

test('treats documentation-only remote changes separately from skills', () => {
  expect(isLibraryDocumentationOnlyUpdate(['README.md'])).toBe(true)
  expect(isLibraryDocumentationOnlyUpdate(['README.md', 'docs/using-this-library.md', 'LICENSE'])).toBe(true)
})

test('keeps portable content and configuration in the explicit sync review', () => {
  for (const file of ['skills.json', 'skills.lock', 'dotagents.yaml', '.gitignore', 'skills/review/SKILL.md']) {
    expect(isLibraryDocumentationOnlyUpdate([file])).toBe(false)
  }
  expect(isLibraryDocumentationOnlyUpdate([])).toBe(false)
})
