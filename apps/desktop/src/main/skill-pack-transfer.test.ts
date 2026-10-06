import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { exportSkillPack, parseSkillPack, reviewSkillPackImport, importSkillPack } from './skill-pack-transfer';
import { listSkillPresets } from './skill-presets';

test('portable packs round-trip files without local paths, reuse matching skills, and preserve conflicts', () => {
  const root = mkdtempSync(join(tmpdir(), 'skiller-pack-transfer-'));
  try {
    const original = join(root, 'original', 'review'); mkdirSync(join(original, 'rules'), { recursive: true });
    const content = '---\nname: Review\ndescription: Check code\n---\nReview this code.\n';
    writeFileSync(join(original, 'SKILL.md'), content); writeFileSync(join(original, 'rules', 'check.md'), 'Check edge cases.');
    const text = exportSkillPack({ id: randomUUID(), name: 'Code review', skills: [{ id: 'review', name: 'Review', sourcePath: original }] });
    expect(text).not.toContain(root);
    const pack = parseSkillPack(text); const library = join(root, 'new-machine'); const packs = join(root, 'packs');
    expect(reviewSkillPackImport(pack, library)).toMatchObject({ added: 1, reused: 0 });
    const imported = importSkillPack(pack, library, packs);
    expect(readFileSync(join(library, 'review/SKILL.md'), 'utf8')).toBe(content);
    expect(readFileSync(join(library, 'review/rules/check.md'), 'utf8')).toBe('Check edge cases.');
    expect(listSkillPresets(packs)[0]?.id).toBe(imported.id);
    expect(reviewSkillPackImport(pack, library)).toMatchObject({ added: 0, reused: 1 });
    expect(importSkillPack(pack, library, packs).id).not.toBe(imported.id);
    writeFileSync(join(library, 'review/SKILL.md'), 'Local edits');
    expect(() => importSkillPack(pack, library, packs)).toThrow('will not be overwritten');
    expect(readFileSync(join(library, 'review/SKILL.md'), 'utf8')).toBe('Local edits');
    for (const path of ['../outside', '/absolute', 'rules/../../outside', 'a\\b', 'C:/outside', '.git/config']) {
      const broken = structuredClone(pack); broken.skills[0]!.files[0]!.path = path;
      expect(() => parseSkillPack(JSON.stringify(broken))).toThrow();
    }
    const duplicate = structuredClone(pack); duplicate.skills.push(duplicate.skills[0]!);
    expect(() => parseSkillPack(JSON.stringify(duplicate))).toThrow('Duplicate skill');
    const damaged = structuredClone(pack); damaged.skills[0]!.files[0]!.data = Buffer.from('Modified').toString('base64');
    const damagedRoot = join(root, 'damaged');
    expect(() => importSkillPack(parseSkillPack(JSON.stringify(damaged)), damagedRoot, packs)).toThrow('damaged');
    expect(existsSync(join(damagedRoot, 'review'))).toBe(false);
    const unavailable = join(root, 'missing');
    expect(() => exportSkillPack({ id: randomUUID(), name: 'Missing', skills: [{ id: 'review', name: 'Review', sourcePath: unavailable }] })).toThrow('Source unavailable');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
