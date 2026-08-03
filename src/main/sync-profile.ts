import { parse, stringify } from "yaml";
import { z } from "zod";

export const SYNC_MANIFEST_FILE = "skiller-sync.yaml";
export const SYNC_MANIFEST_VERSION = 3;

const stableId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const portablePath = z.string().min(1).max(512);
const skillSourcePath = z.union([z.literal("."), portablePath]);

const bundledSkillSchema = z.object({
	id: stableId,
	kind: z.literal("bundled"),
	path: portablePath,
	sha256: z.string().regex(/^[a-f0-9]{64}$/),
	// This is intentionally a list of agent identities, not filesystem paths.
	// Agent paths are machine-local implementation details and must never leak
	// into a portable profile or be replayed on another computer.
	installations: z.array(stableId).min(1).optional(),
});

const legacyBundledSkillSchema = bundledSkillSchema.omit({ installations: true });

const referenceSkillSchema = z.object({
	id: stableId,
	kind: z.literal("reference"),
	repository: z.string().min(1).max(2_048),
	ref: z.string().regex(/^[a-f0-9]{40}$/),
	skill_path: skillSourcePath,
	/** Optional for compatibility with older/manual references. */
	sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
	installations: z.array(stableId).min(1).optional(),
});

/**
 * A skill installed through the Vercel Skills CLI. It remains a dependency:
 * the manifest records immutable provenance instead of copying the package into
 * a personal library and silently disconnecting it from its upstream.
 */
const skillsShSkillSchema = z.object({
	id: stableId,
	kind: z.literal("skills_sh"),
	source_url: z.string().min(1).max(2_048),
	ref: z.string().regex(/^[a-f0-9]{40}$/),
	skill_path: skillSourcePath,
	sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
	installations: z.array(stableId).min(1).optional(),
});

const legacyReferenceSkillSchema = referenceSkillSchema.omit({ installations: true });

const manifestBaseSchema = z.object({
	profile: z.object({
		id: stableId,
		mode: z.enum(["private", "team", "public"]),
	}),
	agent_policy: z.discriminatedUnion("mode", [
		z.object({ mode: z.literal("detected") }),
		z.object({ mode: z.literal("selected"), agent_slugs: z.array(stableId).min(1) }),
	]),
});

const syncManifestSchema = manifestBaseSchema.extend({
	schema_version: z.literal(SYNC_MANIFEST_VERSION),
	skills: z.array(z.discriminatedUnion("kind", [bundledSkillSchema, referenceSkillSchema, skillsShSkillSchema])),
});

const v2SyncManifestSchema = manifestBaseSchema.extend({
	schema_version: z.literal(2),
	skills: z.array(z.discriminatedUnion("kind", [bundledSkillSchema, legacyReferenceSkillSchema])),
});

const legacySyncManifestSchema = manifestBaseSchema.extend({
	schema_version: z.literal(1),
	skills: z.array(z.discriminatedUnion("kind", [legacyBundledSkillSchema, legacyReferenceSkillSchema])),
});

export type SyncManifest = z.infer<typeof syncManifestSchema>;
export type SyncSkill = SyncManifest["skills"][number];

export function assertSyncStableId(id: string): void {
	if (!stableId.safeParse(id).success) {
		throw new Error(`Invalid sync stable id: ${id}`);
	}
}

export function createSyncManifest(
	profileId: string,
	mode: SyncManifest["profile"]["mode"] = "private",
	agentPolicy: SyncManifest["agent_policy"] = { mode: "detected" },
): SyncManifest {
	assertSyncStableId(profileId);
	const manifest = {
		schema_version: SYNC_MANIFEST_VERSION,
		profile: { id: profileId, mode },
		agent_policy: agentPolicy,
		skills: [],
	};
	return validateSyncManifest(manifest);
}

export function parseSyncManifest(text: string): SyncManifest {
	let parsed: unknown;
	try {
		parsed = parse(text);
	} catch (error) {
		throw new Error(`Invalid ${SYNC_MANIFEST_FILE}: ${error instanceof Error ? error.message : "YAML parse failed"}`);
	}
	return validateSyncManifest(parsed);
}

export function stringifySyncManifest(manifest: SyncManifest): string {
	return stringify(validateSyncManifest(manifest));
}

export function validateSyncManifest(input: unknown): SyncManifest {
	const raw = input as { schema_version?: unknown } | null;
	// v1 had the same safe payload format but no per-skill routing.  Reading it
	// is non-mutating; it is only written as v2 after the person explicitly
	// publishes a reviewed change.
	const v1 = raw?.schema_version === 1 ? legacySyncManifestSchema.parse(input) : null;
	const v2 = raw?.schema_version === 2 ? v2SyncManifestSchema.parse(input) : null;
	const manifest: SyncManifest = v1
		? { ...v1, schema_version: SYNC_MANIFEST_VERSION }
		: v2
			? { ...v2, schema_version: SYNC_MANIFEST_VERSION }
			: syncManifestSchema.parse(input);
	const seenIds = new Set<string>();
	for (const skill of manifest.skills) {
		if (seenIds.has(skill.id)) throw new Error(`Duplicate sync skill id: ${skill.id}`);
		seenIds.add(skill.id);
		if (skill.kind === "bundled") assertPortableRelativePath(skill.path);
		else assertPortableSkillSourcePath(skill.skill_path);
		if (skill.kind === "bundled") {
			const expectedPath = `skills/${skill.id}`;
			if (skill.path !== expectedPath) {
				throw new Error(`Bundled skill ${skill.id} must use path ${expectedPath}`);
			}
		} else if (skill.kind === "reference") {
			assertCredentialFreeGitRemote(skill.repository);
		} else {
			assertCredentialFreeGitRemote(skill.source_url);
		}
	}
	return manifest;
}

/** Manifest paths are POSIX-relative so a profile stays portable between OSes. */
export function assertPortableRelativePath(path: string): void {
	if (path.trim() !== path || path.length === 0 || path.length > 512) {
		throw new Error("Sync path must be a non-empty, trimmed relative path");
	}
	if (path.includes("\\") || path.startsWith("/") || /^[a-z]:/i.test(path)) {
		throw new Error(`Sync path must use a portable relative POSIX path: ${path}`);
	}
	const segments = path.split("/");
	if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
		throw new Error(`Sync path must not contain traversal segments: ${path}`);
	}
}

/** A Git repository root is a valid external skill source; bundles never use it. */
export function assertPortableSkillSourcePath(path: string): void {
	if (path === ".") return;
	assertPortableRelativePath(path);
}

/** Credentials belong to the OS Git credential helper or SSH agent, never a manifest URL. */
export function assertCredentialFreeGitRemote(remote: string): void {
	if (/^[a-z][a-z0-9+.-]*:\/\/[^/\s@]+:[^/\s@]+@/i.test(remote)) {
		throw new Error("Sync repository URL must not embed credentials");
	}
}
