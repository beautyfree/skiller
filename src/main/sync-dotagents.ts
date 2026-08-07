import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { randomUUID } from "node:crypto";
import { parseLibraryLock, parseLibraryManifest } from "dotagents/library";
import { libraryManifestSchema, type LibraryLock, type LibraryManifest } from "dotagents/schema";
import { localConfigSchema, mergeConfig, parseLocalConfig, parsePortableConfig, resolveSkillAgentSelection, type LocalConfig } from "dotagents/config";
import { GitDependencyResolver } from "dotagents";
import { planResolveDependencies } from "dotagents/sources";
import {
  DENY_ALL_SOURCE_SECURITY_POLICY,
  exactSourceSecurityPolicy,
  parseSourceSecurityPolicy,
  type SourceSecurityPolicy,
  type SourceSecurityPolicyInput,
} from "dotagents/source-policy";
import type { SyncManifest } from "./sync-profile";
import { createSyncManifest, parseSyncManifest, validateSyncManifest } from "./sync-profile";
import type { SyncPublishPlan } from "./sync-publish";
import { planBundledSkillExport } from "./sync-export";

const CANONICAL_MANIFEST = "skills.json";
const LEGACY_MANIFEST = "skiller-sync.yaml";
const LOCAL_CONFIG = "dotagents.local.yaml";

type CanonicalSkillerMetadata = {
  schema_version: 1;
  profile: SyncManifest["profile"];
  agent_policy: SyncManifest["agent_policy"];
  source_kinds: Record<string, "reference" | "skills_sh">;
  content_hashes: Record<string, string>;
  installations: Record<string, string[]>;
};

export type CanonicalSyncLibraryPlan = {
  manifest: LibraryManifest;
  lock: LibraryLock;
  /** Device-only evidence; never written into portable files. */
  sourcePolicy: SourceSecurityPolicy | null;
  resolutionPlanId: string;
  portableFiles: Record<string, string>;
};

export type CanonicalSyncLibraryOptions = {
  license?: string;
  /** Exact device-owned trust and cooling-off policy reviewed in Sync Center. */
  sourcePolicy?: SourceSecurityPolicyInput;
  /** Device cache outside the portable repository during preflight. */
  cacheRoot?: string;
};

function canonicalMetadata(value: unknown, fallbackProfileId: string): CanonicalSkillerMetadata {
  // A generic dotagents library is still a valid Sync Center library. Skiller's
  // routing metadata is an optional product extension, not a compatibility
  // requirement for repositories created by `dotagents init` or another client.
  // The conservative fallback remains private and device-selected.
  if (value === undefined) {
    return {
      schema_version: 1,
      profile: { id: fallbackProfileId, mode: "private" },
      agent_policy: { mode: "detected" },
      source_kinds: {},
      content_hashes: {},
      installations: {},
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Canonical library has invalid Skiller routing metadata");
  }
  const metadata = value as Partial<CanonicalSkillerMetadata>;
  if (metadata.schema_version !== 1 || !metadata.profile || !metadata.agent_policy) {
    throw new Error("Canonical library uses unsupported Skiller routing metadata");
  }
  return {
    schema_version: 1,
    profile: metadata.profile,
    agent_policy: metadata.agent_policy,
    source_kinds: metadata.source_kinds ?? {},
    content_hashes: metadata.content_hashes ?? {},
    installations: metadata.installations ?? {},
  };
}

export function isCanonicalSyncLibrary(workspace: string): boolean {
  return existsSync(join(workspace, CANONICAL_MANIFEST));
}

export function readCanonicalSyncLock(workspace: string): LibraryLock | null {
  if (!isCanonicalSyncLibrary(workspace)) return null;
  const lockPath = join(workspace, "skills.lock");
  if (!existsSync(lockPath)) return null;
  const result = parseLibraryLock(readFileSync(lockPath, "utf8"));
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join("; "));
  return result.value;
}

/** Machine routing is private state and must never leak into a shared library. */
export function readLocalSyncAgentSelection(workspace: string): string[] | null {
  if (!isCanonicalSyncLibrary(workspace)) return null;
  const path = join(workspace, LOCAL_CONFIG);
  if (!existsSync(path)) return null;
  const selected = parseLocalConfig(readFileSync(path, "utf8")).agents?.selected;
  return selected ? [...selected] : null;
}

/** The remote allowlist is Device state and is never committed with a library. */
export function readLocalSyncSourceSecurityPolicy(workspace: string): SourceSecurityPolicy {
  if (!isCanonicalSyncLibrary(workspace)) return DENY_ALL_SOURCE_SECURITY_POLICY;
  const path = join(workspace, LOCAL_CONFIG);
  if (!existsSync(path)) return DENY_ALL_SOURCE_SECURITY_POLICY;
  return parseLocalConfig(readFileSync(path, "utf8")).source_security ?? DENY_ALL_SOURCE_SECURITY_POLICY;
}

