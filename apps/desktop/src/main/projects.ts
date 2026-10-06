import { z } from 'zod'
import type { Skill } from './skill-types'
import type { ProjectSkillComparisonJson } from '../shared/rpc-schema'
import { buildBundledConflictComparison, previewBundledConflictFile } from './sync-conflict-preview'
import { loadRegisteredAgents } from './custom-agents'
import { sharedSkillsDir } from './shared-skills'
import { assertSkillDestinationsAvailable } from './install'
import { reviewedPackageHashes, replaceReviewedPackage } from './reviewed-package-replacement'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  renameSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import type { ProjectEntryJson, ProjectSkillJson } from "../shared/rpc-schema";
import { copyDirRecursive, linkOrCopy, removePath } from "./fsutil";
import { parseSkillMdFile } from "./parser";
import { readSettings, writeSettings } from "./settings";
import type { MarketplaceSkill } from "./marketplace-types";
import { resolveRepoPath } from "./repos";
import { discoverSkillDirs } from "./scanner";
import { detectAgents } from "./registry";
import type { AgentConfig } from "./types";
import type { SourceSecurityPolicyInput } from "dotagents/source-policy";
import { checkoutReviewedGitSource } from "./git-transport";

/** Canonical skills dir for a project — mirrors vercel-labs/skills `.agents/skills` convention. */
const UNIVERSAL_REL = ".agents/skills";
export const UNIVERSAL_PROJECT_SKILLS_DIR = UNIVERSAL_REL;

export function projectCanonicalSkillsDir(projectPath: string): string {
  return join(projectPath, UNIVERSAL_REL);
}

/**
 * Sanitize a skill directory name: kebab-case, strip path separators, prevent hidden files.
 * Ported from vercel-labs/skills.
 */
export function sanitizeSkillName(raw: string): string {
  const sanitized = raw
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, "-")
    .replace(/^[.\-]+|[.\-]+$/g, "");
  return sanitized.substring(0, 255) || "unnamed-skill";
}

/** Verify `target` is inside `base` (after normalize/resolve). */
function isPathSafe(base: string, target: string): boolean {
  const b = normalize(resolve(base));
  const t = normalize(resolve(target));
  return t === b || t.startsWith(b + sep);
}

function nowIso(): string {
  return new Date().toISOString();
}

function loadDetectedAgents(): AgentConfig[] {
  return detectAgents(loadRegisteredAgents());
}

// ─── Projects settings ──────────────────────────────────────────────────────

export function listProjects(): ProjectEntryJson[] {
  const s = readSettings();
  return s.projects ?? [];
}

export function addProject(path: string): ProjectEntryJson {
  if (!existsSync(path)) throw new Error(`path does not exist: ${path}`);
  const st = statSync(path);
  if (!st.isDirectory()) throw new Error(`path is not a directory: ${path}`);

  const s = readSettings();
  const projects = s.projects ?? [];
  const existing = projects.find((p) => p.path === path);
  if (existing) {
    existing.last_used_at = nowIso();
    writeSettings({ ...s, projects });
    return existing;
  }
  const entry: ProjectEntryJson = {
    path,
    name: basename(path),
    added_at: nowIso(),
    last_used_at: nowIso(),
  };
  writeSettings({ ...s, projects: [...projects, entry] });
  return entry;
}

export function removeProject(path: string): void {
  const s = readSettings();
  const projects = (s.projects ?? []).filter((p) => p.path !== path);
  writeSettings({ ...s, projects });
}

// ─── Folder registry ───────────────────────────────────────────────────────

export function listProjectFolders(): string[] {
  const s = readSettings();
  return s.project_folders ?? [];
}

export function addProjectFolder(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("folder name is required");
  const s = readSettings();
  const folders = s.project_folders ?? [];
  if (folders.some((f) => f.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`folder "${trimmed}" already exists`);
  }
  const next = [...folders, trimmed].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  );
  writeSettings({ ...s, project_folders: next });
  return next;
}

export function removeProjectFolder(name: string): string[] {
  const s = readSettings();
  const folders = (s.project_folders ?? []).filter((f) => f !== name);
  // Unregister every project that lived inside this folder. Files on disk are untouched.
  const projects = (s.projects ?? []).filter((p) => p.group !== name);
  writeSettings({ ...s, project_folders: folders, projects });
  return folders;
}

