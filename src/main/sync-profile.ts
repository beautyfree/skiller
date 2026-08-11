/**
 * Renderer-facing view of a canonical dotagents library. This is not a
 * portable format: canonical state lives in skills.json, skills.lock and
 * dotagents.yaml and is authored by dotagents itself.
 */
export type SyncMode = "private" | "team" | "public";
export type SyncAgentPolicy =
  | { mode: "detected" }
  | { mode: "selected"; agent_slugs: string[] };

export type SyncSkill =
  | { id: string; kind: "bundled"; path: string; sha256: string; installations?: string[] }
  | { id: string; kind: "reference"; repository: string; ref: string; skill_path: string; sha256?: string; installations?: string[] }
  | { id: string; kind: "skills_sh"; source_url: string; ref: string; skill_path: string; sha256?: string; installations?: string[] };

export type SyncManifest = {
  profile: { id: string; mode: SyncMode };
  agent_policy: SyncAgentPolicy;
  skills: SyncSkill[];
};

export function assertSyncStableId(value: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) throw new Error(`Invalid library id: ${value}`);
}

export function assertPortableRelativePath(value: string): void {
  if (!value || value.trim() !== value || value.includes("\\") || value.startsWith("/") || /^[a-z]:/i.test(value))
    throw new Error(`Library path must be a portable relative POSIX path: ${value}`);
  if (value.split("/").some((part) => !part || part === "." || part === ".."))
    throw new Error(`Library path must not contain traversal: ${value}`);
}

export function assertCredentialFreeGitRemote(remote: string): void {
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/\s@]+:[^/\s@]+@/i.test(remote))
    throw new Error("Sync repository URL must not embed credentials");
}

export function createSyncManifest(
  id: string,
  mode: SyncMode = "private",
  agentPolicy: SyncAgentPolicy = { mode: "detected" },
): SyncManifest {
  return validateSyncManifest({ profile: { id, mode }, agent_policy: agentPolicy, skills: [] });
}

/** Validates the in-memory view assembled from canonical dotagents files. */
export function validateSyncManifest(input: SyncManifest): SyncManifest {
  assertSyncStableId(input.profile.id);
  const ids = new Set<string>();
  for (const skill of input.skills) {
    assertSyncStableId(skill.id);
    if (ids.has(skill.id)) throw new Error(`Duplicate library skill id: ${skill.id}`);
    ids.add(skill.id);
    if (skill.kind === "bundled") {
      assertPortableRelativePath(skill.path);
      if (skill.path !== `skills/${skill.id}`) throw new Error(`Bundled skill ${skill.id} must use skills/${skill.id}`);
    } else {
      if (skill.skill_path !== ".") assertPortableRelativePath(skill.skill_path);
      assertCredentialFreeGitRemote(skill.kind === "reference" ? skill.repository : skill.source_url);
      if (!/^[a-f0-9]{40}$/i.test(skill.ref)) throw new Error(`Library skill ${skill.id} must be pinned to a Git commit`);
    }
  }
  return input;
}

/** Derive a private local workspace id without exposing this concept in setup UI. */
export function syncProfileIdFromRemote(remoteUrl: string): string {
  const withoutQuery = remoteUrl.trim().split(/[?#]/, 1)[0] ?? "";
  const remoteParts = withoutQuery.replace(/[\\/]+$/, "").split(/[\\/:]/);
  const repository = remoteParts[remoteParts.length - 1]?.replace(/\.git$/i, "") ?? "";
  const normalized = repository
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return normalized || "agent-library";
}
