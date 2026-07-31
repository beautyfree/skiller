import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppPlatform } from '../shared/platform'
import type { AppRPCSchema } from '../shared/rpc-schema'
import type {
  MarketplaceSkillJson,
  RepoProgressJson,
  SkillJson,
  SkillRepoJson,
  SkillSourceParam,
  SyncProfileStatusJson,
  SyncInventoryJson,
  SyncPublishPreviewJson,
  SyncRestorePreviewJson,
  UpdateAllResultJson,
  UpdateProgressJson,
} from '../shared/rpc-schema'
import { detectAgents, loadAgentConfigs } from './registry'
import { detectRuntimeAgent } from './runtime-agent'
import { readSkillsCliLock } from './skills-cli-lock'
import { getAgentsDir } from './paths'
import type { AgentConfig } from './types'
import type { SkillSource } from './skill-types'
import { scanAllSkills } from './scanner'
import { installSkillFromGit, installSkillFromPath } from './install'
import {
  detachSharedSkill,
  uninstallSkill,
  uninstallDirectSkillFromAll,
  uninstallSkillFromAll,
  unlinkInheritedSkillFromAgentConfigs,
} from './uninstall'
import { updateAll, updateSingleSkill } from './update'
import { readSettings, writeSettings } from './settings'
import {
  agentConfigToJson,
  marketplaceSkillToJson,
  skillToJson,
} from './skill-json'
import { clearMarketplaceCacheDb } from './marketplace/cache'
import {
  applyUpdate as applyAppUpdate,
  checkForUpdate as checkAppUpdate,
  downloadUpdate as downloadAppUpdate,
  getAppUpdateStatus,
} from './app-updater'
import { fetchTimeoutSignal } from './marketplace/fetch-signal'
import { fetchClawhub, searchClawhub } from './marketplace/clawhub'
import { fetchSkillssh, searchSkillssh } from './marketplace/skillssh'
import { installFromMarketplace } from './marketplace/install-from-marketplace'
import type { MarketplaceSkill } from './marketplace-types'
import {
  addLocalDir,
  addSkillRepo,
  installRepoSkill,
  listRepoSkillsAsJson,
  listSkillRepos,
  removeSkillRepo,
  syncSkillRepo,
} from './repos'
import {
  addProject,
  addProjectFolder,
  installMarketplaceSkillToProject,
  installRepoSkillToProject,
  installSkillToProjectFromGit,
  installSkillToProjectFromPath,
  listProjectFolders,
  listProjectSkills,
  listProjects,
  removeProject,
  removeProjectFolder,
  renameProjectFolder,
  setProjectGroup,
  uninstallProjectSkill,
} from './projects'
import { resolveSkillSourcePath } from './skill-paths'
import { sharedSkillsDir } from './shared-skills'
import { readProvenance } from './provenance'
import { scanSyncInventory } from './sync-inventory'
import { createGitHubSyncRepository } from './github-sync'
import { applySyncPublishPlan, createSyncPublishPlan, type SyncPublishCandidate } from './sync-publish'
import { applySyncRestorePlan, createSyncRestorePlan } from './sync-restore'
import { assertCredentialFreeGitRemote, assertPortableRelativePath, assertSyncStableId, parseSyncManifest, type SyncManifest } from './sync-profile'
import {
  commitSyncWorkspace,
  cloneSyncWorkspace,
  fetchSyncWorkspace,
  fastForwardSyncWorkspace,
  getSyncWorkspaceStatus,
  hasSyncWorkspace,
  initializeSyncWorkspace,
  pushSyncWorkspace,
  setSyncWorkspaceRemote,
  syncProfilesDirectory,
  syncWorkspacePath,
} from './sync-workspace'
import {
  effectiveMacOSWindowBlur,
  effectiveMacOSWindowBlurFromSettings,
  isMacOSWindowBlurLockedOffByEnv,
} from './macos-window-preferences'

/** macOS zoom often does not report maximized; track title-bar zoom ourselves for reliable toggle. */
let titleBarZoomRestoreFrame: {
  x: number
  y: number
  width: number
  height: number
} | null = null
let titleBarZoomActive = false

export type BunSideRpc = {
  send: (
    name: keyof AppRPCSchema['bun']['messages'],
    payload?:
      | UpdateProgressJson
      | RepoProgressJson
      | { macosWindowBlur: boolean }
      | { active: boolean }
      | { baseUrl: string }
      | { path: string }
      | import('../shared/rpc-schema').AppUpdateStatusJson
  ) => void
}

