import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import Handlebars from "handlebars";
import simpleGit from "simple-git";
import type { AgentConfig } from "./types";
import { copyDirRecursive, expandHome, linkOrCopy, removePath } from "./fsutil";
import { isSymlink } from "./fsutil";
import { getTemplatesDir } from "./paths";
import { readProvenance, writeProvenance } from "./provenance";
import { sharedSkillsDir } from "./shared-skills";
import { planBundledSkillExport } from "./sync-export";

export { sharedSkillsDir };

function sanitizeSkillDirName(raw: string): string {
	return raw
		.trim()
		.split("")
		.map((ch) => {
			if (ch === "/" || ch === "\\" || ch === ":") return "-";
			return ch;
		})
		.join("");
}

function expandHomePath(path: string): string {
	return expandHome(path);
}

export function resolveInstallTargets(
	targetAgentSlugs: string[],
	agents: AgentConfig[],
): AgentConfig[] {
	return targetAgentSlugs.map((slug) => {
		const agent = agents.find((a) => a.slug === slug);
		if (!agent) throw new Error(`agent \`${slug}\` is unsupported`);
		if (!agent.detected) throw new Error(`agent \`${slug}\` is not detected`);
		return agent;
	});
}

function installToCanonical(sourceSkillDir: string, skillName: string): string {
	const targetRoot = sharedSkillsDir();
	mkdirSync(targetRoot, { recursive: true });
	const targetSkillDir = join(targetRoot, skillName);

	let sourceCanon: string;
	let targetCanon: string;
	try {
		sourceCanon = realpathSync(sourceSkillDir);
	} catch {
		sourceCanon = sourceSkillDir;
	}
	try {
		targetCanon = realpathSync(targetSkillDir);
	} catch {
		targetCanon = targetSkillDir;
	}
	if (sourceCanon === targetCanon) return targetSkillDir;

	if (existsSync(targetSkillDir)) {
		rmSync(targetSkillDir, { recursive: true, force: true });
	}
	copyDirRecursive(sourceSkillDir, targetSkillDir);
	return targetSkillDir;
}

export function installSkillFromPath(
	sourceSkillDir: string,
	targetAgentSlugs: string[],
	agents: AgentConfig[],
	targetSkillName?: string,
): string {
	if (!existsSync(sourceSkillDir)) {
		throw new Error(`source skill directory not found: ${sourceSkillDir}`);
	}
	const fallback = basename(sourceSkillDir) || "skill";
	const skillName = targetSkillName
		? sanitizeSkillDirName(targetSkillName)
		: sanitizeSkillDirName(fallback);
	const targetAgents = resolveInstallTargets(targetAgentSlugs, agents);
	const canonicalDir = installToCanonical(sourceSkillDir, skillName);

	const sharedPath = sharedSkillsDir();
	let sharedReal: string;
	try {
		sharedReal = realpathSync(sharedPath);
	} catch {
		sharedReal = sharedPath;
	}

	for (const agent of targetAgents) {
		const { slug } = agent;
		const readsShared = agent.additional_readable_paths.some((rp) => {
			try {
				return realpathSync(rp.path) === sharedReal;
			} catch {
				return rp.path === sharedPath;
			}
		});

		if (!readsShared) {
			const gp = agent.global_paths[0];
			if (!gp) throw new Error(`agent \`${slug}\` has no global paths configured`);
			const agentRoot = gp;
			mkdirSync(agentRoot, { recursive: true });
			const agentSkillLink = join(agentRoot, skillName);
			if (existsSync(agentSkillLink)) {
				try {
					const st = statSync(agentSkillLink);
					if (st.isDirectory() && !isSymlink(agentSkillLink)) {
						rmSync(agentSkillLink, { recursive: true, force: true });
					} else {
						rmSync(agentSkillLink, { force: true });
					}
				} catch {
					removePath(agentSkillLink);
				}
			}
			linkOrCopy(canonicalDir, agentSkillLink);
		}

		if (agent.extra_config) {
			for (const cfg of agent.extra_config) {
				if (cfg.template && cfg.target_file) {
					renderExtraConfig(cfg.template, cfg.target_file, slug, skillName);
				}
			}
		}
	}

	// Preserve any existing provenance from a prior git-based install. Only
	// write a minimal "local" stub when there's nothing recorded — callers
	// like installSkillFromGit override this with the real repo info right
	// after. Without this, a skill installed from a local folder has no
	// provenance at all and later update_skill fails with "no provenance".
	if (!readProvenance()[skillName]) {
		writeProvenance(skillName, "local", sourceSkillDir, null, null);
	}

	return canonicalDir;
}

