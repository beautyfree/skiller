import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { parseLibraryLock, parseLibraryManifest } from "@beautyfree/dotagent/library";
import { libraryManifestSchema, type LibraryLock, type LibraryManifest } from "@beautyfree/dotagent/schema";
import { GitDependencyResolver } from "@beautyfree/dotagent";
import { planResolveDependencies } from "@beautyfree/dotagent/sources";
import type { SyncManifest } from "./sync-profile";
import { createSyncManifest, parseSyncManifest, validateSyncManifest } from "./sync-profile";
import type { SyncPublishPlan } from "./sync-publish";
import { planBundledSkillExport } from "./sync-export";

const CANONICAL_MANIFEST = "skills.json";
const LEGACY_MANIFEST = "skiller-sync.yaml";

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

export async function planCanonicalSyncLibrary(workspace: string, plan: SyncPublishPlan): Promise<CanonicalSyncLibraryPlan> {
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
    skills: Object.fromEntries(plan.manifest.skills.map((skill) => [skill.id, {
      ...(skill.installations?.length ? { agents: [...new Set(skill.installations)].sort() } : {}),
      ...(skill.kind !== "bundled" ? { distribution: "dependency" } : {}),
    }])),
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
