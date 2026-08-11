import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { randomUUID } from "node:crypto";
import { parseLibraryLock, parseLibraryManifest } from "dotagents/library";
import { libraryManifestSchema, type LibraryLock, type LibraryManifest } from "dotagents/schema";
import { localConfigSchema, mergeConfig, parseLocalConfig, parsePortableConfig, resolveSkillAgentSelection, type LocalConfig } from "dotagents/config";
import { planCanonicalLibraryPublication } from "dotagents/canonical-library";
import type { LibraryPublishCandidate } from "dotagents/library-publish";
import { SCOPE_DESCRIPTOR_FILE, readPortableScopeDescriptor, type PortableScope } from "dotagents/scope";
import {
  DENY_ALL_SOURCE_SECURITY_POLICY,
  parseSourceSecurityPolicy,
  type SourceSecurityPolicy,
  type SourceSecurityPolicyInput,
} from "dotagents/source-policy";
import type { SyncManifest } from "./sync-profile";
import { createSyncManifest, validateSyncManifest } from "./sync-profile";
import type { SyncPublishPlan } from "./sync-publish";
import { planBundledSkillExport } from "./sync-export";

const CANONICAL_MANIFEST = "skills.json";
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

function defaultPortableScope(mode: SyncManifest["profile"]["mode"]): PortableScope {
  return mode === "team" ? "project" : "personal";
}

