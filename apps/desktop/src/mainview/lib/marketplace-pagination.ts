import type { MarketplaceSkill } from '@/main/marketplace-types';
import { marketplaceSkillKey } from './marketplace-groups';

export function nextMarketplacePage(pages: MarketplaceSkill[][]): number | undefined {
  const last = pages[pages.length - 1];
  if (!last || last.length < 50) return undefined;
  const previous = new Set(pages.slice(0, -1).flat().map(marketplaceSkillKey));
  return last.some(skill => !previous.has(marketplaceSkillKey(skill))) ? pages.length + 1 : undefined;
}
