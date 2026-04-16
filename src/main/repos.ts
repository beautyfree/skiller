import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parse as parseToml } from "@iarna/toml";
import simpleGit from "simple-git";
import type { SkillJson } from "../shared/rpc-schema";
import type { RepoEntryJson } from "../shared/rpc-schema";
import { installSkillFromPath } from "./install";
import { parseSkillMdFile } from "./parser";
import { writeProvenance } from "./provenance";
import { readSettings, writeSettings } from "./settings";
import { skillToJson } from "./skill-json";
import type { Skill } from "./skill-types";
import type { AgentConfig } from "./types";
import { discoverSkillDirs } from "./scanner";
import { detectAgents, loadAgentConfigs } from "./registry";
import { getAgentsDir } from "./paths";

type SkillsManifest = {
	name?: string;
	description?: string;
	skills_dir?: string;
};

function loadDetectedAgents(): AgentConfig[] {
	return detectAgents(loadAgentConfigs(getAgentsDir()));
}

export function repoNameFromUrl(url: string): string {
	const t = url.trim().replace(/\/$/, "");
	const part = t.includes(":") && !t.includes("://")
		? t.split(":").pop()
		: t.split("/").pop();
	const seg = part ?? "repo";
	return seg.replace(/\.git$/, "");
}

export function repoIdFromUrl(url: string): string {
	return repoNameFromUrl(url);
}

export function localDirId(path: string): string {
	const h = createHash("sha256").update(path).digest("hex").slice(0, 16);
	return `local-${h}`;
}

export function reposDir(): string {
	return join(homedir(), ".skills-app", "repos");
}

function parseManifest(repoPath: string): SkillsManifest {
	const manifestPath = join(repoPath, "skills.toml");
	if (!existsSync(manifestPath)) return {};
	try {
		const content = readFileSync(manifestPath, "utf-8");
		return (parseToml(content) as SkillsManifest) ?? {};
	} catch {
		return {};
	}
}

function skillsRoot(repoPath: string, manifest: SkillsManifest): string {
	if (manifest.skills_dir) {
		const candidate = join(repoPath, manifest.skills_dir);
		if (existsSync(candidate) && statSync(candidate).isDirectory()) {
			return candidate;
		}
	}
	const defaultDir = join(repoPath, "skills");
	if (existsSync(defaultDir) && statSync(defaultDir).isDirectory()) {
		return defaultDir;
	}
	return repoPath;
}

function countSkills(skillsPath: string): number {
	if (!existsSync(skillsPath)) return 0;
	let n = 0;
	try {
		for (const ent of readdirSync(skillsPath)) {
			const p = join(skillsPath, ent);
			try {
				if (statSync(p).isDirectory() && existsSync(join(p, "SKILL.md"))) {
					n++;
				}
			} catch {
				/* ignore */
			}
		}
	} catch {
		return 0;
	}
	return n;
}

export type SkillRepoInternal = {
	id: string;
	name: string;
	description?: string | null;
	repo_url: string;
	local_path: string;
	last_synced?: string | null;
	skill_count: number;
};

function buildSkillRepo(repoUrl: string, localPath: string, id: string): SkillRepoInternal {
	const manifest = parseManifest(localPath);
	const sr = skillsRoot(localPath, manifest);
	const name = manifest.name ?? repoNameFromUrl(repoUrl);
	return {
		id,
		name,
		description: manifest.description ?? null,
		repo_url: repoUrl,
		local_path: localPath,
		last_synced: null,
		skill_count: countSkills(sr),
	};
}

function resolveRepoUrl(repoIdParam: string): string | undefined {
	if (repoIdParam.startsWith("local-")) return undefined;
	const settings = readSettings();
	const repos = settings.repos ?? [];
	for (const r of repos) {
		const url = r.repo_url;
		if (url && repoIdFromUrl(url) === repoIdParam) return url;
	}
	return undefined;
}

export function resolveRepoPath(repoIdParam: string): string {
	if (repoIdParam.startsWith("local-")) {
		const settings = readSettings();
		const repos = settings.repos ?? [];
		for (const r of repos) {
			const lp = r.local_path;
			if (lp && localDirId(lp) === repoIdParam) return lp;
		}
		throw new Error("Local directory not found in config");
	}
	return join(reposDir(), repoIdParam);
}

