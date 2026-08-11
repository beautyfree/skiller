import { join } from "node:path";
import type { AgentConfig } from "./types";
import { installSkillFromPath } from "./install";
import { readLocalSkillSources, saveLocalSkillSource } from "dotagents/source-registry";
import { scanAllSkills } from "./scanner";
import type { UpdateAllResult, UpdateProgress } from "./skill-types";
import { appDataRootPath } from "./settings";
import { SkillSourceSession } from "dotagents/source-session";
import type { SourceSecurityPolicyInput } from "dotagents/source-policy";

function persistentClonePath(repoUrl: string): string {
  const name =
    repoUrl
      .trim()
      .replace(/\/$/, "")
      .split("/")
      .pop()
      ?.replace(/\.git$/, "") ?? "repo";
  return join(appDataRootPath(), "repos", name);
}

/** Update one skill from its recorded git provenance (mirrors Rust `update_skill`). */
export async function updateSingleSkill(
  skillId: string,
  agents: AgentConfig[],
  sourcePolicy: SourceSecurityPolicyInput = {},
): Promise<void> {
  const raw = readLocalSkillSources();
  const entry = raw[skillId];
  if (!entry || typeof entry !== "object") {
    throw new Error(`No provenance for skill '${skillId}'`);
  }
  const rec: Record<string, unknown> = { ...entry };
  const sourceLabel = typeof rec.source === "string" ? rec.source : "";
  const repoUrl = typeof rec.repository === "string" ? rec.repository : "";
  // Skills installed from a local folder have provenance.source = "local"
  // and `repository` set to the folder path, not a git URL. Trying to
	// A local folder is not a reviewed remote Git source and cannot participate
	// in the immutable checkout transport. Reinstall it explicitly instead.
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
    allSkills
      .find((s) => s.id === skillId)
      ?.installations.map((i) => i.agent_slug) ?? [];
  const session = await SkillSourceSession.open({
    repository: repoUrl,
    sourcePolicy,
    cacheDirectory: persistentClonePath(repoUrl),
  });
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
    await session.dispose();
  }
}

export function updateSkillFromSession(
  skillId: string,
  sourceLabel: string,
  repoUrl: string,
  skillPathHint: string | null | undefined,
  targetAgents: string[],
  agents: AgentConfig[],
  session: SkillSourceSession,
): void {
	void sourceLabel;
  const skillDir = session.findSkill(skillId, skillPathHint);
  if (!skillDir) throw new Error(`skill '${skillId}' not found in repository`);
  installSkillFromPath(skillDir, targetAgents, agents);
  saveLocalSkillSource(skillId, { source: "git", repository: repoUrl, skill_path: skillPathHint ?? null, ref: null, content_sha256: null, ownership: "external" });
}

export async function updateAll(
  agents: AgentConfig[],
  onProgress: (p: UpdateProgress) => void,
  sourcePolicy: SourceSecurityPolicyInput = {},
): Promise<UpdateAllResult> {
  const provenance = readLocalSkillSources();
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
      allSkills
        .find((s) => s.id === skillId)
        ?.installations.map((i) => i.agent_slug) ?? [];
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
    let session: SkillSourceSession | undefined;
    try {
      session = await SkillSourceSession.open({
        repository: repoUrl,
        sourcePolicy,
        cacheDirectory: persistentClonePath(repoUrl),
      });
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
      await session.dispose();
    }
  }

  return result;
}
