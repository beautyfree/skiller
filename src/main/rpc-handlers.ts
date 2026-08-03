import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppPlatform } from '../shared/platform'
import type { AppRPCSchema } from '../shared/rpc-schema'
import type {
  MarketplaceSkillJson,
  DotagentMachineInventoryJson,
  DotagentDoctorJson,
  DotagentMaterializationStatusJson,
  DotagentSkillDiscoveryJson,
  DotagentAuditJson,
  DotagentImportPlanJson,
  RepoProgressJson,
  SkillJson,
  SkillRepoJson,
  SkillSourceParam,
  SyncProfileStatusJson,
  SyncInventoryJson,
	SyncSkillPreviewJson,
  SyncThreeWayReviewJson,
  SyncPublishPreviewJson,
  SyncRestorePreviewJson,
  UpdateAllResultJson,
  UpdateProgressJson,
} from '../shared/rpc-schema'
import { detectAgents, loadAgentConfigs } from './registry'
import { detectRuntimeAgent } from './runtime-agent'
import { scanDotagentMachine } from './dotagent-catalog'
import { dotagentDescriptorsFromSkiller } from './dotagent-catalog'
import { planDotagentImportFromDiscovery, scanDotagentSkillDiscovery, type DotagentImportDecision } from './dotagent-discovery'
import { dotagentAuditToJson, dotagentDiscoveryToJson, dotagentDoctorToJson, dotagentImportPlanToJson, dotagentMachineToJson, dotagentStatusToJson } from './dotagent-json'
import { doctorLibrary } from '@beautyfree/dotagent/doctor'
import { auditLibrary } from '@beautyfree/dotagent/audit'
import { getMaterializationStatus } from '@beautyfree/dotagent/status'
import { homedir } from 'node:os'
import { readSkillsCliLock, type SkillsCliLockEntry } from './skills-cli-lock'
import { getAgentsDir } from './paths'
import type { AgentConfig } from './types'
import type { SkillSource } from './skill-types'
import { scanAllSkills } from './scanner'
import { discardPreparedGitSkill, installPreparedGitSkill, installSkillFromGit, installSkillFromPath, prepareGitSkillInstall, type PreparedGitSkillInstall } from './install'
import {
  detachSharedSkill,
	unlinkInheritedSkillFromAgentConfigs,
  uninstallSkill,
  uninstallDirectSkillFromAll,
  uninstallSkillFromAll,
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
import { readProvenance, type ProvenanceEntry } from './provenance'
import { scanSyncInventory } from './sync-inventory'
import { planBundledSkillExport } from './sync-export'
import { parseSkillMdFile } from './parser'
import { classifyThreeWaySkill, makeSyncLedger, readSyncLedger, writeSyncLedgerAt, syncLedgerPath } from './sync-ledger'
import { readRestoreJournalAt, recoverRestoreJournalAt, syncJournalPath } from './sync-journal'
import { createGitHubSyncRepository } from './github-sync'
import { applySyncPublishFiles, applySyncPublishPlan, createSyncPublishPlan, mergeBundledUpdateIntoManifest, type SyncPublishCandidate } from './sync-publish'
import { applySyncRestorePlan, createSyncRestorePlan } from './sync-restore'
import { isCanonicalSyncLibrary, planCanonicalSyncLibrary, readSyncManifestFromWorkspace } from './sync-dotagent'
import { classifyExternalRestore, externalKeptSourceMatches, externalSkillDirectory, externalSkillRepository, type ManagedExternalSkill, type ExternalRestoreAction } from './sync-external'
import { assertCredentialFreeGitRemote, assertPortableRelativePath, assertSyncStableId, type SyncManifest } from './sync-profile'
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
	refreshSyncWorkspaceStatus,
	resolveGitReferenceToCommit,
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
      skills_sh: plan.manifest.skills
        .filter((skill): skill is Extract<typeof skill, { kind: 'skills_sh' }> => skill.kind === 'skills_sh')
        .map((skill) => ({ id: skill.id, source_url: skill.source_url, ref: skill.ref, skill_path: skill.skill_path })),
    },
  }
}

async function listSyncProfiles(refreshRemote = false): Promise<SyncProfileStatusJson[]> {
  const directory = syncProfilesDirectory()
  if (!existsSync(directory)) return []
  const result: SyncProfileStatusJson[] = []
  for (const profileId of readdirSync(directory).sort()) {
    try {
      assertSyncStableId(profileId)
      if (!hasSyncWorkspace(profileId)) continue
      const workspace = syncWorkspacePath(profileId)
      const manifest = readSyncManifestFromWorkspace(workspace)
	  let status = await getSyncWorkspaceStatus(workspace)
	  let checkError: string | null = null
	  let checkedAt: string | null = null
	  if (refreshRemote && status.remoteUrl) {
		try {
		  await refreshSyncWorkspaceStatus(workspace)
		  checkedAt = new Date().toISOString()
		  status = await getSyncWorkspaceStatus(workspace)
		} catch {
		  // Intentionally do not surface arbitrary Git output: it can include a
		  // remote URL. The user gets a clear, non-sensitive next step instead.
		  checkError = 'Could not check the remote. Connect or authenticate, then retry from Sync Center.'
		}
	  }
      result.push({
        profile_id: profileId,
        mode: manifest.profile.mode,
        skill_count: manifest.skills.length,
        remote_url: status.remoteUrl,
        branch: status.branch,
        changed: status.changed,
        ahead: status.ahead,
        behind: status.behind,
		last_checked_at: checkedAt,
		check_error: checkError,
      })
    } catch {
      // An incomplete/non-Skiller Git folder is intentionally not a profile.
    }
  }
  return result
}