function listRepoSkillsSync(repoIdParam: string): Skill[] {
	const localPath = resolveRepoPath(repoIdParam);
	if (!existsSync(localPath)) {
		throw new Error("Repository not found locally");
	}

	const repoUrl = resolveRepoUrl(repoIdParam);
	const candidates = discoverSkillDirs(localPath);
	const skills: Skill[] = [];

	for (const candidate of candidates) {
		const skillMd = join(candidate.dir, "SKILL.md");
		let parsed;
		try {
			parsed = parseSkillMdFile(skillMd);
		} catch {
			continue;
		}
		if (parsed.description === undefined) continue;

		const dirName = basename(candidate.dir) || "unknown-skill";
		const skillName = candidate.parsed_name ?? dirName;

		const source = repoUrl
			? ({
					kind: "GitRepository",
					repo_url: repoUrl,
					skill_path: dirName,
				} as const)
			: ({
					kind: "LocalPath",
					path: localPath,
				} as const);

		skills.push({
			id: dirName,
			name: skillName,
			description: parsed.description,
			canonical_path: candidate.dir,
			source,
			metadata: parsed.metadata,
			collection: null,
			scope: { kind: "SharedGlobal" },
			installations: [],
		});
	}

	skills.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
	return skills;
}

export function listRepoSkillsAsJson(repoIdParam: string): SkillJson[] {
	return listRepoSkillsSync(repoIdParam).map(skillToJson);
}

function installRepoSkillSync(
	repoIdParam: string,
	skillId: string,
	targetAgents: string[],
): void {
	const localPath = resolveRepoPath(repoIdParam);
	if (!existsSync(localPath)) {
		throw new Error("Repository not found locally");
	}

	const candidates = discoverSkillDirs(localPath);
	const skillPath = candidates.find((c) => basename(c.dir) === skillId)?.dir;
	if (!skillPath) {
		throw new Error(`Skill '${skillId}' not found in repository`);
	}

	const agents = loadDetectedAgents();
	const canonical = installSkillFromPath(skillPath, targetAgents, agents);
	const installedId = basename(canonical);
	const repoUrl = resolveRepoUrl(repoIdParam);
	const sourceLabel = repoUrl ? "git" : "local";
	writeProvenance(installedId, sourceLabel, repoUrl ?? null, skillId);
}

export type RepoProgress = { stage: string; detail?: string | null };

