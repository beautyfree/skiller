import { basename, join, resolve, sep } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AgentConfig } from "../types";
import type { MarketplaceSkill } from "../marketplace-types";
import { discoverSkillDirs } from "../scanner";
import { installSkillFromPath } from "../install";
import { saveLocalSkillSource } from "dotagents/source-registry";
import type { SourceSecurityPolicyInput } from "dotagents/source-policy";
import { checkoutReviewedGitSource } from "../git-transport";

function findSkillInRepo(repoDir: string, skillName: string): string | null {
  const skillNameLower = skillName.toLowerCase();
  const candidates = discoverSkillDirs(repoDir);

  const match1 = candidates.find((c) => {
    const n = basename(c.dir).toLowerCase();
    return n === skillNameLower;
  });
  if (match1) return match1.dir;

  const match2 = candidates.find(
    (c) => c.parsed_name?.toLowerCase() === skillNameLower,
  );
  if (match2) return match2.dir;

  const match3 = candidates.find((c) => {
    const n = basename(c.dir).toLowerCase();
    return (
      skillNameLower.startsWith(`${n}-`) ||
      skillNameLower.startsWith(`${n}_`) ||
      skillNameLower === n
    );
  });
  if (match3) return match3.dir;

  const match4 = candidates.find((c) => {
    const n = c.parsed_name?.toLowerCase();
    if (!n) return false;
    return n.includes(skillNameLower) || skillNameLower.includes(n);
  });
  if (match4) return match4.dir;

  if (candidates.length === 1) return candidates[0]!.dir;

  return null;
}

export async function installFromMarketplace(
  skill: MarketplaceSkill,
  targetAgents: string[],
  agents: AgentConfig[],
  sourcePolicy: SourceSecurityPolicyInput = {},
): Promise<void> {
  const repoUrl = skill.repository?.trim();
  if (!repoUrl) {
    throw new Error("marketplace item has no repository url");
  }
  const tempDir = join(
    tmpdir(),
    `skiller-marketplace-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  try {
    const checkout = await checkoutReviewedGitSource(
      repoUrl,
      tempDir,
      "HEAD",
      sourcePolicy,
    );
    const explicitSkillPath = skill.skill_path?.trim();
    const candidateFromSource = explicitSkillPath
      ? resolve(tempDir, explicitSkillPath)
      : null;
    const skillDir = candidateFromSource?.startsWith(`${resolve(tempDir)}${sep}`) &&
      existsSync(join(candidateFromSource, "SKILL.md"))
      ? candidateFromSource
      : findSkillInRepo(tempDir, skill.name);
    const canonical = skillDir
      ? installSkillFromPath(skillDir, targetAgents, agents)
      : installSkillFromPath(tempDir, targetAgents, agents);

    const skillId = basename(canonical);
		const source = skill.source === "skills.sh"
			? "skills.sh"
			: skill.source === "clawhub"
				? "clawhub"
				: repoUrl ? "git" : "local";
    saveLocalSkillSource(skillId, {
			source,
      repository: repoUrl ?? null,
      skill_path: explicitSkillPath && explicitSkillPath !== "." ? explicitSkillPath : null,
      ref: checkout.resolvedCommit,
      content_sha256: null,
			ownership: source === "local" ? "unknown" : "external",
    });
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
