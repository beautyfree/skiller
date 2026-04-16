import { initTRPC } from '@trpc/server'
import { z } from 'zod'
import type { BrowserWindow } from 'electrobun'
import {
  createBunRequestHandlers,
  type BunSideRpc,
} from '../rpc-handlers'

const t = initTRPC.create()
const anyIn = z.any()

export function createAppRouter(ctx: {
  getMainWindow: () => BrowserWindow
  rpc: BunSideRpc
  ensureSkillWatcherStarted?: (reason: string) => void
}) {
  const h = createBunRequestHandlers(ctx)
  const proc = t.procedure

  return t.router({
    list_agents: proc.query(() => h.list_agents()),
    detect_agents: proc.query(() => h.detect_agents()),
    scan_all_skills: proc.query(() => h.scan_all_skills()),
    scan_agent_skills: proc.input(anyIn).query(({ input }) => h.scan_agent_skills(input)),
    install_skill: proc.input(anyIn).mutation(({ input }) => h.install_skill(input)),
    uninstall_skill: proc.input(anyIn).mutation(({ input }) => h.uninstall_skill(input)),
    uninstall_skill_all: proc.input(anyIn).mutation(({ input }) => h.uninstall_skill_all(input)),
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
  })
}

export type AppRouter = ReturnType<typeof createAppRouter>
