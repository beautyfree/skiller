import { describe, expect, test } from "bun:test";
import { isTrpcQueryProcedure } from "./trpc-query-procedures";

describe("tRPC query procedure registry", () => {
	test("keeps Sync Center read operations on GET", () => {
		for (const name of [
			"scan_sync_inventory",
			"get_sync_skill_preview",
			"sync_center_publish_preview",
			"list_sync_profiles",
		]) {
			expect(isTrpcQueryProcedure(name)).toBe(true);
		}
	});

	test("does not classify state-changing Sync operations as queries", () => {
		for (const name of [
			"sync_center_publish",
			"sync_three_way_review",
			"sync_apply_remote_changes",
			"sync_publish_local_changes",
			"sync_keep_local_changes",
			"sync_keep_external_local_changes",
		]) {
			expect(isTrpcQueryProcedure(name)).toBe(false);
		}
	});
});
