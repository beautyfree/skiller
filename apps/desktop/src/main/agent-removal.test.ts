import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trashAgentSkill } from './uninstall';
import { defaultAgentConfig } from './types';
import { scanAllSkills } from './scanner';

test('scoped batch removal preserves other agents, shared sources and symlink targets', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'skiller-agent-trash-')));
  try {
    const a = defaultAgentConfig({ slug: 'qa-first', name: 'First', global_paths: [join(root, 'first')], detected: true });
    const b = defaultAgentConfig({ slug: 'qa-second', name: 'Second', global_paths: [join(root, 'second')], detected: true });
    const id = 'qa-scoped-removal';
    for (const agent of [a, b]) {
      mkdirSync(join(agent.global_paths[0]!, id), { recursive: true });
      writeFileSync(join(agent.global_paths[0]!, id, 'SKILL.md'), '---\nname: QA scoped removal\ndescription: Test\n---\nInstructions');
    }
    const original = readFileSync(join(b.global_paths[0]!, id, 'SKILL.md'), 'utf8');
    const agents = [a, b];
    const scan = () => scanAllSkills(agents);
    const moved: string[] = [];
    mkdirSync(join(root, 'trash'));
    const trash = async (path: string) => { renameSync(path, join(root, 'trash', String(moved.length))); moved.push(path); };
    await expect(trashAgentSkill('../outside', a.slug, agents, scan(), trash)).rejects.toThrow('Invalid');
    await expect(trashAgentSkill(id, 'unknown', agents, scan(), trash)).rejects.toThrow('not found');
    await expect(trashAgentSkill(id, a.slug, agents, scan(), async () => { throw new Error('Trash unavailable'); })).rejects.toThrow('Trash unavailable');
    expect(existsSync(join(a.global_paths[0]!, id))).toBe(true);
    b.additional_readable_paths = [{ path: a.global_paths[0]!, source_agent: a.slug }];
    await expect(trashAgentSkill(id, a.slug, agents, scan(), trash)).rejects.toThrow('Keep');
    b.additional_readable_paths = [];
    await trashAgentSkill(id, a.slug, agents, scan(), trash);
    expect(moved).toEqual([join(a.global_paths[0]!, id)]);
    expect(readFileSync(join(b.global_paths[0]!, id, 'SKILL.md'), 'utf8')).toBe(original);
    symlinkSync(join(b.global_paths[0]!, id), join(a.global_paths[0]!, id));
    await trashAgentSkill(id, a.slug, agents, scan(), trash);
    expect(readFileSync(join(b.global_paths[0]!, id, 'SKILL.md'), 'utf8')).toBe(original);
    a.additional_readable_paths = [{ path: b.global_paths[0]!, source_agent: b.slug }];
    await expect(trashAgentSkill(id, a.slug, agents, scan(), trash)).rejects.toThrow('shared source');
    expect(moved).toHaveLength(2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