function loadDetectedAgents(
  caller = 'unknown',
): AgentConfig[] {
  const configs = loadAgentConfigs(getAgentsDir())
  const detected = detectAgents(configs)
  void caller
  return detected
}

function selectedSyncSkillIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('skillIds must be an array')
  const ids = [...new Set(value)]
  if (ids.length === 0) throw new Error('Select at least one skill to sync')
  for (const id of ids) {
    if (typeof id !== 'string') throw new Error('skillIds must contain only strings')
    assertSyncStableId(id)
  }
  return ids as string[]
}

function syncSecretFindingsForJson(
  skills: { id: string; secretFindings: { rule: string; relativePath: string; line: number; column: number }[] }[],
) {
  return skills.flatMap((skill) => skill.secretFindings.map((finding) => ({
    rule: finding.rule,
    skill_id: skill.id,
    relative_path: finding.relativePath,
    line: finding.line,
    column: finding.column,
  })))
}

function syncAgentPolicy(agentSlugs: unknown, agents: AgentConfig[]): SyncManifest['agent_policy'] {
  if (agentSlugs === undefined) return { mode: 'detected' }
  if (!Array.isArray(agentSlugs)) throw new Error('agentSlugs must be an array')
  const selected = [...new Set(agentSlugs)]
  if (selected.length === 0) return { mode: 'detected' }
  for (const slug of selected) {
    if (typeof slug !== 'string') throw new Error('agentSlugs must contain only strings')
    assertSyncStableId(slug)
    if (!agents.some((agent) => agent.slug === slug && agent.detected)) {
      throw new Error(`Selected sync agent is not detected: ${slug}`)
    }
  }
  return { mode: 'selected', agent_slugs: selected as string[] }
}

function buildSyncPublishPreview(
  profileId: string,
  mode: 'private' | 'team' | 'public',
  skillIds: string[],
  skillKinds: Record<string, 'bundled' | 'reference'> | undefined,
  agentSlugs: string[] | undefined,
): { plan: ReturnType<typeof createSyncPublishPlan>; json: SyncPublishPreviewJson } {
  assertSyncStableId(profileId)
  const agents = loadDetectedAgents('sync_publish_preview')
  const agentPolicy = syncAgentPolicy(agentSlugs, agents)
  const provenance = readProvenance()
  const candidates: SyncPublishCandidate[] = skillIds.map((id) => {
    if (skillKinds?.[id] !== 'reference') {
      return { kind: 'bundled', id, sourcePath: resolveSkillSourcePath(id, agents) }
    }
    const source = provenance[id]
    const repository = source?.repository?.trim()
    const ref = source?.ref?.trim()
    const skillPath = source?.skill_path?.trim()
    if (!repository || !ref || !/^[a-f0-9]{40}$/i.test(ref) || !skillPath) {
      throw new Error(`Skill \`${id}\` has no pinned Git provenance and cannot be synced as a reference`)
    }
    assertCredentialFreeGitRemote(repository)
    assertPortableRelativePath(skillPath)
    return { kind: 'reference', id, repository, ref: ref.toLowerCase(), skillPath }
  })
  const plan = createSyncPublishPlan(profileId, mode, candidates, agentPolicy)
  return {
    plan,
    json: {
      profile_id: profileId,
      mode,
      skills: plan.bundledSkills.map((skill) => ({
        id: skill.id,
        file_count: skill.files.length,
        total_bytes: skill.files.reduce((total, file) => total + file.size, 0),
        files: skill.files.map((file) => file.relativePath),
        excluded_paths: skill.excludedPaths,
      })),
      secret_findings: syncSecretFindingsForJson(plan.bundledSkills),
      references: plan.manifest.skills
        .filter((skill): skill is Extract<typeof skill, { kind: 'reference' }> => skill.kind === 'reference')
        .map((skill) => ({ id: skill.id, repository: skill.repository, ref: skill.ref, skill_path: skill.skill_path })),
    },
  }
}

async function listSyncProfiles(): Promise<SyncProfileStatusJson[]> {
  const directory = syncProfilesDirectory()
  if (!existsSync(directory)) return []
  const result: SyncProfileStatusJson[] = []
  for (const profileId of readdirSync(directory).sort()) {
    try {
      assertSyncStableId(profileId)
      if (!hasSyncWorkspace(profileId)) continue
      const workspace = syncWorkspacePath(profileId)
      const manifest = parseSyncManifest(readFileSync(join(workspace, 'skiller-sync.yaml'), 'utf8'))
      const status = await getSyncWorkspaceStatus(workspace)
      result.push({
        profile_id: profileId,
        mode: manifest.profile.mode,
        skill_count: manifest.skills.length,
        remote_url: status.remoteUrl,
        branch: status.branch,
        changed: status.changed,
        ahead: status.ahead,
        behind: status.behind,
      })
    } catch {
      // An incomplete/non-Skiller Git folder is intentionally not a profile.
    }
  }
  return result
}