/** Sources from the inventory the user has just reviewed. Kept main-process-only. */
let syncPreviewSources = new Map<string, string>()

function syncInventoryToJson(): SyncInventoryJson {
  const inventory = scanSyncInventory(loadDetectedAgents('scan_sync_inventory'))
	const skillsCliEntries = readSkillsCliLock()?.skills ?? []
	const provenance = readProvenance()
	// Review details must be as immediate as All Skills: never re-run the expensive
	// export-safe inventory traversal merely to open an already-listed SKILL.md.
	syncPreviewSources = new Map(inventory.items.map((item) => [item.candidateKey, item.sourcePath]))
  return {
    items: inventory.items.map((item) => ({
      candidate_key: item.candidateKey,
      display_name: item.displayName,
		description: item.description,
      when_to_use: item.whenToUse,
      content_hash: item.contentHash,
			source: (() => {
				const source = skillsCliEntryForInventoryItem(item, skillsCliEntries)
				if (source) return { kind: 'skills_sh' as const, source_url: source.source_url, ref: source.ref, skill_path: source.skill_path }
				const git = provenanceEntryForInventoryItem(item, provenance)
				if (!git?.repository) return { kind: 'local' as const }
				if (git.source === 'skills.sh') return { kind: 'skills_sh' as const, source_url: git.repository, ref: git.ref ?? null, skill_path: git.skill_path ?? null }
				return { kind: 'git_reference' as const, repository: git.repository, ref: git.ref ?? null, skill_path: git.skill_path ?? null }
			})(),
      locations: item.locations.map((location) => ({ ...(location.agentSlug ? { agent_slug: location.agentSlug } : {}), kind: location.kind })),
    })),
    collisions: inventory.collisions.map((collision) => ({
      display_name: collision.displayName,
      candidate_keys: collision.candidateKeys,
    })),
    invalid_paths: inventory.invalidPaths,
	invalid_entries: inventory.invalidEntries.map((entry) => ({ display_name: entry.displayName, reason: entry.reason })),
	linked_aliases: inventory.linkedAliases,
  }
}

function syncSkillPreviewToJson(skillId: string): SyncSkillPreviewJson {
  assertSyncStableId(skillId)
	const sourcePath = syncPreviewSources.get(skillId)
	if (!sourcePath) throw new Error('Refresh the library review before opening this skill')
  return { skill_id: skillId, body: parseSkillMdFile(join(sourcePath, 'SKILL.md')).body }
}

function skillsCliEntryForInventoryItem(
  item: ReturnType<typeof scanSyncInventory>['items'][number],
  entries: SkillsCliLockEntry[],
): SkillsCliLockEntry | null {
  // The Skills CLI lock is keyed by its installed directory name. Keep the
  // match conservative: provenance is better omitted than attached to an
  // unrelated same-named local skill.
  const names = new Set([
    item.candidateKey,
    basename(item.sourcePath),
    item.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
  ]);
  return entries.find((entry) => names.has(entry.name)) ?? null
}

function provenanceEntryForInventoryItem(
  item: ReturnType<typeof scanSyncInventory>['items'][number],
  provenance: Record<string, ProvenanceEntry>,
): ProvenanceEntry | null {
  const names = [
    item.candidateKey,
    basename(item.sourcePath),
    item.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
  ]
  for (const name of names) {
    const entry = provenance[name]
    if (entry?.repository?.trim()) return entry
  }
  return null
}

function skillsCliSkillDirectory(entry: SkillsCliLockEntry): string | null {
  const path = entry.skill_path?.trim()
  if (!path) return null
  if (path === 'SKILL.md') return '.'
  return path.replace(/\/SKILL\.md$/i, '') || '.'
}

const GIT_COMMIT_CACHE_TTL_MS = 5 * 60_000
const gitCommitResolution = new Map<string, { resolvedAt: number; promise: Promise<string> }>()

/**
 * A library review can revisit the same external source several times. Cache
 * only its immutable resolution briefly; failed/auth-required attempts are
 * immediately discarded so reconnecting can be retried without a restart.
 */
function resolveGitCommitCached(repository: string, ref: string): Promise<string> {
	const requestedRef = ref.trim() || 'HEAD'
	const key = `${repository.trim()}\u0000${requestedRef}`
	const existing = gitCommitResolution.get(key)
	if (existing && Date.now() - existing.resolvedAt < GIT_COMMIT_CACHE_TTL_MS) return existing.promise
	const promise = resolveGitReferenceToCommit(repository, requestedRef)
	const entry = { resolvedAt: Date.now(), promise }
	gitCommitResolution.set(key, entry)
	promise.catch(() => {
		if (gitCommitResolution.get(key) === entry) gitCommitResolution.delete(key)
	})
	return promise
}

function resolveSkillsCliCommit(entry: SkillsCliLockEntry): Promise<string> {
	return resolveGitCommitCached(entry.source_url, entry.ref?.trim() || 'HEAD')
}