function portableLibraryReadme(name: string, skillNames: string[]): string {
  const skills = skillNames.length
    ? skillNames.map((skill) => `- \`${skill}\``).join("\n")
    : "- No skills have been added yet.";
  return `# ${name}\n\nA portable AI-agent toolkit powered by [dotagents](https://github.com/beautyfree/dotagents).\n\n## Included skills\n\n${skills}\n\n## Use this library\n\nInstall dotagents and run its guided setup. Choose your Git provider, select this repository, review the plan, and confirm.\n\n\`\`\`sh\nnpm install -g dotagents\ndotagents setup\n\`\`\`\n\nOn another computer, run \`dotagents setup\` again and select the same repository. Local agent choices and credentials stay on each device.\n`;
}

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
  const existingManifestPath = join(workspace, CANONICAL_MANIFEST);
  if (existsSync(existingManifestPath)) {
    const existing = parseLibraryManifest(readFileSync(existingManifestPath, "utf8"));
    if (existing.ok) existingLicense = existing.value.license;
  }
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
  const dependencyMetadata: CanonicalSkillerMetadata = {
    schema_version: 1,
    profile: plan.manifest.profile,
    agent_policy: plan.manifest.agent_policy,
    source_kinds: sourceKinds,
    content_hashes: contentHashes,
    installations,
  };
  const canonicalCandidates: LibraryPublishCandidate[] = plan.manifest.skills.map((skill) => {
    if (skill.kind === "reference") return {
      kind: "git",
      id: skill.id,
      repository: skill.repository,
      ref: skill.ref,
      skillPath: skill.skill_path,
      ...(skill.sha256 ? { contentHash: skill.sha256 } : {}),
      ...(skill.installations?.length ? { installationAgentSlugs: skill.installations } : {}),
    };
    if (skill.kind === "skills_sh") return {
      kind: "skills-cli",
      id: skill.id,
      sourceUrl: skill.source_url,
      ref: skill.ref,
      skillPath: skill.skill_path,
      ...(skill.sha256 ? { contentHash: skill.sha256 } : {}),
      ...(skill.installations?.length ? { installationAgentSlugs: skill.installations } : {}),
    };
    const bundled = plan.bundledSkills.find((entry) => entry.id === skill.id);
    if (!bundled) throw new Error(`Canonical publish plan has no bundled source for ${skill.id}`);
    const base = { id: skill.id, sourcePath: bundled.sourcePath, ...(plan.forkedFrom[skill.id] ? { forkedFrom: plan.forkedFrom[skill.id] } : {}), ...(skill.installations?.length ? { installationAgentSlugs: skill.installations } : {}) };
    if (plan.vendoredOrigins[skill.id]) return { kind: "vendored", ...base, origin: plan.vendoredOrigins[skill.id]! };
    if (plan.snapshotOrigins[skill.id]) return { kind: "snapshot", ...base, origin: plan.snapshotOrigins[skill.id]! };
    return { kind: "owned", ...base };
  });
  // dotagents owns dependency resolution, export planning and portable config.
  // Skiller adds only its opaque UI routing metadata below.
  const canonicalCore = await planCanonicalLibraryPublication({
    root: workspace,
    name: plan.manifest.profile.id,
    candidates: canonicalCandidates,
    ...(license ? { license } : {}),
    sourcePolicy: options.sourcePolicy,
    cacheRoot: options.cacheRoot,
    generatedBy: "dotagents",
  });
  const manifest = libraryManifestSchema.parse({
    schema_version: 1,
    name: plan.manifest.profile.id,
    version: "0.1.0",
    description: "A portable AI-agent skill library powered by dotagents.",
    ...(license ? { license } : {}),
    skills: plan.manifest.skills.filter((skill) => skill.kind === "bundled").map((skill) => skill.path).sort(),
    dependencies,
    metadata: { skiller_sync: dependencyMetadata },
  });
  const resolution = { lock: canonicalCore.lock, sourcePolicy: canonicalCore.sourcePolicy, planId: canonicalCore.planId };
  // A dependency key names the source package, not necessarily the skill it
  // contains. Portable routing and provenance must follow the resolved skill
  // name so a package such as `gamma-source` can correctly install `gamma`,
  // and one package can expose several independently addressable skills.
  const resolvedMetadata: CanonicalSkillerMetadata = {
    schema_version: 1,
    profile: plan.manifest.profile,
    agent_policy: plan.manifest.agent_policy,
    source_kinds: {},
    content_hashes: {},
    installations: {},
  };
  for (const skill of plan.manifest.skills) {
    if (skill.kind === "bundled" && skill.installations?.length) {
      resolvedMetadata.installations[skill.id] = [...new Set(skill.installations)].sort();
    }
  }
  for (const [dependency, resolved] of Object.entries(resolution.lock.resolved)) {
    for (const skill of resolved.skills) {
      resolvedMetadata.source_kinds[skill.name] = sourceKinds[dependency] ?? "reference";
      if (contentHashes[dependency]) resolvedMetadata.content_hashes[skill.name] = contentHashes[dependency]!;
      if (installations[dependency]?.length) resolvedMetadata.installations[skill.name] = installations[dependency]!;
    }
  }
  const resolvedManifest = libraryManifestSchema.parse({
    ...manifest,
    metadata: { skiller_sync: resolvedMetadata },
  });
  const existingReadme = join(workspace, "README.md");
  const existingScope = join(workspace, SCOPE_DESCRIPTOR_FILE);
  const storedScope = existsSync(existingScope) ? readPortableScopeDescriptor(workspace) : null;
  const portableScope = storedScope?.scope
    ?? (isCanonicalSyncLibrary(workspace) ? null : defaultPortableScope(plan.manifest.profile.mode));
  const skillNames = plan.manifest.skills.map((skill) => skill.id).sort((left, right) => left.localeCompare(right, "en"));
  return {
    manifest: resolvedManifest,
    lock: resolution.lock,
    sourcePolicy: resolution.sourcePolicy,
    resolutionPlanId: resolution.planId,
    portableFiles: {
      ...canonicalCore.portableFiles,
      "skills.json": `${JSON.stringify(resolvedManifest, null, 2)}\n`,
      ...(portableScope ? { [SCOPE_DESCRIPTOR_FILE]: `${JSON.stringify({ schema_version: 1, scope: portableScope }, null, 2)}\n` } : {}),
      ...(!existsSync(existingReadme) ? { "README.md": portableLibraryReadme(resolvedManifest.name, skillNames) } : {}),
    },
  };
}

export function readSyncManifestFromWorkspace(workspace: string): SyncManifest {
  if (!isCanonicalSyncLibrary(workspace)) {
    throw new Error("This library uses an unsupported legacy format. Recreate or migrate it with dotagents before connecting.");
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
    ...Object.values(lock.resolved).flatMap((resolved) => resolved.skills.map((skill) => {
      const id = skill.name;
      const kind = metadata.source_kinds[id] ?? "reference";
      const common = {
        id,
        ref: resolved.commit,
        skill_path: skill.path,
        ...(metadata.content_hashes[id] ? { sha256: metadata.content_hashes[id] } : {}),
        ...(metadata.installations[id]?.length ? { installations: metadata.installations[id] } : {}),
      };
      return kind === "skills_sh"
        ? { ...common, kind: "skills_sh" as const, source_url: resolved.url }
        : { ...common, kind: "reference" as const, repository: resolved.url };
    })),
  ];
  return validateSyncManifest(sync);
}
