import { expect, test } from 'bun:test';
import { nextMarketplacePage } from './marketplace-pagination';

test('marketplace continues full pages, stops empty/short/repeated pages', () => {
  const page = Array.from({ length: 50 }, (_, id) => ({ name: String(id), source: 'skills.sh', repository: 'https://github.com/owner/repo' }));
  expect(nextMarketplacePage([page])).toBe(2);
  expect(nextMarketplacePage([page, page.map(skill => ({ ...skill, name: 'next-' + skill.name }))])).toBe(3);
  expect(nextMarketplacePage([page, page])).toBeUndefined();
  expect(nextMarketplacePage([page, page.slice(0, 3)])).toBeUndefined();
  expect(nextMarketplacePage([page, []])).toBeUndefined();
});
