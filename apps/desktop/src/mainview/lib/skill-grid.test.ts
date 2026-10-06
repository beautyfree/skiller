import { expect, test } from 'bun:test';
import { packSkillRows } from './skill-grid';

test('grid rows preserve order and isolate collection headers and children at every column count', () => {
  const rows = [
    { kind: 'standalone', id: 'a' }, { kind: 'standalone', id: 'b' }, { kind: 'standalone', id: 'c' },
    { kind: 'collection_header', id: 'package' },
    { kind: 'collection_child', id: 'd' }, { kind: 'collection_child', id: 'e' },
    { kind: 'standalone', id: 'f' }, { kind: 'section', id: 'section' }, { kind: 'standalone', id: 'g' },
  ];
  for (const columns of [1, 2, 3, 4]) {
    const packed = packSkillRows(rows, columns);
    expect(packed.flat()).toEqual(rows);
    expect(packed.every(group => group.length <= columns && group.every(row => row.kind === group[0]!.kind))).toBe(true);
    expect(packed.find(group => group[0]!.id === 'package')).toHaveLength(1);
  }
  expect(packSkillRows(rows, 1).every(group => group.length === 1)).toBe(true);
  expect(packSkillRows([], 3)).toEqual([]);
});

test('collapsed repository cards share grid rows; expansion starts a separate section', () => {
  const closed = [{ kind: 'standalone', id: 'a' }, { kind: 'collection_header', id: 'repo', collapsed: true }, { kind: 'standalone', id: 'b' }];
  expect(packSkillRows(closed, 3)).toEqual([closed]);
  expect(packSkillRows(closed, 2).map(row => row.map(item => item.id))).toEqual([['a', 'repo'], ['b']]);
  const expanded = [closed[0]!, { ...closed[1]!, collapsed: false }, { kind: 'collection_child', id: 'member' }, closed[2]!];
  expect(packSkillRows(expanded, 3).map(row => row.map(item => item.id))).toEqual([['a'], ['repo'], ['member'], ['b']]);
});
