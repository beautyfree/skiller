import type { DoctorReport } from "@beautyfree/dotagent/doctor";
import type { MaterializationStatus } from "@beautyfree/dotagent/status";
import type { LibraryAuditReport } from "@beautyfree/dotagent/audit";
import type { ImportCandidate, ImportPlan } from "@beautyfree/dotagent/import";
import type { SkillDiscoveryReport } from "@beautyfree/dotagent/discovery";
import type {
	DotagentAuditJson,
	DotagentDoctorJson,
	DotagentMachineInventoryJson,
	DotagentMaterializationStatusJson,
	DotagentSkillDiscoveryJson,
	DotagentImportPlanJson,
} from "../shared/rpc-schema";

export function dotagentMachineToJson(machine: NonNullable<DoctorReport["machine"]>): DotagentMachineInventoryJson {
	return {
		platform: machine.platform,
		detected_slugs: machine.detectedSlugs,
		agents: machine.agents.map((agent) => ({
			slug: agent.slug,
			display_name: agent.displayName,
			detected: agent.detected,
			reason: agent.reason,
		})),
	};
}

/** Removes absolute paths and safe causes before data crosses Electron IPC. */
export function dotagentDoctorToJson(report: DoctorReport): DotagentDoctorJson {
	return {
		ok: report.ok,
		library: report.library ? {
			name: report.library.name,
			version: report.library.version,
			owned_skill_count: report.library.ownedSkills.length,
			dependency_count: report.library.dependencyCount,
			locked: report.library.locked,
		} : null,
		machine: report.machine ? dotagentMachineToJson(report.machine) : null,
		issues: report.issues.map((issue) => ({
			code: issue.code,
			severity: issue.severity ?? "error",
			message: issue.message,
			remediation: issue.remediation,
			...(issue.field ? { field: issue.field } : {}),
		})),
	};
}

export function dotagentStatusToJson(status: MaterializationStatus): DotagentMaterializationStatusJson {
	return {
		targets: status.targets.map((target) => ({
			agent_slug: target.agent,
			skill_id: target.skill,
			mode: target.mode,
			health: target.health,
		})),
	};
}

export function dotagentDiscoveryToJson(report: SkillDiscoveryReport, suggestions: ImportCandidate[]): DotagentSkillDiscoveryJson {
	const bySkill = new Map(suggestions.map((candidate) => [candidate.skill, candidate]));
	return {
		skills: report.skills.map((skill) => {
			const suggestion = bySkill.get(skill.name) ?? { kind: "local-only" as const, skill: skill.name, reason: "No safe default is available" };
			return {
				candidate_key: skill.candidateKey,
				name: skill.name,
				description: skill.description,
				when_to_use: skill.whenToUse,
				integrity: skill.integrity,
				file_count: skill.fileCount,
				total_bytes: skill.bytes,
				metadata_valid: skill.metadataValid,
				locations: skill.locations.map((location) => ({ kind: location.kind, ...(location.agent ? { agent_slug: location.agent } : {}) })),
				suggested: suggestion.kind === "dependency"
					? { kind: suggestion.kind, ...(suggestion.source ? { source: suggestion.source } : {}), package: suggestion.package }
					: suggestion.kind === "local-only" || suggestion.kind === "excluded"
						? { kind: suggestion.kind, reason: suggestion.reason }
						: { kind: suggestion.kind },
			};
		}),
		collisions: report.collisions.map((collision) => ({ name: collision.name, candidate_keys: collision.candidateKeys })),
		issues: report.issues.map((issue) => ({ code: issue.code, severity: issue.severity ?? "error", message: issue.message, remediation: issue.remediation })),
		linked_aliases: report.linkedAliases,
	};
}

export function dotagentAuditToJson(report: LibraryAuditReport): DotagentAuditJson {
	return {
		ok: report.ok,
		public_ready: report.publicReady,
		library: report.library ? {
			name: report.library.name,
			version: report.library.version,
			owned_skill_count: report.library.ownedSkills.length,
			dependency_count: report.library.dependencyCount,
		} : null,
		issues: report.issues.map((issue) => ({
			code: issue.code,
			severity: issue.severity ?? "error",
			message: issue.message,
			remediation: issue.remediation,
			...(issue.field ? { field: issue.field } : {}),
		})),
	};
}

export function dotagentImportPlanToJson(plan: ImportPlan): DotagentImportPlanJson {
	return {
		plan_id: plan.planId,
		has_conflicts: plan.hasConflicts,
		requires_resolve: plan.requiresResolve,
		owned_skill_count: plan.nextManifest.skills.length,
		dependency_count: Object.keys(plan.nextManifest.dependencies).length,
		operations: plan.operations.map((operation) => ({
			skill_id: operation.skill,
			action: operation.action,
			source_kind: operation.sourceKind,
			...(operation.package ? { package: operation.package } : {}),
			...(operation.reason ? { reason: operation.reason } : {}),
		})),
		secret_findings: plan.secretFindings.map((finding) => ({
			rule: finding.rule,
			skill_id: finding.skill,
			relative_path: finding.relativePath,
			line: finding.line,
			column: finding.column,
		})),
	};
}
