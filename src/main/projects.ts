import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, normalize, resolve, sep } from "node:path";
import simpleGit from "simple-git";
import type { ProjectEntryJson, ProjectSkillJson } from "../shared/rpc-schema";
import { copyDirRecursive, linkOrCopy, removePath } from "./fsutil";
import { parseSkillMdFile } from "./parser";
import { readSettings, writeSettings } from "./settings";
import type { MarketplaceSkill } from "./marketplace-types";
import { resolveRepoPath } from "./repos";
import { discoverSkillDirs } from "./scanner";
import { detectAgents, loadAgentConfigs } from "./registry";
import { getAgentsDir } from "./paths";
import type { AgentConfig } from "./types";

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
	return detectAgents(loadAgentConfigs(getAgentsDir()));
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

export function setProjectGroup(path: string, group: string | null): ProjectEntryJson {
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
	const root = projectCanonicalSkillsDir(projectPath);
	if (!existsSync(root)) return [];
	const out: ProjectSkillJson[] = [];
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
		});
	}
	out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
	return out;
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
	if (!isPathSafe(canonicalRoot, canonical)) {
		throw new Error(`unsafe skill name: ${name}`);
	}

	if (existsSync(canonical)) rmSync(canonical, { recursive: true, force: true });
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
			console.warn(`project install: failed to link ${agent.slug} → ${agentLink}:`, err);
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
): Promise<string> {
	const tempDir = join(
		tmpdir(),
		`skiller-project-install-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await simpleGit().clone(repoUrl, tempDir);
	if (ref && ref.trim()) {
		try {
			await simpleGit(tempDir).checkout(ref.trim());
		} catch (err) {
			throw new Error(`Failed to checkout ref "${ref}" in ${repoUrl}: ${err}`);
		}
	}
	try {
		const source = join(tempDir, skillRelativePath);
		const rel = skillRelativePath.trim();
		const nameBase =
			!rel || rel === "."
				? (repoUrl.trim().replace(/\/$/, "").split("/").pop() ?? "skill").replace(/\.git$/, "")
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
	const skillPath = candidates.find((c) => basename(c.dir) === skillId)?.dir;
	if (!skillPath) throw new Error(`Skill '${skillId}' not found in repository`);
	return installSkillToProjectFromPath(skillPath, projectPath, skillId);
}

export async function installMarketplaceSkillToProject(
	skill: MarketplaceSkill,
	projectPath: string,
): Promise<string> {
	const repo = skill.repository?.trim();
	if (!repo) throw new Error("marketplace skill has no repository url");
	return installSkillToProjectFromGit(repo, ".", projectPath);
}

// ─── Uninstall ──────────────────────────────────────────────────────────────

/**
 * Remove canonical skill directory plus every agent-specific symlink that points at it.
 */
export function uninstallProjectSkill(projectPath: string, skillId: string): void {
	const canonical = join(projectCanonicalSkillsDir(projectPath), skillId);
	if (existsSync(canonical) || isSymlinkLoose(canonical)) removePath(canonical);

	const agents = loadDetectedAgents();
	for (const agent of agents) {
		const rel = agent.project_skills_dir;
		if (!rel || rel === UNIVERSAL_REL) continue;
		const link = join(projectPath, rel, skillId);
		if (!isPathSafe(projectPath, link)) continue;
		if (existsSync(link) || isSymlinkLoose(link)) {
			removePath(link);
		}
	}
}

