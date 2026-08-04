import { parse, stringify } from "yaml";
import { z } from "zod";
import type { VendoredOrigin } from "dotagents";
import { planSkillExport, type SkillExportFinding, type SkillExportPlan } from "dotagents";
import { computePlanId } from "dotagents";

/** Compatibility format used by Skiller before beautyfree/dotagents libraries. */
export const SKILLER_SYNC_MANIFEST_FILE = "skiller-sync.yaml";
export const SKILLER_SYNC_MANIFEST_VERSION = 3 as const;

export const skillerStableIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const portablePathSchema = z.string().min(1).max(512);
const skillSourcePathSchema = z.union([z.literal("."), portablePathSchema]);
const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);
const commitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);

const installationsSchema = z.array(skillerStableIdSchema).min(1).optional();

export const skillerBundledSkillSchema = z.object({
  id: skillerStableIdSchema,
  kind: z.literal("bundled"),
  path: portablePathSchema,
  sha256: sha256HexSchema,
  installations: installationsSchema,
});

export const skillerReferenceSkillSchema = z.object({
  id: skillerStableIdSchema,
  kind: z.literal("reference"),
  repository: z.string().min(1).max(2_048),
  ref: commitShaSchema,
  skill_path: skillSourcePathSchema,
  sha256: sha256HexSchema.optional(),
  installations: installationsSchema,
});

export const skillerSkillsShSkillSchema = z.object({
  id: skillerStableIdSchema,
  kind: z.literal("skills_sh"),
  source_url: z.string().min(1).max(2_048),
  ref: commitShaSchema,
  skill_path: skillSourcePathSchema,
  sha256: sha256HexSchema.optional(),
  installations: installationsSchema,
});

const manifestBaseSchema = z.object({
  profile: z.object({
    id: skillerStableIdSchema,
    mode: z.enum(["private", "team", "public"]),
  }),
  agent_policy: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("detected") }),
    z.object({ mode: z.literal("selected"), agent_slugs: z.array(skillerStableIdSchema).min(1) }),
  ]),
});

export const skillerSyncManifestSchema = manifestBaseSchema.extend({
  schema_version: z.literal(SKILLER_SYNC_MANIFEST_VERSION),
  skills: z.array(
    z.discriminatedUnion("kind", [skillerBundledSkillSchema, skillerReferenceSkillSchema, skillerSkillsShSkillSchema]),
  ),
});

const v2SkillerSyncManifestSchema = manifestBaseSchema.extend({
  schema_version: z.literal(2),
  skills: z.array(
    z.discriminatedUnion("kind", [
      skillerBundledSkillSchema,
      skillerReferenceSkillSchema.omit({ installations: true }),
    ]),
  ),
});

const v1SkillerSyncManifestSchema = manifestBaseSchema.extend({
  schema_version: z.literal(1),
  skills: z.array(
    z.discriminatedUnion("kind", [
      skillerBundledSkillSchema.omit({ installations: true }),
      skillerReferenceSkillSchema.omit({ installations: true }),
    ]),
  ),
});

export type SkillerSyncManifest = z.infer<typeof skillerSyncManifestSchema>;
export type SkillerSyncSkill = SkillerSyncManifest["skills"][number];

export interface SkillerBundledPublishCandidate {
  kind?: "bundled";
  id: string;
  sourcePath: string;
  installationAgentSlugs?: string[];
}

export interface SkillerReferencePublishCandidate {
  kind: "reference";
  id: string;
  repository: string;
  ref: string;
  skillPath: string;
  contentHash?: string;
  installationAgentSlugs?: string[];
}

export interface SkillerSkillsShPublishCandidate {
  kind: "skills_sh";
  id: string;
  sourceUrl: string;
  ref: string;
  skillPath: string;
  contentHash?: string;
  installationAgentSlugs?: string[];
}

export interface SkillerVendoredPublishCandidate {
  kind: "vendored";
  id: string;
  sourcePath: string;
  origin: VendoredOrigin;
  installationAgentSlugs?: string[];
}

export type SkillerSyncPublishCandidate =
  | SkillerBundledPublishCandidate
  | SkillerReferencePublishCandidate
  | SkillerSkillsShPublishCandidate
  | SkillerVendoredPublishCandidate;

export type SkillerBundledExportPlan = Omit<SkillExportPlan, "skill"> & {
  id: string;
  bundledPath: string;
};

