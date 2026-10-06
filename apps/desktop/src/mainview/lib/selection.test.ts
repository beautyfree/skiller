import { expect, test } from 'bun:test'
import { visibleSkillSelection, visibleResultSelection } from './selection'

test('a filter removes hidden selections permanently before bulk actions', () => {
  const selected = new Set(['frontend', 'testing'])
  const filtered = visibleSkillSelection(selected, ['testing'])
  expect([...filtered]).toEqual(['testing'])
  expect(visibleSkillSelection(filtered, ['frontend', 'testing'])).toBe(filtered)
  expect([...visibleSkillSelection(filtered, [])]).toEqual([])
  expect([...visibleSkillSelection(new Set(['gone']), ['new'])]).toEqual([])
})

test('changed marketplace results cannot leave details on a missing skill', () => {
  expect(visibleResultSelection('react', ['testing', 'react'])).toBe('react')
  expect(visibleResultSelection('react', ['testing'])).toBe('testing')
  expect(visibleResultSelection('react', [])).toBeNull()
  expect(visibleResultSelection(null, ['testing'])).toBe('testing')
})