function writeLocalConfig(workspace: string, next: LocalConfig): void {
  const path = join(workspace, LOCAL_CONFIG);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, stringify(localConfigSchema.parse(next), { lineWidth: 100 }), { mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function writeLocalSyncSourceSecurityPolicy(
  workspace: string,
  sourcePolicy: SourceSecurityPolicyInput,
): void {
  if (!isCanonicalSyncLibrary(workspace)) {
    throw new Error("Local source trust is supported only by canonical dotagents libraries");
  }
  const path = join(workspace, LOCAL_CONFIG);
  const existing: LocalConfig = existsSync(path)
    ? parseLocalConfig(readFileSync(path, "utf8"))
    : localConfigSchema.parse({ schema_version: 1 });
  writeLocalConfig(workspace, {
    ...existing,
    schema_version: 1,
    source_security: parseSourceSecurityPolicy(sourcePolicy),
  });
}

/**
 * Persist a reviewed per-device routing choice while retaining future local
 * fields. Canonical repositories gitignore this file by contract.
 */
export function writeLocalSyncAgentSelection(workspace: string, agentSlugs: string[]): void {
  if (!isCanonicalSyncLibrary(workspace)) {
    throw new Error("Local agent routing is supported only by canonical dotagents libraries");
  }
  const path = join(workspace, LOCAL_CONFIG);
  const existing: LocalConfig = existsSync(path)
    ? parseLocalConfig(readFileSync(path, "utf8"))
    : localConfigSchema.parse({ schema_version: 1 });
  const next = localConfigSchema.parse({
    ...existing,
    schema_version: 1,
    agents: {
      ...(existing.agents ?? {}),
      selected: [...new Set(agentSlugs)].sort(),
    },
  });
  writeLocalConfig(workspace, next);
}

export function canonicalSyncAgentRouting(
  workspace: string,
  detectedAgentSlugs: string[],
): { forSkill: (skillId: string) => string[]; localFilter: string[] | null } | null {
  if (!isCanonicalSyncLibrary(workspace)) return null;
  const portable = parsePortableConfig(readFileSync(join(workspace, "dotagents.yaml"), "utf8"));
  const localPath = join(workspace, LOCAL_CONFIG);
  const local = existsSync(localPath) ? parseLocalConfig(readFileSync(localPath, "utf8")) : null;
  const effective = mergeConfig(portable, local);
  return {
    forSkill: (skillId) => resolveSkillAgentSelection(effective, skillId, detectedAgentSlugs).agents,
    localFilter: effective.agents.selected ? [...effective.agents.selected].sort() : null,
  };
}

export async function planCanonicalSyncLibrary(
  workspace: string,
  plan: SyncPublishPlan,
  options: CanonicalSyncLibraryOptions = {},
): Promise<CanonicalSyncLibraryPlan> {
  let existingLicense: string | undefined;
  let existingConfig: ReturnType<typeof parsePortableConfig> | null = null;
  const existingManifestPath = join(workspace, CANONICAL_MANIFEST);
  if (existsSync(existingManifestPath)) {
    const existing = parseLibraryManifest(readFileSync(existingManifestPath, "utf8"));
    if (existing.ok) existingLicense = existing.value.license;
  }
  const existingConfigPath = join(workspace, "dotagents.yaml");
  if (existsSync(existingConfigPath)) existingConfig = parsePortableConfig(readFileSync(existingConfigPath, "utf8"));
  const license = options.license ?? existingLicense;
  const dependencies: LibraryManifest["dependencies"] = {};
  const sourceKinds: CanonicalSkillerMetadata["source_kinds"] = {};
  const contentHashes: CanonicalSkillerMetadata["content_hashes"] = {};
  const installations: CanonicalSkillerMetadata["installations"] = {};
  for (const skill of plan.manifest.skills) {
    if (skill.installations?.length) installations[skill.id] = [...new Set(skill.installations)].sort();
    if (skill.kind === "bundled") continue;
    const url = skill.kind === "skills_sh" ? skill.source_url : skill.repository;
    dependencies[skill.id] = { url, ref: skill.ref, select: [skill.skill_path] };
    sourceKinds[skill.id] = skill.kind;
    if (skill.sha256) contentHashes[skill.id] = skill.sha256;
  }
  const metadata: CanonicalSkillerMetadata = {
    schema_version: 1,
    profile: plan.manifest.profile,
    agent_policy: plan.manifest.agent_policy,
    source_kinds: sourceKinds,
    content_hashes: contentHashes,
    installations,
  };
  const manifest = libraryManifestSchema.parse({
    schema_version: 1,
    name: plan.manifest.profile.id,
    version: "0.1.0",
    description: "A portable agent skill library managed by Skiller and beautyfree/dotagents.",
    ...(license ? { license } : {}),
    skills: plan.manifest.skills.filter((skill) => skill.kind === "bundled").map((skill) => skill.path).sort(),
    dependencies,
    metadata: { skiller_sync: metadata },
  });
  const resolution = await planResolveDependencies(
    manifest,
    new GitDependencyResolver({
      cacheRoot: options.cacheRoot ?? join(workspace, ".dotagents", "cache", "git"),
      sourcePolicy: options.sourcePolicy ?? exactSourceSecurityPolicy(Object.values(dependencies).map((dependency) => dependency.url)),
    }),
    null,
    "dotagents via Skiller",
  );
  const config = {
    schema_version: 1,
    defaults: { include: "all" },
    skills: Object.fromEntries(plan.manifest.skills.map((skill) => {
      const explicitDistribution = plan.bundledDistributions[skill.id];
      const previousPolicy = existingConfig?.skills[skill.id];
      const vendoredOrigin = plan.vendoredOrigins[skill.id]
        ?? (!explicitDistribution && previousPolicy?.distribution === "vendored" ? previousPolicy.origin : undefined);
      return [skill.id, {
        ...(skill.installations?.length ? { agents: [...new Set(skill.installations)].sort() } : {}),
        ...(skill.kind !== "bundled"
          ? { distribution: "dependency" as const }
          : vendoredOrigin
            ? { distribution: "vendored" as const, origin: vendoredOrigin }
            : {}),
      }];
    })),
  };
  return {
    manifest,
    lock: resolution.lock,
    sourcePolicy: resolution.sourcePolicy,
    resolutionPlanId: resolution.planId,
    portableFiles: {
      "skills.json": `${JSON.stringify(manifest, null, 2)}\n`,
      "skills.lock": `${JSON.stringify(resolution.lock, null, 2)}\n`,
      "dotagents.yaml": stringify(config, { lineWidth: 100 }),
      ".gitignore": "dotagents.local.yaml\n.dotagents/\n",
      "README.md": `# ${manifest.name}\n\nA portable agent skill library managed by [Skiller](https://github.com/beautyfree/skiller) and [beautyfree/dotagents](https://github.com/beautyfree/dotagents).\n`,
    },
  };
}

export function readSyncManifestFromWorkspace(workspace: string): SyncManifest {
  const legacy = join(workspace, LEGACY_MANIFEST);
  if (existsSync(legacy)) {
    return parseSyncManifest(readFileSync(legacy, "utf8"));
  }
  const manifestResult = parseLibraryManifest(readFileSync(join(workspace, CANONICAL_MANIFEST), "utf8"));
  if (!manifestResult.ok) throw new Error(manifestResult.issues.map((issue) => issue.message).join("; "));
  const lockPath = join(workspace, "skills.lock");
  let lock: LibraryLock;
  if (existsSync(lockPath)) {
    const lockResult = parseLibraryLock(readFileSync(lockPath, "utf8"));
    if (!lockResult.ok) throw new Error(lockResult.issues.map((issue) => issue.message).join("; "));
    lock = lockResult.value;
  } else {
    if (Object.keys(manifestResult.value.dependencies).length > 0) {
      throw new Error("This dotagents library declares dependencies but has no skills.lock. Resolve and review its dependencies before connecting it.");
    }
    // Empty libraries do not need a portable lockfile. Synthesize an internal
    // empty view without writing to or changing the remote repository.
    lock = { lockfile_version: 1, generated_by: "dotagents via Skiller", resolved: {} };
  }
  const metadata = canonicalMetadata(manifestResult.value.metadata?.skiller_sync, manifestResult.value.name);
  const sync = createSyncManifest(metadata.profile.id, metadata.profile.mode, metadata.agent_policy);
  sync.skills = [
    ...manifestResult.value.skills.map((skillPath) => {
      const parts = skillPath.split("/");
      const id = parts[parts.length - 1]!;
      const exported = planBundledSkillExport(id, join(workspace, ...skillPath.split("/")));
      return {
        id,
        kind: "bundled" as const,
        path: skillPath,
        sha256: exported.sha256,
        ...(metadata.installations[id]?.length ? { installations: metadata.installations[id] } : {}),
      };
    }),
    ...Object.entries(lock.resolved).flatMap(([dependency, resolved]) => resolved.skills.map((skill) => {
      const id = dependency;
      const kind = metadata.source_kinds[dependency] ?? "reference";
      const common = {
        id,
        ref: resolved.commit,
        skill_path: skill.path,
        ...(metadata.content_hashes[dependency] ? { sha256: metadata.content_hashes[dependency] } : {}),
        ...(metadata.installations[dependency]?.length ? { installations: metadata.installations[dependency] } : {}),
      };
      return kind === "skills_sh"
        ? { ...common, kind: "skills_sh" as const, source_url: resolved.url }
        : { ...common, kind: "reference" as const, repository: resolved.url };
    })),
  ];
  return validateSyncManifest(sync);
}