function syncInventoryToJson(): SyncInventoryJson {
  const inventory = scanSyncInventory(loadDetectedAgents('scan_sync_inventory'))
  return {
    items: inventory.items.map((item) => ({
      candidate_key: item.candidateKey,
      display_name: item.displayName,
      content_hash: item.contentHash,
      locations: item.locations.map((location) => ({ agent_slug: location.agentSlug, kind: location.kind })),
    })),
    collisions: inventory.collisions.map((collision) => ({
      display_name: collision.displayName,
      candidate_keys: collision.candidateKeys,
    })),
    invalid_paths: inventory.invalidPaths,
  }
}

function skillSourceParamToInternal(s: SkillSourceParam): SkillSource {
  if (s === 'Unknown') return { kind: 'Unknown' }
  if ('LocalPath' in s) return { kind: 'LocalPath', path: s.LocalPath.path }
  if ('GitRepository' in s) {
    return {
      kind: 'GitRepository',
      repo_url: s.GitRepository.repo_url,
      skill_path: s.GitRepository.skill_path ?? null,
    }
  }
  if ('SkillsSh' in s)
    return { kind: 'SkillsSh', repository: s.SkillsSh.repository ?? null }
  if ('ClawHub' in s)
    return { kind: 'ClawHub', repository: s.ClawHub.repository ?? null }
  return { kind: 'Unknown' }
}

function readAppVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkgPath = join(here, '..', '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      version?: string
    }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

async function fetchRemoteSkillContent(
  repoUrl: string,
  skillName?: string | null
): Promise<string> {
  const repo = repoUrl
    .trim()
    .replace(/\/$/, '')
    .replace(/\.git$/, '')
  const rawBase = repo.replace('github.com', 'raw.githubusercontent.com')
  const branches = ['main', 'master'] as const
  const filePaths: string[] = []
  if (skillName) filePaths.push(`skills/${skillName}/SKILL.md`)
  filePaths.push('SKILL.md')

  for (const path of filePaths) {
    for (const branch of branches) {
      const url = `${rawBase}/${branch}/${path}`
      try {
        const res = await fetch(url, { signal: fetchTimeoutSignal(10_000) })
        if (res.ok) {
          const text = await res.text()
          if (text.length > 0) return text
        }
      } catch {
        /* try next */
      }
    }
  }
  throw new Error('Could not fetch SKILL.md from repository')
}

