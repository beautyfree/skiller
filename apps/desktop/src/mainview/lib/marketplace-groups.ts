import type { MarketplaceSkill } from '@/main/marketplace-types';

export function marketplaceSkillKey(skill: MarketplaceSkill): string {
  return JSON.stringify([skill.source, skill.repository?.replace(/\/$/, '') ?? null, skill.catalog_id ?? skill.skill_path ?? skill.name]);
}

export function marketplaceRepository(skill: MarketplaceSkill): string | null {
  if (skill.source !== 'skills.sh' || !skill.repository) return null;
  try {
    const url = new URL(skill.repository);
    const [owner, repository] = url.pathname.split('/').filter(Boolean);
    if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'github.com' || !owner || !repository) return null;
    return `${owner}/${repository.replace(/\.git$/, '')}`;
  } catch { return null; }
}

export type MarketplaceRow<T> =
  | { kind: 'collection_header'; key: string; repository: string; count: number; installs: number | null; collapsed: boolean }
  | { kind: 'standalone' | 'collection_child'; key: string; skill: T };

/** Repository grouping applies only to the current results; it is not a complete package inventory. */
export function groupMarketplaceRows<T extends MarketplaceSkill>(skills: T[], grouped: boolean, collapsed: Set<string>): MarketplaceRow<T>[] {
  if (!grouped) return skills.map(skill => ({ kind: 'standalone', key: marketplaceSkillKey(skill), skill }));
  const repositories = new Map<string, { name: string; skills: T[] }>();
  for (const skill of skills) {
    const name = marketplaceRepository(skill);
    if (!name) continue;
    const key = name.toLowerCase();
    const group = repositories.get(key) ?? { name, skills: [] };
    group.skills.push(skill);
    repositories.set(key, group);
  }
  const seen = new Set<string>();
  return skills.flatMap(skill => {
    const repository = marketplaceRepository(skill)?.toLowerCase();
    const group = repository ? repositories.get(repository) : undefined;
    if (!repository || !group || group.skills.length < 2) return [{ kind: 'standalone', key: marketplaceSkillKey(skill), skill } as MarketplaceRow<T>];
    if (seen.has(repository)) return [];
    seen.add(repository);
    const key = `repository:${repository}`;
    const rows: MarketplaceRow<T>[] = [{ kind: 'collection_header', key, repository: group.name, count: group.skills.length, installs: group.skills.every(skill => skill.installs != null) ? group.skills.reduce((total, skill) => total + skill.installs!, 0) : null, collapsed: collapsed.has(key) }];
    if (!collapsed.has(key)) rows.push(...group.skills.map(skill => ({ kind: 'collection_child' as const, key: marketplaceSkillKey(skill), skill })));
    return rows;
  });
}