export interface SkillerSyncPublishPlan {
  kind: "skiller-sync-publish";
  schemaVersion: 1;
  planId: string;
  manifest: SkillerSyncManifest;
  bundledSkills: SkillerBundledExportPlan[];
  bundledDistributions: Record<string, "owned" | "vendored">;
  vendoredOrigins: Record<string, VendoredOrigin>;
  secretFindings: SkillExportFinding[];
}

function withSkillerPublishPlanId(payload: Omit<SkillerSyncPublishPlan, "planId">): SkillerSyncPublishPlan {
  return { ...payload, planId: computePlanId(payload) };
}

export function assertSkillerStableId(id: string): void {
  if (!skillerStableIdSchema.safeParse(id).success) throw new Error(`Invalid sync stable id: ${id}`);
}

/** Legacy Skiller paths are strict POSIX-relative paths; traversal is rejected, not normalized. */
export function assertSkillerPortableRelativePath(value: string): void {
  if (value.trim() !== value || value.length === 0 || value.length > 512) {
    throw new Error("Sync path must be a non-empty, trimmed relative path");
  }
  if (value.includes("\\") || value.startsWith("/") || /^[a-z]:/i.test(value)) {
    throw new Error(`Sync path must use a portable relative POSIX path: ${value}`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`Sync path must not contain traversal segments: ${value}`);
  }
}

export function assertSkillerPortableSkillSourcePath(value: string): void {
  if (value !== ".") assertSkillerPortableRelativePath(value);
}

/** Credentials belong in a credential helper or SSH agent, never in a portable manifest. */
export function assertCredentialFreeGitRemote(remote: string): void {
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/\s@]+:[^/\s@]+@/i.test(remote)) {
    throw new Error("Sync repository URL must not embed credentials");
  }
}

export function validateSkillerSyncManifest(input: unknown): SkillerSyncManifest {
  const raw = input as { schema_version?: unknown } | null;
  const v1 = raw?.schema_version === 1 ? v1SkillerSyncManifestSchema.parse(input) : null;
  const v2 = raw?.schema_version === 2 ? v2SkillerSyncManifestSchema.parse(input) : null;
  const manifest: SkillerSyncManifest = v1
    ? { ...v1, schema_version: SKILLER_SYNC_MANIFEST_VERSION }
    : v2
      ? { ...v2, schema_version: SKILLER_SYNC_MANIFEST_VERSION }
      : skillerSyncManifestSchema.parse(input);

  const seenIds = new Set<string>();
  for (const skill of manifest.skills) {
    if (seenIds.has(skill.id)) throw new Error(`Duplicate sync skill id: ${skill.id}`);
    seenIds.add(skill.id);
    if (skill.kind === "bundled") {
      assertSkillerPortableRelativePath(skill.path);
      const expectedPath = `skills/${skill.id}`;
      if (skill.path !== expectedPath) throw new Error(`Bundled skill ${skill.id} must use path ${expectedPath}`);
    } else {
      assertSkillerPortableSkillSourcePath(skill.skill_path);
      assertCredentialFreeGitRemote(skill.kind === "reference" ? skill.repository : skill.source_url);
    }
  }
  return manifest;
}

export function parseSkillerSyncManifest(text: string): SkillerSyncManifest {
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    throw new Error(
      `Invalid ${SKILLER_SYNC_MANIFEST_FILE}: ${error instanceof Error ? error.message : "YAML parse failed"}`,
    );
  }
  return validateSkillerSyncManifest(parsed);
}

export function stringifySkillerSyncManifest(manifest: SkillerSyncManifest): string {
  return stringify(validateSkillerSyncManifest(manifest));
}

export function createSkillerSyncManifest(
  profileId: string,
  mode: SkillerSyncManifest["profile"]["mode"] = "private",
  agentPolicy: SkillerSyncManifest["agent_policy"] = { mode: "detected" },
): SkillerSyncManifest {
  assertSkillerStableId(profileId);
  return validateSkillerSyncManifest({
    schema_version: SKILLER_SYNC_MANIFEST_VERSION,
    profile: { id: profileId, mode },
    agent_policy: agentPolicy,
    skills: [],
  });
}

function normalizedInstallations(agentSlugs: string[] | undefined): string[] | undefined {
  return agentSlugs?.length ? [...new Set(agentSlugs)].sort() : undefined;
}