export function createRequestHandlers(ctx: {
  /** Host-specific adapter for OS-level calls (quit, file dialog, window chrome). */
  platform: AppPlatform
  rpc: BunSideRpc
  ensureSkillWatcherStarted?: (reason: string) => void
}) {
  const { platform, rpc, ensureSkillWatcherStarted } = ctx
  const getMainWindow = () => platform.getMainWindow()

  const handlers = {
    list_agents: async () => {
      return loadDetectedAgents().map(agentConfigToJson)
    },
    detect_agents: async () => {
      const out = loadDetectedAgents('detect_agents').map(agentConfigToJson)
      return out
    },
    // Runtime context is informational only. It must never influence the
    // installable-agent list, which remains guarded by registry detection.
    detect_runtime_agent: async () => detectRuntimeAgent(),
    read_skills_cli_lock: async () => readSkillsCliLock(),
    scan_all_skills: async () => {
      const agents = loadDetectedAgents('scan_all_skills')
      const skills = scanAllSkills(agents)
      const json = skills.map(skillToJson)
      setImmediate(() => ensureSkillWatcherStarted?.('after_scan_all_skills'))
      return json
    },
    scan_agent_skills: async (params: { agentSlug: string }) => {
      const { agentSlug } = params
      const all = scanAllSkills(loadDetectedAgents())
      return all
        .filter((s) => s.installations.some((i) => i.agent_slug === agentSlug))
        .map(skillToJson)
    },
    list_sync_profiles: async (): Promise<SyncProfileStatusJson[]> => listSyncProfiles(),
    scan_sync_inventory: async (): Promise<SyncInventoryJson> => syncInventoryToJson(),
    sync_publish_preview: async (params: {
      profileId: string
      mode: 'private' | 'team' | 'public'
      skillIds: string[]
      skillKinds?: Record<string, 'bundled' | 'reference'>
      agentSlugs?: string[]
    }): Promise<SyncPublishPreviewJson> => {
      const skillIds = selectedSyncSkillIds(params.skillIds)
      return buildSyncPublishPreview(params.profileId, params.mode, skillIds, params.skillKinds, params.agentSlugs).json
    },
    sync_profile_publish: async (params: {
      profileId: string
      mode: 'private' | 'team' | 'public'
      skillIds: string[]
      skillKinds?: Record<string, 'bundled' | 'reference'>
      agentSlugs?: string[]
      remoteUrl?: string | null
      push: boolean
    }) => {
      const skillIds = selectedSyncSkillIds(params.skillIds)
      assertSyncStableId(params.profileId)
      const workspace = syncWorkspacePath(params.profileId)
      const remoteUrl = params.remoteUrl?.trim() || null
      if (remoteUrl) assertCredentialFreeGitRemote(remoteUrl)

      if (!hasSyncWorkspace(params.profileId)) {
        await initializeSyncWorkspace(workspace, remoteUrl)
      } else {
        const status = await getSyncWorkspaceStatus(workspace)
        if (status.changed) throw new Error('Sync workspace has uncommitted changes; resolve them before publishing')
        if (remoteUrl && status.remoteUrl && status.remoteUrl !== remoteUrl) {
          throw new Error('This profile already uses a different remote; changing a remote is not implicit')
        }
        if (remoteUrl && !status.remoteUrl) await setSyncWorkspaceRemote(workspace, remoteUrl)
      }

      const { plan } = buildSyncPublishPreview(params.profileId, params.mode, skillIds, params.skillKinds, params.agentSlugs)
      applySyncPublishPlan(workspace, plan)
      const commit = await commitSyncWorkspace(workspace, `Skiller sync: update ${params.profileId}`)
      let pushed = false
      if (params.push) {
        const status = await getSyncWorkspaceStatus(workspace)
        if (!status.remoteUrl) throw new Error('A Git remote is required before pushing')
        await pushSyncWorkspace(workspace)
        pushed = true
      }
      return { commit, pushed }
    },
    sync_profile_clone: async (params: { profileId: string; remoteUrl: string }): Promise<SyncProfileStatusJson> => {
      assertSyncStableId(params.profileId)
      const remoteUrl = params.remoteUrl.trim()
      if (!remoteUrl) throw new Error('A Git remote is required')
      assertCredentialFreeGitRemote(remoteUrl)
      if (hasSyncWorkspace(params.profileId) || existsSync(syncWorkspacePath(params.profileId))) {
        throw new Error('This profile already has a local workspace; cloning would overwrite it')
      }
      await cloneSyncWorkspace(remoteUrl, syncWorkspacePath(params.profileId))
      const workspace = syncWorkspacePath(params.profileId)
      const manifest = parseSyncManifest(readFileSync(join(workspace, 'skiller-sync.yaml'), 'utf8'))
      if (manifest.profile.id !== params.profileId) throw new Error('The remote profile id does not match the requested profile')
      const status = await getSyncWorkspaceStatus(workspace)
      return {
        profile_id: params.profileId,
        mode: manifest.profile.mode,
        skill_count: manifest.skills.length,
        remote_url: status.remoteUrl,
        branch: status.branch,
        changed: status.changed,
        ahead: status.ahead,
        behind: status.behind,
      }
    },
    sync_github_create_repo: async (params: { repository: string; visibility: 'private' | 'public' }) => ({
      remoteUrl: await createGitHubSyncRepository(params.repository, params.visibility),
    }),
    sync_pull_preview: async (params: { profileId: string }): Promise<SyncRestorePreviewJson> => {
      assertSyncStableId(params.profileId)
      if (!hasSyncWorkspace(params.profileId)) throw new Error('Sync profile has not been set up on this computer')
      const workspace = syncWorkspacePath(params.profileId)
      const status = await getSyncWorkspaceStatus(workspace)
      if (!status.remoteUrl) throw new Error('This sync profile has no Git remote')
      if (status.changed) throw new Error('Sync workspace has uncommitted changes; resolve them before pulling')
      await fetchSyncWorkspace(workspace)
      await fastForwardSyncWorkspace(workspace)
      const plan = createSyncRestorePlan(workspace, sharedSkillsDir())
      return {
        profile_id: params.profileId,
        mode: plan.manifest.profile.mode,
        skills: [
          ...plan.entries.map((entry) => ({ id: entry.id, kind: 'bundled' as const, action: entry.action })),
          ...plan.manifest.skills
            .filter((skill): skill is Extract<typeof skill, { kind: 'reference' }> => skill.kind === 'reference')
            .map((skill) => ({
              id: skill.id,
              kind: 'reference' as const,
              action: 'create' as const,
              repository: skill.repository,
              ref: skill.ref,
            })),
        ],
        secret_findings: plan.secretFindings.map((finding) => ({
          rule: finding.rule,
          skill_id: finding.skillId,
          relative_path: finding.relativePath,
          line: finding.line,
          column: finding.column,
        })),
      }
    },
    sync_restore_apply: async (params: { profileId: string; skillIds: string[] }) => {
      assertSyncStableId(params.profileId)
      const skillIds = selectedSyncSkillIds(params.skillIds)
      if (!hasSyncWorkspace(params.profileId)) throw new Error('Sync profile has not been set up on this computer')
      const workspace = syncWorkspacePath(params.profileId)
      const plan = createSyncRestorePlan(workspace, sharedSkillsDir())
      const referenceSkills = plan.manifest.skills
        .filter((skill): skill is Extract<typeof skill, { kind: 'reference' }> => skill.kind === 'reference')
      const available = new Set([...plan.entries.map((entry) => entry.id), ...referenceSkills.map((skill) => skill.id)])
      for (const id of skillIds) if (!available.has(id)) throw new Error(`Skill is not present in this sync profile: ${id}`)
      applySyncRestorePlan(plan, skillIds.filter((id) => plan.entries.some((entry) => entry.id === id)))

      const agents = loadDetectedAgents('sync_restore_apply')
      const targetAgentSlugs = plan.manifest.agent_policy.mode === 'selected'
        ? plan.manifest.agent_policy.agent_slugs.filter((slug) => agents.some((agent) => agent.slug === slug && agent.detected))
        : agents.filter((agent) => agent.detected).map((agent) => agent.slug)
      for (const id of skillIds.filter((id) => plan.entries.some((entry) => entry.id === id))) {
        installSkillFromPath(join(sharedSkillsDir(), id), targetAgentSlugs, agents, id)
      }
      for (const skill of referenceSkills.filter((skill) => skillIds.includes(skill.id))) {
        await installSkillFromGit(skill.repository, skill.skill_path, targetAgentSlugs, agents, 'sync-reference', skill.ref)
      }
      rpc.send('skills_changed')
      return { restored: skillIds, installed_to_detected_agents: targetAgentSlugs }
    },
    install_skill: async (params: {
      source: SkillSourceParam
      targetAgents: string[]
    }) => {
      const { source, targetAgents } = params
      const agents = loadDetectedAgents()
      const src = skillSourceParamToInternal(source)
      switch (src.kind) {
        case 'LocalPath':
          installSkillFromPath(src.path, targetAgents, agents)
          return
        case 'GitRepository': {
          const rel = src.skill_path?.trim() || '.'
          await installSkillFromGit(
            src.repo_url,
            rel,
            targetAgents,
            agents,
            'git'
          )
          return
        }
        case 'SkillsSh': {
          const repo = src.repository?.trim()
          if (!repo) throw new Error('repository url is required')
          await installSkillFromGit(
            repo,
            '.',
            targetAgents,
            agents,
            'skills.sh'
          )
          return
        }
        case 'ClawHub': {
          const repo = src.repository?.trim()
          if (!repo) throw new Error('repository url is required')
          await installSkillFromGit(repo, '.', targetAgents, agents, 'clawhub')
          return
        }
        case 'Unknown':
          throw new Error('unsupported skill source')
      }
    },
    uninstall_skill: async (params: { skillId: string; agentSlug: string }) => {
      const { skillId, agentSlug } = params
      uninstallSkill(skillId, agentSlug, loadDetectedAgents())
    },
    uninstall_skill_all: async (params: { skillId: string }) => {
      const { skillId } = params
      uninstallSkillFromAll(skillId, loadDetectedAgents())
    },
    uninstall_skills_all: async (params: { skillIds: string[] }) => {
      if (!Array.isArray(params.skillIds)) {
        throw new Error('skillIds must be an array')
      }
      const skillIds = [...new Set(
        params.skillIds.filter((id): id is string => typeof id === 'string' && id.length > 0),
      )]
      const agents = loadDetectedAgents()
      const removed: string[] = []
      const failed: { id: string; error: string }[] = []

      for (const skillId of skillIds) {
        try {
          uninstallDirectSkillFromAll(skillId, agents)
          removed.push(skillId)
        } catch (err) {
          failed.push({
            id: skillId,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      return { removed, failed }
    },
    /**
     * Remove every directly-installed skill from a single agent. Used by
     * "Clean up Gemini / Codex / …" in the agent header, for the case where
     * the user no longer uses that agent and wants it empty (or hidden from
     * the sidebar because a zero-count agent collapses).
     */
    uninstall_all_skills_from_agent: async (params: { agentSlug: string }) => {
      const agents = loadDetectedAgents()
      const skills = scanAllSkills(agents)
      const removed: string[] = []
      const failed: { id: string; error: string }[] = []
      for (const skill of skills) {
        const direct = skill.installations.some(
          (i) => i.agent_slug === params.agentSlug && !i.is_inherited,
        )
        if (!direct) continue
        try {
          uninstallSkill(skill.id, params.agentSlug, agents)
          removed.push(skill.id)
        } catch (err) {
          failed.push({
            id: skill.id,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
      return { removed, failed }
    },
    /**
     * Copy every skill that's directly installed on `sourceAgent` (or on any
     * agent when sourceAgent is null) into `targetAgent`. Uses the canonical
     * dir as the source for each skill, same path as individual Sync To X.
     */
    sync_all_skills_to_agent: async (params: {
      targetAgent: string
      sourceAgent: string | null
    }) => {
      const agents = loadDetectedAgents()
      const skills = scanAllSkills(agents)
      const copied: string[] = []
      const skipped: string[] = []
      const alreadyPresent: string[] = []
      const failed: { id: string; error: string }[] = []
      for (const skill of skills) {
        // STEP 1: candidacy — is this skill actually on the source agent?
        // Only directly-installed skills count (inherited skills aren't
        // "owned" by the source; they come from a shared library that the
        // target may or may not already read). If the user picked "any",
        // we accept anything with at least one direct install somewhere.
        const presentOnSource = params.sourceAgent
          ? skill.installations.some(
              (i) =>
                i.agent_slug === params.sourceAgent && !i.is_inherited,
            )
          : skill.installations.some((i) => !i.is_inherited)
        if (!presentOnSource) continue

        // STEP 2: is it already on the target? Count separately so the
        // summary can tell the user "your target already has N of them via
        // the shared dir" — different meaning from "we considered it and
        // dropped it for another reason".
        const onTarget = skill.installations.some(
          (i) => i.agent_slug === params.targetAgent,
        )
        if (onTarget) {
          alreadyPresent.push(skill.id)
          continue
        }
        try {
          const source = resolveSkillSourcePath(skill.id, agents)
          installSkillFromPath(source, [params.targetAgent], agents)
          copied.push(skill.id)
        } catch (err) {
          failed.push({
            id: skill.id,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
      // Keep the shared-response shape stable — fold "already present" into
      // skipped so existing callers still read the summary the same way,
      // while copied/failed stay precise.
      return {
        copied,
        skipped: [...alreadyPresent, ...skipped],
        failed,
      }
    },
    detach_shared_skill: async (params: {
      skillId: string
      removeFromAgent: string
    }) => {
      return detachSharedSkill(
        params.skillId,
        params.removeFromAgent,
        loadDetectedAgents(),
      )
    },
    unlink_inherited_skill: async (params: { skillId: string }) => {
      const { skillId } = params
      const agents = loadDetectedAgents()
      unlinkInheritedSkillFromAgentConfigs(skillId, agents, getAgentsDir())
    },
    sync_skill: async (params: { skillId: string; targetAgents: string[] }) => {
      const { skillId, targetAgents } = params
      const agents = loadDetectedAgents()
      const source = resolveSkillSourcePath(skillId, agents)
      installSkillFromPath(source, targetAgents, agents)
    },
    update_skill: async (params: { skillId: string }) => {
      const { skillId } = params
      await updateSingleSkill(skillId, loadDetectedAgents())
    },
    update_all_skills: async () => {
      const agents = loadDetectedAgents()
      const result = await updateAll(agents, (p) => {
        rpc.send('skill_update_progress', p)
      })
      const out: UpdateAllResultJson = {
        updated: result.updated,
        failed: result.failed,
        skipped: result.skipped,
      }
      return out
    },
    read_skill_content: async (params: { path: string }) => {
      const { path: filePath } = params
      const normalized = filePath.replace(/\//g, sep)
      return readFileSync(normalized, 'utf-8')
    },
    write_skill_content: async (params: { path: string; content: string }) => {
      const { path: filePath, content } = params
      const normalized = filePath.replace(/\//g, sep)
      writeFileSync(normalized, content, 'utf-8')
    },
    install_from_git: async (params: {
      repoUrl: string
      skillRelativePath: string
      targetAgents: string[]
    }) => {
      const { repoUrl, skillRelativePath, targetAgents } = params
      await installSkillFromGit(
        repoUrl,
        skillRelativePath,
        targetAgents,
        loadDetectedAgents(),
        'git'
      )
    },
    fetch_remote_skill_content: async (params: {
      repoUrl: string
      skillName?: string | null
    }) => {
      const { repoUrl, skillName } = params
      return fetchRemoteSkillContent(repoUrl, skillName)
    },
    fetch_skillssh: async (params: {
      sort: string
      page: number
    }): Promise<MarketplaceSkillJson[]> => {
      const skills = await fetchSkillssh(params.sort, params.page)
      return skills.map(marketplaceSkillToJson)
    },
    fetch_clawhub: async (params: {
      endpoint: string
      params: Record<string, string>
    }): Promise<MarketplaceSkillJson[]> => {
      const skills = await fetchClawhub(params.endpoint, params.params)
      return skills.map(marketplaceSkillToJson)
    },
    search_marketplace: async (params: {
      query: string
      source: string
    }): Promise<MarketplaceSkillJson[]> => {
      const q = params.query
      if (params.source === 'skills.sh') {
        const skills = await searchSkillssh(q)
        return skills.map(marketplaceSkillToJson)
      }
      if (params.source === 'clawhub') {
        const skills = await searchClawhub(q)
        return skills.map(marketplaceSkillToJson)
      }
      return []
    },
    install_from_marketplace: async (params: {
      skill: MarketplaceSkillJson
      targetAgents: string[]
    }) => {
      const s = params.skill
      const internal: MarketplaceSkill = {
        name: s.name,
        description: s.description ?? null,
        author: s.author ?? null,
        repository: s.repository ?? null,
        installs: s.installs ?? null,
        source: s.source,
      }
      await installFromMarketplace(
        internal,
        params.targetAgents,
        loadDetectedAgents()
      )
    },
    shell_runtime: async () => {
      return {
        macosWindowBlur: effectiveMacOSWindowBlur(),
        macosWindowBlurLockedByEnv: isMacOSWindowBlurLockedOffByEnv(),
      }
    },
    read_settings: async () => {
      return readSettings()
    },
    write_settings: async (params: {
      settings: import('../shared/rpc-schema').AppSettingsJson
    }) => {
      const blurBefore = effectiveMacOSWindowBlur()
      const blurDesired = effectiveMacOSWindowBlurFromSettings(params.settings)
      writeSettings(params.settings)
      if (process.platform === 'darwin') {
        const blurChanged = blurBefore !== blurDesired
        const nextBlur = blurDesired
        queueMicrotask(() => {
          try {
            platform.syncMacOSChromeFromSettings()
          } catch (err) {
            console.warn('syncMacOSChromeFromSettings:', err)
          }
          if (!blurChanged) return
          try {
            platform.setMacOSVibrancy(nextBlur)
          } catch (err) {
            console.warn('setMacOSVibrancy:', err)
          }
          try {
            rpc.send('shell_runtime_changed', {
              macosWindowBlur: nextBlur,
            })
          } catch (err) {
            console.warn('shell_runtime_changed send:', err)
          }
        })
      }
    },
    clear_marketplace_cache: async () => {
      clearMarketplaceCacheDb()
    },
    close_minimize: async () => {
      getMainWindow().minimize()
    },
    close_quit: async () => {
      platform.quit()
    },
    add_skill_repo: async (params: { repoUrl: string }) => {
      const { repo, skills } = await addSkillRepo(params.repoUrl, (p) => {
        rpc.send('repo_progress', p)
      })
      return {
        repo: {
          id: repo.id,
          name: repo.name,
          description: repo.description ?? null,
          repo_url: repo.repo_url,
          local_path: repo.local_path,
          last_synced: repo.last_synced ?? null,
          skill_count: repo.skill_count,
        },
        skills,
      }
    },
    add_local_dir: async (params: { path: string }) => {
      const { repo, skills } = await addLocalDir(params.path)
      return {
        repo: {
          id: repo.id,
          name: repo.name,
          description: repo.description ?? null,
          repo_url: repo.repo_url,
          local_path: repo.local_path,
          last_synced: repo.last_synced ?? null,
          skill_count: repo.skill_count,
        },
        skills,
      }
    },
    remove_skill_repo: async (params: { repoIdParam: string }) => {
      removeSkillRepo(params.repoIdParam)
    },
    list_skill_repos: async (): Promise<SkillRepoJson[]> => {
      return listSkillRepos().map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description ?? null,
        repo_url: r.repo_url,
        local_path: r.local_path,
        last_synced: r.last_synced ?? null,
        skill_count: r.skill_count,
      }))
    },
    sync_skill_repo: async (params: { repoIdParam: string }) => {
      const repo = await syncSkillRepo(params.repoIdParam, (p) => {
        rpc.send('repo_progress', p)
      })
      return {
        id: repo.id,
        name: repo.name,
        description: repo.description ?? null,
        repo_url: repo.repo_url,
        local_path: repo.local_path,
        last_synced: repo.last_synced ?? null,
        skill_count: repo.skill_count,
      }
    },
    list_repo_skills: async (params: {
      repoIdParam: string
    }): Promise<SkillJson[]> => {
      return listRepoSkillsAsJson(params.repoIdParam)
    },
    install_repo_skill: async (params: {
      repoIdParam: string
      skillId: string
      targetAgents: string[]
    }) => {
      installRepoSkill(params.repoIdParam, params.skillId, params.targetAgents)
    },
    get_app_version: async () => readAppVersion(),
    app_update_status: async () => getAppUpdateStatus(),
    app_update_check: async () => checkAppUpdate(),
    app_update_download: async () => downloadAppUpdate(),
    app_update_apply: async () => applyAppUpdate(),
    window_minimize: async () => {
      getMainWindow().minimize()
    },
    window_toggle_maximize: async () => {
      const win = getMainWindow()
      if (process.platform === 'darwin') {
        if (win.toggleMacOSZoom()) {
          titleBarZoomActive = false
          titleBarZoomRestoreFrame = null
          return
        }
      }
      if (win.isMaximized()) {
        win.unmaximize()
        titleBarZoomActive = false
        titleBarZoomRestoreFrame = null
        return
      }
      if (titleBarZoomActive && titleBarZoomRestoreFrame) {
        win.setFrame(titleBarZoomRestoreFrame)
        titleBarZoomActive = false
        titleBarZoomRestoreFrame = null
        return
      }
      titleBarZoomRestoreFrame = win.getFrame()
      win.maximize()
      titleBarZoomActive = true
    },
    window_show: async () => {
      getMainWindow().show()
    },
    pick_folder: async (params?: { title?: string }) => {
      return platform.pickFolder({
        title: params?.title,
        startingFolder: '~/',
      })
    },
    open_external: async (params: { url: string }) => {
      await platform.openExternal(params.url)
    },
    reveal_path_in_folder: async (params: { path: string }) => {
      platform.showItemInFolder(params.path)
    },
    list_projects: async () => listProjects(),
    add_project: async (params: { path: string }) => addProject(params.path),
    remove_project: async (params: { path: string }) => {
      removeProject(params.path)
    },
    list_project_skills: async (params: { path: string }) =>
      listProjectSkills(params.path),
    install_skill_to_project: async (params: {
      source: SkillSourceParam
      projectPath: string
    }) => {
      const { source, projectPath } = params
      const src = skillSourceParamToInternal(source)
      switch (src.kind) {
        case 'LocalPath':
          installSkillToProjectFromPath(src.path, projectPath)
          return
        case 'GitRepository': {
          const rel = src.skill_path?.trim() || '.'
          await installSkillToProjectFromGit(src.repo_url, rel, projectPath)
          return
        }
        case 'SkillsSh':
        case 'ClawHub': {
          const repo = src.repository?.trim()
          if (!repo) throw new Error('repository url is required')
          await installSkillToProjectFromGit(repo, '.', projectPath)
          return
        }
        case 'Unknown':
          throw new Error('unsupported skill source')
      }
    },
    install_repo_skill_to_project: async (params: {
      repoIdParam: string
      skillId: string
      projectPath: string
    }) => {
      installRepoSkillToProject(
        params.repoIdParam,
        params.skillId,
        params.projectPath,
      )
    },
    install_marketplace_skill_to_project: async (params: {
      skill: MarketplaceSkillJson
      projectPath: string
    }) => {
      const s = params.skill
      const internal: MarketplaceSkill = {
        name: s.name,
        description: s.description ?? null,
        author: s.author ?? null,
        repository: s.repository ?? null,
        installs: s.installs ?? null,
        source: s.source,
      }
      await installMarketplaceSkillToProject(internal, params.projectPath)
    },
    uninstall_project_skill: async (params: {
      projectPath: string
      skillId: string
    }) => {
      uninstallProjectSkill(params.projectPath, params.skillId)
    },
    set_project_group: async (params: { path: string; group: string | null }) =>
      setProjectGroup(params.path, params.group),
    list_project_folders: async () => listProjectFolders(),
    add_project_folder: async (params: { name: string }) =>
      addProjectFolder(params.name),
    remove_project_folder: async (params: { name: string }) =>
      removeProjectFolder(params.name),
    rename_project_folder: async (params: { from: string; to: string }) =>
      renameProjectFolder(params.from, params.to),
  }

  return handlers
}