export function renameProjectFolder(from: string, to: string): string[] {
  const trimmed = to.trim();
  if (!trimmed) throw new Error("new folder name is required");
  const s = readSettings();
  const folders = s.project_folders ?? [];
  if (!folders.includes(from)) throw new Error(`folder not found: ${from}`);
  const next = folders
    .map((f) => (f === from ? trimmed : f))
    .filter((f, i, arr) => arr.indexOf(f) === i)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const projects = (s.projects ?? []).map((p) =>
    p.group === from ? { ...p, group: trimmed } : p,
  );
  writeSettings({ ...s, project_folders: next, projects });
  return next;
}

export function setProjectGroup(
  path: string,
  group: string | null,
): ProjectEntryJson {
  const s = readSettings();
  const projects = s.projects ?? [];
  const p = projects.find((x) => x.path === path);
  if (!p) throw new Error(`project not found: ${path}`);
  const normalized = group == null || group.trim() === "" ? null : group.trim();
  p.group = normalized;

  // Auto-register a new folder name so it persists even if no project currently lives in it.
  let folders = s.project_folders ?? [];
  if (normalized && !folders.includes(normalized)) {
    folders = [...folders, normalized].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
  }
  writeSettings({ ...s, projects, project_folders: folders });
  return p;
}

export function touchProject(path: string): void {
  const s = readSettings();
  const projects = s.projects ?? [];
  const p = projects.find((x) => x.path === path);
  if (!p) return;
  p.last_used_at = nowIso();
  writeSettings({ ...s, projects });
}

// ─── Listing project skills ─────────────────────────────────────────────────

