import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { planBundledSkillExport } from './sync-export';

/** Both existing packages must be fully exportable; never silently drop private files. */
export function reviewedPackageHashes(id: string, sourcePath: string, targetPath: string) {
  const source = planBundledSkillExport(id, sourcePath);
  const target = planBundledSkillExport(id, targetPath);
  if ([source, target].some(plan => plan.excludedPaths.length || plan.secretFindings.length || plan.files.some(file => file.relativePath.split('/').some(part => part === '.env' || part.startsWith('.env.'))))) {
    throw new Error('Package contains excluded or sensitive files. Inspect it manually.');
  }
  return { sourceHash: source.sha256, targetHash: target.sha256 };
}

/** Ownership stays with the caller. Stage, recheck, swap and retain the previous package. */
export async function replaceReviewedPackage(params: {
  id: string; sourcePath: string; targetPath: string; sourceHash: string; targetHash: string;
}, validate: () => void, trash: (path: string) => Promise<void>): Promise<{ backupPath?: string }> {
  const { id, sourcePath, targetPath, sourceHash, targetHash } = params;
  const checkHashes = () => {
    const current = reviewedPackageHashes(id, sourcePath, targetPath);
    if (current.sourceHash !== sourceHash || current.targetHash !== targetHash) throw new Error('Files changed since review. Refresh the comparison.');
  };
  validate();
  checkHashes();
  const entry = lstatSync(targetPath);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Linked or non-directory targets cannot be replaced.');
  const plan = planBundledSkillExport(id, sourcePath);
  const staging = mkdtempSync(join(dirname(dirname(targetPath)), '.skiller-replacement-'));
  const next = join(staging, 'next');
  const previous = join(staging, id);
  let backedUp = false;
  let replaced = false;
  try {
    mkdirSync(next);
    for (const file of plan.files) {
      const source = join(sourcePath, file.relativePath);
      const bytes = readFileSync(source);
      if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Files changed since review. Refresh the comparison.');
      const target = join(next, file.relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes, { flag: 'wx', mode: statSync(source).mode & 0o777 });
    }
    validate();
    checkHashes();
    const meta = lstatSync(targetPath);
    if (meta.dev !== entry.dev || meta.ino !== entry.ino || meta.isSymbolicLink() || planBundledSkillExport(id, next).sha256 !== sourceHash) throw new Error('Files changed since review. Refresh the comparison.');
    renameSync(targetPath, previous);
    backedUp = true;
    renameSync(next, targetPath);
    replaced = true;
    try { await trash(previous); } catch { return { backupPath: previous }; }
    return {};
  } finally {
    if (backedUp && !replaced) renameSync(previous, targetPath);
    if (!backedUp || !replaced || !existsSync(previous)) rmSync(staging, { recursive: true, force: true });
  }
}