export async function addSkillRepo(
	repoUrl: string,
	emit: (p: RepoProgress) => void,
): Promise<{ repo: SkillRepoInternal; skills: SkillJson[] }> {
	const id = repoIdFromUrl(repoUrl);
	const localPath = join(reposDir(), id);

	if (existsSync(localPath)) {
		const settings = readSettings();
		const inConfig = settings.repos?.some((r) => r.repo_url === repoUrl);
		if (inConfig) {
			emit({ stage: "scanning", detail: null });
			let repo = buildSkillRepo(repoUrl, localPath, id);
			const skills = listRepoSkillsAsJson(id);
			repo.skill_count = skills.length;
			repo.last_synced =
				settings.repos?.find((r) => r.repo_url === repoUrl)?.last_synced ?? null;
			emit({ stage: "done", detail: null });
			return {
				repo: {
					...repo,
					last_synced: repo.last_synced ?? null,
				},
				skills,
			};
		}
		try {
			rmSync(localPath, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}

	mkdirSync(reposDir(), { recursive: true });
	emit({ stage: "cloning", detail: repoUrl });
	try {
		await simpleGit().clone(repoUrl, localPath);
	} catch (e) {
		try {
			rmSync(localPath, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
		throw new Error(`Failed to clone repository: ${e}`);
	}

	emit({ stage: "scanning", detail: null });
	const now = new Date().toISOString();
	let repo = buildSkillRepo(repoUrl, localPath, id);
	repo.last_synced = now;
	const skills = listRepoSkillsAsJson(id);
	repo.skill_count = skills.length;

	emit({ stage: "saving", detail: null });
	const settings = readSettings();
	const repos: RepoEntryJson[] = [...(settings.repos ?? [])];
	repos.push({ repo_url: repoUrl, local_path: null, last_synced: now });
	writeSettings({ ...settings, repos });

	emit({ stage: "done", detail: null });
	return { repo, skills };
}

export function removeSkillRepo(repoIdParam: string): void {
	if (!repoIdParam.startsWith("local-")) {
		const localPath = join(reposDir(), repoIdParam);
		if (existsSync(localPath)) {
			try {
				rmSync(localPath, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}
	}

	const settings = readSettings();
	const repos = settings.repos;
	if (!repos) return;
	const filtered = repos.filter((r) => {
		if (r.local_path) {
			return localDirId(r.local_path) !== repoIdParam;
		}
		if (r.repo_url) {
			return repoIdFromUrl(r.repo_url) !== repoIdParam;
		}
		return true;
	});
	writeSettings({ ...settings, repos: filtered });
}

export function listSkillRepos(): SkillRepoInternal[] {
	const settings = readSettings();
	const repoEntries = settings.repos ?? [];
	const result: SkillRepoInternal[] = [];

	for (const entry of repoEntries) {
		if (entry.local_path) {
			const lp = entry.local_path;
			const dir = lp;
			if (!existsSync(dir)) continue;
			const manifest = parseManifest(dir);
			const sr = skillsRoot(dir, manifest);
			const name = (manifest.name ?? basename(dir)) || "Local";
			result.push({
				id: localDirId(lp),
				name,
				description: manifest.description ?? null,
				repo_url: lp,
				local_path: lp,
				last_synced: null,
				skill_count: countSkills(sr),
			});
		} else if (entry.repo_url) {
			const url = entry.repo_url;
			const id = repoIdFromUrl(url);
			const localPath = join(reposDir(), id);
			if (!existsSync(localPath)) continue;
			let repo = buildSkillRepo(url, localPath, id);
			repo.last_synced = entry.last_synced ?? null;
			result.push(repo);
		}
	}

	return result;
}

export async function syncSkillRepo(
	repoIdParam: string,
	emit: (p: RepoProgress) => void,
): Promise<SkillRepoInternal> {
	const localPath = join(reposDir(), repoIdParam);
	if (!existsSync(localPath)) {
		throw new Error("Repository not found locally");
	}

	emit({ stage: "fetching", detail: null });
	const git = simpleGit(localPath);
	emit({ stage: "merging", detail: null });
	try {
		await git.pull();
	} catch {
		/* up to date or non-fast-forward */
	}

	emit({ stage: "saving", detail: null });
	const now = new Date().toISOString();
	const settings = readSettings();
	let repoUrl = "";
	const repos = [...(settings.repos ?? [])];
	for (const entry of repos) {
		if (entry.repo_url && repoIdFromUrl(entry.repo_url) === repoIdParam) {
			entry.last_synced = now;
			repoUrl = entry.repo_url;
		}
	}
	writeSettings({ ...settings, repos });

	let repo = buildSkillRepo(repoUrl, localPath, repoIdParam);
	repo.last_synced = now;
	const skills = listRepoSkillsAsJson(repoIdParam);
	repo.skill_count = skills.length;

	emit({ stage: "done", detail: null });
	return repo;
}

export async function addLocalDir(path: string): Promise<{
	repo: SkillRepoInternal;
	skills: SkillJson[];
}> {
	const dir = path;
	if (!existsSync(dir) || !statSync(dir).isDirectory()) {
		throw new Error("Path is not a directory");
	}

	const settings = readSettings();
	if (settings.repos?.some((r) => r.local_path === path)) {
		throw new Error("This directory is already added");
	}

	const id = localDirId(path);
	const manifest = parseManifest(dir);
	const name = (manifest.name ?? basename(dir)) || "Local";

	const repos: RepoEntryJson[] = [...(settings.repos ?? [])];
	repos.push({ repo_url: null, local_path: path, last_synced: null });
	writeSettings({ ...settings, repos });

	const skills = listRepoSkillsAsJson(id);
	const repo: SkillRepoInternal = {
		id,
		name,
		description: manifest.description ?? null,
		repo_url: path,
		local_path: path,
		last_synced: null,
		skill_count: skills.length,
	};

	return { repo, skills };
}

export function installRepoSkill(
	repoIdParam: string,
	skillId: string,
	targetAgents: string[],
): void {
	installRepoSkillSync(repoIdParam, skillId, targetAgents);
}
