import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { randomUUID } from "node:crypto";
import { parseLibraryLock, parseLibraryManifest } from "@beautyfree/dotagent/library";
import { libraryManifestSchema, type LibraryLock, type LibraryManifest } from "@beautyfree/dotagent/schema";
import { localConfigSchema, mergeConfig, parseLocalConfig, parsePortableConfig, resolveSkillAgentSelection, type LocalConfig } from "@beautyfree/dotagent/config";
import { GitDependencyResolver } from "@beautyfree/dotagent";
import { planResolveDependencies } from "@beautyfree/dotagent/sources";
import type { SyncManifest } from "./sync-profile";
import { createSyncManifest, parseSyncManifest, validateSyncManifest } from "./sync-profile";
import type { SyncPublishPlan } from "./sync-publish";
import { planBundledSkillExport } from "./sync-export";

const CANONICAL_MANIFEST = "skills.json";
const LEGACY_MANIFEST = "skiller-sync.yaml";
const LOCAL_CONFIG = "dotagent.local.yaml";

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
  portableFiles: Record<string, string>;
};

export type CanonicalSyncLibraryOptions = {
  license?: string;
};

function canonicalMetadata(value: unknown): CanonicalSkillerMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Canonical library has no Skiller routing metadata");
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
  const result = parseLibraryLock(readFileSync(join(workspace, "skills.lock"), "utf8"));
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

/**
 * Persist a reviewed per-device routing choice while retaining future local
 * fields. Canonical repositories gitignore this file by contract.
 */
export function writeLocalSyncAgentSelection(workspace: string, agentSlugs: string[]): void {
  if (!isCanonicalSyncLibrary(workspace)) {
    throw new Error("Local agent routing is supported only by canonical dotagent libraries");
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
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, stringify(next, { lineWidth: 100 }), { mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function canonicalSyncAgentRouting(
  workspace: string,
  detectedAgentSlugs: string[],
): { forSkill: (skillId: string) => string[]; localFilter: string[] | null } | null {
  if (!isCanonicalSyncLibrary(workspace)) return null;
  const portable = parsePortableConfig(readFileSync(join(workspace, "dotagent.yaml"), "utf8"));
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
  const existingConfigPath = join(workspace, "dotagent.yaml");
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
    description: "A portable agent skill library managed by Skiller and beautyfree/dotagent.",
    ...(license ? { license } : {}),
    skills: plan.manifest.skills.filter((skill) => skill.kind === "bundled").map((skill) => skill.path).sort(),
    dependencies,
    metadata: { skiller_sync: metadata },
  });
  const resolution = await planResolveDependencies(
    manifest,
    new GitDependencyResolver({ cacheRoot: join(workspace, ".dotagent", "cache", "git") }),
    null,
    "@beautyfree/dotagent via Skiller",
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
    portableFiles: {
      "skills.json": `${JSON.stringify(manifest, null, 2)}\n`,
      "skills.lock": `${JSON.stringify(resolution.lock, null, 2)}\n`,
      "dotagent.yaml": stringify(config, { lineWidth: 100 }),
      ".gitignore": "dotagent.local.yaml\n.dotagent/\n",
      "README.md": `# ${manifest.name}\n\nA portable agent skill library managed by [Skiller](https://github.com/beautyfree/skiller) and [beautyfree/dotagent](https://github.com/beautyfree/dotagent).\n`,
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
  const lockResult = parseLibraryLock(readFileSync(join(workspace, "skills.lock"), "utf8"));
  if (!lockResult.ok) throw new Error(lockResult.issues.map((issue) => issue.message).join("; "));
  const metadata = canonicalMetadata(manifestResult.value.metadata?.skiller_sync);
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
    ...Object.entries(lockResult.value.resolved).flatMap(([dependency, resolved]) => resolved.skills.map((skill) => {
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
