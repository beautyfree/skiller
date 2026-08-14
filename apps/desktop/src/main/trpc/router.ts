import { initTRPC } from '@trpc/server'
import { z } from 'zod'
import type { AppPlatform } from '../../shared/platform'
import { redactTrpcErrorData } from './error-data'
import {
  createRequestHandlers,
  type BunSideRpc,
} from '../rpc-handlers'

const t = initTRPC.create({
  // The HTTP transport is loopback-only, but it is still a renderer boundary.
  // Never serialize a main-process stack, absolute path, or validator detail
  // across it. User-facing handlers return deliberate safe messages instead.
  errorFormatter({ shape }) {
    return {
      ...shape,
      data: redactTrpcErrorData(shape.data),
    }
  },
})
const anyIn = z.any()

export function createAppRouter(ctx: {
  platform: AppPlatform
  rpc: BunSideRpc
  ensureSkillWatcherStarted?: (reason: string) => void
}) {
  const h = createRequestHandlers(ctx)
  const proc = t.procedure

  return t.router({
    list_agents: proc.query(() => h.list_agents()),
    detect_agents: proc.query(() => h.detect_agents()),
    detect_runtime_agent: proc.query(() => h.detect_runtime_agent()),
    dotagents_machine_inventory: proc.query(() => h.dotagents_machine_inventory()),
    dotagents_doctor: proc.input(anyIn).query(({ input }) => h.dotagents_doctor(input)),
    dotagents_materialization_status: proc.input(anyIn).query(({ input }) => h.dotagents_materialization_status(input)),
    dotagents_skill_discovery: proc.query(() => h.dotagents_skill_discovery()),
    dotagents_audit: proc.input(anyIn).query(({ input }) => h.dotagents_audit(input)),
    dotagents_import_plan: proc.input(anyIn).query(({ input }) => h.dotagents_import_plan(input)),
    read_skills_cli_lock: proc.query(() => h.read_skills_cli_lock()),
    scan_all_skills: proc.query(() => h.scan_all_skills()),
    check_global_skill_updates: proc.query(() => h.check_global_skill_updates()),
    review_linked_skill_package_update: proc.input(anyIn).mutation(({ input }) => h.review_linked_skill_package_update(input)),
    apply_linked_skill_package_update: proc.input(anyIn).mutation(({ input }) => h.apply_linked_skill_package_update(input)),
    apply_reviewed_global_skill_updates: proc.input(anyIn).mutation(({ input }) => h.apply_reviewed_global_skill_updates(input)),
    review_global_skill_update: proc.input(anyIn).mutation(({ input }) => h.review_global_skill_update(input)),
    scan_agent_skills: proc.input(anyIn).query(({ input }) => h.scan_agent_skills(input)),
		mark_skill_reviewed: proc.input(anyIn).mutation(({ input }) => h.mark_skill_reviewed(input)),
		claim_skill_ownership: proc.input(anyIn).mutation(({ input }) => h.claim_skill_ownership(input)),
		list_skill_improvement_notes: proc.input(anyIn).query(({ input }) => h.list_skill_improvement_notes(input)),
		add_skill_improvement_note: proc.input(anyIn).mutation(({ input }) => h.add_skill_improvement_note(input)),
		fork_skill_to_library: proc.input(anyIn).mutation(({ input }) => h.fork_skill_to_library(input)),
    skill_quality_overview: proc.query(() => h.skill_quality_overview()),
    skill_quality_reveal_file: proc.input(anyIn).mutation(({ input }) => h.skill_quality_reveal_file(input)),
    skill_quality_reveal_folder: proc.input(anyIn).mutation(({ input }) => h.skill_quality_reveal_folder(input)),
    skill_quality_eval_preview: proc.input(anyIn).query(({ input }) => h.skill_quality_eval_preview(input)),
    skill_quality_dry_start: proc.input(anyIn).mutation(({ input }) => h.skill_quality_dry_start(input)),
    skill_quality_measured_start: proc.input(anyIn).mutation(({ input }) => h.skill_quality_measured_start(input)),
    list_sync_profiles: proc.query(() => h.list_sync_profiles()),
	refresh_sync_profiles: proc.input(anyIn.optional()).mutation(({ input }) => h.refresh_sync_profiles(input)),
	sync_select_profile: proc.input(anyIn).mutation(({ input }) => h.sync_select_profile(input)),
	sync_disconnect_preview: proc.input(anyIn).query(({ input }) => h.sync_disconnect_preview(input)),
	sync_disconnect_apply: proc.input(anyIn).mutation(({ input }) => h.sync_disconnect_apply(input)),
	sync_remote_trust_preview: proc.input(anyIn).query(({ input }) => h.sync_remote_trust_preview(input)),
	sync_remote_trust_apply: proc.input(anyIn).mutation(({ input }) => h.sync_remote_trust_apply(input)),
    scan_sync_inventory: proc.query(() => h.scan_sync_inventory()),
		get_sync_skill_preview: proc.input(anyIn).query(({ input }) => h.get_sync_skill_preview(input)),
    // This preview can carry hundreds of decisions and contacts reviewed Git
    // sources. Keep it on POST to avoid URL limits and query/cache semantics.
    sync_center_publish_preview: proc.input(anyIn.optional()).mutation(({ input }) => h.sync_center_publish_preview(input)),
    sync_center_publish_preview_cancel: proc.input(anyIn).mutation(({ input }) => h.sync_center_publish_preview_cancel(input)),
    sync_local_publish_preview: proc.input(anyIn).mutation(({ input }) => h.sync_local_publish_preview(input)),
    sync_local_publish_apply: proc.input(anyIn).mutation(({ input }) => h.sync_local_publish_apply(input)),
    sync_push_pending: proc.input(anyIn).mutation(({ input }) => h.sync_push_pending(input)),
    sync_center_publish: proc.input(anyIn).mutation(({ input }) => h.sync_center_publish(input)),
    sync_provider_sign_in_start: proc.input(anyIn).mutation(({ input }) => h.sync_provider_sign_in_start(input)),
    sync_provider_sign_in_finish: proc.input(anyIn).mutation(({ input }) => h.sync_provider_sign_in_finish(input)),
    sync_provider_check: proc.input(anyIn).mutation(({ input }) => h.sync_provider_check(input)),
    sync_three_way_review: proc.input(anyIn).mutation(({ input }) => h.sync_three_way_review(input)),
	sync_external_conflict_preview: proc.input(anyIn).mutation(({ input }) => h.sync_external_conflict_preview(input)),
	sync_library_check_cancel: proc.input(anyIn).mutation(({ input }) => h.sync_library_check_cancel(input)),
    sync_history: proc.input(anyIn).query(({ input }) => h.sync_history(input)),
    sync_undo_preview: proc.input(anyIn).query(({ input }) => h.sync_undo_preview(input)),
    sync_undo_apply: proc.input(anyIn).mutation(({ input }) => h.sync_undo_apply(input)),
    dotagents_resource_overview: proc.input(anyIn).query(({ input }) => h.dotagents_resource_overview(input)),
    dotagents_library_mark_seen: proc.input(anyIn).mutation(({ input }) => h.dotagents_library_mark_seen(input)),
    dotagents_library_local_changes: proc.input(anyIn).query(({ input }) => h.dotagents_library_local_changes(input)),
		dotagents_library_local_change_preview: proc.input(anyIn).mutation(({ input }) => h.dotagents_library_local_change_preview(input)),
    // Preview caches an opaque, expiring reviewed plan in the main process, so
    // it is intentionally POST even though it does not write files or Git.
    dotagents_library_new_local_preview: proc.input(anyIn).mutation(({ input }) => h.dotagents_library_new_local_preview(input)),
    dotagents_library_new_local_apply: proc.input(anyIn).mutation(({ input }) => h.dotagents_library_new_local_apply(input)),
    dotagents_library_removal_preview: proc.input(anyIn).mutation(({ input }) => h.dotagents_library_removal_preview(input)),
    dotagents_library_removal_apply: proc.input(anyIn).mutation(({ input }) => h.dotagents_library_removal_apply(input)),
    // Renderer RPC uses POST for parameterized calls. Keep this a mutation even
    // though it is read-only, otherwise tRPC rejects the request before the
    // handler can safely read the selected library file.
		dotagents_resource_content: proc.input(anyIn).mutation(({ input }) => h.dotagents_resource_content(input)),
    dotagents_library_health: proc.input(anyIn).query(({ input }) => h.dotagents_library_health(input)),
    dotagents_library_repair_preview: proc.input(anyIn).query(({ input }) => h.dotagents_library_repair_preview(input)),
    dotagents_library_repair_apply: proc.input(anyIn).mutation(({ input }) => h.dotagents_library_repair_apply(input)),
    sync_apply_remote_changes: proc.input(anyIn).mutation(({ input }) => h.sync_apply_remote_changes(input)),
    sync_accept_remote_library_update: proc.input(anyIn).mutation(({ input }) => h.sync_accept_remote_library_update(input)),
    sync_apply_conflicting_remote_changes: proc.input(anyIn).mutation(({ input }) => h.sync_apply_conflicting_remote_changes(input)),
	 sync_publish_local_changes: proc.input(anyIn).mutation(({ input }) => h.sync_publish_local_changes(input)),
	 sync_adopt_local_changes: proc.input(anyIn).mutation(({ input }) => h.sync_adopt_local_changes(input)),
	 sync_keep_local_changes: proc.input(anyIn).mutation(({ input }) => h.sync_keep_local_changes(input)),
	 sync_keep_external_local_changes: proc.input(anyIn).mutation(({ input }) => h.sync_keep_external_local_changes(input)),
    sync_recovery_status: proc.input(anyIn).query(({ input }) => h.sync_recovery_status(input)),
    sync_recovery_rollback: proc.input(anyIn).mutation(({ input }) => h.sync_recovery_rollback(input)),
	sync_center_connect: proc.input(anyIn).mutation(({ input }) => h.sync_center_connect(input)),
    sync_center_connect_preview: proc.input(anyIn).query(({ input }) => h.sync_center_connect_preview(input)),
    sync_git_destination_preview: proc.input(anyIn).query(({ input }) => h.sync_git_destination_preview(input)),
    sync_github_create_repo_preview: proc.input(anyIn).query(({ input }) => h.sync_github_create_repo_preview(input)),
    sync_github_create_repo: proc.input(anyIn).mutation(({ input }) => h.sync_github_create_repo(input)),
		sync_gitlab_create_project_preview: proc.input(anyIn).query(({ input }) => h.sync_gitlab_create_project_preview(input)),
		sync_gitlab_create_project: proc.input(anyIn).mutation(({ input }) => h.sync_gitlab_create_project(input)),
    sync_provider_libraries: proc.input(anyIn).query(({ input }) => h.sync_provider_libraries(input)),
    sync_provider_libraries_cancel: proc.input(anyIn).mutation(({ input }) => h.sync_provider_libraries_cancel(input)),
    install_skill: proc.input(anyIn).mutation(({ input }) => h.install_skill(input)),
    uninstall_skill: proc.input(anyIn).mutation(({ input }) => h.uninstall_skill(input)),
    uninstall_skill_all: proc.input(anyIn).mutation(({ input }) => h.uninstall_skill_all(input)),
    uninstall_skills_all: proc.input(anyIn).mutation(({ input }) =>
      h.uninstall_skills_all(input),
    ),
    detach_shared_skill: proc.input(anyIn).mutation(({ input }) =>
      h.detach_shared_skill(input),
    ),
    uninstall_all_skills_from_agent: proc.input(anyIn).mutation(({ input }) =>
      h.uninstall_all_skills_from_agent(input),
    ),
    sync_all_skills_to_agent: proc.input(anyIn).mutation(({ input }) =>
      h.sync_all_skills_to_agent(input),
    ),
    unlink_inherited_skill: proc.input(anyIn).mutation(({ input }) =>
      h.unlink_inherited_skill(input),
    ),
    sync_skill: proc.input(anyIn).mutation(({ input }) => h.sync_skill(input)),
    update_skill: proc.input(anyIn).mutation(({ input }) => h.update_skill(input)),
    update_all_skills: proc.mutation(() => h.update_all_skills()),
    list_skill_files: proc.input(anyIn).query(({ input }) => h.list_skill_files(input)),
    read_skill_content: proc.input(anyIn).query(({ input }) => h.read_skill_content(input)),
    write_skill_content: proc.input(anyIn).mutation(({ input }) => h.write_skill_content(input)),
    install_from_git: proc.input(anyIn).mutation(({ input }) => h.install_from_git(input)),
    fetch_remote_skill_content: proc.input(anyIn).query(({ input }) =>
      h.fetch_remote_skill_content(input),
    ),
    list_remote_skill_files: proc.input(anyIn).query(({ input }) =>
      h.list_remote_skill_files(input),
    ),
    fetch_skillssh: proc.input(anyIn).query(({ input }) => h.fetch_skillssh(input)),
    fetch_clawhub: proc.input(anyIn).query(({ input }) => h.fetch_clawhub(input)),
    search_marketplace: proc.input(anyIn).query(({ input }) => h.search_marketplace(input)),
    install_from_marketplace: proc.input(anyIn).mutation(({ input }) =>
      h.install_from_marketplace(input),
    ),
    shell_runtime: proc.query(() => h.shell_runtime()),
    read_settings: proc.query(() => h.read_settings()),
    write_settings: proc.input(anyIn).mutation(({ input }) => h.write_settings(input)),
    clear_marketplace_cache: proc.mutation(() => h.clear_marketplace_cache()),
    close_minimize: proc.mutation(() => h.close_minimize()),
    close_quit: proc.mutation(() => h.close_quit()),
    add_skill_repo: proc.input(anyIn).mutation(({ input }) => h.add_skill_repo(input)),
    add_local_dir: proc.input(anyIn).mutation(({ input }) => h.add_local_dir(input)),
    remove_skill_repo: proc.input(anyIn).mutation(({ input }) => h.remove_skill_repo(input)),
    list_skill_repos: proc.query(() => h.list_skill_repos()),
    sync_skill_repo: proc.input(anyIn).mutation(({ input }) => h.sync_skill_repo(input)),
    list_repo_skills: proc.input(anyIn).query(({ input }) => h.list_repo_skills(input)),
    install_repo_skill: proc.input(anyIn).mutation(({ input }) => h.install_repo_skill(input)),
    get_app_version: proc.query(() => h.get_app_version()),
    app_update_status: proc.query(() => h.app_update_status()),
    app_update_check: proc.mutation(() => h.app_update_check()),
    app_update_download: proc.mutation(() => h.app_update_download()),
    app_update_apply: proc.mutation(() => h.app_update_apply()),
    window_minimize: proc.mutation(() => h.window_minimize()),
    window_toggle_maximize: proc.mutation(() => h.window_toggle_maximize()),
    window_show: proc.mutation(() => h.window_show()),
    pick_folder: proc.input(anyIn.optional()).query(({ input }) => h.pick_folder(input)),
    open_external: proc.input(anyIn).mutation(({ input }) => h.open_external(input)),
    reveal_path_in_folder: proc.input(anyIn).mutation(({ input }) =>
      h.reveal_path_in_folder(input),
    ),
		open_skill_folder: proc.input(anyIn).mutation(({ input }) => h.open_skill_folder(input)),
		reveal_sync_secret_finding: proc.input(anyIn).mutation(({ input }) => h.reveal_sync_secret_finding(input)),
		open_sync_secret_finding: proc.input(anyIn).mutation(({ input }) => h.open_sync_secret_finding(input)),
		reveal_sync_invalid_entry: proc.input(anyIn).mutation(({ input }) => h.reveal_sync_invalid_entry(input)),
    list_projects: proc.query(() => h.list_projects()),
    add_project: proc.input(anyIn).mutation(({ input }) => h.add_project(input)),
    remove_project: proc.input(anyIn).mutation(({ input }) => h.remove_project(input)),
    list_project_skills: proc.input(anyIn).query(({ input }) => h.list_project_skills(input)),
    install_skill_to_project: proc.input(anyIn).mutation(({ input }) =>
      h.install_skill_to_project(input),
    ),
    install_repo_skill_to_project: proc.input(anyIn).mutation(({ input }) =>
      h.install_repo_skill_to_project(input),
    ),
    install_marketplace_skill_to_project: proc.input(anyIn).mutation(({ input }) =>
      h.install_marketplace_skill_to_project(input),
    ),
    uninstall_project_skill: proc.input(anyIn).mutation(({ input }) =>
      h.uninstall_project_skill(input),
    ),
    set_project_group: proc.input(anyIn).mutation(({ input }) =>
      h.set_project_group(input),
    ),
    list_project_folders: proc.query(() => h.list_project_folders()),
    add_project_folder: proc.input(anyIn).mutation(({ input }) =>
      h.add_project_folder(input),
    ),
    remove_project_folder: proc.input(anyIn).mutation(({ input }) =>
      h.remove_project_folder(input),
    ),
    rename_project_folder: proc.input(anyIn).mutation(({ input }) =>
      h.rename_project_folder(input),
    ),
  })
}

export type AppRouter = ReturnType<typeof createAppRouter>
