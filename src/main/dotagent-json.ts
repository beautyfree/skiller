import type { DoctorReport } from "@beautyfree/dotagent/doctor";
import type { MaterializationStatus } from "@beautyfree/dotagent/status";
import type {
	DotagentDoctorJson,
	DotagentMachineInventoryJson,
	DotagentMaterializationStatusJson,
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
