import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverSkills } from 'dotagents/discovery';
import { checkGlobalSkillUpdates, reviewGlobalSkillUpdate, applyReviewedManagedSkillUpdates } from 'dotagents/global-skill-updates';
import type { LocalSkillSourceRecord } from 'dotagents/source-registry';

test('updates use the installed folder identity even when frontmatter names differ', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'skiller-update-identity-'));
  try {
    const root = join(fixture, 'library');
    const local = join(root, 'composition-patterns');
    const remoteRoot = join(fixture, 'source');
    const remotePath = join(remoteRoot, 'skills', 'composition-patterns');
    mkdirSync(local, { recursive: true }); mkdirSync(remotePath, { recursive: true });
    const previous = '---\nname: vercel-composition-patterns\ndescription: Fixture\n---\nPrevious version\n';
    const current = previous.replace('Previous', 'Current');
    writeFileSync(join(local, 'SKILL.md'), previous);
    writeFileSync(join(remotePath, 'SKILL.md'), current);
    const localSkill = (await discoverSkills([{ path: root, kind: 'shared' }])).skills[0]!;
    const remoteSkill = (await discoverSkills([{ path: remoteRoot, kind: 'shared' }])).skills[0]!;
    const repository = 'https://github.com/example/skills';
    const sources: Record<string, LocalSkillSourceRecord> = { 'composition-patterns': {
      source: 'git', repository, skill_path: 'skills/composition-patterns', ref: null, content_sha256: null,
      observed_integrity: localSkill.integrity, ownership: 'external', forked_from: null,
      first_seen_at: new Date().toISOString(), updated_at: new Date().toISOString(), reviewed_at: null,
    } };
    const openSession = async () => ({ path: remoteRoot, skills: [remoteSkill], findSkill: () => remoteSkill.sourcePath, dispose: async () => {} });
    const check = await checkGlobalSkillUpdates({ roots: [{ path: root, kind: 'shared' }], managedRoots: [root], sources, openSession });
    expect(check.items[0]).toMatchObject({ skill: 'composition-patterns', state: 'update-available', managed: true });
    const update = { skill: 'composition-patterns', repository, skillPath: 'skills/composition-patterns', expectedLocalIntegrity: localSkill.integrity, expectedRemoteIntegrity: remoteSkill.integrity };
    const review = await reviewGlobalSkillUpdate({ root, sources, update, openSession });
    expect(review.changes).toMatchObject([{ path: 'SKILL.md', kind: 'modified' }]);
    const result = await applyReviewedManagedSkillUpdates({ root, sources, updates: [update], openSession });
    expect(result.updated[0]).toMatchObject({ skill: 'composition-patterns', integrity: remoteSkill.integrity });
    expect(readFileSync(join(local, 'SKILL.md'), 'utf8')).toBe(current);
    await expect(applyReviewedManagedSkillUpdates({ root, sources, updates: [update], openSession })).rejects.toThrow('Local skill changed after review');
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