async function mapWithConcurrency<T, Result>(items: T[], limit: number, task: (item: T) => Promise<Result>): Promise<Result[]> {
  const output = new Array<Result>(items.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++
      output[index] = await task(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return output
}

type UnresolvedSyncCenterSource = { id: string; kind: 'reference' | 'skills_sh' }

async function createSyncCenterPublishPlan(selectedKeys?: string[]): Promise<{
  plan: ReturnType<typeof createSyncPublishPlan>
  unresolvedSources: UnresolvedSyncCenterSource[]
}> {
  const inventory = scanSyncInventory(loadDetectedAgents('sync_center_publish'))
  const selected = selectedKeys ? new Set(selectedKeys) : null
  const items = inventory.items.filter((item) => selected === null || selected.has(item.candidateKey))
	if (items.length === 0) throw new Error('Choose at least one skill for your library')
  const selectedKeysSet = new Set(items.map((item) => item.candidateKey))
  const unresolved = inventory.collisions.filter((collision) => collision.candidateKeys.filter((key) => selectedKeysSet.has(key)).length > 1)
  if (unresolved.length > 0) {
		throw new Error(`Resolve ${unresolved.length} same-name skill collision(s) before creating this library`)
  }
  const skillsCliEntries = readSkillsCliLock()?.skills ?? []
	const provenance = readProvenance()
  const unresolvedSources: UnresolvedSyncCenterSource[] = []
  const candidates = (await mapWithConcurrency(items, 8, async (item): Promise<SyncPublishCandidate | null> => {
    const installationAgentSlugs = item.locations.flatMap((location) => location.agentSlug ? [location.agentSlug] : [])
    const skillsCliEntry = skillsCliEntryForInventoryItem(item, skillsCliEntries)
    if (skillsCliEntry) {
      const skillPath = skillsCliSkillDirectory(skillsCliEntry)
      const sourceUrl = skillsCliEntry.source_url.trim()
      if (!sourceUrl || !skillPath) {
        throw new Error(`The skills.sh entry for ${item.displayName} has incomplete source information and cannot be backed up safely.`)
      }
      try {
        return {
          kind: 'skills_sh' as const,
          id: item.candidateKey,
          sourceUrl,
          ref: await resolveSkillsCliCommit(skillsCliEntry),
          skillPath,
			contentHash: item.contentHash,
          installationAgentSlugs,
        }
      } catch {
        unresolvedSources.push({ id: item.candidateKey, kind: 'skills_sh' })
        return null
      }
    }
		const git = provenanceEntryForInventoryItem(item, provenance)
		if (git?.repository?.trim()) {
			const repository = git.repository.trim()
			let ref: string
			try {
				ref = await resolveGitCommitCached(repository, git.ref?.trim() || 'HEAD')
			} catch {
				unresolvedSources.push({ id: item.candidateKey, kind: git.source === 'skills.sh' ? 'skills_sh' : 'reference' })
				return null
			}
			const skillPath = externalSkillDirectory(git.skill_path)
			if (git.source === 'skills.sh') {
				return { kind: 'skills_sh' as const, id: item.candidateKey, sourceUrl: repository, ref, skillPath, contentHash: item.contentHash, installationAgentSlugs }
			}
			return { kind: 'reference' as const, id: item.candidateKey, repository, ref, skillPath, contentHash: item.contentHash, installationAgentSlugs }
		}
    return { kind: 'bundled' as const, id: item.candidateKey, sourcePath: item.sourcePath, installationAgentSlugs }
  })).filter((candidate): candidate is SyncPublishCandidate => candidate !== null)
  if (candidates.length === 0) throw new Error('No selected skills can be pinned safely. Connect or authenticate to their Git sources, then retry.')
  return { plan: createSyncPublishPlan('agent-library', 'private', candidates), unresolvedSources }
}

function syncPublishPlanToJson(plan: ReturnType<typeof createSyncPublishPlan>, unresolvedSources: UnresolvedSyncCenterSource[] = []): SyncPublishPreviewJson {
  return {
    profile_id: plan.manifest.profile.id,
    mode: plan.manifest.profile.mode,
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
    skills_sh: plan.manifest.skills
      .filter((skill): skill is Extract<typeof skill, { kind: 'skills_sh' }> => skill.kind === 'skills_sh')
      .map((skill) => ({ id: skill.id, source_url: skill.source_url, ref: skill.ref, skill_path: skill.skill_path })),
    unresolved_sources: unresolvedSources,
  }
}

function externalRestoreAction(skill: ManagedExternalSkill, agents: AgentConfig[]): ExternalRestoreAction {
	let sourcePath: string
	try {
		sourcePath = resolveSkillSourcePath(skill.id, agents)
	} catch {
		return 'create'
	}
	let localContentHash: string | null = null
	if (skill.sha256) {
		try {
			localContentHash = planBundledSkillExport(skill.id, sourcePath).sha256
		} catch {
			// A managed external skill with a now-unreadable/symlinked local tree
			// must be reviewed, never treated as an untouched exact copy.
			return 'conflict'
		}
	}
	return classifyExternalRestore(skill, true, readProvenance()[skill.id], localContentHash)
}

function externalReviewAction(
	skill: ManagedExternalSkill,
	agents: AgentConfig[],
	externalKeptSources: Record<string, { repository: string; ref: string }> | undefined,
): ExternalRestoreAction | 'kept-local' {
	const action = externalRestoreAction(skill, agents)
	if (action === 'conflict' && externalKeptSourceMatches(skill, externalKeptSources?.[skill.id])) return 'kept-local'
	return action
}

async function prepareManagedExternalSkill(
	skill: ManagedExternalSkill,
	agents: AgentConfig[],
	fallbackTargets: string[],
): Promise<{ skill: ManagedExternalSkill; prepared: PreparedGitSkillInstall; targets: string[] } | null> {
	const action = externalRestoreAction(skill, agents)
	if (action === 'unchanged') return null
	if (action === 'conflict') {
		throw new Error(`Local skill ${skill.id} is not the pinned version in this library. Review it before replacing anything.`)
	}
	const targets = skill.installations?.filter((slug) => agents.some((agent) => agent.slug === slug && agent.detected)) ?? fallbackTargets
	return {
		skill,
		targets,
		prepared: await prepareGitSkillInstall(externalSkillRepository(skill), skill.skill_path, skill.ref, skill.id, skill.sha256),
	}
}

async function applyReviewedRemoteChanges(profileId: string, ids: string[], rpc: BunSideRpc, allowConflict = false): Promise<{ restored: string[] }> {
  assertSyncStableId(profileId)
  const skillIds = selectedSyncSkillIds(ids)
  if (!hasSyncWorkspace(profileId)) throw new Error('This library has not been set up on this computer')
  const workspace = syncWorkspacePath(profileId)
  const status = await getSyncWorkspaceStatus(workspace)
  if (!status.remoteUrl || status.changed) throw new Error('Sync workspace must be clean and connected before applying remote changes')
  await fetchSyncWorkspace(workspace)
  await fastForwardSyncWorkspace(workspace)
  const plan = createSyncRestorePlan(workspace, sharedSkillsDir())
  const ledger = readSyncLedger(profileId)
  const entries = new Map(plan.entries.map((entry) => [entry.id, entry]))
	const agents = loadDetectedAgents('sync_apply_remote_changes')
	const externalSkills = new Map(plan.manifest.skills
		.filter((skill): skill is ManagedExternalSkill => skill.kind === 'reference' || skill.kind === 'skills_sh')
		.map((skill) => [skill.id, skill]))
  for (const id of skillIds) {
    const entry = entries.get(id)
		if (!entry) {
			const external = externalSkills.get(id)
			if (!external) throw new Error(`Remote skill is not available: ${id}`)
			if (externalRestoreAction(external, agents) !== 'create') {
				throw new Error(`External skill ${id} must be resolved manually before it can be installed.`)
			}
			continue
		}
    const action = classifyThreeWaySkill(id, ledger?.skills[id]?.sha256 ?? null, entry.localSha256, entry.remoteSha256, ledger?.skills[id]?.kept_remote_sha256).action
	if (action !== 'take-remote' && !(allowConflict && action === 'conflict')) throw new Error(`Remote change must be resolved manually: ${id}`)
  }
	const fallbackTargets = plan.manifest.agent_policy.mode === 'selected'
		? plan.manifest.agent_policy.agent_slugs.filter((slug) => agents.some((agent) => agent.slug === slug && agent.detected))
		: agents.filter((agent) => agent.detected).map((agent) => agent.slug)
	const preparedExternal: { skill: ManagedExternalSkill; prepared: PreparedGitSkillInstall; targets: string[] }[] = []
	try {
		for (const id of skillIds.filter((id) => externalSkills.has(id))) {
			const prepared = await prepareManagedExternalSkill(externalSkills.get(id)!, agents, fallbackTargets)
			if (prepared) preparedExternal.push(prepared)
		}
		applySyncRestorePlan(plan, skillIds.filter((id) => entries.has(id)), profileId)
		const manifestSkills = new Map(plan.manifest.skills.filter((skill) => skill.kind === 'bundled').map((skill) => [skill.id, skill]))
		for (const id of skillIds.filter((id) => entries.has(id))) {
			const skill = manifestSkills.get(id)
			// v1 manifests without per-skill routing retain the old, explicit
			// profile policy. New Sync Center profiles always carry installations.
			const targets = skill?.installations
				? skill.installations.filter((slug) => agents.some((agent) => agent.slug === slug && agent.detected))
				: agents.filter((agent) => agent.detected).map((agent) => agent.slug)
			if (targets.length > 0) installSkillFromPath(join(sharedSkillsDir(), id), targets, agents, id)
		}
		for (const entry of preparedExternal) {
			installPreparedGitSkill(entry.prepared, entry.targets, agents, entry.skill.kind === 'skills_sh' ? 'skills.sh' : 'sync-reference')
		}
		const nextSkills = new Map(Object.entries(ledger?.skills ?? {}).map(([id, entry]) => [id, { sha256: entry.sha256, keptRemoteSha256: entry.kept_remote_sha256 }]))
		for (const id of skillIds.filter((id) => entries.has(id))) nextSkills.set(id, { sha256: entries.get(id)!.remoteSha256, keptRemoteSha256: undefined })
		writeSyncLedgerAt(syncLedgerPath(profileId), makeSyncLedger(profileId, [...nextSkills.entries()].map(([id, entry]) => ({ id, ...entry })), ledger?.external_kept_sources))
		rpc.send('skills_changed')
		return { restored: skillIds }
	} finally {
		for (const entry of preparedExternal) discardPreparedGitSkill(entry.prepared)
	}
}

/**
 * Explicitly publishes only entries that changed locally while the remote
 * stayed at the last applied base. The current remote manifest is retained
 * verbatim for every other skill, so a granular publish cannot erase a
 * colleague's unrelated addition.
 */
async function publishReviewedLocalChanges(profileId: string, ids: string[]): Promise<{ commit: string | null; pushed: boolean }> {
  assertSyncStableId(profileId)
  const skillIds = selectedSyncSkillIds(ids)
  if (!hasSyncWorkspace(profileId)) throw new Error('This library has not been set up on this computer')
  const workspace = syncWorkspacePath(profileId)
  let status = await getSyncWorkspaceStatus(workspace)
  if (!status.remoteUrl || status.changed) throw new Error('Sync workspace must be clean and connected before publishing local changes')
  await fetchSyncWorkspace(workspace)
  await fastForwardSyncWorkspace(workspace)
  const restore = createSyncRestorePlan(workspace, sharedSkillsDir())
  const existing = restore.manifest
  const ledger = readSyncLedger(profileId)
  const entries = new Map(restore.entries.map((entry) => [entry.id, entry]))
  const existingBundled = new Map(existing.skills.filter((skill) => skill.kind === 'bundled').map((skill) => [skill.id, skill]))
  const candidates: SyncPublishCandidate[] = []
  for (const id of skillIds) {
    const entry = entries.get(id)
    const current = existingBundled.get(id)
    if (!entry || !current || entry.localSha256 === null) throw new Error(`Local skill is not available: ${id}`)
    const action = classifyThreeWaySkill(id, ledger?.skills[id]?.sha256 ?? null, entry.localSha256, entry.remoteSha256, ledger?.skills[id]?.kept_remote_sha256).action
    if (action !== 'publish-local') throw new Error(`Local change must be resolved manually: ${id}`)
    candidates.push({ id, sourcePath: entry.targetPath, installationAgentSlugs: current.installations })
  }
  const update = createSyncPublishPlan(profileId, existing.profile.mode, candidates, existing.agent_policy)
	const publishedBundles = new Map(update.manifest.skills.filter((skill) => skill.kind === 'bundled').map((skill) => [skill.id, skill]))
	const merged = mergeBundledUpdateIntoManifest(existing, update)
	if (isCanonicalSyncLibrary(workspace)) {
		const canonical = await planCanonicalSyncLibrary(workspace, merged)
		applySyncPublishFiles(workspace, merged, canonical.portableFiles)
	} else {
		applySyncPublishPlan(workspace, merged)
	}
  const commit = await commitSyncWorkspace(workspace, 'Skiller sync: publish reviewed local changes')
  await pushSyncWorkspace(workspace)
	const nextSkills = new Map(Object.entries(ledger?.skills ?? {}).map(([id, entry]) => [id, { sha256: entry.sha256, keptRemoteSha256: entry.kept_remote_sha256 }]))
  for (const id of skillIds) nextSkills.set(id, { sha256: publishedBundles.get(id)!.sha256, keptRemoteSha256: undefined })
  writeSyncLedgerAt(syncLedgerPath(profileId), makeSyncLedger(profileId, [...nextSkills.entries()].map(([id, entry]) => ({ id, ...entry })), ledger?.external_kept_sources))
  return { commit, pushed: true }
}

/** Record a reviewed local-over-remote choice without changing either tree. */
async function keepReviewedLocalChanges(profileId: string, ids: string[]): Promise<{ kept: string[] }> {
  assertSyncStableId(profileId)
  const skillIds = selectedSyncSkillIds(ids)
  if (!hasSyncWorkspace(profileId)) throw new Error('This library has not been set up on this computer')
  const workspace = syncWorkspacePath(profileId)
  const status = await getSyncWorkspaceStatus(workspace)
  if (!status.remoteUrl || status.changed) throw new Error('Sync workspace must be clean and connected before keeping local changes')
  await fetchSyncWorkspace(workspace)
  await fastForwardSyncWorkspace(workspace)
  const restore = createSyncRestorePlan(workspace, sharedSkillsDir())
  const ledger = readSyncLedger(profileId)
  const entries = new Map(restore.entries.map((entry) => [entry.id, entry]))
  const nextSkills = new Map(Object.entries(ledger?.skills ?? {}).map(([id, entry]) => [id, { sha256: entry.sha256, keptRemoteSha256: entry.kept_remote_sha256 }]))
  for (const id of skillIds) {
    const entry = entries.get(id)
    if (!entry || entry.localSha256 === null) throw new Error(`Local skill is not available: ${id}`)
    const action = classifyThreeWaySkill(id, ledger?.skills[id]?.sha256 ?? null, entry.localSha256, entry.remoteSha256, ledger?.skills[id]?.kept_remote_sha256).action
    if (action !== 'conflict' && action !== 'unmanaged') throw new Error(`Local change does not need this decision: ${id}`)
    nextSkills.set(id, { sha256: ledger?.skills[id]?.sha256 ?? entry.localSha256, keptRemoteSha256: entry.remoteSha256 })
  }
  writeSyncLedgerAt(syncLedgerPath(profileId), makeSyncLedger(profileId, [...nextSkills.entries()].map(([id, entry]) => ({ id, ...entry })), ledger?.external_kept_sources))
  return { kept: skillIds }
}

/**
 * Persist a per-device decision to leave an external skill alone. This never
 * mutates the skill or remote library. The decision is scoped to its exact
 * repository + commit, so a later remote pin forces the user to review again.
 */
async function keepReviewedExternalChanges(profileId: string, ids: string[]): Promise<{ kept: string[] }> {
	assertSyncStableId(profileId)
	const skillIds = selectedSyncSkillIds(ids)
	if (!hasSyncWorkspace(profileId)) throw new Error('This library has not been set up on this computer')
	const workspace = syncWorkspacePath(profileId)
	const status = await getSyncWorkspaceStatus(workspace)
	if (!status.remoteUrl || status.changed) throw new Error('Sync workspace must be clean and connected before keeping a local skill')
	await fetchSyncWorkspace(workspace)
	await fastForwardSyncWorkspace(workspace)
	const restore = createSyncRestorePlan(workspace, sharedSkillsDir())
	const ledger = readSyncLedger(profileId)
	const agents = loadDetectedAgents('sync_keep_external_local_changes')
	const externalSkills = new Map(restore.manifest.skills
		.filter((skill): skill is ManagedExternalSkill => skill.kind === 'reference' || skill.kind === 'skills_sh')
		.map((skill) => [skill.id, skill]))
	const nextKeptSources = { ...(ledger?.external_kept_sources ?? {}) }
	for (const id of skillIds) {
		const skill = externalSkills.get(id)
		if (!skill) throw new Error(`External skill is not available: ${id}`)
		if (externalReviewAction(skill, agents, ledger?.external_kept_sources) !== 'conflict') {
			throw new Error(`External skill does not need this decision: ${id}`)
		}
		nextKeptSources[id] = { repository: externalSkillRepository(skill), ref: skill.ref }
	}
	writeSyncLedgerAt(
		syncLedgerPath(profileId),
		makeSyncLedger(profileId, Object.entries(ledger?.skills ?? {}).map(([id, entry]) => ({
			id,
			sha256: entry.sha256,
			keptRemoteSha256: entry.kept_remote_sha256,
		})), nextKeptSources),
	)
	return { kept: skillIds }
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
    dotagent_machine_inventory: async (): Promise<DotagentMachineInventoryJson> => {
      const inventory = await scanDotagentMachine(loadAgentConfigs(getAgentsDir()))
      return dotagentMachineToJson(inventory)
    },
    dotagent_doctor: async (params: { libraryRoot: string }): Promise<DotagentDoctorJson> => {
      const configs = loadAgentConfigs(getAgentsDir())
      return dotagentDoctorToJson(await doctorLibrary({
        root: params.libraryRoot,
        descriptors: dotagentDescriptorsFromSkiller(configs),
        platform: process.platform as 'darwin' | 'linux' | 'win32',
        home: homedir(),
      }))
    },
    dotagent_materialization_status: async (params: { libraryRoot: string }): Promise<DotagentMaterializationStatusJson> =>
      dotagentStatusToJson(await getMaterializationStatus(params.libraryRoot)),
    dotagent_skill_discovery: async (): Promise<DotagentSkillDiscoveryJson> => {
      const discovery = await scanDotagentSkillDiscovery(loadDetectedAgents('dotagent_skill_discovery'))
      return dotagentDiscoveryToJson(discovery.report, discovery.suggestions)
    },
    dotagent_audit: async (params: { libraryRoot: string; visibility: 'private' | 'team' | 'public' }): Promise<DotagentAuditJson> =>
      dotagentAuditToJson(await auditLibrary({ root: params.libraryRoot, visibility: params.visibility })),
    dotagent_import_plan: async (params: { libraryRoot: string; decisions: DotagentImportDecision[] }): Promise<DotagentImportPlanJson> =>
      dotagentImportPlanToJson(await planDotagentImportFromDiscovery(
        params.libraryRoot,
        loadDetectedAgents('dotagent_import_plan'),
        params.decisions,
      )),
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
	refresh_sync_profiles: async (): Promise<SyncProfileStatusJson[]> => listSyncProfiles(true),
    scan_sync_inventory: async (): Promise<SyncInventoryJson> => syncInventoryToJson(),
		get_sync_skill_preview: async (params: { skillId: string }): Promise<SyncSkillPreviewJson> => syncSkillPreviewToJson(params.skillId),
    sync_center_publish_preview: async (params?: { selectedKeys?: string[] }): Promise<SyncPublishPreviewJson> => {
      const result = await createSyncCenterPublishPlan(params?.selectedKeys)
      return syncPublishPlanToJson(result.plan, result.unresolvedSources)
    },
    sync_center_publish: async (params: { remoteUrl: string; selectedKeys?: string[] }) => {
      const remoteUrl = params.remoteUrl.trim()
      if (!remoteUrl) throw new Error('A Git remote is required')
      assertCredentialFreeGitRemote(remoteUrl)
      const profileId = 'agent-library'
      const workspace = syncWorkspacePath(profileId)
      const existingWorkspace = hasSyncWorkspace(profileId)
      if (existingWorkspace) {
        const status = await getSyncWorkspaceStatus(workspace)
        if (status.changed) throw new Error('Sync workspace has uncommitted changes; resolve them before publishing')
			if (status.remoteUrl && status.remoteUrl !== remoteUrl) throw new Error('This library already uses a different remote')
        if (!status.remoteUrl) await setSyncWorkspaceRemote(workspace, remoteUrl)
      }
		const publishPlan = await createSyncCenterPublishPlan(params.selectedKeys)
		if (existingWorkspace && !isCanonicalSyncLibrary(workspace)) {
			// Existing libraries retain their versioned legacy format until the user
			// explicitly migrates; newly created libraries are canonical dotagent.
			applySyncPublishPlan(workspace, publishPlan.plan)
		} else {
			const canonical = await planCanonicalSyncLibrary(workspace, publishPlan.plan)
			applySyncPublishFiles(workspace, publishPlan.plan, canonical.portableFiles)
			if (!existingWorkspace) await initializeSyncWorkspace(workspace, remoteUrl)
		}
		  const commit = await commitSyncWorkspace(workspace, 'Skiller sync: update skill library')
      await pushSyncWorkspace(workspace)
      writeSyncLedgerAt(
        syncLedgerPath(profileId),
        makeSyncLedger(profileId, publishPlan.plan.manifest.skills
          .filter((skill): skill is Extract<typeof skill, { kind: 'bundled' }> => skill.kind === 'bundled')
			.map((skill) => ({ id: skill.id, sha256: skill.sha256 })), readSyncLedger(profileId)?.external_kept_sources),
      )
      return { commit, pushed: true }
    },
    sync_three_way_review: async (params: { profileId: string }): Promise<SyncThreeWayReviewJson> => {
      assertSyncStableId(params.profileId)
      if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
      const workspace = syncWorkspacePath(params.profileId)
      const status = await getSyncWorkspaceStatus(workspace)
      if (!status.remoteUrl) throw new Error('This library has no Git remote')
      if (status.changed) throw new Error('Sync workspace has uncommitted changes; resolve them before reviewing')
      await fetchSyncWorkspace(workspace)
      await fastForwardSyncWorkspace(workspace)
      const restore = createSyncRestorePlan(workspace, sharedSkillsDir())
      const ledger = readSyncLedger(params.profileId)
		const agents = loadDetectedAgents('sync_three_way_review')
		const externalSkills = restore.manifest.skills.filter((skill): skill is ManagedExternalSkill => skill.kind === 'reference' || skill.kind === 'skills_sh')
      return {
        profile_id: params.profileId,
			skills: [
			...restore.entries.map((entry) => ({
				id: entry.id,
				kind: 'bundled' as const,
				action: classifyThreeWaySkill(entry.id, ledger?.skills[entry.id]?.sha256 ?? null, entry.localSha256, entry.remoteSha256, ledger?.skills[entry.id]?.kept_remote_sha256).action,
			})),
			...externalSkills.map((skill) => {
				const externalAction = externalReviewAction(skill, agents, ledger?.external_kept_sources)
				return {
					id: skill.id,
					kind: skill.kind,
					action: externalAction === 'create'
						? 'take-remote' as const
						: externalAction === 'conflict'
							? 'conflict' as const
							: externalAction === 'kept-local'
								? 'kept-local' as const
								: 'unchanged' as const,
					source: { repository: externalSkillRepository(skill), ref: skill.ref },
				}
			}),
			],
      }
    },
    sync_apply_remote_changes: async (params: { profileId: string; skillIds: string[] }) => applyReviewedRemoteChanges(params.profileId, params.skillIds, rpc),
	 sync_apply_conflicting_remote_changes: async (params: { profileId: string; skillIds: string[] }) => applyReviewedRemoteChanges(params.profileId, params.skillIds, rpc, true),
	 sync_publish_local_changes: async (params: { profileId: string; skillIds: string[] }) => publishReviewedLocalChanges(params.profileId, params.skillIds),
	 sync_keep_local_changes: async (params: { profileId: string; skillIds: string[] }) => keepReviewedLocalChanges(params.profileId, params.skillIds),
	 sync_keep_external_local_changes: async (params: { profileId: string; skillIds: string[] }) => keepReviewedExternalChanges(params.profileId, params.skillIds),
    sync_recovery_status: async (params: { profileId: string }) => {
      assertSyncStableId(params.profileId)
      return { pending: readRestoreJournalAt(syncJournalPath(params.profileId)) !== null }
    },
    sync_recovery_rollback: async (params: { profileId: string }) => {
      assertSyncStableId(params.profileId)
      return { recovered: recoverRestoreJournalAt(syncJournalPath(params.profileId)) }
    },
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

      const existingWorkspace = hasSyncWorkspace(params.profileId)
      if (existingWorkspace) {
        const status = await getSyncWorkspaceStatus(workspace)
        if (status.changed) throw new Error('Sync workspace has uncommitted changes; resolve them before publishing')
        if (remoteUrl && status.remoteUrl && status.remoteUrl !== remoteUrl) {
          throw new Error('This profile already uses a different remote; changing a remote is not implicit')
        }
        if (remoteUrl && !status.remoteUrl) await setSyncWorkspaceRemote(workspace, remoteUrl)
      }

      const { plan } = buildSyncPublishPreview(params.profileId, params.mode, skillIds, params.skillKinds, params.agentSlugs)
      if (existingWorkspace && !isCanonicalSyncLibrary(workspace)) {
		  applySyncPublishPlan(workspace, plan)
	  } else {
		  const canonical = await planCanonicalSyncLibrary(workspace, plan)
		  applySyncPublishFiles(workspace, plan, canonical.portableFiles)
		  if (!existingWorkspace) await initializeSyncWorkspace(workspace, remoteUrl)
	  }
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
      const manifest = readSyncManifestFromWorkspace(workspace)
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
		last_checked_at: new Date().toISOString(),
		check_error: null,
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
      const agents = loadDetectedAgents('sync_pull_preview')
	  const ledger = readSyncLedger(params.profileId)
      const externalSkills = plan.manifest.skills.filter((skill): skill is ManagedExternalSkill => skill.kind === 'reference' || skill.kind === 'skills_sh')
      return {
        profile_id: params.profileId,
        mode: plan.manifest.profile.mode,
        skills: [
          ...plan.entries.map((entry) => ({ id: entry.id, kind: 'bundled' as const, action: entry.action })),
          ...externalSkills
            .filter((skill): skill is Extract<ManagedExternalSkill, { kind: 'reference' }> => skill.kind === 'reference')
            .map((skill) => ({
              id: skill.id,
              kind: 'reference' as const,
			  action: externalReviewAction(skill, agents, ledger?.external_kept_sources),
              repository: skill.repository,
              ref: skill.ref,
            })),
          ...externalSkills
            .filter((skill): skill is Extract<ManagedExternalSkill, { kind: 'skills_sh' }> => skill.kind === 'skills_sh')
            .map((skill) => ({
              id: skill.id,
              kind: 'skills_sh' as const,
			  action: externalReviewAction(skill, agents, ledger?.external_kept_sources),
              repository: skill.source_url,
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
      const skillsShSkills = plan.manifest.skills
        .filter((skill): skill is Extract<typeof skill, { kind: 'skills_sh' }> => skill.kind === 'skills_sh')
      const available = new Set([
        ...plan.entries.map((entry) => entry.id),
        ...referenceSkills.map((skill) => skill.id),
        ...skillsShSkills.map((skill) => skill.id),
      ])
      for (const id of skillIds) if (!available.has(id)) throw new Error(`Skill is not present in this sync profile: ${id}`)
      const agents = loadDetectedAgents('sync_restore_apply')
      const targetAgentSlugs = plan.manifest.agent_policy.mode === 'selected'
        ? plan.manifest.agent_policy.agent_slugs.filter((slug) => agents.some((agent) => agent.slug === slug && agent.detected))
        : agents.filter((agent) => agent.detected).map((agent) => agent.slug)
		const selectedExternal = [...referenceSkills, ...skillsShSkills].filter((skill) => skillIds.includes(skill.id))
		const preparedExternal: { skill: ManagedExternalSkill; prepared: PreparedGitSkillInstall; targets: string[] }[] = []
		try {
			// Resolve every external source before applying a bundled restore. A
			// bad pin or unreachable source therefore leaves bundled skills alone.
			for (const skill of selectedExternal) {
				const prepared = await prepareManagedExternalSkill(skill, agents, targetAgentSlugs)
				if (prepared) preparedExternal.push(prepared)
			}
			applySyncRestorePlan(plan, skillIds.filter((id) => plan.entries.some((entry) => entry.id === id)), params.profileId)
			const bundledById = new Map(plan.manifest.skills
				.filter((skill): skill is Extract<typeof skill, { kind: 'bundled' }> => skill.kind === 'bundled')
				.map((skill) => [skill.id, skill]))
			for (const id of skillIds.filter((id) => plan.entries.some((entry) => entry.id === id))) {
				const skill = bundledById.get(id)
				const targets = skill?.installations?.filter((slug) => agents.some((agent) => agent.slug === slug && agent.detected)) ?? targetAgentSlugs
				installSkillFromPath(join(sharedSkillsDir(), id), targets, agents, id)
			}
			for (const entry of preparedExternal) {
				installPreparedGitSkill(entry.prepared, entry.targets, agents, entry.skill.kind === 'skills_sh' ? 'skills.sh' : 'sync-reference')
			}
			const previousLedger = readSyncLedger(params.profileId)
			const nextSkills = new Map(Object.entries(previousLedger?.skills ?? {}).map(([id, entry]) => [id, entry.sha256]))
			for (const entry of plan.entries.filter((entry) => skillIds.includes(entry.id))) {
				nextSkills.set(entry.id, entry.remoteSha256)
			}
			writeSyncLedgerAt(
				syncLedgerPath(params.profileId),
				makeSyncLedger(params.profileId, [...nextSkills.entries()].map(([id, sha256]) => ({ id, sha256 })), previousLedger?.external_kept_sources),
			)
			rpc.send('skills_changed')
			return { restored: skillIds, installed_to_detected_agents: targetAgentSlugs }
		} finally {
			for (const entry of preparedExternal) discardPreparedGitSkill(entry.prepared)
		}
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
		const agents = loadDetectedAgents()
		unlinkInheritedSkillFromAgentConfigs(params.skillId, agents, getAgentsDir())
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
		reveal_sync_secret_finding: async (params: { skillId: string; relativePath: string }) => {
			assertSyncStableId(params.skillId)
			assertPortableRelativePath(params.relativePath)
			const item = scanSyncInventory(loadDetectedAgents('reveal_sync_secret_finding')).items.find((candidate) => candidate.candidateKey === params.skillId)
			if (!item) throw new Error('This skill is no longer available locally')
			const filePath = join(item.sourcePath, params.relativePath)
			if (!existsSync(filePath)) throw new Error('This file is no longer available locally')
			platform.showItemInFolder(filePath)
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
