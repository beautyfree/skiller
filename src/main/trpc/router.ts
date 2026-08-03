import { initTRPC } from '@trpc/server'
import { z } from 'zod'
import type { AppPlatform } from '../../shared/platform'
import {
  createRequestHandlers,
  type BunSideRpc,
} from '../rpc-handlers'

const t = initTRPC.create()
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
    dotagent_machine_inventory: proc.query(() => h.dotagent_machine_inventory()),
    dotagent_doctor: proc.input(anyIn).query(({ input }) => h.dotagent_doctor(input)),
    dotagent_materialization_status: proc.input(anyIn).query(({ input }) => h.dotagent_materialization_status(input)),
    dotagent_skill_discovery: proc.query(() => h.dotagent_skill_discovery()),
    dotagent_audit: proc.input(anyIn).query(({ input }) => h.dotagent_audit(input)),
    dotagent_import_plan: proc.input(anyIn).query(({ input }) => h.dotagent_import_plan(input)),
    read_skills_cli_lock: proc.query(() => h.read_skills_cli_lock()),
    scan_all_skills: proc.query(() => h.scan_all_skills()),
    scan_agent_skills: proc.input(anyIn).query(({ input }) => h.scan_agent_skills(input)),
    list_sync_profiles: proc.query(() => h.list_sync_profiles()),
	refresh_sync_profiles: proc.mutation(() => h.refresh_sync_profiles()),
    scan_sync_inventory: proc.query(() => h.scan_sync_inventory()),
		get_sync_skill_preview: proc.input(anyIn).query(({ input }) => h.get_sync_skill_preview(input)),
    sync_center_publish_preview: proc.input(anyIn.optional()).query(({ input }) => h.sync_center_publish_preview(input)),
    sync_center_publish: proc.input(anyIn).mutation(({ input }) => h.sync_center_publish(input)),
    sync_three_way_review: proc.input(anyIn).mutation(({ input }) => h.sync_three_way_review(input)),
    sync_apply_remote_changes: proc.input(anyIn).mutation(({ input }) => h.sync_apply_remote_changes(input)),
	 sync_apply_conflicting_remote_changes: proc.input(anyIn).mutation(({ input }) => h.sync_apply_conflicting_remote_changes(input)),
	 sync_publish_local_changes: proc.input(anyIn).mutation(({ input }) => h.sync_publish_local_changes(input)),
	 sync_keep_local_changes: proc.input(anyIn).mutation(({ input }) => h.sync_keep_local_changes(input)),
	 sync_keep_external_local_changes: proc.input(anyIn).mutation(({ input }) => h.sync_keep_external_local_changes(input)),
    sync_recovery_status: proc.input(anyIn).query(({ input }) => h.sync_recovery_status(input)),
    sync_recovery_rollback: proc.input(anyIn).mutation(({ input }) => h.sync_recovery_rollback(input)),
    sync_publish_preview: proc.input(anyIn).query(({ input }) => h.sync_publish_preview(input)),
    sync_profile_publish: proc.input(anyIn).mutation(({ input }) => h.sync_profile_publish(input)),
    sync_profile_clone: proc.input(anyIn).mutation(({ input }) => h.sync_profile_clone(input)),
    sync_github_create_repo: proc.input(anyIn).mutation(({ input }) => h.sync_github_create_repo(input)),
    sync_pull_preview: proc.input(anyIn).mutation(({ input }) => h.sync_pull_preview(input)),
    sync_restore_apply: proc.input(anyIn).mutation(({ input }) => h.sync_restore_apply(input)),
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
    read_skill_content: proc.input(anyIn).query(({ input }) => h.read_skill_content(input)),
    write_skill_content: proc.input(anyIn).mutation(({ input }) => h.write_skill_content(input)),
    install_from_git: proc.input(anyIn).mutation(({ input }) => h.install_from_git(input)),
    fetch_remote_skill_content: proc.input(anyIn).query(({ input }) =>
      h.fetch_remote_skill_content(input),
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
		reveal_sync_secret_finding: proc.input(anyIn).mutation(({ input }) => h.reveal_sync_secret_finding(input)),
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
