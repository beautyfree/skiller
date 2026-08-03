import {
	applyLibraryReconciliationPlan,
	classifyThreeWaySkill,
	planLibraryReconciliation,
	type LibraryReconciliationPlan,
	type ThreeWayAction,
} from "@beautyfree/dotagent/reconcile";
import type { SyncLedger } from "./sync-ledger";
import { readSyncManifestFromWorkspace } from "./sync-dotagent";
import {
	applyLegacySyncRestorePlan,
	createLegacySyncRestorePlan,
	type SyncRestorePlan as LegacySyncRestorePlan,
} from "./sync-restore-legacy";
import { syncJournalPath } from "./sync-journal";
import type { SyncManifest } from "./sync-profile";
import type { SyncExportFinding } from "./sync-export";

export type SyncRestoreAction = "create" | "unchanged" | "conflict";

export type SyncRestoreEntry = {
	id: string;
	sourcePath: string;
	targetPath: string;
	action: SyncRestoreAction;
	threeWayAction: ThreeWayAction;
	remoteSha256: string;
	localSha256: string | null;
	reason?: string;
};

export type SyncRestoreFinding = SyncExportFinding & { skillId: string };

type DotagentSyncRestorePlan = {
	engine: "dotagent";
	manifest: SyncManifest;
	entries: SyncRestoreEntry[];
	secretFindings: SyncRestoreFinding[];
	corePlan: LibraryReconciliationPlan;
};

type LegacyCompatibilityPlan = {
	engine: "legacy";
	manifest: SyncManifest;
	entries: SyncRestoreEntry[];
	secretFindings: SyncRestoreFinding[];
	legacyPlan: LegacySyncRestorePlan;
};

export type SyncRestorePlan = DotagentSyncRestorePlan | LegacyCompatibilityPlan;

function compatibilityAction(entry: LibraryReconciliationPlan["operations"][number]): SyncRestoreAction {
	if (entry.expectedTarget.kind === "absent") return "create";
	if (entry.localIntegrity === entry.remoteIntegrity) return "unchanged";
	return "conflict";
}

function ledgerBase(ledger?: SyncLedger): Record<string, { baseIntegrity: string | null; keptRemoteIntegrity?: string }> | undefined {
	if (!ledger) return undefined;
	return Object.fromEntries(
		Object.entries(ledger.skills).map(([id, entry]) => [
			id,
			{
				baseIntegrity: entry.sha256,
				...(entry.kept_remote_sha256 ? { keptRemoteIntegrity: entry.kept_remote_sha256 } : {}),
			},
		]),
	);
}

function legacyCompatibilityPlan(
	workspacePath: string,
	canonicalSkillsPath: string,
	ledger?: SyncLedger,
): LegacyCompatibilityPlan {
	const legacyPlan = createLegacySyncRestorePlan(workspacePath, canonicalSkillsPath);
	return {
		engine: "legacy",
		legacyPlan,
		manifest: legacyPlan.manifest,
		entries: legacyPlan.entries.map((entry) => ({
			...entry,
			threeWayAction: classifyThreeWaySkill(
				entry.id,
				ledger?.skills[entry.id]?.sha256 ?? null,
				entry.localSha256,
				entry.remoteSha256,
				ledger?.skills[entry.id]?.kept_remote_sha256,
			).action,
		})),
		secretFindings: legacyPlan.secretFindings,
	};
}

/**
 * Compatibility adapter from legacy/canonical Skiller manifests to the shared
 * dotagent reconciliation module. Set SKILLER_SYNC_RECONCILE_ENGINE=legacy to
 * compare or temporarily fall back while migration fixtures remain active.
 */
export function createSyncRestorePlan(
	workspacePath: string,
	canonicalSkillsPath: string,
	ledger?: SyncLedger,
): SyncRestorePlan {
	if (process.env.SKILLER_SYNC_RECONCILE_ENGINE === "legacy") {
		return legacyCompatibilityPlan(workspacePath, canonicalSkillsPath, ledger);
	}
	const manifest = readSyncManifestFromWorkspace(workspacePath);
	const base = ledgerBase(ledger);
	const corePlan = planLibraryReconciliation({
		sourceRoot: workspacePath,
		targetRoot: canonicalSkillsPath,
		skills: manifest.skills
			.filter((skill): skill is Extract<typeof skill, { kind: "bundled" }> => skill.kind === "bundled")
			.map((skill) => ({ id: skill.id, path: skill.path, integrity: skill.sha256 })),
		...(base ? { base } : {}),
	});
	return {
		engine: "dotagent",
		manifest,
		corePlan,
		entries: corePlan.operations.map((entry) => ({
			id: entry.skill,
			sourcePath: entry.source,
			targetPath: entry.target,
			action: compatibilityAction(entry),
			threeWayAction: entry.action,
			remoteSha256: entry.remoteIntegrity,
			localSha256: entry.localIntegrity,
			...(entry.reason ? { reason: entry.reason } : {}),
		})),
		secretFindings: corePlan.secretFindings.map((finding) => ({
			rule: finding.rule,
			skillId: finding.skill,
			relativePath: finding.relativePath,
			line: finding.line,
			column: finding.column,
		})),
	};
}

/** Apply only user-selected remote versions through the active engine. */
export function applySyncRestorePlan(plan: SyncRestorePlan, selectedIds: string[], profileId?: string): void {
	if (plan.engine === "legacy") {
		applyLegacySyncRestorePlan(plan.legacyPlan, selectedIds, profileId);
		return;
	}
	applyLibraryReconciliationPlan(
		plan.corePlan,
		selectedIds
			.filter((skill) => plan.corePlan.operations.some((operation) => operation.skill === skill && operation.action !== "unchanged"))
			.map((skill) => ({ skill, action: "take-remote" })),
		profileId ? { journalPath: syncJournalPath(profileId) } : {},
	);
}
