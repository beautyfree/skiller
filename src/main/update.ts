import { existsSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import simpleGit from "simple-git";
import type { AgentConfig } from "./types";
import { readProvenance, readProvenanceRaw } from "./provenance";
import { installSkillFromPath } from "./install";
import { writeProvenance } from "./provenance";
import { discoverSkillDirs, scanAllSkills } from "./scanner";
import type { SkillCandidate } from "./scanner";
import type { UpdateAllResult, UpdateProgress } from "./skill-types";
import { appDataRootPath } from "./settings";

function persistentClonePath(repoUrl: string): string {
	const name = repoUrl
		.trim()
		.replace(/\/$/, "")
		.split("/")
		.pop()
		?.replace(/\.git$/, "") ?? "repo";
	return join(appDataRootPath(), "repos", name);
}

export class RepoSession {
	readonly path: string;
	private readonly isTemp: boolean;
	private readonly candidates: SkillCandidate[];

	private constructor(path: string, isTemp: boolean, candidates: SkillCandidate[]) {
		this.path = path;
		this.isTemp = isTemp;
		this.candidates = candidates;
	}

	static async open(repoUrl: string): Promise<RepoSession> {
		const persistent = persistentClonePath(repoUrl);
		if (existsSync(join(persistent, ".git"))) {
			const git = simpleGit(persistent);
			await git.pull();
			const candidates = discoverSkillDirs(persistent);
			return new RepoSession(persistent, false, candidates);
		}
		const temp = join(
			tmpdir(),
			`skiller-update-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		await simpleGit().clone(repoUrl, temp);
		const candidates = discoverSkillDirs(temp);
		return new RepoSession(temp, true, candidates);
	}

	dispose(): void {
		if (this.isTemp) {
			try {
				rmSync(this.path, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}
	}

	findSkill(skillId: string, skillPathHint?: string | null): string | undefined {
		const byDir = this.candidates.find((c) => basename(c.dir) === skillId);
		if (byDir) return byDir.dir;
		const byName = this.candidates.find((c) => c.parsed_name === skillId);
		if (byName) return byName.dir;
		if (skillPathHint) {
			const m = this.candidates.find((c) => basename(c.dir) === skillPathHint);
			if (m) return m.dir;
		}
		return undefined;
	}
}

/** Update one skill from its recorded git provenance (mirrors Rust `update_skill`). */
export async function updateSingleSkill(skillId: string, agents: AgentConfig[]): Promise<void> {
	const raw = readProvenanceRaw();
	const entry = raw[skillId];
	if (!entry || typeof entry !== "object") {
		throw new Error(`No provenance for skill '${skillId}'`);
	}
	const rec = entry as Record<string, unknown>;
	const sourceLabel = typeof rec.source === "string" ? rec.source : "";
	const repoUrl = typeof rec.repository === "string" ? rec.repository : "";
	// Skills installed from a local folder have provenance.source = "local"
	// and `repository` set to the folder path, not a git URL. Trying to
	// `simpleGit().clone()` a local dir that isn't a bare/init'd repo would
	// fail with a confusing "not a valid git repo" error. Bail clearly.
	if (sourceLabel === "local") {
		throw new Error(
			`Skill '${skillId}' was installed from a local folder — updates aren't supported. Reinstall from the source folder to pick up changes.`,
		);
	}
	if (!repoUrl) {
		throw new Error(`Skill '${skillId}' has no repository URL`);
	}
	const skillPathHint =
		typeof rec.skill_path === "string" ? rec.skill_path : null;
	const allSkills = scanAllSkills(agents);
	const targetAgents =
		allSkills.find((s) => s.id === skillId)?.installations.map((i) => i.agent_slug) ?? [];
	const session = await RepoSession.open(repoUrl);
	try {
		updateSkillFromSession(
			skillId,
			sourceLabel,
			repoUrl,
			skillPathHint,
			targetAgents,
			agents,
			session,
		);
	} finally {
		session.dispose();
	}
}

export function updateSkillFromSession(
	skillId: string,
	sourceLabel: string,
	repoUrl: string,
	skillPathHint: string | null | undefined,
	targetAgents: string[],
	agents: AgentConfig[],
	session: RepoSession,
): void {
	const skillDir = session.findSkill(skillId, skillPathHint);
	if (!skillDir) throw new Error(`skill '${skillId}' not found in repository`);
	installSkillFromPath(skillDir, targetAgents, agents);
	writeProvenance(skillId, sourceLabel, repoUrl, skillPathHint ?? null);
}

export async function updateAll(
	agents: AgentConfig[],
	onProgress: (p: UpdateProgress) => void,
): Promise<UpdateAllResult> {
	const provenance = readProvenance();
	const allSkills = scanAllSkills(agents);

	type Updatable = {
		id: string;
		repo_url: string;
		source_label: string;
		skill_path_hint?: string | null;
		target_agents: string[];
	};

	const updatable: Updatable[] = [];
	for (const [skillId, entry] of Object.entries(provenance)) {
		const repo = entry.repository ?? "";
		if (!repo) continue;
		const source = entry.source ?? "";
		const skill_path_hint = entry.skill_path ?? null;
		const target_agents =
			allSkills.find((s) => s.id === skillId)?.installations.map((i) => i.agent_slug) ?? [];
		updatable.push({
			id: skillId,
			repo_url: repo,
			source_label: source,
			skill_path_hint,
			target_agents,
		});
	}

	const total = updatable.length;
	const skipped = Object.keys(provenance).length - total;
	const result: UpdateAllResult = { updated: [], failed: [], skipped };

	const groups = new Map<string, Updatable[]>();
	for (const u of updatable) {
		const g = groups.get(u.repo_url) ?? [];
		g.push(u);
		groups.set(u.repo_url, g);
	}

	let done = 0;
	for (const [, skills] of groups) {
		const repoUrl = skills[0]!.repo_url;
		let session: RepoSession | undefined;
		try {
			session = await RepoSession.open(repoUrl);
		} catch (e) {
			for (const skill of skills) {
				done++;
				onProgress({ done, total, current_skill: skill.id });
				result.failed.push([skill.id, String(e)]);
			}
			continue;
		}
		try {
			for (const skill of skills) {
				done++;
				onProgress({ done, total, current_skill: skill.id });
				try {
					updateSkillFromSession(
						skill.id,
						skill.source_label,
						skill.repo_url,
						skill.skill_path_hint,
						skill.target_agents,
						agents,
						session,
					);
					result.updated.push(skill.id);
				} catch (err) {
					result.failed.push([skill.id, String(err)]);
				}
			}
		} finally {
			session.dispose();
		}
	}

	return result;
}