export function listProjectSkills(projectPath: string): ProjectSkillJson[] {
  const out: ProjectSkillJson[] = [];
  for (const enabled of [true, false]) {
  const root = join(projectPath, enabled ? UNIVERSAL_REL : `${UNIVERSAL_REL}-disabled`);
  if (!existsSync(root)) continue;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  for (const name of entries) {
    const dir = join(root, name);
    let st;
    try {
      st = statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const skillMd = join(dir, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    let parsed;
    try {
      parsed = parseSkillMdFile(skillMd);
    } catch {
      continue;
    }
    out.push({
      id: name,
      name: parsed.name ?? name,
      description: parsed.description ?? null,
      path: dir,
      enabled,
    });
  }
  }
  out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return out;
}

/** Move the project's own package and its links without changing any library source. */
export function setProjectSkillEnabled(input: unknown, projects = listProjects(), agents = loadRegisteredAgents()): void {
  const { projectPath, skillId, enabled } = z.object({
    projectPath: z.string().refine(isAbsolute),
    skillId: z.string().min(1).max(255).refine(id => !/[\\/\x00-\x1f]/.test(id) && id !== '.' && id !== '..'),
    enabled: z.boolean(),
  }).strict().parse(input);
  if (!projects.some(project => project.path === projectPath)) throw new Error('Choose a registered project');
  const root = realpathSync(projectPath);
  const active = join(root, UNIVERSAL_REL, skillId);
  const disabled = join(root, `${UNIVERSAL_REL}-disabled`, skillId);
  const present = (path: string) => existsSync(path) || isSymlinkLoose(path);
  function safe(path: string) {
    if (!isPathSafe(root, path)) throw new Error('Skill path is outside this project');
    let parent = dirname(path);
    while (!existsSync(parent) && !isSymlinkLoose(parent)) parent = dirname(parent);
    if (!isPathSafe(root, realpathSync(parent))) throw new Error('Linked skills roots outside the project cannot be changed');
  }
  safe(active); safe(disabled);
  const source = present(enabled ? disabled : active) ? (enabled ? disabled : active) : (enabled ? active : disabled);
  if (!present(source) || lstatSync(source).isSymbolicLink() || !lstatSync(source).isDirectory() || !existsSync(join(source, 'SKILL.md'))) throw new Error('Only a project-owned skill package can be enabled or disabled');
  const target = enabled ? active : disabled;
  if (source !== target && present(target)) throw new Error('Both enabled and disabled copies exist. Keep both copies and resolve them first.');
  const moves: { from: string; to: string }[] = [];
  const roots = new Set(agents.map(agent => agent.project_skills_dir).filter((rel): rel is string => !!rel && rel !== UNIVERSAL_REL));
  for (const rel of roots) {
    const activeLink = resolve(root, rel, skillId);
    const disabledLink = resolve(root, `${rel}-disabled`, skillId);
    if (!present(activeLink) && !present(disabledLink)) continue;
    safe(activeLink); safe(disabledLink);
    for (const path of [activeLink, disabledLink]) {
      if (!present(path)) continue;
      if (!lstatSync(path).isSymbolicLink()) throw new Error(`Separate agent copy must be handled first: ${path}`);
      const linkedTarget = resolve(dirname(activeLink), readlinkSync(path));
      if (!existsSync(dirname(linkedTarget)) || join(realpathSync(dirname(linkedTarget)), basename(linkedTarget)) !== active) throw new Error(`External agent link must be handled first: ${path}`);
    }
    const from = enabled ? disabledLink : activeLink;
    const to = enabled ? activeLink : disabledLink;
    if (present(from)) {
      if (present(to)) throw new Error(`Destination already exists: ${to}`);
      moves.push({ from, to });
    }
  }
  // Links retain their original target; returning the package reactivates them.
  if (source !== target) {
    if (enabled) moves.unshift({ from: source, to: target });
    else moves.push({ from: source, to: target });
  }
  const completed: typeof moves = [];
  try {
    for (const move of moves) { mkdirSync(dirname(move.to), { recursive: true }); renameSync(move.from, move.to); completed.push(move); }
  } catch (error) {
    const failures: string[] = [];
    for (const move of completed.reverse()) { try { renameSync(move.to, move.from) } catch { failures.push(move.to) } }
    if (failures.length) throw new Error(`Could not finish or roll back. Files are preserved at: ${failures.join(', ')}`);
    throw error;
  }
}

// ─── Install ────────────────────────────────────────────────────────────────

/**
 * Install a skill into a project.
 *
 * Model (inspired by vercel-labs/skills):
 * 1. Copy skill into canonical `<project>/.agents/skills/<name>/`.
 * 2. For every detected non-universal agent (whose `project_skills_dir` differs from
 *    `.agents/skills`), create a symlink from that agent's project dir to canonical —
 *    so Claude Code (`.claude/skills`), Kilo (`.kilocode/skills`), Factory (`.factory/skills`),
 *    etc. see the skill without a second copy.
 * 3. Universal agents (Codex, Cursor, Copilot, Cline, …) read `.agents/skills` natively —
 *    no symlink needed.
 */
export function installSkillToProjectFromPath(
  sourceSkillDir: string,
  projectPath: string,
  targetSkillName?: string,
): string {
  if (!existsSync(sourceSkillDir)) {
    throw new Error(`source skill directory not found: ${sourceSkillDir}`);
  }
  const canonicalRoot = projectCanonicalSkillsDir(projectPath);
  mkdirSync(canonicalRoot, { recursive: true });

  const name = sanitizeSkillName(
    targetSkillName ?? basename(sourceSkillDir) ?? "skill",
  );
  const canonical = join(canonicalRoot, name);
  if (existsSync(join(projectPath, `${UNIVERSAL_REL}-disabled`, name))) throw new Error("This skill is disabled in the project. Enable it before replacing it.");
  if (!isPathSafe(canonicalRoot, canonical)) {
    throw new Error(`unsafe skill name: ${name}`);
  }

  if (existsSync(canonical))
    rmSync(canonical, { recursive: true, force: true });
  copyDirRecursive(sourceSkillDir, canonical);

  // Materialise the skill for every detected non-universal agent via a symlink.
  const agents = loadDetectedAgents();
  for (const agent of agents) {
    if (!agent.detected) continue;
    const rel = agent.project_skills_dir;
    if (!rel || rel === UNIVERSAL_REL) continue; // universal → reads canonical directly
    const agentRoot = join(projectPath, rel);
    const agentLink = join(agentRoot, name);
    if (!isPathSafe(projectPath, agentLink)) continue;
    try {
      mkdirSync(agentRoot, { recursive: true });
      if (existsSync(agentLink) || isSymlinkLoose(agentLink)) {
        removePath(agentLink);
      }
      linkOrCopy(canonical, agentLink);
    } catch (err) {
      console.warn(
        `project install: failed to link ${agent.slug} → ${agentLink}:`,
        err,
      );
    }
  }

  touchProject(projectPath);
  return canonical;
}

function isSymlinkLoose(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export async function installSkillToProjectFromGit(
  repoUrl: string,
  skillRelativePath: string,
  projectPath: string,
  ref?: string | null,
  sourcePolicy: SourceSecurityPolicyInput = {},
): Promise<string> {
  const tempDir = join(
    tmpdir(),
    `skiller-project-install-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  try {
    await checkoutReviewedGitSource(repoUrl, tempDir, ref, sourcePolicy);
    const source = join(tempDir, skillRelativePath);
    const rel = skillRelativePath.trim();
    const nameBase =
      !rel || rel === "."
        ? (
            repoUrl.trim().replace(/\/$/, "").split("/").pop() ?? "skill"
          ).replace(/\.git$/, "")
        : basename(rel);
    return installSkillToProjectFromPath(source, projectPath, nameBase);
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export function installRepoSkillToProject(
  repoIdParam: string,
  skillId: string,
  projectPath: string,
): string {
  const localPath = resolveRepoPath(repoIdParam);
  if (!existsSync(localPath)) throw new Error("Repository not found locally");
  const candidates = discoverSkillDirs(localPath);
  const matches = candidates.filter(c => basename(c.dir) === skillId);
  if (matches.length > 1) throw new Error(`Several skill folders use '${skillId}'. Import them individually with distinct names.`);
  const skillPath = matches[0]?.dir;
  if (!skillPath) throw new Error(`Skill '${skillId}' not found in repository`);
  const name = sanitizeSkillName(skillId);
  assertSkillDestinationsAvailable([
    join(projectCanonicalSkillsDir(projectPath), name),
    join(projectPath, `${UNIVERSAL_REL}-disabled`, name),
    ...loadDetectedAgents().filter(agent => agent.detected && agent.project_skills_dir).map(agent => join(projectPath, agent.project_skills_dir!, name)),
  ]);
  return installSkillToProjectFromPath(skillPath, projectPath, skillId);
}

export async function installMarketplaceSkillToProject(
  skill: MarketplaceSkill,
  projectPath: string,
  sourcePolicy: SourceSecurityPolicyInput = {},
): Promise<string> {
  const repo = skill.repository?.trim();
  if (!repo) throw new Error("marketplace skill has no repository url");
  return installSkillToProjectFromGit(
    repo,
    ".",
    projectPath,
    undefined,
    sourcePolicy,
  );
}

// ─── Uninstall ──────────────────────────────────────────────────────────────

/**
 * Remove canonical skill directory plus every agent-specific symlink that points at it.
 */
export async function uninstallProjectSkill(
  projectPath: string,
  skillId: string,
  trash: (path: string) => Promise<void>,
  projects = listProjects(),
  agents = loadDetectedAgents(),
): Promise<{ removed: string[]; kept: string[] }> {
  const parsed = z.object({ projectPath: z.string().refine(isAbsolute), skillId: z.string().min(1).max(255).refine(id => !/[\\/\x00-\x1f]/.test(id) && id !== '.' && id !== '..') }).safeParse({ projectPath, skillId });
  if (!parsed.success || !projects.some(project => project.path === projectPath)) throw new Error('Choose a registered project and skill');
  const skill = listProjectSkills(projectPath).find(skill => skill.id === skillId);
  if (!skill) throw new Error('Project skill is no longer available');
  const root = realpathSync(projectPath);
  const canonical = join(root, skill.enabled === false ? `${UNIVERSAL_REL}-disabled` : UNIVERSAL_REL, skillId);
  if (lstatSync(canonical).isSymbolicLink() || !isPathSafe(root, realpathSync(canonical))) throw new Error('Linked skills are kept; unlink their source separately');
  const removed: string[] = [];
  const kept: string[] = [];
  for (const agent of agents) {
    const rel = agent.project_skills_dir;
    if (!rel || rel === UNIVERSAL_REL) continue;
    const link = resolve(root, skill.enabled === false ? `${rel}-disabled` : rel, skillId);
    if (!isPathSafe(root, link)) continue;
    if (existsSync(link) || isSymlinkLoose(link)) {
      if (isPathSafe(root, realpathSync(dirname(link))) && lstatSync(link).isSymbolicLink() && ((existsSync(link) && realpathSync(link) === canonical) || (skill.enabled === false && resolve(root, rel, readlinkSync(link)) === join(root, UNIVERSAL_REL, skillId)))) {
        await trash(link);
        removed.push(link);
      } else kept.push(link);
    }
  }
  // Recheck after asynchronous OS calls before moving the canonical folder.
  if (lstatSync(canonical).isSymbolicLink() || !isPathSafe(root, realpathSync(canonical))) throw new Error('Project skill changed; review again');
  await trash(canonical);
  removed.push(canonical);
  return { removed, kept };
}


const comparisonInput = z.object({
  projectPath: z.string().refine(isAbsolute),
  skillId: z.string().min(1).max(255).refine(id => !/[\\/\x00-\x1f]/.test(id) && id !== '.' && id !== '..'),
  librarySourcePath: z.string().min(1).max(4096),
  file: z.string().max(1024).optional(),
}).strict()

export function compareProjectSkill(input: unknown, inventory: Skill[], projects = listProjects()): ProjectSkillComparisonJson {
  const parsed = comparisonInput.safeParse(input)
  if (!parsed.success) throw new Error('Choose a registered project, skill and library source')
  const params = parsed.data
  if (!projects.some(project => project.path === params.projectPath)) throw new Error('Choose a project registered in Skiller')
  const skill = listProjectSkills(params.projectPath).find(skill => skill.id === params.skillId)
  if (!skill) throw new Error('Project skill is no longer available. Refresh the project.')
  const projectRoot = realpathSync(params.projectPath)
  const localPath = realpathSync(skill.path)
  if (!isPathSafe(projectRoot, localPath)) throw new Error('Project skill links outside the selected project')
  const source = inventory.find(item => item.id === params.skillId && item.canonical_path === params.librarySourcePath)
  if (!source) throw new Error('Library source changed or is unavailable. Refresh the library.')
  const libraryPath = realpathSync(source.canonical_path)
  const comparison = buildBundledConflictComparison({ id: skill.id, libraryPath, localPath })
  if (comparison.local_state !== 'directory') throw new Error('Project package could not be compared safely. Inspect its files and links.')
  let libraryUpdate: ProjectSkillComparisonJson['libraryUpdate']
  let libraryUpdateBlocked: string | undefined
  try {
    if (source.scope.kind !== 'SharedLibrary' || source.collection || libraryPath !== join(realpathSync(sharedSkillsDir()), source.id)) throw new Error('Only a matching entry in your shared library can be updated here.')
    if (localPath === libraryPath) throw new Error('This project reads the library source directly.')
    if (lstatSync(skill.path).isSymbolicLink() || lstatSync(source.canonical_path).isSymbolicLink() || libraryPath !== join(realpathSync(sharedSkillsDir()), source.id)) throw new Error('Linked packages cannot be replaced here. Inspect their source folders.')
    const hashes = reviewedPackageHashes(skill.id, localPath, libraryPath)
    libraryUpdate = { projectHash: hashes.sourceHash, libraryHash: hashes.targetHash }
  } catch (error) { libraryUpdateBlocked = error instanceof Error ? error.message : String(error) }
  return { projectPath: skill.path, libraryPath: source.canonical_path, comparison, libraryUpdate, libraryUpdateBlocked,
    ...(params.file ? { filePreview: previewBundledConflictFile({ libraryPath, localPath, comparison, file: params.file }) } : {}),
  }
}

const libraryUpdateInput = comparisonInput.omit({ file: true }).extend({
  projectHash: z.string().regex(/^[a-f0-9]{64}$/),
  libraryHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

/** Update only the local shared library. No Git publication or sibling-copy overwrite. */
export async function updateProjectSkillToLibrary(input: unknown, inventory: Skill[], trash: (path: string) => Promise<void>, projects = listProjects()): Promise<{ backupPath?: string }> {
  const { projectHash, libraryHash, ...params } = libraryUpdateInput.parse(input)
  const review = compareProjectSkill(params, inventory, projects)
  if (!review.libraryUpdate) throw new Error(review.libraryUpdateBlocked ?? 'Library update is unavailable.')
  return replaceReviewedPackage({ id: params.skillId, sourcePath: review.projectPath, targetPath: review.libraryPath, sourceHash: projectHash, targetHash: libraryHash }, () => {
    const fresh = compareProjectSkill(params, inventory, projects)
    if (!fresh.libraryUpdate) throw new Error(fresh.libraryUpdateBlocked ?? 'Library update is unavailable.')
  }, trash)
}