/**
 * Builds Skiller's compatibility publish payload without writing to the library.
 * Source inspection, integrity, and secret findings come from dotagents's shared export policy.
 */
export function planSkillerSyncPublish(
  profileId: string,
  mode: SkillerSyncManifest["profile"]["mode"],
  candidates: SkillerSyncPublishCandidate[],
  agentPolicy?: SkillerSyncManifest["agent_policy"],
): SkillerSyncPublishPlan {
  const bundledCandidates = candidates.filter(
    (candidate): candidate is SkillerBundledPublishCandidate | SkillerVendoredPublishCandidate =>
      candidate.kind === undefined || candidate.kind === "bundled" || candidate.kind === "vendored",
  );
  const bundledSkills = bundledCandidates.map((candidate): SkillerBundledExportPlan => {
    const plan = planSkillExport(candidate.id, candidate.sourcePath);
    return {
      id: candidate.id,
      sourcePath: plan.sourcePath,
      bundledPath: `skills/${candidate.id}`,
      sha256: plan.sha256,
      files: plan.files,
      excludedPaths: plan.excludedPaths,
      secretFindings: plan.secretFindings,
    };
  });
  const bundledById = new Map(bundledSkills.map((skill) => [skill.id, skill]));
  const manifest = createSkillerSyncManifest(profileId, mode, agentPolicy);
  manifest.skills = candidates.map((candidate): SkillerSyncSkill => {
    const installations = normalizedInstallations(candidate.installationAgentSlugs);
    if (candidate.kind === "reference") {
      return {
        id: candidate.id,
        kind: "reference",
        repository: candidate.repository,
        ref: candidate.ref,
        skill_path: candidate.skillPath,
        ...(candidate.contentHash ? { sha256: candidate.contentHash } : {}),
        ...(installations ? { installations } : {}),
      };
    }
    if (candidate.kind === "skills_sh") {
      return {
        id: candidate.id,
        kind: "skills_sh",
        source_url: candidate.sourceUrl,
        ref: candidate.ref,
        skill_path: candidate.skillPath,
        ...(candidate.contentHash ? { sha256: candidate.contentHash } : {}),
        ...(installations ? { installations } : {}),
      };
    }
    const skill = bundledById.get(candidate.id);
    if (!skill) throw new Error(`Missing bundled export plan: ${candidate.id}`);
    return {
      id: skill.id,
      kind: "bundled",
      path: skill.bundledPath,
      sha256: skill.sha256,
      ...(installations ? { installations } : {}),
    };
  });
  return withSkillerPublishPlanId({
    kind: "skiller-sync-publish",
    schemaVersion: 1,
    manifest: validateSkillerSyncManifest(manifest),
    bundledSkills,
    bundledDistributions: Object.fromEntries(
      bundledCandidates.map((candidate) => [candidate.id, candidate.kind === "vendored" ? "vendored" : "owned"]),
    ),
    vendoredOrigins: Object.fromEntries(
      bundledCandidates
        .filter((candidate): candidate is SkillerVendoredPublishCandidate => candidate.kind === "vendored")
        .map((candidate) => [candidate.id, candidate.origin]),
    ),
    secretFindings: bundledSkills.flatMap((skill) => skill.secretFindings),
  });
}

/** Keeps untouched remote skills while applying an explicitly reviewed owned-skill update. */
export function mergeSkillerSyncPublishUpdate(
  base: SkillerSyncManifest,
  update: SkillerSyncPublishPlan,
  options: { allowSourceConversion?: boolean } = {},
): SkillerSyncPublishPlan {
  const replacement = new Map(update.manifest.skills.map((skill) => [skill.id, skill]));
  for (const skill of update.manifest.skills) {
    const previous = base.skills.find((item) => item.id === skill.id);
    if (!previous || skill.kind !== "bundled" || (!options.allowSourceConversion && previous.kind !== "bundled")) {
      throw new Error(`Granular sync update is not a known bundled skill: ${skill.id}`);
    }
  }
  const { planId: _previousPlanId, ...payload } = update;
  return withSkillerPublishPlanId({
    ...payload,
    manifest: validateSkillerSyncManifest({
      ...base,
      skills: base.skills.map((skill) => replacement.get(skill.id) ?? skill),
    }),
  });
}
