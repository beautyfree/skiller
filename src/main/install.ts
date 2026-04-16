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
import { writeProvenance } from "./provenance";
import { sharedSkillsDir } from "./shared-skills";

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
	const canonicalDir = installToCanonical(sourceSkillDir, skillName);

	const sharedPath = sharedSkillsDir();
	let sharedReal: string;
	try {
		sharedReal = realpathSync(sharedPath);
	} catch {
		sharedReal = sharedPath;
	}

	for (const slug of targetAgentSlugs) {
		const agent = agents.find((a) => a.slug === slug);
		if (!agent) throw new Error(`agent \`${slug}\` is unsupported`);

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

export async function installSkillFromGit(
	repoUrl: string,
	skillRelativePath: string,
	targetAgentSlugs: string[],
	agents: AgentConfig[],
	sourceLabel: string,
): Promise<string> {
	const tempDir = join(
		tmpdir(),
		`skills-app-install-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await simpleGit().clone(repoUrl, tempDir);
	const source = join(tempDir, skillRelativePath);
	const skillName = deriveGitTargetSkillName(repoUrl, skillRelativePath, source);
	const installed = installSkillFromPath(source, targetAgentSlugs, agents, skillName);
	try {
		rmSync(tempDir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}

	const skillId = basename(installed);
	const rel = skillRelativePath.trim();
	const skillPath = !rel || rel === "." ? null : rel;
	writeProvenance(skillId, sourceLabel, repoUrl, skillPath);
	return installed;
}
