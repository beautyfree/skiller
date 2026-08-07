import { describe, expect, test } from "bun:test";
import { isTrpcQueryProcedure } from "./trpc-query-procedures";

describe("tRPC query procedure registry", () => {
	test("keeps Sync Center read operations on GET", () => {
		for (const name of [
			"dotagents_machine_inventory",
			"dotagents_doctor",
			"dotagents_materialization_status",
			"dotagents_skill_discovery",
			"dotagents_audit",
			"dotagents_import_plan",
			"scan_sync_inventory",
			"get_sync_skill_preview",
			"skill_quality_overview",
			"skill_quality_eval_preview",
			"sync_center_connect_preview",
			"sync_github_create_repo_preview",
			"sync_gitlab_create_project_preview",
			"sync_provider_libraries",
			"list_sync_profiles",
			"sync_history",
			"sync_undo_preview",
			"dotagents_resource_overview",
			"dotagents_library_health",
			"dotagents_library_repair_preview",
			"dotagents_scope_overview",
			"dotagents_scope_migration_preview",
			"dotagents_scope_composition_preview",
			"dotagents_resource_adopt_preview",
		]) {
			expect(isTrpcQueryProcedure(name)).toBe(true);
		}
	});

	test("does not classify state-changing Sync operations as queries", () => {
		for (const name of [
			"sync_center_publish_preview",
			"sync_center_publish",
			"sync_center_connect",
			"sync_github_create_repo",
			"sync_gitlab_create_project",
			"sync_three_way_review",
			"sync_apply_remote_changes",
			"sync_publish_local_changes",
			"sync_adopt_local_changes",
			"sync_keep_local_changes",
			"sync_keep_external_local_changes",
			"sync_undo_apply",
			"dotagents_resource_pick_source",
			"dotagents_library_repair_apply",
			"dotagents_scope_migration_apply",
			"dotagents_scope_composition_apply",
			"dotagents_resource_adopt_apply",
			"skill_quality_dry_start",
			"skill_quality_measured_start",
		]) {
			expect(isTrpcQueryProcedure(name)).toBe(false);
		}
	});
});
