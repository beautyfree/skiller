import { randomUUID, createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { DEFAULT_SKILL_EXPORT_LIMITS } from 'dotagents/export-policy';
import { planBundledSkillExport } from './sync-export';
import { writeSkillPreset } from './skill-presets';
import type { SkillPresetJson } from '../shared/rpc-schema';

export const MAX_PACK_FILE_BYTES = 30 * 1024 * 1024;
const MAX_CONTENT_BYTES = 20 * 1024 * 1024;
const segment = (value: string) => !!value && !/[<>:"\\/|?*\x00-\x1f]/.test(value) && !/[. ]$/.test(value) && value !== '.' && value !== '..' && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
const documentSchema = z.object({
  format: z.literal('skiller-pack'), version: z.literal(1), name: z.string().trim().min(1).max(80),
  skills: z.array(z.object({
    id: z.string().min(1).max(200).refine(segment), name: z.string().min(1).max(200), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    files: z.array(z.object({ path: z.string().min(1).max(1024).refine(value => value.split('/').every(part => segment(part) && part.toLowerCase() !== '.dotagents' && !DEFAULT_SKILL_EXPORT_LIMITS.excludedDirectories.includes(part.toLowerCase()))), data: z.string().max(MAX_PACK_FILE_BYTES).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/), executable: z.boolean() }).strict()).min(1).max(5000),
  }).strict()).max(200),
}).strict();
export type PortableSkillPack = z.infer<typeof documentSchema>;

export function parseSkillPack(text: string): PortableSkillPack {
  if (Buffer.byteLength(text) > MAX_PACK_FILE_BYTES) throw new Error('Pack file exceeds 30 MB');
  const pack = documentSchema.parse(JSON.parse(text));
  let bytes = 0, files = 0;
  const ids = new Set<string>();
  for (const skill of pack.skills) {
    const id = skill.id.toLowerCase();
    if (ids.has(id)) throw new Error('Duplicate skill in pack');
    ids.add(id);
    const paths = new Set<string>();
    for (const file of skill.files) {
      const path = file.path.toLowerCase();
      if (paths.has(path)) throw new Error('Duplicate file in pack');
      paths.add(path);
      bytes += Buffer.from(file.data, 'base64').length; files++;
      if (bytes > MAX_CONTENT_BYTES || files > 5000) throw new Error('Pack exceeds 20 MB or 5000 files');
    }
    if (!skill.files.some(file => file.path === 'SKILL.md')) throw new Error('Every skill needs SKILL.md');
    for (const path of paths) {
      const parts = path.split('/');
      while (parts.length > 1) { parts.pop(); if (paths.has(parts.join('/'))) throw new Error('Conflicting file paths in pack'); }
    }
  }
  return pack;
}

export function exportSkillPack(preset: SkillPresetJson): string {
  const pack: PortableSkillPack = { format: 'skiller-pack', version: 1, name: preset.name, skills: preset.skills.map(skill => {
    if (!existsSync(skill.sourcePath)) throw new Error(`Source unavailable: ${skill.name}`);
    const plan = planBundledSkillExport(skill.id, skill.sourcePath);
    if (plan.secretFindings.length) throw new Error(`Sensitive files detected in ${skill.name}; review them before exporting`);
    return { id: skill.id, name: skill.name, sha256: plan.sha256, files: plan.files.map(file => {
      const path = join(skill.sourcePath, file.relativePath);
      const bytes = readFileSync(path);
      if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Skill changed during export; try again');
      return { path: file.relativePath, data: bytes.toString('base64'), executable: !!(statSync(path).mode & 0o111) };
    }) };
  }) };
  const text = JSON.stringify(pack, null, 2) + '\n';
  parseSkillPack(text);
  return text;
}

export function reviewSkillPackImport(pack: PortableSkillPack, root: string) {
  const rows = pack.skills.map(skill => {
    const path = join(root, skill.id);
    try { lstatSync(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { id: skill.id, state: 'add' as const };
      throw error;
    }
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory() || planBundledSkillExport(skill.id, path).sha256 !== skill.sha256) throw new Error(`A different skill already exists: ${skill.id}. It will not be overwritten.`);
    return { id: skill.id, state: 'reuse' as const };
  });
  return { name: pack.name, count: rows.length, added: rows.filter(row => row.state === 'add').length, reused: rows.filter(row => row.state === 'reuse').length };
}

/** New files only; roll back precisely the directories reserved by this import. */
export function importSkillPack(pack: PortableSkillPack, root: string, presetsDir?: string): SkillPresetJson {
  reviewSkillPackImport(pack, root);
  const created: string[] = [];
  try {
    mkdirSync(root, { recursive: true });
    const skills = pack.skills.map(skill => {
      const destination = join(root, skill.id);
      if (!existsSync(destination)) {
        mkdirSync(destination); created.push(destination);
        for (const file of skill.files) {
          const path = join(destination, file.path);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, Buffer.from(file.data, 'base64'), { flag: 'wx', mode: file.executable ? 0o755 : 0o644 });
        }
      }
      const plan = planBundledSkillExport(skill.id, destination);
      if (lstatSync(destination).isSymbolicLink() || plan.sha256 !== skill.sha256 || plan.secretFindings.length) throw new Error(`Skill changed, contains sensitive files, or pack is damaged: ${skill.id}`);
      return { id: skill.id, name: skill.name, sourcePath: realpathSync(destination) };
    });
    return writeSkillPreset({ id: randomUUID(), name: pack.name, skills }, presetsDir);
  } catch (error) {
    for (const path of created.reverse()) rmSync(path, { recursive: true, force: true });
    throw error;
  }
}
