import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertSkillDestinationsAvailable } from './install';

test('repository batch imports refuse existing packages and dangling links without changing them', () => {
  const root = mkdtempSync(join(tmpdir(), 'skiller-repo-install-'));
  try {
    const existing = join(root, 'existing');
    mkdirSync(existing);
    writeFileSync(join(existing, 'SKILL.md'), 'user changes');
    const link = join(root, 'linked');
    symlinkSync(join(root, 'missing'), link);
    expect(() => assertSkillDestinationsAvailable([join(root, 'new')])).not.toThrow();
    expect(() => assertSkillDestinationsAvailable([join(root, 'new'), existing])).toThrow('already exists');
    expect(() => assertSkillDestinationsAvailable([link])).toThrow('already exists');
    expect(readFileSync(join(existing, 'SKILL.md'), 'utf8')).toBe('user changes');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
