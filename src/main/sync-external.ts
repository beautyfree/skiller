import type { ProvenanceEntry } from "./provenance";
import type { SyncManifest } from "./sync-profile";

export type ManagedExternalSkill = Extract<SyncManifest["skills"][number], { kind: "reference" | "skills_sh" }>;
export type ExternalRestoreAction = "create" | "unchanged" | "conflict";
export type ExternalKeptSource = { repository: string; ref: string };

export function externalSkillRepository(skill: ManagedExternalSkill): string {
	return skill.kind === "skills_sh" ? skill.source_url : skill.repository;
}

/**
 * A person can keep a conflicting local copy for this machine only. The
 * decision expires automatically when the library points at another origin or
 * immutable revision, which forces a fresh review instead of hiding updates.
 */
export function externalKeptSourceMatches(
	skill: ManagedExternalSkill,
	decision: ExternalKeptSource | undefined,
): boolean {
	return decision?.repository.trim() === externalSkillRepository(skill)
		&& decision.ref.trim().toLowerCase() === skill.ref.toLowerCase();
}

/** Git root is represented as `.`; lock files sometimes point directly at SKILL.md. */
export function externalSkillDirectory(path: string | null | undefined): string {
	const normalized = path?.trim();
	if (!normalized || normalized === "SKILL.md") return ".";
	return normalized.replace(/\/SKILL\.md$/i, "") || ".";
}

/**
 * Classifies external restore without touching the filesystem. A caller supplies
 * whether an identically named local skill exists and its recorded provenance.
 * An unrecognised local folder is always a conflict, never an overwrite.
 */
export function classifyExternalRestore(
	skill: ManagedExternalSkill,
	localExists: boolean,
	provenance: ProvenanceEntry | null | undefined,
	localContentHash?: string | null,
): ExternalRestoreAction {
	if (!localExists) return "create";
	const sameOrigin = provenance?.repository?.trim() === externalSkillRepository(skill)
		&& provenance.ref?.trim()?.toLowerCase() === skill.ref.toLowerCase()
		&& externalSkillDirectory(provenance.skill_path) === skill.skill_path;
	if (!sameOrigin) return "conflict";
	// Older manifests may not have a content hash. They stay conservative about
	// origin, while v3-created references additionally detect manual edits.
	if (skill.sha256 && localContentHash !== skill.sha256) return "conflict";
	return "unchanged";
}
