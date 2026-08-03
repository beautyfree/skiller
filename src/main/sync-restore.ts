import {
	applyLibraryReconciliationPlan,
	planLibraryReconciliation,
	type LibraryReconciliationPlan,
	type ThreeWayAction,
} from "@beautyfree/dotagent/reconcile";
import { computePlanId } from "@beautyfree/dotagent";
import type { SyncLedger } from "./sync-ledger";
import { readSyncManifestFromWorkspace } from "./sync-dotagent";
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

export type SyncRestorePlan = {
	engine: "dotagent";
	manifest: SyncManifest;
	entries: SyncRestoreEntry[];
	secretFindings: SyncRestoreFinding[];
	corePlan: LibraryReconciliationPlan;
};

/** Stable, path-redacted review token for the shared reconciliation engine. */
export function syncRestorePlanId(plan: SyncRestorePlan): string {
	return computePlanId({
		kind: "skiller-reconciliation",
		schemaVersion: 1,
		manifest: plan.manifest,
		entries: plan.entries.map((entry) => ({
			id: entry.id,
			action: entry.action,
			threeWayAction: entry.threeWayAction,
			remoteSha256: entry.remoteSha256,
			localSha256: entry.localSha256,
		})),
		secretFindings: plan.secretFindings,
	});
}

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

/**
 * Compatibility adapter from legacy/canonical Skiller manifests to the shared
 * dotagent reconciliation module.
 */
export function createSyncRestorePlan(
	workspacePath: string,
	canonicalSkillsPath: string,
	ledger?: SyncLedger,
): SyncRestorePlan {
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
	applyLibraryReconciliationPlan(
		plan.corePlan,
		selectedIds
			.filter((skill) => plan.corePlan.operations.some((operation) => operation.skill === skill && operation.action !== "unchanged"))
			.map((skill) => ({ skill, action: "take-remote" })),
		profileId ? { journalPath: syncJournalPath(profileId) } : {},
	);
}
