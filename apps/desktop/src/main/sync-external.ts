import type { LocalSkillSourceRecord } from "dotagents/source-registry";
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
	provenance: LocalSkillSourceRecord | null | undefined,
	localContentHash?: string | null,
): ExternalRestoreAction {
	if (!localExists) return "create";
	const sameLocation = provenance?.repository?.trim() === externalSkillRepository(skill)
		&& externalSkillDirectory(provenance.skill_path) === skill.skill_path;
	if (!sameLocation) return "conflict";
	// A source commit can move because documentation or another selected skill
	// changed while this skill's reviewed content stayed byte-for-byte identical.
	// The content hash is stronger evidence than the old provenance ref, so this
	// is a metadata-only update and must not force a fake skill conflict.
	if (skill.sha256) return localContentHash === skill.sha256 ? "unchanged" : "conflict";
	// Older manifests without a content hash remain conservative about the exact
	// immutable revision because there is no equivalent content proof.
	if (provenance.ref?.trim()?.toLowerCase() !== skill.ref.toLowerCase()) return "conflict";
	return "unchanged";
}
