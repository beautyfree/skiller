import { z } from 'zod';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { reviewedPackageHashes, replaceReviewedPackage } from './reviewed-package-replacement';
import { privateAgentSkillEntries } from './uninstall';
import type { AgentConfig } from './types';
import type { Skill } from './skill-types';
import type { AgentSkillComparisonJson } from '../shared/rpc-schema';
import { buildBundledConflictComparison, previewBundledConflictFile } from './sync-conflict-preview';

const inputSchema = z.object({
  skillId: z.string().min(1).max(255).refine(id => !/[\\/\0]/.test(id) && id !== '.' && id !== '..'),
  agentSlug: z.string().min(1).max(255),
  librarySourcePath: z.string().max(4096).refine(isAbsolute),
  file: z.string().min(1).max(1024).optional(),
}).strict();

export function compareAgentSkill(input: unknown, inventory: Skill[], agents: AgentConfig[]): AgentSkillComparisonJson {
  const params = inputSchema.parse(input);
  const agent = agents.find(item => item.slug === params.agentSlug);
  const source = inventory.find(item => item.id === params.skillId && item.canonical_path === params.librarySourcePath && item.scope.kind === 'SharedLibrary' && !item.collection);
  if (!agent || !source) throw new Error('Agent or library source changed. Refresh the skill.');
  const installation = source.installations.find(item => item.agent_slug === agent.slug && !item.is_inherited)
    ?? source.installations.find(item => item.agent_slug === agent.slug);
  if (!installation) throw new Error('This skill is no longer available to the selected agent.');
  if (!isAbsolute(installation.path) || ![...agent.global_paths, ...agent.additional_readable_paths.map(item => item.path)].some(root =>
    resolve(join(root, source.id)) === resolve(installation.path) || resolve(root) === resolve(installation.path),
  )) throw new Error('Unregistered agent skill path.');
  const libraryPath = realpathSync(source.canonical_path);
  const agentPath = realpathSync(installation.path);
  if (lstatSync(installation.path).isSymbolicLink() && agentPath !== libraryPath) throw new Error('This link points to another source. Inspect the agent folder.');
  const comparison = buildBundledConflictComparison({ id: source.id, libraryPath, localPath: agentPath });
  if (comparison.local_state !== 'directory') throw new Error('Agent package could not be compared safely.');
  let replacement: AgentSkillComparisonJson['replacement'];
  let replacementBlocked: string | undefined;
  try {
    if (agentPath === libraryPath || lstatSync(installation.path).isSymbolicLink()) throw new Error('This agent reads the library source directly.');
    const entries = privateAgentSkillEntries(source.id, agent.slug, agents, inventory);
    if (entries.length !== 1 || entries[0]!.path !== installation.path) throw new Error('Inspect multiple agent paths before replacing this package.');
    const hashes = reviewedPackageHashes(source.id, libraryPath, agentPath);
    replacement = { libraryHash: hashes.sourceHash, agentHash: hashes.targetHash };
  } catch (error) { replacementBlocked = error instanceof Error ? error.message : String(error); }
  return { agentPath: installation.path, libraryPath: source.canonical_path, sameSource: agentPath === libraryPath, comparison, replacement, replacementBlocked,
    ...(params.file ? { filePreview: previewBundledConflictFile({ libraryPath, localPath: agentPath, comparison, file: params.file }) } : {}),
  };
}

const replacementSchema = inputSchema.omit({ file: true }).extend({ libraryHash: z.string().regex(/^[a-f0-9]{64}$/), agentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

/** Stage and verify a replacement, retaining the exact previous package for recovery. */
export async function replaceAgentSkill(input: unknown, inventory: Skill[], agents: AgentConfig[], trash: (path: string) => Promise<void>): Promise<{ backupPath?: string }> {
  const { libraryHash, agentHash, ...params } = replacementSchema.parse(input);
  const review = compareAgentSkill(params, inventory, agents);
  if (!review.replacement) throw new Error(review.replacementBlocked ?? 'Replacement is unavailable.');
  if (review.replacement.libraryHash !== libraryHash || review.replacement.agentHash !== agentHash) throw new Error('Files changed since review. Refresh the comparison.');
  return replaceReviewedPackage({ id: params.skillId, sourcePath: review.libraryPath, targetPath: review.agentPath, sourceHash: libraryHash, targetHash: agentHash }, () => {
    const fresh = compareAgentSkill(params, inventory, agents);
    if (!fresh.replacement) throw new Error(fresh.replacementBlocked ?? 'Replacement is unavailable.');
  }, trash);
}
