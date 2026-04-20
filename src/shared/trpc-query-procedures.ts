const QUERY_NAMES = new Set<string>([
  'list_agents',
  'detect_agents',
  'scan_all_skills',
  'scan_agent_skills',
  'read_skill_content',
  'fetch_remote_skill_content',
  'fetch_skillssh',
  'fetch_clawhub',
  'search_marketplace',
  'shell_runtime',
  'read_settings',
  'list_skill_repos',
  'list_repo_skills',
  'list_projects',
  'list_project_skills',
  'list_project_folders',
  'get_app_version',
  'pick_folder',
  'app_update_status',
])

export function isTrpcQueryProcedure(name: string): boolean {
  return QUERY_NAMES.has(name)
}
