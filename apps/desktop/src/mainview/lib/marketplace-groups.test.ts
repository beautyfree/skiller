import { expect, test } from 'bun:test';
import { groupMarketplaceRows, marketplaceSkillKey } from './marketplace-groups';
import { packSkillRows } from './skill-grid';

test('repository grouping retains individual identities and counts only returned skills', () => {
  const a = { name: 'review', source: 'skills.sh', repository: 'https://github.com/acme/tools.git', catalog_id: 'acme/tools/review' };
  const b = { ...a, repository: 'https://github.com/Acme/Tools/', catalog_id: 'acme/tools/testing' };
  const unrelated = { name: 'other', source: 'skills.sh', repository: 'https://github.com/acme/other' };
  const claw = { name: 'claw', source: 'clawhub', repository: a.repository };
  const skills = [a, unrelated, b, claw];
  expect(marketplaceSkillKey(a)).not.toBe(marketplaceSkillKey(b));
  expect(groupMarketplaceRows(skills, false, new Set()).map(row => row.key)).toEqual(skills.map(marketplaceSkillKey));
  const rows = groupMarketplaceRows(skills, true, new Set());
  expect(rows[0]).toMatchObject({ kind: 'collection_header', count: 2 });
  expect(rows.filter(row => row.kind !== 'collection_header').map(row => row.skill)).toEqual([a, b, unrelated, claw]);
  expect(packSkillRows(rows, 3)[0]).toHaveLength(1);
  expect(groupMarketplaceRows(skills, true, new Set(['repository:acme/tools'])).filter(row => row.kind !== 'collection_header').map(row => row.skill)).toEqual([unrelated, claw]);
  expect(groupMarketplaceRows([unrelated, claw], true, new Set()).every(row => row.kind === 'standalone')).toBe(true);
});


test('repository installs sum loaded skills and stay unknown when a count is missing', () => {
  const skills = [
    { name: 'a', source: 'skills.sh', repository: 'https://github.com/acme/tools', installs: 1200 },
    { name: 'b', source: 'skills.sh', repository: 'https://github.com/acme/tools', installs: 800 },
  ];
  expect(groupMarketplaceRows(skills, true, new Set())[0]).toMatchObject({ installs: 2000 });
  expect(groupMarketplaceRows([{ ...skills[0], installs: 0 }, { ...skills[1], installs: 0 }], true, new Set())[0]).toMatchObject({ installs: 0 });
  expect(groupMarketplaceRows([skills[0], { ...skills[1], installs: null }], true, new Set())[0]).toMatchObject({ installs: null });
});