function renderExtraConfig(
	templateFile: string,
	targetFile: string,
	agentSlug: string,
	skillName: string,
): void {
	const templatePath = join(getTemplatesDir(), templateFile);
	const templateContent = readFileSync(templatePath, "utf-8");
	const hbs = Handlebars.create();
	const rendered = hbs.compile(templateContent)({
		agent_slug: agentSlug,
		skill_name: skillName,
	});
	const targetPath = expandHomePath(targetFile);
	mkdirSync(dirname(targetPath), { recursive: true });
	writeFileSync(targetPath, rendered, "utf-8");
}

function deriveGitTargetSkillName(repoUrl: string, skillRelativePath: string, sourceDir: string): string {
	const rel = skillRelativePath.trim();
	if (rel && rel !== ".") {
		const fromRel = basename(rel) || rel;
		return sanitizeSkillDirName(fromRel);
	}
	const fromRepo = repoUrl
		.trim()
		.replace(/\/$/, "")
		.split("/")
		.pop()
		?.replace(/\.git$/, "") ?? "skill";
	const sanitized = sanitizeSkillDirName(fromRepo);
	if (sanitized) return sanitized;
	return sanitizeSkillDirName(basename(sourceDir)) || "skill";
}

export type PreparedGitSkillInstall = {
	tempDir: string;
	sourceDir: string;
	skillName: string;
	repository: string;
	skillRelativePath: string;
	resolvedSha: string | null;
};

/** Clone and verify an external skill without touching the local library. */
export async function prepareGitSkillInstall(
	repoUrl: string,
	skillRelativePath: string,
	ref?: string | null,
	targetSkillName?: string,
	expectedContentHash?: string,
): Promise<PreparedGitSkillInstall> {
	const tempDir = join(
		tmpdir(),
		`skiller-install-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	try {
		await simpleGit().clone(repoUrl, tempDir);
		if (ref && ref.trim()) {
			try {
				await simpleGit(tempDir).checkout(ref.trim());
			} catch (err) {
				throw new Error(`Failed to checkout ref "${ref}" in ${repoUrl}: ${err}`);
			}
		}
		// Capture the resolved HEAD SHA so we can pin it in the lockfile.
		let resolvedSha: string | null = null;
		try {
			resolvedSha = (await simpleGit(tempDir).revparse(["HEAD"])).trim();
		} catch {
			/* keep null */
		}

		const source = join(tempDir, skillRelativePath);
		const skillName = targetSkillName?.trim()
			? sanitizeSkillDirName(targetSkillName)
			: deriveGitTargetSkillName(repoUrl, skillRelativePath, source);
		if (expectedContentHash) {
			const sourcePlan = planBundledSkillExport(skillName, source);
			if (sourcePlan.sha256 !== expectedContentHash) {
				throw new Error(`Pinned source content does not match the reviewed manifest: ${skillName}`);
			}
		}
		return { tempDir, sourceDir: source, skillName, repository: repoUrl, skillRelativePath, resolvedSha };
	} catch (error) {
		discardPreparedGitSkill({ tempDir } as PreparedGitSkillInstall);
		throw error;
	}
}

/** Materialize a previously verified external source into its selected agent paths. */
export function installPreparedGitSkill(
	prepared: PreparedGitSkillInstall,
	targetAgentSlugs: string[],
	agents: AgentConfig[],
	sourceLabel: string,
): string {
	const installed = installSkillFromPath(prepared.sourceDir, targetAgentSlugs, agents, prepared.skillName);
	const skillId = basename(installed);
	const rel = prepared.skillRelativePath.trim();
	writeProvenance(skillId, sourceLabel, prepared.repository, !rel || rel === "." ? null : rel, prepared.resolvedSha);
	return installed;
}

export function discardPreparedGitSkill(prepared: Pick<PreparedGitSkillInstall, "tempDir">): void {
	try {
		rmSync(prepared.tempDir, { recursive: true, force: true });
	} catch {
		// Ignore cleanup failure: it must not mask a failed clone, checkout,
		// or integrity check. The OS can reclaim it later.
	}
}

export async function installSkillFromGit(
	repoUrl: string,
	skillRelativePath: string,
	targetAgentSlugs: string[],
	agents: AgentConfig[],
	sourceLabel: string,
	/** Optional git ref (branch, tag, or SHA) to check out before copying. */
	ref?: string | null,
	/** Portable manifest identity when the source directory name is not the skill id. */
	targetSkillName?: string,
	/** When supplied by Sync Center, verify exact source content before any local write. */
	expectedContentHash?: string,
): Promise<string> {
	const prepared = await prepareGitSkillInstall(repoUrl, skillRelativePath, ref, targetSkillName, expectedContentHash);
	try {
		return installPreparedGitSkill(prepared, targetAgentSlugs, agents, sourceLabel);
	} finally {
		try {
			discardPreparedGitSkill(prepared);
		} catch { /* discard is already failure-safe */ }
	}
}
