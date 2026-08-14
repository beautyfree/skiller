import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { basename, dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppPlatform } from '../shared/platform'
import type { AppRPCSchema } from '../shared/rpc-schema'
import type {
  MarketplaceSkillJson,
  DotagentsMachineInventoryJson,
  DotagentsDoctorJson,
  DotagentsMaterializationStatusJson,
  DotagentsSkillDiscoveryJson,
  DotagentsAuditJson,
  DotagentsImportPlanJson,
  SkillQualityOverviewJson,
  SkillQualityEvalPlanJson,
  SkillQualityEvalPreviewRequestJson,
  SkillQualityDryRunReportJson,
  SkillQualityMeasuredReportJson,
  RepoProgressJson,
  SkillJson,
  SkillRepoJson,
  SkillSourceParam,
  SyncProfileStatusJson,
	SyncRemoteTrustPreviewJson,
	SyncDisconnectPreviewJson,
  SyncInventoryJson,
	SyncSkillPreviewJson,
  SyncConnectPreviewJson,
  SyncGitDestinationPreviewJson,
  SyncGitHubRepositoryPreviewJson,
  SyncGitLabProjectPreviewJson,
  SyncProviderLibrariesResultJson,
  SyncThreeWayReviewJson,
	SyncConflictComparisonJson,
  SyncHistoryEntryJson,
  SyncLocalPublishPreviewJson,
  SyncUndoPreviewJson,
  DotagentsLibraryHealthJson,
  DotagentsLibraryRepairPreviewJson,
  DotagentsResourceOverviewJson,
  DotagentsLibraryLocalChangesJson,
  DotagentsLibraryLocalChangePreviewJson,
  DotagentsLibraryNewLocalPreviewJson,
  DotagentsLibraryRemovalPreviewJson,
  DotagentsResourceContentJson,
	SkillImprovementNoteJson,
  SyncPublishPreviewJson,
  SyncSourceReviewProgressJson,
  UpdateProgressJson,
  GlobalSkillUpdateCheckJson,
  GlobalSkillUpdateProgressJson,
  LinkedSkillPackageUpdateJson,
} from '../shared/rpc-schema'
import { detectAgents, loadAgentConfigs } from './registry'
import { detectRuntimeAgent } from './runtime-agent'
import { scanDotagentsMachine } from './dotagents-catalog'
import { dotagentsDescriptorsFromSkiller } from './dotagents-catalog'
import { planDotagentsImportFromDiscovery, scanDotagentsSkillDiscovery, type DotagentsImportDecision } from './dotagents-discovery'
import { dotagentsAuditToJson, dotagentsDiscoveryToJson, dotagentsDoctorToJson, dotagentsImportPlanToJson, dotagentsMachineToJson, dotagentsStatusToJson } from './dotagents-json'
import { doctorLibrary } from 'dotagents/doctor'
import { auditLibrary } from 'dotagents/audit'
import { getMaterializationStatus } from 'dotagents/status'
import { diffLibraryLocks, normalizeGitIdentity } from 'dotagents/sources'
import { parseImportDecisions, type ImportDecision, type ImportDisposition } from 'dotagents/decisions'
import { scanOwnedSkill } from 'dotagents/inventory'
import { markLocalSkillReviewed, observeLocalSkills, readLocalSkillSources, saveLocalSkillSource } from 'dotagents/source-registry'
import { applyReviewedManagedSkillUpdates, checkGlobalSkillUpdates, reviewGlobalSkillUpdate } from 'dotagents/global-skill-updates'
import { applyLinkedSkillPackageUpdate, discoverLinkedSkillPackages, planLinkedSkillPackageUpdate, type LinkedSkillPackageUpdate } from 'dotagents/linked-skill-package-updates'
import { addSkillImprovementNote, readSkillImprovementNotes } from 'dotagents/skill-evolution'
import { forkSkillToLibrary } from 'dotagents/skill-fork'
import { inspectLibraryUpdateRecovery, libraryUpdateJournalPath, planLibraryUpdate, applyLibraryUpdatePlan, recoverLibraryUpdate } from 'dotagents/library-update'
import { planCanonicalLibraryRemoval } from 'dotagents/library-removal'
import { classifyProviderFailure, computePlanId, finishGitHubDeviceAuthorization, finishGitLabDeviceAuthorization, GitDependencyResolver, NodeWorkspaceGitPort, ProviderOperationError, startGitHubDeviceAuthorization, startGitLabDeviceAuthorization, type GitRunner } from 'dotagents'
import { applyOperationUndo, listOperationHistory, planOperationUndo, readOperationHistory } from 'dotagents/history'
import {
  exactSourceSecurityPolicy,
  requireMinimumReleaseAge,
  requireTrustedSource,
  SourceReleaseAgeError,
  type SourceCommitAgeDecision,
  type SourceSecurityPolicy,
  type SourceTrustDecision,
} from 'dotagents/source-policy'
import { homedir } from 'node:os'
import { readSkillsCliLock, type SkillsCliLockEntry } from './skills-cli-lock'
import { getAgentsDir } from './paths'
import type { AgentConfig } from './types'
import type { SkillSource } from './skill-types'
import { classifySyncSourceFailure, describeSyncCheckFailure, type SyncSourceFailureReason } from './sync-source-failure'
import { isLibraryDocumentationOnlyUpdate, libraryDocumentationUpdatePlanId } from './sync-update-classification'
import { SyncProfileCheckStore } from './sync-profile-check-state'
import { applyReviewedSyncDisconnect, planSyncDisconnect } from './sync-disconnect'
import { scanAllSkills } from './scanner'
import { inspectSkillQualityOverview, skillQualityIdentity } from './skill-quality'
import { createSkillQualityEvalPlan, inspectLocalCredentialProfile, inspectLocalDockerImage } from './skill-quality-eval'
import { runSkillQualityDryPlan } from './skill-quality-dry-run'
import { runSkillQualityMeasuredPlan } from './skill-quality-measured-run'
import { LibraryRepairSession, readResourceLibraryContent, readResourceLibraryOverview } from './resource-library'
import { discardPreparedGitSkill, installPreparedGitSkill, installSkillFromGit, installSkillFromPath, prepareGitSkillInstall, type PreparedGitSkillInstall } from './install'
import {
  detachSharedSkill,
	unlinkInheritedSkillFromAgentConfigs,
  uninstallSkill,
  uninstallDirectSkillFromAll,
  uninstallSkillFromAll,
} from './uninstall'
import { appDataRootPath, readSettings, writeSettings } from './settings'
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
import { fetchSkillsShGatewaySnapshot, fileFromGatewaySnapshot, filesFromGatewaySnapshot } from './marketplace/skillssh-gateway'
import { installFromMarketplace } from './marketplace/install-from-marketplace'
import type { MarketplaceSkill } from './marketplace-types'
import {
  addLocalDir,
  addSkillRepo,
  installRepoSkill,
  listRepoSkillsAsJson,
  listSkillRepos,
	normalizeSkillRepoUrl,
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
import { scanSyncInventoryWithDotagents, syncInventoryRoots, type SyncInventoryItem } from './sync-inventory'
import { classifyLibraryLocalChanges } from './sync-library-local-changes'
import { planBundledSkillExport } from './sync-export'
import { buildBundledConflictComparison, previewBundledConflictFile, previewNewLocalBundleFile } from './sync-conflict-preview'
import { parseSkillMdFile } from './parser'
import { bootstrapSyncLedgerFromManifest, makeSyncLedger, readSyncLedger, recordSyncLedgerDeviceChoices, writeSyncLedgerAt, syncLedgerPath } from './sync-ledger'
import { readRestoreJournalAt, recoverRestoreJournalAt, syncJournalPath } from './sync-journal'
import { checkGitHubConnection, createGitHubSyncRepository, GITHUB_DEVICE_FLOW_CLIENT_ID, listGitHubSyncRepositories, planGitHubSyncRepository, preflightGitHubSyncRepository } from './github-sync'
import { checkGitLabConnection, createGitLabSyncProject, GITLAB_DEVICE_FLOW_CLIENT_ID, listGitLabSyncProjects, planGitLabSyncProject, preflightGitLabSyncProject } from './gitlab-sync'
import { githubGitEnvironment, gitlabGitEnvironment, readProviderToken, writeProviderToken } from './provider-credentials'
import { applySyncPublishFiles, createSyncPublishPlan, mergeBundledUpdateIntoManifest, type SyncPublishCandidate } from './sync-publish'
import { applySyncRestorePlan, createSyncRestorePlan, syncRestorePlanId } from './sync-restore'
import { canonicalSyncAgentRouting, clearLocalSyncLibraryExclusions, clearLocalSyncRecentlyAddedSkill, isCanonicalSyncLibrary, markLocalSyncSkillsRecentlyAdded, planCanonicalSyncLibrary, readCanonicalSyncLock, readLocalSyncLibraryExclusions, readLocalSyncRecentlyAddedSkills, readSyncManifestFromWorkspace, writeLocalSyncAgentSelection, writeLocalSyncLibraryExclusion, writeLocalSyncSourceSecurityPolicy } from './sync-dotagents'
import { withReviewTimeout } from './review-timeout'
import { classifyExternalRestore, externalKeptSourceMatches, externalSkillDirectory, externalSkillRepository, type ManagedExternalSkill, type ExternalRestoreAction } from './sync-external'
import { assertCredentialFreeGitRemote, assertPortableRelativePath, assertSyncStableId, syncProfileIdFromRemote, type SyncManifest } from './sync-profile'
import {
	applySyncWorkspaceRemoteTrust,
  assertSyncRemoteEmpty,
  applyReviewedSyncWorkspaceLocalPublish,
  applyReviewedSyncWorkspaceFastForward,
  commitSyncWorkspace,
  cloneSyncWorkspace,
  getSyncWorkspaceStatus,
  hasSyncWorkspace,
  initializeSyncWorkspace,
  inspectSyncWorkspaceFastForward,
  planSyncWorkspaceClone,
  planSyncWorkspaceFastForward,
  planSyncWorkspaceLocalPublish,
  pushSyncWorkspace,
  syncProfilesDirectory,
  syncWorkspacePath,
	refreshSyncWorkspaceStatus,
	inspectSyncWorkspaceRemoteTrust,
	planSyncWorkspaceRemoteTrust,
	SYNC_REMOTE_MINIMUM_RELEASE_AGE_MINUTES,
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
const libraryRepairSession = new LibraryRepairSession()
const LOCAL_LIBRARY_PLAN_TTL_MS = 15 * 60_000
const newLocalLibraryPlans = new Map<string, {
  profileId: string
  skills: Array<{ id: string; displayName: string; sourcePath: string; contentHash: string; installationAgentSlugs: string[] }>
  existingSkillIds: string[]
  sharedReview?: SyncCenterPublishPlanResult
  createdAt: number
}>()
const libraryRemovalPlans = new Map<string, {
  profileId: string
  skillId: string
  skillName: string
  removedPath: string
  portableFiles: Record<string, string>
  createdAt: number
}>()
// File switching in the library inspector must not rescan every global agent
// folder. Keep the path-bearing comparison context in the main process only,
// just long enough for a user to inspect adjacent files.
const LOCAL_CHANGE_PREVIEW_TTL_MS = 20_000
const localChangePreviewCache = new Map<string, {
  expiresAt: number
  response: DotagentsLibraryLocalChangePreviewJson
  localPath?: string
  libraryPath?: string
}>()
const LOCAL_INVENTORY_TTL_MS = 20_000
let localInventoryCache: {
  expiresAt: number
  inventory: Awaited<ReturnType<typeof scanSyncInventoryWithDotagents>>
  pending?: Promise<Awaited<ReturnType<typeof scanSyncInventoryWithDotagents>>>
} | null = null
async function readRecentLocalInventory(caller: string) {
  const now = Date.now()
  if (localInventoryCache && localInventoryCache.expiresAt > now) {
    if (localInventoryCache.pending) return localInventoryCache.pending
    return localInventoryCache.inventory
  }
  const pending = scanSyncInventoryWithDotagents(loadDetectedAgents(caller))
  localInventoryCache = { expiresAt: now + LOCAL_INVENTORY_TTL_MS, inventory: localInventoryCache?.inventory ?? { items: [], collisions: [], invalidPaths: 0, invalidEntries: [], linkedAliases: 0 }, pending }
  try {
    const inventory = await pending
    localInventoryCache = { expiresAt: Date.now() + LOCAL_INVENTORY_TTL_MS, inventory }
    return inventory
  } catch (error) {
    localInventoryCache = null
    throw error
  }
}

function pruneNewLocalLibraryPlans(): void {
  const oldest = Date.now() - LOCAL_LIBRARY_PLAN_TTL_MS
  for (const [planId, plan] of newLocalLibraryPlans) if (plan.createdAt < oldest) newLocalLibraryPlans.delete(planId)
  for (const [planId, plan] of libraryRemovalPlans) if (plan.createdAt < oldest) libraryRemovalPlans.delete(planId)
}

export type BunSideRpc = {
  send: (
    name: keyof AppRPCSchema['bun']['messages'],
    payload?:
      | UpdateProgressJson
      | GlobalSkillUpdateProgressJson
      | RepoProgressJson
      | { macosWindowBlur: boolean }
      | { active: boolean }
      | { baseUrl: string; token: string }
      | { path: string }
      | SyncSourceReviewProgressJson
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

function secretAcknowledgementKey(input: { skillId: string; contentHash: string; rule: string; relativePath: string; line: number }): string {
  // Deliberately hash only stable metadata plus the complete skill content
  // hash. The acknowledgement never stores, transmits, or reveals a matched
  // secret value; changing the skill invalidates the acknowledgement.
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

function secretFindingsForLibraryReview(
  skills: Array<{ id: string; contentHash: string }>,
  findings: Array<{ skill_id: string; rule: string; relative_path: string; line: number; column: number }>,
  acknowledged: Record<string, { acknowledged_at: string }> | undefined,
) {
  const hashBySkillId = new Map(skills.map((skill) => [skill.id, skill.contentHash]))
  return findings.map((finding) => {
    const contentHash = hashBySkillId.get(finding.skill_id) ?? ''
    const acknowledgementKey = secretAcknowledgementKey({ skillId: finding.skill_id, contentHash, rule: finding.rule, relativePath: finding.relative_path, line: finding.line })
    return { ...finding, acknowledgement_key: acknowledgementKey, acknowledged: Boolean(acknowledged?.[acknowledgementKey]) }
  })
}

function selectedDetectedAgentSlugs(value: unknown, agents: AgentConfig[]): string[] {
  if (!Array.isArray(value)) throw new Error('agentSlugs must be an array')
  const selected = [...new Set(value)]
  for (const slug of selected) {
    if (typeof slug !== 'string') throw new Error('agentSlugs must contain only strings')
    assertSyncStableId(slug)
    if (!agents.some((agent) => agent.slug === slug && agent.detected)) {
      throw new Error(`Selected sync agent is not detected: ${slug}`)
    }
  }
  return (selected as string[]).sort()
}

function syncRestoreAgentRouting(
  workspace: string,
  manifest: SyncManifest,
  agents: AgentConfig[],
): { forSkill: (skillId: string) => string[] } {
  const detected = agents.filter((agent) => agent.detected).map((agent) => agent.slug)
  const canonical = canonicalSyncAgentRouting(workspace, detected)
  if (canonical) return { forSkill: canonical.forSkill }
  const fallback = manifest.agent_policy.mode === 'selected'
    ? manifest.agent_policy.agent_slugs.filter((slug) => detected.includes(slug))
    : detected
  const byId = new Map(manifest.skills.map((skill) => [skill.id, skill]))
  return {
    forSkill: (skillId) => byId.get(skillId)?.installations?.filter((slug) => detected.includes(slug)) ?? fallback,
  }
}

function availableSyncProfileId(remoteUrl: string): string {
  const base = syncProfileIdFromRemote(remoteUrl)
  for (let index = 1; index <= 99; index += 1) {
    const candidate = index === 1 ? base : `${base.slice(0, 60 - String(index).length)}-${index}`
    if (!existsSync(syncWorkspacePath(candidate))) return candidate
  }
  throw new Error('Too many local libraries use this repository name')
}

function rememberActiveSyncProfile(profileId: string): void {
	assertSyncStableId(profileId)
	if (!hasSyncWorkspace(profileId)) throw new Error('This library is not connected on this computer')
	writeSettings({ ...readSettings(), active_sync_profile_id: profileId })
}

function replaceActiveSyncProfile(profileId: string | null): void {
	const { active_sync_profile_id: _previous, ...settings } = readSettings()
	writeSettings(profileId ? { ...settings, active_sync_profile_id: profileId } : settings)
}

async function createSyncDisconnectReview(profileId: string) {
	assertSyncStableId(profileId)
	if (!hasSyncWorkspace(profileId)) throw new Error('This library is not connected on this computer')
	const workspace = syncWorkspacePath(profileId)
	const [status, restorePending] = await Promise.all([
		getSyncWorkspaceStatus(workspace),
		Promise.resolve(readRestoreJournalAt(syncJournalPath(profileId)) !== null),
	])
	const updatePending = inspectLibraryUpdateRecovery(libraryUpdateJournalPath(workspace)) !== null
	return planSyncDisconnect({
		profileId,
		remoteIdentity: status.remoteUrl ? normalizeGitIdentity(status.remoteUrl) : null,
		changed: status.changed,
		ahead: status.ahead,
		recoveryPending: restorePending || updatePending,
	})
}

type SyncCenterConnectPlan = SyncConnectPreviewJson & { clone_plan_id: string }

async function planSyncCenterConnection(params: {
  profileId?: string
  remoteUrl: string
  agentSlugs: string[]
  minimumReleaseAgeMinutes: number
}, signal?: AbortSignal): Promise<SyncCenterConnectPlan> {
  const remoteUrl = params.remoteUrl.trim()
  if (!remoteUrl) throw new Error('Enter the Git repository that contains your library')
  assertCredentialFreeGitRemote(remoteUrl)
  const profileId = params.profileId ?? availableSyncProfileId(remoteUrl)
  assertSyncStableId(profileId)
  const agentSlugs = selectedDetectedAgentSlugs(params.agentSlugs, loadDetectedAgents('sync_center_connect_preview'))
  const sourcePolicy = reviewedRemoteSourcePolicy(remoteUrl, params.minimumReleaseAgeMinutes)
  const transport = await gitTransportForRemote(remoteUrl)
  const clone = await planSyncWorkspaceClone(remoteUrl, syncWorkspacePath(profileId), sourcePolicy, signal, transport?.port)
  const payload = {
    kind: 'skiller-sync-connect' as const,
    schemaVersion: 2 as const,
    profileId,
    clonePlanId: clone.planId,
    agentSlugs,
    sourcePolicy,
  }
  return {
    profile_id: profileId,
    plan_id: computePlanId(payload),
    remote_identity: clone.remoteIdentity,
    resolved_commit: clone.resolvedCommit,
    committed_at: clone.committedAt,
    minimum_release_age_minutes: clone.minimumAgeMinutes,
    agent_slugs: agentSlugs,
    clone_plan_id: clone.planId,
  }
}

async function cloneSyncProfile(params: {
  profileId: string
  remoteUrl: string
  agentSlugs?: string[]
  clonePlanId?: string
  minimumReleaseAgeMinutes: number
}, signal?: AbortSignal): Promise<SyncProfileStatusJson> {
  assertSyncStableId(params.profileId)
  const remoteUrl = params.remoteUrl.trim()
  if (!remoteUrl) throw new Error('A Git remote is required')
  assertCredentialFreeGitRemote(remoteUrl)
  const workspace = syncWorkspacePath(params.profileId)
  if (hasSyncWorkspace(params.profileId) || existsSync(workspace)) {
    throw new Error('This library already has a local workspace; connecting again would overwrite it')
  }
  const agents = loadDetectedAgents('sync_center_connect')
  const localAgentSlugs = params.agentSlugs === undefined
    ? undefined
    : selectedDetectedAgentSlugs(params.agentSlugs, agents)
  try {
	const transport = await gitTransportForRemote(remoteUrl)
    await cloneSyncWorkspace(
      remoteUrl,
      workspace,
      reviewedRemoteSourcePolicy(remoteUrl, params.minimumReleaseAgeMinutes),
      params.clonePlanId,
	  signal,
	  transport?.port,
    )
    if (!isCanonicalSyncLibrary(workspace)) {
      throw new Error('This library uses an unsupported legacy format. Recreate or migrate it with dotagents before connecting.')
    }
    const manifest = readSyncManifestFromWorkspace(workspace)
    if (localAgentSlugs !== undefined) {
      writeLocalSyncAgentSelection(workspace, localAgentSlugs)
    }
    const status = await getSyncWorkspaceStatus(workspace)
    return {
      profile_id: params.profileId,
      mode: manifest.profile.mode,
      skill_count: manifest.skills.length,
	  device_choice_count: 0,
      remote_url: status.remoteUrl,
      remote_identity: status.remoteUrl ? normalizeGitIdentity(status.remoteUrl) : null,
      branch: status.branch,
      changed: status.changed,
      ahead: status.ahead,
      behind: status.behind,
      last_checked_at: new Date().toISOString(),
      check_error: null,
		check_error_kind: null,
	  remote_trust_required: false,
    }
  } catch (error) {
    // The destination was proven absent above and belongs solely to this
    // failed clone attempt, so removing it cannot touch an existing profile.
    rmSync(workspace, { recursive: true, force: true })
    throw error
  }
}

/**
 * A profile listing must not erase the result of the background Git check.
 * This stays device-local and contains only safe presentation state, never
 * credentials or raw Git output.
 */
const syncProfileCheckStates = new SyncProfileCheckStore()

async function listSyncProfiles(refreshRemote = false, signal?: AbortSignal): Promise<SyncProfileStatusJson[]> {
  const directory = syncProfilesDirectory()
  if (!existsSync(directory)) {
	syncProfileCheckStates.clear()
	return []
  }
	const profileIds = readdirSync(directory).sort().filter((profileId) => {
    try {
      assertSyncStableId(profileId)
			return hasSyncWorkspace(profileId)
		} catch {
			return false
		}
	})
	const discoveredProfileIds = new Set(profileIds)
	const inspected = await mapWithConcurrency(profileIds, 4, async (profileId): Promise<SyncProfileStatusJson | null> => {
		try {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Check cancelled', 'AbortError')
      const workspace = syncWorkspacePath(profileId)
	  const manifest = readSyncManifestFromWorkspace(workspace)
	  const ledger = readSyncLedger(profileId)
	  const deviceChoiceCount = Object.values(ledger?.skills ?? {}).filter((entry) => Boolean(entry.kept_remote_sha256)).length
		+ Object.keys(ledger?.external_kept_sources ?? {}).length
	  let status = await getSyncWorkspaceStatus(workspace)
	  const previousCheck = syncProfileCheckStates.get(profileId)
	  let checkError = previousCheck?.check_error ?? null
	  let checkErrorKind = previousCheck?.check_error_kind ?? null
	  let checkedAt = previousCheck?.last_checked_at ?? null
	  const remoteTrust = await inspectSyncWorkspaceRemoteTrust(workspace)
	  if (refreshRemote && status.remoteUrl) {
		if (remoteTrust.required) {
		  checkedAt = null
		  checkError = null
		  checkErrorKind = null
		  syncProfileCheckStates.forget(profileId)
		} else {
		try {
		  const transport = await gitTransportForRemote(status.remoteUrl)
		  await refreshSyncWorkspaceStatus(workspace, transport?.port, { signal })
		  checkedAt = new Date().toISOString()
		  checkError = null
		  checkErrorKind = null
		  status = await getSyncWorkspaceStatus(workspace)
		} catch (error) {
		  if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
		  // Intentionally do not surface arbitrary Git output: it can include a
		  // remote URL. The user gets a clear, non-sensitive next step instead.
		  const failure = describeSyncCheckFailure(error)
		  checkErrorKind = failure.kind
		  checkError = failure.message
		}
		syncProfileCheckStates.remember(profileId, {
		  last_checked_at: checkedAt,
		  check_error: checkError,
		  check_error_kind: checkErrorKind,
		})
		}
	  }
      return {
        profile_id: profileId,
        mode: manifest.profile.mode,
        skill_count: manifest.skills.length,
		device_choice_count: deviceChoiceCount,
        remote_url: status.remoteUrl,
        remote_identity: status.remoteUrl ? normalizeGitIdentity(status.remoteUrl) : null,
        branch: status.branch,
        changed: status.changed,
        ahead: status.ahead,
        behind: status.behind,
		last_checked_at: checkedAt,
		check_error: checkError,
		check_error_kind: checkErrorKind,
		remote_trust_required: remoteTrust.required,
      }
	} catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
      // An incomplete/non-Skiller Git folder is intentionally not a profile.
			return null
    }
	})
	const result = inspected.filter((status): status is SyncProfileStatusJson => status !== null)
	syncProfileCheckStates.prune(discoveredProfileIds)
	const activeProfileId = readSettings().active_sync_profile_id?.trim()
	return activeProfileId
		? result.sort((left, right) => Number(right.profile_id === activeProfileId) - Number(left.profile_id === activeProfileId))
		: result
}

/** Sources from the inventory the user has just reviewed. Kept main-process-only. */
let syncPreviewSources = new Map<string, string>()
let syncInvalidSources = new Map<string, string>()

async function syncInventoryToJson(): Promise<SyncInventoryJson> {
	// The visible review is deliberately powered by dotagents, not Skiller's
	// legacy scanner. This keeps Skills CLI global layout, direct agent installs,
	// and link deduplication identical in the CLI and desktop application.
	const discovery = await scanDotagentsSkillDiscovery(loadDetectedAgents('scan_sync_inventory'))
	const suggestionByKey = new Map(
		discovery.report.skills.map((skill, index) => [skill.candidateKey, discovery.suggestions[index]]),
	)
	// Review details must be as immediate as All Skills: never re-run the bounded
	// core discovery merely to open a skill already listed in this review.
	syncPreviewSources = new Map(discovery.report.skills.map((skill) => [skill.candidateKey, skill.sourcePath]))
	const invalidIssues = discovery.report.issues.filter((issue) => issue.path)
	syncInvalidSources = new Map(
		invalidIssues.map((issue) => [computePlanId({ kind: 'sync-invalid-entry', sourcePath: issue.path }), issue.path!]),
	)
  return {
    items: discovery.report.skills.map((skill) => ({
      candidate_key: skill.candidateKey,
      display_name: skill.name,
		description: skill.description,
      when_to_use: skill.whenToUse,
      content_hash: skill.integrity,
		source: (() => {
			const suggestion = suggestionByKey.get(skill.candidateKey)
			if (suggestion?.kind !== 'dependency') return { kind: 'local' as const }
			if (suggestion.source === 'skills-cli') {
				return { kind: 'skills_sh' as const, source_url: suggestion.url, ref: suggestion.ref, skill_path: suggestion.skillPath }
			}
			return { kind: 'git_reference' as const, repository: suggestion.url, ref: suggestion.ref, skill_path: suggestion.skillPath }
		})(),
      locations: skill.locations
        .map((location) => ({ ...(location.agent ? { agent_slug: location.agent } : {}), kind: location.kind }))
        .sort((left, right) => (
          ({ shared: 0, 'agent-local': 1, inherited: 2 }[left.kind] - { shared: 0, 'agent-local': 1, inherited: 2 }[right.kind])
          || (left.agent_slug ?? '').localeCompare(right.agent_slug ?? '', 'en')
        )),
    })),
    collisions: discovery.report.collisions.map((collision) => ({
      display_name: collision.name,
      candidate_keys: collision.candidateKeys,
    })),
    invalid_paths: invalidIssues.length,
	invalid_entries: invalidIssues.map((issue) => ({
		invalid_id: computePlanId({ kind: 'sync-invalid-entry', sourcePath: issue.path! }),
		display_name: basename(issue.path!),
		reason: issue.message,
	})),
	linked_aliases: discovery.report.linkedAliases,
  }
}

function syncSkillPreviewToJson(skillId: string): SyncSkillPreviewJson {
  assertSyncStableId(skillId)
	const sourcePath = syncPreviewSources.get(skillId)
	if (!sourcePath) throw new Error('Refresh the library review before opening this skill')
  return { skill_id: skillId, body: parseSkillMdFile(join(sourcePath, 'SKILL.md')).body }
}

function skillsCliEntryForInventoryItem(
  item: SyncInventoryItem,
  entries: SkillsCliLockEntry[],
): SkillsCliLockEntry | null {
	// Skills CLI's global lock belongs to its canonical shared store. A
	// same-named direct install in an agent folder can be independently edited;
	// never silently turn that content into a source-linked dependency.
	if (!item.locations.some((location) => location.kind === 'shared')) return null
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


function skillsCliSkillDirectory(entry: SkillsCliLockEntry): string | null {
  const path = entry.skill_path?.trim()
  if (!path) return null
  if (path === 'SKILL.md') return '.'
  return path.replace(/\/SKILL\.md$/i, '') || '.'
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

const DEFAULT_MINIMUM_RELEASE_AGE_MINUTES = SYNC_REMOTE_MINIMUM_RELEASE_AGE_MINUTES

function reviewedRemoteSourcePolicy(remoteUrl: string, minimumReleaseAgeMinutes: number): SourceSecurityPolicy {
  return exactSourceSecurityPolicy([remoteUrl], {
    minimum_release_age_minutes: minimumReleaseAgeMinutes,
  })
}

type UnresolvedSyncCenterSource = {
  id: string
  kind: 'reference' | 'skills_sh'
  source: string
  requestedRef: string
  reason: SyncSourceFailureReason
  ageMinutes?: number
  minimumAgeMinutes?: number
}
type SyncCenterLicense = 'MIT' | 'Apache-2.0' | 'CC0-1.0'
type FinalSyncCenterDisposition = Exclude<ImportDisposition, 'suggested'> | 'snapshot'
type SyncCenterDecisionOutcome = { candidateKey: string; disposition: Exclude<ImportDisposition, 'suggested'>; license?: string }
type SyncCenterExternalSource = {
  kind: 'reference' | 'skills_sh'
  repository: string
  requestedRef: string
  skillPath: string
}
type SyncCenterPreparedItem = {
  item: SyncInventoryItem
  disposition: FinalSyncCenterDisposition
  installationAgentSlugs: string[]
  reviewed?: ImportDecision
  external: SyncCenterExternalSource | null
}
type SyncCenterSourceResolution = {
  source: string
  requestedRef: string
  commit: string
  committedAt: string
  integrity: string
  skillPaths: string[]
}
type SyncCenterResolvedSource = Awaited<ReturnType<GitDependencyResolver['resolve']>>
type SyncCenterPublishPlanResult = {
  plan: ReturnType<typeof createSyncPublishPlan>
  reviewPlanId: string
  sourceAuthorizationId: string
  sourcePolicy: SourceSecurityPolicy
  unresolvedSources: UnresolvedSyncCenterSource[]
  decisions: SyncCenterDecisionOutcome[]
  sourceTrust: SourceTrustDecision[]
  sourceAges: SourceCommitAgeDecision[]
}

function unresolvedSourceReasonLabel(reason: SyncSourceFailureReason): string {
  return {
    authentication: 'Sign-in is required to verify its source.',
    timeout: 'Its source did not respond in time.',
    'invalid-source': 'Its saved source reference is no longer valid.',
    'missing-skill': 'Its source no longer contains this skill.',
    unavailable: 'Its source is not reachable right now.',
    'too-new': 'Its source is newer than the selected safety delay.',
  }[reason]
}

const SYNC_CENTER_REVIEW_CACHE_TTL_MS = 5 * 60 * 1000
const syncCenterReviewCache = new Map<string, { expiresAt: number; result: SyncCenterPublishPlanResult }>()
const syncCenterSourceResolutionCache = new Map<string, { expiresAt: number; result: SyncCenterResolvedSource }>()
const syncCenterReviewControllers = new Map<string, AbortController>()
const syncProviderBrowseControllers = new Map<string, AbortController>()
const syncProviderDeviceAuthorizations = new Map<string, { provider: 'github' | 'gitlab'; deviceCode: string; interval: number }>()
const syncLibraryCheckControllers = new Map<string, AbortController>()

async function requireGitHubAccessToken(): Promise<string> {
  const token = await readProviderToken('github')
  if (!token) throw new ProviderOperationError('authentication', 'Connect GitHub before continuing.')
  return token
}

async function requireGitLabAccessToken(): Promise<string> {
  const token = await readProviderToken('gitlab')
  if (!token) throw new ProviderOperationError('authentication', 'Connect GitLab before continuing.')
  return token
}

async function gitTransportForRemote(remoteUrl: string): Promise<{ environment: NodeJS.ProcessEnv; port: NodeWorkspaceGitPort } | null> {
  try {
    const url = new URL(remoteUrl)
    if (url.protocol !== 'https:') return null
    const host = url.hostname.toLowerCase()
    if (host !== 'github.com' && host !== 'gitlab.com') return null
  } catch {
    return null
  }
  const provider = new URL(remoteUrl).hostname.toLowerCase() === 'gitlab.com' ? 'gitlab' : 'github'
  const token = await readProviderToken(provider)
  if (!token) return null
  const environment = provider === 'gitlab' ? gitlabGitEnvironment(token) : githubGitEnvironment(token)
  return { environment, port: new NodeWorkspaceGitPort(environment) }
}

async function gitTransportForWorkspace(workspace: string): Promise<{ environment: NodeJS.ProcessEnv; port: NodeWorkspaceGitPort } | null> {
  const remoteUrl = (await getSyncWorkspaceStatus(workspace)).remoteUrl
  return remoteUrl ? gitTransportForRemote(remoteUrl) : null
}

async function withCancellableLibraryCheck<T>(requestId: string | undefined, operation: (signal?: AbortSignal) => Promise<T>): Promise<T> {
  if (!requestId) return operation()
  syncLibraryCheckControllers.get(requestId)?.abort()
  const controller = new AbortController()
  syncLibraryCheckControllers.set(requestId, controller)
  try {
    return await operation(controller.signal)
  } finally {
    if (syncLibraryCheckControllers.get(requestId) === controller) syncLibraryCheckControllers.delete(requestId)
  }
}

class CancellableGitRunner implements GitRunner {
  constructor(private readonly signal: AbortSignal, private readonly timeoutMs = 45_000, private readonly environment: NodeJS.ProcessEnv = {}) {}

  run(args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('git', args, {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf8',
        timeout: this.timeoutMs,
        signal: this.signal,
        env: {
          ...process.env,
			...this.environment,
          GIT_TERMINAL_PROMPT: '0',
          GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=10',
        },
      }, (error, stdout) => {
        if (error) reject(error)
        else resolve(stdout.trim())
      })
    })
  }
}

function throwIfSourceReviewCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Source review cancelled', 'AbortError')
}

function cachedSyncCenterReview(sourceAuthorizationId: string): SyncCenterPublishPlanResult | null {
  const now = Date.now()
  for (const [key, cached] of syncCenterReviewCache) {
    if (cached.expiresAt <= now) syncCenterReviewCache.delete(key)
  }
  const cached = syncCenterReviewCache.get(sourceAuthorizationId)
  return cached && cached.expiresAt > now ? cached.result : null
}

function cacheSyncCenterReview(result: SyncCenterPublishPlanResult): void {
  // The cache is deliberately process-local: it cannot become portable trust
  // state or survive a restart. Its key binds every reviewed local content hash,
  // disposition, source and policy. Final publish still recomputes that key from
  // the live inventory before this verified immutable plan can be reused.
  syncCenterReviewCache.set(result.sourceAuthorizationId, {
    expiresAt: Date.now() + SYNC_CENTER_REVIEW_CACHE_TTL_MS,
    result,
  })
  while (syncCenterReviewCache.size > 3) {
    const oldest = syncCenterReviewCache.keys().next().value
    if (!oldest) break
    syncCenterReviewCache.delete(oldest)
  }
}

function cachedSyncCenterSourceResolution(key: string): SyncCenterResolvedSource | null {
  const now = Date.now()
  for (const [cacheKey, cached] of syncCenterSourceResolutionCache) {
    if (cached.expiresAt <= now) syncCenterSourceResolutionCache.delete(cacheKey)
  }
  const cached = syncCenterSourceResolutionCache.get(key)
  if (!cached) return null
  // Source decisions often change immediately after the first review. Keep a
  // recently reused immutable result warm so saving a failed source as a copy
  // cannot make an unrelated, already-verified source fail on the next screen.
  cached.expiresAt = now + SYNC_CENTER_REVIEW_CACHE_TTL_MS
  return cached.result
}

function cacheSyncCenterSourceResolution(key: string, result: SyncCenterResolvedSource): void {
  // A cancelled review should not throw away immutable source work that already
  // completed. This cache is process-local, short-lived, and keyed by the exact
  // credential-free source, requested ref, and selected skill paths. Every retry
  // still rebuilds the inventory, trust policy, and final authorization id.
  syncCenterSourceResolutionCache.set(key, {
    expiresAt: Date.now() + SYNC_CENTER_REVIEW_CACHE_TTL_MS,
    result,
  })
  while (syncCenterSourceResolutionCache.size > 256) {
    const oldest = syncCenterSourceResolutionCache.keys().next().value
    if (!oldest) break
    syncCenterSourceResolutionCache.delete(oldest)
  }
}

async function resolveSyncCenterSource(
  group: { source: string; requestedRef: string; entries: SyncCenterPreparedItem[] },
  cacheRoot: string,
  sourcePolicy: SourceSecurityPolicy,
  signal?: AbortSignal,
): Promise<SyncCenterResolvedSource> {
  const first = group.entries[0]!.external!
  const selectedPaths = [...new Set(group.entries.map((entry) => entry.external!.skillPath))].sort()
  const cacheKey = computePlanId({
    kind: 'sync-center-source-resolution',
    schemaVersion: 1,
    source: group.source,
    requestedRef: group.requestedRef,
    selectedPaths,
  })
  const cached = cachedSyncCenterSourceResolution(cacheKey)
  if (cached) return cached

  const controller = new AbortController()
  const cancel = () => controller.abort()
  if (signal?.aborted) cancel()
  else signal?.addEventListener('abort', cancel, { once: true })
  const resolver = new GitDependencyResolver({
    git: new CancellableGitRunner(controller.signal, 15_000),
    cacheRoot,
    sourcePolicy,
  })
  try {
    throwIfSourceReviewCancelled(signal)
    const resolved = await withReviewTimeout(resolver.resolve(`sync-center-${cacheKey.slice(0, 16)}`, {
      url: first.repository,
      ref: group.requestedRef,
      select: selectedPaths,
    }), group.source)
    cacheSyncCenterSourceResolution(cacheKey, resolved)
    return resolved
  } finally {
    // withReviewTimeout bounds the UI wait. Abort the underlying Git process as
    // well so timed-out reviews do not keep consuming sockets in the background.
    controller.abort()
    signal?.removeEventListener('abort', cancel)
  }
}

function syncCenterPublicLicense(mode: 'private' | 'team' | 'public', license: unknown): SyncCenterLicense | undefined {
  if (mode !== 'public') return undefined
  if (license === 'MIT' || license === 'Apache-2.0' || license === 'CC0-1.0') return license
  throw new Error('Choose a license before creating a public library')
}

async function createSyncCenterPublishPlan(
  selectedKeys?: string[],
  mode: 'private' | 'team' | 'public' = 'private',
  reviewedDecisions?: ImportDecision[],
  minimumReleaseAgeMinutes = DEFAULT_MINIMUM_RELEASE_AGE_MINUTES,
  expectedSourceAuthorizationId?: string,
  onSourceReviewProgress?: (progress: SyncSourceReviewProgressJson) => void,
  signal?: AbortSignal,
): Promise<SyncCenterPublishPlanResult> {
  throwIfSourceReviewCancelled(signal)
  const inventory = await scanSyncInventoryWithDotagents(loadDetectedAgents('sync_center_publish'))
  const selected = selectedKeys ? new Set(selectedKeys) : null
  const decisions = reviewedDecisions ? parseImportDecisions(reviewedDecisions) : null
  const decisionByKey = new Map(decisions?.map((decision) => [decision.candidateKey, decision]))
  const inventoryKeys = new Set(inventory.items.map((item) => item.candidateKey))
  for (const decision of decisions ?? []) {
    if (!inventoryKeys.has(decision.candidateKey)) throw new Error(`Skill changed or disappeared after review: ${decision.candidateKey}`)
  }
  const requestedDisposition = (candidateKey: string): ImportDecision['disposition'] => {
    if (decisions) return decisionByKey.get(candidateKey)?.disposition ?? 'local-only'
    return selected === null || selected.has(candidateKey) ? 'suggested' : 'local-only'
  }
  const items = inventory.items.filter((item) => !['local-only', 'excluded'].includes(requestedDisposition(item.candidateKey)))
	if (items.length === 0) throw new Error('Choose at least one skill to save or reference in your library')
  const selectedKeysSet = new Set(items.map((item) => item.candidateKey))
  const unresolved = inventory.collisions.filter((collision) => collision.candidateKeys.filter((key) => selectedKeysSet.has(key)).length > 1)
  if (unresolved.length > 0) {
		throw new Error(`Resolve ${unresolved.length} same-name skill collision(s) before creating this library`)
  }
  const skillsCliEntries = readSkillsCliLock()?.skills ?? []
  const outcomes = new Map<string, SyncCenterDecisionOutcome>()
  for (const item of inventory.items) {
    const reviewed = decisionByKey.get(item.candidateKey)
    const disposition = requestedDisposition(item.candidateKey)
    if (disposition === 'local-only' || disposition === 'excluded') {
      outcomes.set(item.candidateKey, { candidateKey: item.candidateKey, disposition })
    } else if (disposition !== 'suggested') {
      outcomes.set(item.candidateKey, {
        candidateKey: item.candidateKey,
        disposition,
        ...(reviewed?.license ? { license: reviewed.license } : {}),
      })
    }
  }
  const prepared = items.map((item): SyncCenterPreparedItem => {
    const installationAgentSlugs = item.locations.flatMap((location) => location.agentSlug ? [location.agentSlug] : [])
    const skillsCliEntry = skillsCliEntryForInventoryItem(item, skillsCliEntries)
    const git = item.gitSource
    const external: SyncCenterExternalSource | null = skillsCliEntry
      ? {
          kind: 'skills_sh',
          repository: skillsCliEntry.source_url.trim(),
          requestedRef: skillsCliEntry.ref?.trim() || 'HEAD',
          skillPath: skillsCliSkillDirectory(skillsCliEntry) ?? '',
        }
      : git?.url
        ? {
            kind: 'reference',
            repository: git.url,
            requestedRef: git.ref,
            skillPath: git.skillPath,
          }
        : null
    const requested = requestedDisposition(item.candidateKey)
    const disposition: FinalSyncCenterDisposition = requested === 'suggested'
      ? external ? 'dependency' : 'owned'
      : requested === 'owned' && external && mode !== 'public'
        ? 'snapshot'
        : requested
    const reviewed = decisionByKey.get(item.candidateKey)
    outcomes.set(item.candidateKey, {
      candidateKey: item.candidateKey,
      disposition: disposition === 'snapshot' ? 'owned' : disposition,
      ...(reviewed?.license ? { license: reviewed.license } : {}),
    })
    if (disposition !== 'owned' && (!external?.repository || !external.skillPath)) {
      throw new Error(`${item.displayName} has no verified Git source. Save it as owned or keep it on this computer.`)
    }
    if (disposition === 'vendored' && !reviewed?.license) {
      throw new Error(`Choose the upstream license before vendoring ${item.displayName}`)
    }
    return { item, disposition, installationAgentSlugs, reviewed, external: disposition === 'owned' ? null : external }
  })

  for (const entry of prepared) {
    if (entry.external) assertCredentialFreeGitRemote(entry.external.repository)
  }
  const repositories = prepared.flatMap((entry) => entry.external && entry.disposition !== 'snapshot' ? [entry.external.repository] : [])
  const sourcePolicy = exactSourceSecurityPolicy(repositories, {
    minimum_release_age_minutes: minimumReleaseAgeMinutes,
  })
  const sourceTrustBySource = new Map<string, SourceTrustDecision>()
  for (const repository of repositories) {
    const decision = requireTrustedSource(repository, sourcePolicy)
    sourceTrustBySource.set(decision.source, decision)
  }
  const sourceTrust = [...sourceTrustBySource.values()].sort((left, right) => left.source.localeCompare(right.source, 'en'))
  const sourceAuthorizationId = computePlanId({
    kind: 'sync-center-source-authorization',
    schemaVersion: 1,
    mode,
    sourcePolicy,
    items: prepared.map((entry) => ({
      candidateKey: entry.item.candidateKey,
      contentHash: entry.item.contentHash,
      disposition: entry.disposition,
      installationAgentSlugs: [...entry.installationAgentSlugs].sort(),
      ...(entry.reviewed?.license ? { license: entry.reviewed.license } : {}),
      ...(entry.external && entry.disposition !== 'snapshot' ? {
        source: requireTrustedSource(entry.external.repository, sourcePolicy).source,
        requestedRef: entry.external.requestedRef,
        skillPath: entry.external.skillPath,
      } : {}),
      ...(entry.external && entry.disposition === 'snapshot' ? {
        snapshotSource: normalizeGitIdentity(entry.external.repository),
        snapshotRequestedRef: entry.external.requestedRef,
        snapshotSkillPath: entry.external.skillPath,
      } : {}),
    })),
  })
  if (expectedSourceAuthorizationId && expectedSourceAuthorizationId !== sourceAuthorizationId) {
    throw new Error('The selected sources or trust policy changed after review. Review them again before Skiller contacts Git.')
  }
  const cachedReview = cachedSyncCenterReview(sourceAuthorizationId)
  if (cachedReview) {
    onSourceReviewProgress?.({ completed: 0, total: 0, verified: 0, kept_local: 0 })
    return cachedReview
  }

  const sourceGroups = new Map<string, { source: string; requestedRef: string; entries: SyncCenterPreparedItem[] }>()
  for (const entry of prepared) {
    if (!entry.external || entry.disposition === 'snapshot') continue
    const source = requireTrustedSource(entry.external.repository, sourcePolicy).source
    const key = `${source}\u0000${entry.external.requestedRef}`
    const group = sourceGroups.get(key)
    if (group) group.entries.push(entry)
    else sourceGroups.set(key, { source, requestedRef: entry.external.requestedRef, entries: [entry] })
  }
  const sourceCacheRoot = join(syncProfilesDirectory(), '.source-cache', 'git')
  // Source verification is dominated by independent network round-trips. A
  // conservative limit of four made a normal 90+ repository library take
  // nearly a minute even with a warm object cache. Keep the bound explicit,
  // but allow enough overlap for the review screen to finish promptly.
  const orderedSourceGroups = [...sourceGroups.values()].sort((left, right) => `${left.source}\u0000${left.requestedRef}`.localeCompare(`${right.source}\u0000${right.requestedRef}`, 'en'))
  let completedSourceGroups = 0
  let verifiedSourceGroups = 0
  let keptLocalSourceGroups = 0
  const reportSourceReviewProgress = () => onSourceReviewProgress?.({
    completed: completedSourceGroups,
    total: orderedSourceGroups.length,
    verified: verifiedSourceGroups,
    kept_local: keptLocalSourceGroups,
  })
  reportSourceReviewProgress()
  const resolvedGroups = await mapWithConcurrency(
    orderedSourceGroups,
    24,
    async (group) => {
      throwIfSourceReviewCancelled(signal)
      try {
        const resolved = await resolveSyncCenterSource(group, sourceCacheRoot, sourcePolicy, signal)
        if (!resolved.committed_at) throw new Error(`Git source ${group.source} did not provide a commit timestamp`)
        verifiedSourceGroups += 1
        return { group, resolved } as const
      } catch (error) {
        throwIfSourceReviewCancelled(signal)
        keptLocalSourceGroups += 1
        return { group, error } as const
      } finally {
        completedSourceGroups += 1
        reportSourceReviewProgress()
      }
    },
  )
  const unresolvedSources: UnresolvedSyncCenterSource[] = []
  const resolvedByCandidate = new Map<string, Awaited<ReturnType<GitDependencyResolver['resolve']>>>()
  const sourceAges: SourceCommitAgeDecision[] = []
  const sourceResolutions: SyncCenterSourceResolution[] = []
  for (const result of resolvedGroups) {
    if ('error' in result) {
      const releaseAge = result.error instanceof SourceReleaseAgeError ? result.error.decision : null
      for (const entry of result.group.entries) {
        unresolvedSources.push({
          id: entry.item.candidateKey,
          kind: entry.external!.kind,
          source: result.group.source,
          requestedRef: result.group.requestedRef,
          reason: classifySyncSourceFailure(result.error),
          ...(releaseAge ? { ageMinutes: releaseAge.ageMinutes, minimumAgeMinutes: releaseAge.minimumAgeMinutes } : {}),
        })
        outcomes.set(entry.item.candidateKey, { candidateKey: entry.item.candidateKey, disposition: 'local-only' })
      }
      continue
    }
    const age = requireMinimumReleaseAge(result.group.source, result.resolved.committed_at!, sourcePolicy)
    sourceAges.push(age)
    sourceResolutions.push({
      source: result.group.source,
      requestedRef: result.group.requestedRef,
      commit: result.resolved.commit,
      committedAt: result.resolved.committed_at!,
      integrity: result.resolved.integrity,
      skillPaths: result.resolved.skills.map((skill) => skill.path).sort(),
    })
    for (const entry of result.group.entries) resolvedByCandidate.set(entry.item.candidateKey, result.resolved)
  }

  const candidates: SyncPublishCandidate[] = []
  for (const entry of prepared) {
	if (entry.disposition === 'snapshot') {
	  const scanned = await scanOwnedSkill(dirname(entry.item.sourcePath), basename(entry.item.sourcePath))
	  if (!scanned.ok) throw new Error(`Could not verify snapshot files for ${entry.item.displayName}: ${scanned.issues[0]?.message ?? 'unsafe skill'}`)
	  candidates.push({
		kind: 'snapshot',
		id: entry.item.candidateKey,
		sourcePath: entry.item.sourcePath,
		origin: {
		  url: entry.external!.repository,
		  requested_ref: entry.external!.requestedRef,
		  skill_path: entry.external!.skillPath,
		  integrity: scanned.value.integrity,
		  ...(/^[a-f0-9]{40}$/i.test(entry.external!.requestedRef) ? { resolved_commit: entry.external!.requestedRef.toLowerCase() } : {}),
		},
		installationAgentSlugs: entry.installationAgentSlugs,
	  })
	  continue
	}
    if (entry.disposition === 'owned') {
      candidates.push({ kind: 'bundled', id: entry.item.candidateKey, sourcePath: entry.item.sourcePath, ...(entry.item.forkedFrom ? { forkedFrom: { url: entry.item.forkedFrom.url, ...(entry.item.forkedFrom.ref ? { ref: entry.item.forkedFrom.ref } : {}), ...(entry.item.forkedFrom.skillPath ? { skill_path: entry.item.forkedFrom.skillPath } : {}) } } : {}), installationAgentSlugs: entry.installationAgentSlugs })
      continue
    }
    const external = entry.external!
    const resolved = resolvedByCandidate.get(entry.item.candidateKey)
    if (!resolved) continue
    if (entry.disposition === 'vendored') {
      const scanned = await scanOwnedSkill(dirname(entry.item.sourcePath), basename(entry.item.sourcePath))
      if (!scanned.ok) throw new Error(`Could not verify vendored files for ${entry.item.displayName}: ${scanned.issues[0]?.message ?? 'unsafe skill'}`)
      candidates.push({
        kind: 'vendored',
        id: entry.item.candidateKey,
        sourcePath: entry.item.sourcePath,
        origin: {
          url: external.repository,
          commit: resolved.commit,
          skill_path: external.skillPath,
          integrity: scanned.value.integrity,
          license: entry.reviewed!.license!,
        },
        installationAgentSlugs: entry.installationAgentSlugs,
      })
      continue
    }
    candidates.push(external.kind === 'skills_sh'
      ? { kind: 'skills_sh', id: entry.item.candidateKey, sourceUrl: external.repository, ref: resolved.commit, skillPath: external.skillPath, contentHash: entry.item.contentHash, installationAgentSlugs: entry.installationAgentSlugs }
      : { kind: 'reference', id: entry.item.candidateKey, repository: external.repository, ref: resolved.commit, skillPath: external.skillPath, contentHash: entry.item.contentHash, installationAgentSlugs: entry.installationAgentSlugs })
  }
  const plan = createSyncPublishPlan('agent-library', mode, candidates)
  const reviewPlanId = computePlanId({
    kind: 'sync-center-publish-review',
    schemaVersion: 1,
    sourceAuthorizationId,
    publishPlanId: plan.planId,
    sourcePolicy,
    sourceResolutions: sourceResolutions.sort((left, right) => `${left.source}\u0000${left.requestedRef}`.localeCompare(`${right.source}\u0000${right.requestedRef}`, 'en')),
    unresolvedSources: [...unresolvedSources].sort((left, right) => left.id.localeCompare(right.id, 'en')),
  })
  const result: SyncCenterPublishPlanResult = {
    plan,
    reviewPlanId,
    sourceAuthorizationId,
    sourcePolicy,
    unresolvedSources,
    decisions: inventory.items.map((item) => outcomes.get(item.candidateKey) ?? { candidateKey: item.candidateKey, disposition: 'local-only' }),
    sourceTrust,
    sourceAges: sourceAges.sort((left, right) => left.source.localeCompare(right.source, 'en')),
  }
  cacheSyncCenterReview(result)
  return result
}

function syncPublishPlanToJson(
  plan: ReturnType<typeof createSyncPublishPlan>,
  reviewPlanId: string,
  sourceAuthorizationId: string,
  sourcePolicy: SourceSecurityPolicy,
  unresolvedSources: UnresolvedSyncCenterSource[] = [],
  decisions: SyncCenterDecisionOutcome[] = [],
  sourceTrust: SourceTrustDecision[] = [],
  sourceAges: SourceCommitAgeDecision[] = [],
): SyncPublishPreviewJson {
  return {
    plan_id: reviewPlanId,
    source_authorization_id: sourceAuthorizationId,
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
    source_trust: sourceTrust.map((decision) => ({
      source: decision.source,
      kind: decision.kind,
      rule: decision.rule,
    })),
    source_security: {
      minimum_release_age_minutes: sourcePolicy.minimum_release_age_minutes,
      commit_ages: sourceAges.map((decision) => ({
        source: decision.source,
        committed_at: decision.committedAt,
        age_minutes: decision.ageMinutes,
        minimum_age_minutes: decision.minimumAgeMinutes,
        excluded: decision.excluded,
      })),
    },
    decisions: decisions.map((decision) => ({
      candidate_key: decision.candidateKey,
      disposition: decision.disposition,
      ...(decision.license ? { license: decision.license } : {}),
    })),
    unresolved_sources: unresolvedSources.map((source) => ({
      id: source.id,
      kind: source.kind,
      source: source.source,
      requested_ref: source.requestedRef,
      reason: source.reason,
      ...(source.ageMinutes === undefined ? {} : { age_minutes: source.ageMinutes }),
      ...(source.minimumAgeMinutes === undefined ? {} : { minimum_age_minutes: source.minimumAgeMinutes }),
    })),
  }
}

function assertReviewedPublishPlan(expectedPlanId: string, actualPlanId: string): void {
  if (!expectedPlanId || expectedPlanId !== actualPlanId) {
    throw new Error('Your library changed after review. Review it again before publishing.')
  }
}

function assertReviewedReconciliationPlan(expectedPlanId: string, plan: ReturnType<typeof createSyncRestorePlan>): void {
  if (!expectedPlanId || expectedPlanId !== syncRestorePlanId(plan)) {
    throw new Error('The local or remote library changed after review. Review it again before applying this decision.')
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
	return classifyExternalRestore(skill, true, readLocalSkillSources()[skill.id], localContentHash)
}

function externalReviewAction(
	skill: ManagedExternalSkill,
	agents: AgentConfig[],
	externalKeptSources: Record<string, { repository: string; ref: string }> | undefined,
	metadataOnlySourceUpdate = false,
): ExternalRestoreAction | 'kept-local' {
	const action = externalRestoreAction(skill, agents)
	if (metadataOnlySourceUpdate && action === 'conflict') {
		const provenance = readLocalSkillSources()[skill.id]
		try {
			const sourcePath = resolveSkillSourcePath(skill.id, agents)
			const localContentHash = planBundledSkillExport(skill.id, sourcePath).sha256
			const sameLocation = provenance?.repository?.trim() === externalSkillRepository(skill)
				&& externalSkillDirectory(provenance.skill_path) === skill.skill_path
			if (sameLocation && provenance?.content_sha256 === localContentHash) return 'unchanged'
		} catch {
			// Missing or unreadable local content remains a conflict.
		}
	}
	if (action === 'conflict' && externalKeptSourceMatches(skill, externalKeptSources?.[skill.id])) return 'kept-local'
	return action
}

function metadataOnlySkillIds(
	previousLock: ReturnType<typeof readCanonicalSyncLock>,
	nextLock: ReturnType<typeof readCanonicalSyncLock>,
): Set<string> {
	const result = new Set<string>()
	if (!previousLock || !nextLock) return result
	for (const [dependency, next] of Object.entries(nextLock.resolved)) {
		const previous = previousLock.resolved[dependency]
		if (!previous || previous.commit === next.commit) continue
		const sameSelection = JSON.stringify(previous.skills) === JSON.stringify(next.skills)
		if (previous.url === next.url && previous.integrity === next.integrity && sameSelection) {
			for (const skill of next.skills) result.add(skill.name)
		}
	}
	return result
}

async function prepareManagedExternalSkill(
	skill: ManagedExternalSkill,
	agents: AgentConfig[],
	targets: string[],
	allowConflict = false,
): Promise<{ skill: ManagedExternalSkill; prepared: PreparedGitSkillInstall; targets: string[] } | null> {
	const action = externalRestoreAction(skill, agents)
	if (action === 'unchanged') return null
	if (action === 'conflict' && !allowConflict) {
		throw new Error(`Local skill ${skill.id} is not the pinned version in this library. Review it before replacing anything.`)
	}
	return {
		skill,
		targets,
		prepared: await prepareGitSkillInstall(
			externalSkillRepository(skill),
			skill.skill_path,
			skill.ref,
			skill.id,
			skill.sha256,
			exactSourceSecurityPolicy([externalSkillRepository(skill)]),
		),
	}
}

async function applyReviewedRemoteChanges(
  profileId: string,
  ids: string[],
  rpc: BunSideRpc,
  expectedWorkspacePlanId: string,
  expectedPlanId: string,
  allowConflict = false,
): Promise<{ restored: string[] }> {
  assertSyncStableId(profileId)
  const skillIds = selectedSyncSkillIds(ids)
  if (!hasSyncWorkspace(profileId)) throw new Error('This library has not been set up on this computer')
  const workspace = syncWorkspacePath(profileId)
  const status = await getSyncWorkspaceStatus(workspace)
  if (!status.remoteUrl || status.changed) throw new Error('Sync workspace must be clean and connected before applying remote changes')
	const transport = await gitTransportForWorkspace(workspace)
	const workspacePlan = await planSyncWorkspaceFastForward(workspace, undefined, transport?.port)
	if (workspacePlan.planId !== expectedWorkspacePlanId) throw new Error('Remote or local Git state changed after review. Review it again before applying changes.')
	const ledger = readSyncLedger(profileId)
	const reviewedPlan = await inspectSyncWorkspaceFastForward(workspacePlan, (checkout) => createSyncRestorePlan(checkout, sharedSkillsDir(), ledger ?? undefined), undefined, transport?.port)
	assertReviewedReconciliationPlan(expectedPlanId, reviewedPlan)
	const entries = new Map(reviewedPlan.entries.map((entry) => [entry.id, entry]))
	const agents = loadDetectedAgents('sync_apply_remote_changes')
	const externalSkills = new Map(reviewedPlan.manifest.skills
		.filter((skill): skill is ManagedExternalSkill => skill.kind === 'reference' || skill.kind === 'skills_sh')
		.map((skill) => [skill.id, skill]))
  for (const id of skillIds) {
    const entry = entries.get(id)
		if (!entry) {
			const external = externalSkills.get(id)
			if (!external) throw new Error(`Remote skill is not available: ${id}`)
			const action = externalRestoreAction(external, agents)
			if (action !== 'create' && !(allowConflict && action === 'conflict')) {
				throw new Error(`External skill ${id} must be resolved manually before it can be installed.`)
			}
			continue
		}
		const action = entry.threeWayAction
	if (action !== 'take-remote' && !(allowConflict && (action === 'conflict' || action === 'kept-local'))) throw new Error(`Remote change must be resolved manually: ${id}`)
  }
	const routing = syncRestoreAgentRouting(workspace, reviewedPlan.manifest, agents)
	const preparedExternal: { skill: ManagedExternalSkill; prepared: PreparedGitSkillInstall; targets: string[] }[] = []
	try {
		for (const id of skillIds.filter((id) => externalSkills.has(id))) {
			const prepared = await prepareManagedExternalSkill(externalSkills.get(id)!, agents, routing.forSkill(id), allowConflict)
			if (prepared) preparedExternal.push(prepared)
		}
		await applyReviewedSyncWorkspaceFastForward(workspace, expectedWorkspacePlanId, transport?.port)
		const plan = createSyncRestorePlan(workspace, sharedSkillsDir(), ledger ?? undefined)
		assertReviewedReconciliationPlan(expectedPlanId, plan)
		const appliedEntries = new Map(plan.entries.map((entry) => [entry.id, entry]))
		applySyncRestorePlan(plan, skillIds.filter((id) => entries.has(id)), profileId)
		for (const id of skillIds.filter((id) => entries.has(id))) {
			const targets = routing.forSkill(id)
			if (targets.length > 0) installSkillFromPath(join(sharedSkillsDir(), id), targets, agents, id)
		}
		for (const entry of preparedExternal) {
			installPreparedGitSkill(entry.prepared, entry.targets, agents, entry.skill.kind === 'skills_sh' ? 'skills.sh' : 'sync-reference')
		}
		const nextSkills = new Map(Object.entries(ledger?.skills ?? {}).map(([id, entry]) => [id, { sha256: entry.sha256, keptRemoteSha256: entry.kept_remote_sha256 }]))
		for (const id of skillIds.filter((id) => appliedEntries.has(id))) nextSkills.set(id, { sha256: appliedEntries.get(id)!.remoteSha256, keptRemoteSha256: undefined })
		const nextExternalKeptSources = { ...(ledger?.external_kept_sources ?? {}) }
		for (const id of skillIds.filter((id) => externalSkills.has(id))) delete nextExternalKeptSources[id]
		writeSyncLedgerAt(syncLedgerPath(profileId), makeSyncLedger(profileId, [...nextSkills.entries()].map(([id, entry]) => ({ id, ...entry })), nextExternalKeptSources))
		rpc.send('skills_changed')
		return { restored: skillIds }
	} finally {
		for (const entry of preparedExternal) discardPreparedGitSkill(entry.prepared)
	}
}

/**
 * Accept a reviewed library-only update when no managed skill needs to be
 * installed, published, or resolved. The canonical workspace advances to the
 * exact reviewed commit; agent skill folders remain untouched.
 */
async function acceptReviewedRemoteLibraryUpdate(
  profileId: string,
  expectedWorkspacePlanId: string,
  expectedPlanId: string,
): Promise<{ updated: boolean }> {
  assertSyncStableId(profileId)
  if (!hasSyncWorkspace(profileId)) throw new Error('This library has not been set up on this computer')
  const workspace = syncWorkspacePath(profileId)
  const status = await getSyncWorkspaceStatus(workspace)
  if (!status.remoteUrl || status.changed) throw new Error('Sync workspace must be clean and connected before applying a library update')
	const transport = await gitTransportForWorkspace(workspace)
  const ledger = readSyncLedger(profileId)
	const previousLock = readCanonicalSyncLock(workspace)
  const workspacePlan = await planSyncWorkspaceFastForward(workspace, undefined, transport?.port)
  if (workspacePlan.planId !== expectedWorkspacePlanId) throw new Error('Remote or local Git state changed after review. Review it again before applying changes.')
	if (isLibraryDocumentationOnlyUpdate(workspacePlan.files)) {
		if (expectedPlanId !== libraryDocumentationUpdatePlanId(workspacePlan.planId, workspacePlan.files, computePlanId)) {
			throw new Error('The library changed after review. Review it again before applying this update.')
		}
		await applyReviewedSyncWorkspaceFastForward(workspace, expectedWorkspacePlanId, transport?.port)
		return { updated: true }
	}
	const reviewed = await inspectSyncWorkspaceFastForward(workspacePlan, (checkout) => ({
		nextLock: readCanonicalSyncLock(checkout),
		restore: createSyncRestorePlan(checkout, sharedSkillsDir(), ledger ?? undefined),
	}), undefined, transport?.port)
	const restore = reviewed.restore
  assertReviewedReconciliationPlan(expectedPlanId, restore)
  const agents = loadDetectedAgents('sync_accept_remote_library_update')
	const metadataOnlySkills = metadataOnlySkillIds(previousLock, reviewed.nextLock)
  const hasSkillDecision = restore.entries.some((entry) => !['unchanged', 'kept-local'].includes(entry.threeWayAction))
    || restore.manifest.skills
      .filter((skill): skill is ManagedExternalSkill => skill.kind === 'reference' || skill.kind === 'skills_sh')
			.some((skill) => !['unchanged', 'kept-local'].includes(externalReviewAction(skill, agents, ledger?.external_kept_sources, metadataOnlySkills.has(skill.id))))
  if (hasSkillDecision) throw new Error('Review the affected skills before updating the library record')
  await applyReviewedSyncWorkspaceFastForward(workspace, expectedWorkspacePlanId, transport?.port)
  return { updated: true }
}

/**
 * Explicitly publishes only entries that changed locally while the remote
 * stayed at the last applied base. The current remote manifest is retained
 * verbatim for every other skill, so a granular publish cannot erase a
 * colleague's unrelated addition.
 */
async function publishReviewedLocalChanges(
  profileId: string,
  ids: string[],
  expectedWorkspacePlanId: string,
  expectedPlanId: string,
  options: { allowConflict?: boolean } = {},
): Promise<{ commit: string | null; pushed: boolean }> {
  assertSyncStableId(profileId)
  const skillIds = selectedSyncSkillIds(ids)
  if (!hasSyncWorkspace(profileId)) throw new Error('This library has not been set up on this computer')
  const workspace = syncWorkspacePath(profileId)
  let status = await getSyncWorkspaceStatus(workspace)
  if (!status.remoteUrl || status.changed) throw new Error('Sync workspace must be clean and connected before publishing local changes')
	const transport = await gitTransportForWorkspace(workspace)
	await applyReviewedSyncWorkspaceFastForward(workspace, expectedWorkspacePlanId, transport?.port)
	const ledger = readSyncLedger(profileId)
	const restore = createSyncRestorePlan(workspace, sharedSkillsDir(), ledger ?? undefined)
	assertReviewedReconciliationPlan(expectedPlanId, restore)
	const existing = restore.manifest
  const entries = new Map(restore.entries.map((entry) => [entry.id, entry]))
  const existingSkills = new Map(existing.skills.map((skill) => [skill.id, skill]))
  const agents = loadDetectedAgents('sync_adopt_local_changes')
  const candidates: SyncPublishCandidate[] = []
  for (const id of skillIds) {
    const entry = entries.get(id)
    const current = existingSkills.get(id)
    if (!current) throw new Error(`Library skill is not available: ${id}`)
    if (current.kind === 'bundled') {
      if (!entry || entry.localSha256 === null) throw new Error(`Local skill is not available: ${id}`)
			const action = entry.threeWayAction
      if (action !== 'publish-local' && !(options.allowConflict && (action === 'conflict' || action === 'unmanaged'))) {
        throw new Error(`Local change does not need publishing: ${id}`)
      }
      candidates.push({ id, sourcePath: entry.targetPath, installationAgentSlugs: current.installations })
      continue
    }
    if (!options.allowConflict || externalRestoreAction(current, agents) !== 'conflict') {
      throw new Error(`External skill does not need adoption: ${id}`)
    }
    const sourcePath = resolveSkillSourcePath(id, agents)
    planBundledSkillExport(id, sourcePath)
    candidates.push({ id, sourcePath, installationAgentSlugs: current.installations })
  }
  const update = createSyncPublishPlan(profileId, existing.profile.mode, candidates, existing.agent_policy)
	const publishedBundles = new Map(update.manifest.skills.filter((skill) => skill.kind === 'bundled').map((skill) => [skill.id, skill]))
	const merged = mergeBundledUpdateIntoManifest(existing, update, { allowSourceConversion: options.allowConflict })
	if (!isCanonicalSyncLibrary(workspace)) throw new Error('Upgrade this library to the dotagents format before publishing changes')
	const canonical = await planCanonicalSyncLibrary(workspace, merged)
	applySyncPublishFiles(workspace, merged, canonical.portableFiles)
  const commit = await commitSyncWorkspace(workspace, 'Skiller sync: publish reviewed local changes')
  await pushSyncWorkspace(workspace, undefined, transport?.port)
	const nextSkills = new Map(Object.entries(ledger?.skills ?? {}).map(([id, entry]) => [id, { sha256: entry.sha256, keptRemoteSha256: entry.kept_remote_sha256 }]))
  for (const id of skillIds) nextSkills.set(id, { sha256: publishedBundles.get(id)!.sha256, keptRemoteSha256: undefined })
  writeSyncLedgerAt(syncLedgerPath(profileId), makeSyncLedger(profileId, [...nextSkills.entries()].map(([id, entry]) => ({ id, ...entry })), ledger?.external_kept_sources))
  return { commit, pushed: true }
}

/** Record a reviewed local-over-remote choice without changing either tree. */
async function keepReviewedLocalChanges(
  profileId: string,
  ids: string[],
  expectedWorkspacePlanId: string,
  expectedPlanId: string,
): Promise<{ kept: string[] }> {
  assertSyncStableId(profileId)
  const skillIds = selectedSyncSkillIds(ids)
  if (!hasSyncWorkspace(profileId)) throw new Error('This library has not been set up on this computer')
  const workspace = syncWorkspacePath(profileId)
  const status = await getSyncWorkspaceStatus(workspace)
  if (!status.remoteUrl || status.changed) throw new Error('Sync workspace must be clean and connected before keeping local changes')
	const transport = await gitTransportForWorkspace(workspace)
	await applyReviewedSyncWorkspaceFastForward(workspace, expectedWorkspacePlanId, transport?.port)
	const ledger = readSyncLedger(profileId)
	const restore = createSyncRestorePlan(workspace, sharedSkillsDir(), ledger ?? undefined)
  assertReviewedReconciliationPlan(expectedPlanId, restore)
  const entries = new Map(restore.entries.map((entry) => [entry.id, entry]))
  const nextSkills = new Map(Object.entries(ledger?.skills ?? {}).map(([id, entry]) => [id, { sha256: entry.sha256, keptRemoteSha256: entry.kept_remote_sha256 }]))
  for (const id of skillIds) {
    const entry = entries.get(id)
		if (!entry) throw new Error(`Skill is not available in this review: ${id}`)
		const action = entry.threeWayAction
    if (action !== 'conflict' && action !== 'unmanaged') throw new Error(`Local change does not need this decision: ${id}`)
		// The local side may intentionally be absent or occupied by a non-directory
		// item. Remember the exact reviewed library version without touching either
		// side; any later library change asks again instead of silently overwriting.
		nextSkills.set(id, { sha256: ledger?.skills[id]?.sha256 ?? entry.remoteSha256, keptRemoteSha256: entry.remoteSha256 })
  }
  writeSyncLedgerAt(syncLedgerPath(profileId), makeSyncLedger(profileId, [...nextSkills.entries()].map(([id, entry]) => ({ id, ...entry })), ledger?.external_kept_sources))
  return { kept: skillIds }
}

/**
 * Persist a per-device decision to leave an external skill alone. This never
 * mutates the skill or remote library. The decision is scoped to its exact
 * repository + commit, so a later remote pin forces the user to review again.
 */
async function keepReviewedExternalChanges(
	profileId: string,
	ids: string[],
	expectedWorkspacePlanId: string,
	expectedPlanId: string,
): Promise<{ kept: string[] }> {
	assertSyncStableId(profileId)
	const skillIds = selectedSyncSkillIds(ids)
	if (!hasSyncWorkspace(profileId)) throw new Error('This library has not been set up on this computer')
	const workspace = syncWorkspacePath(profileId)
	const status = await getSyncWorkspaceStatus(workspace)
	if (!status.remoteUrl || status.changed) throw new Error('Sync workspace must be clean and connected before keeping a local skill')
	const transport = await gitTransportForWorkspace(workspace)
	await applyReviewedSyncWorkspaceFastForward(workspace, expectedWorkspacePlanId, transport?.port)
	const ledger = readSyncLedger(profileId)
	const restore = createSyncRestorePlan(workspace, sharedSkillsDir(), ledger ?? undefined)
	assertReviewedReconciliationPlan(expectedPlanId, restore)
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

type ClawhubPreviewSource = {
  slug: string
  ownerHandle: string | null
}

/**
 * Marketplace cards from ClawHub are catalogue pages, not Git repositories.
 * Keep this parser deliberately narrow: preview RPCs must never turn a UI URL
 * into an arbitrary outbound request.
 */
function remoteClawhubSkillSource(repoUrl: string): ClawhubPreviewSource | null {
  let url: URL
  try {
    url = new URL(repoUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== 'clawhub.ai') return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length === 3 && parts[1] === 'skills') {
    return { ownerHandle: parts[0]!, slug: parts[2]! }
  }
  // Older cached cards only carried /skills/<slug>. Resolve the owner through
  // the catalogue before reading any content.
  if (parts.length === 2 && parts[0] === 'skills') {
    return { ownerHandle: null, slug: parts[1]! }
  }
  return null
}

function isSafeClawhubSegment(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
}

async function resolveClawhubPreviewSource(source: ClawhubPreviewSource): Promise<{ slug: string; ownerHandle: string }> {
  if (!isSafeClawhubSegment(source.slug)) throw new Error('Invalid ClawHub skill reference')
  if (source.ownerHandle) {
    if (!isSafeClawhubSegment(source.ownerHandle)) throw new Error('Invalid ClawHub owner reference')
    return { slug: source.slug, ownerHandle: source.ownerHandle }
  }
  const response = await fetch(`https://clawhub.ai/api/v1/search?q=${encodeURIComponent(source.slug)}&limit=25`, {
    headers: { Accept: 'application/json', 'User-Agent': 'Skiller' },
    signal: fetchTimeoutSignal(10_000),
  })
  if (!response.ok) throw new Error('Could not resolve this ClawHub skill')
  const body = await response.json() as {
    results?: Array<{ slug?: unknown; native?: { ownerHandle?: unknown } }>
  }
  const match = body.results?.find((result) => result.slug === source.slug && typeof result.native?.ownerHandle === 'string')
  if (!match || typeof match.native?.ownerHandle !== 'string' || !isSafeClawhubSegment(match.native.ownerHandle)) {
    throw new Error('Could not resolve this ClawHub skill owner')
  }
  return { slug: source.slug, ownerHandle: match.native.ownerHandle }
}

async function clawhubLatestVersion(source: ClawhubPreviewSource): Promise<{ source: { slug: string; ownerHandle: string }; version: string }> {
  const resolved = await resolveClawhubPreviewSource(source)
  const query = new URLSearchParams({ ownerHandle: resolved.ownerHandle })
  const response = await fetch(`https://clawhub.ai/api/v1/skills/${encodeURIComponent(resolved.slug)}?${query}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'Skiller' },
    signal: fetchTimeoutSignal(10_000),
  })
  if (!response.ok) throw new Error('Could not load this ClawHub skill')
  const body = await response.json() as { latestVersion?: { version?: unknown }; skill?: { tags?: { latest?: unknown } } }
  const version = typeof body.latestVersion?.version === 'string'
    ? body.latestVersion.version
    : typeof body.skill?.tags?.latest === 'string'
      ? body.skill.tags.latest
      : null
  if (!version) throw new Error('This ClawHub skill has no published version')
  return { source: resolved, version }
}

async function listClawhubSkillFiles(source: ClawhubPreviewSource): Promise<string[]> {
  const latest = await clawhubLatestVersion(source)
  const query = new URLSearchParams({ ownerHandle: latest.source.ownerHandle })
  const response = await fetch(
    `https://clawhub.ai/api/v1/skills/${encodeURIComponent(latest.source.slug)}/versions/${encodeURIComponent(latest.version)}?${query}`,
    { headers: { Accept: 'application/json', 'User-Agent': 'Skiller' }, signal: fetchTimeoutSignal(10_000) },
  )
  if (!response.ok) throw new Error('Could not load files for this ClawHub skill')
  const body = await response.json() as { version?: { files?: Array<{ path?: unknown }> } }
  return (body.version?.files ?? [])
    .map((file) => typeof file.path === 'string' ? normalizeRemoteSkillPath(file.path) : null)
    .filter((path): path is string => Boolean(path))
    .sort((a, b) => /(^|\/)skill\.md$/i.test(a) ? -1 : /(^|\/)skill\.md$/i.test(b) ? 1 : a.localeCompare(b))
}

async function fetchClawhubSkillContent(source: ClawhubPreviewSource, filePath?: string | null): Promise<string> {
  const path = normalizeRemoteSkillPath(filePath)
  if (!path) throw new Error('A ClawHub file is required')
  const latest = await clawhubLatestVersion(source)
  const query = new URLSearchParams({
    ownerHandle: latest.source.ownerHandle,
    path,
    version: latest.version,
  })
  const response = await fetch(`https://clawhub.ai/api/v1/skills/${encodeURIComponent(latest.source.slug)}/file?${query}`, {
    headers: { Accept: 'text/plain, application/octet-stream', 'User-Agent': 'Skiller' },
    signal: fetchTimeoutSignal(10_000),
  })
  if (!response.ok) throw new Error('Could not load this file from ClawHub')
  return await response.text()
}

function normalizeRemoteSkillPath(value?: string | null): string | null {
  if (!value) return null
  const segments = value.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) return null
  return segments.join('/')
}

async function fetchRemoteSkillContent(
  repoUrl: string,
  skillName?: string | null,
  skillPath?: string | null,
  filePath?: string | null,
  source?: string | null,
  catalogId?: string | null,
): Promise<string> {
  const clawhubSource = remoteClawhubSkillSource(repoUrl)
  if (clawhubSource) return fetchClawhubSkillContent(clawhubSource, filePath)
  if (source === 'skills.sh') {
    const snapshot = await fetchSkillsShGatewaySnapshot(repoUrl, skillPath, skillName, catalogId)
    const content = snapshot ? fileFromGatewaySnapshot(snapshot, filePath) : null
    if (content) return content
    throw new Error('Could not load this skill from the marketplace gateway')
  }
  throw new Error('Remote previews are available only through a supported marketplace provider')
}

async function listRemoteSkillFiles(
  repoUrl: string,
  skillName?: string | null,
  skillPath?: string | null,
  source?: string | null,
  catalogId?: string | null,
): Promise<string[]> {
  const clawhubSource = remoteClawhubSkillSource(repoUrl)
  if (clawhubSource) return listClawhubSkillFiles(clawhubSource)
  if (source === 'skills.sh') {
    const snapshot = await fetchSkillsShGatewaySnapshot(repoUrl, skillPath, skillName, catalogId)
    if (snapshot) return filesFromGatewaySnapshot(snapshot)
    throw new Error('Could not list this skill from the marketplace gateway')
  }
  throw new Error('Remote previews are available only through a supported marketplace provider')
}

export function createRequestHandlers(ctx: {
  /** Host-specific adapter for OS-level calls (quit, file dialog, window chrome). */
  platform: AppPlatform
  rpc: BunSideRpc
  ensureSkillWatcherStarted?: (reason: string) => void
}) {
  const { platform, rpc, ensureSkillWatcherStarted } = ctx
  const getMainWindow = () => platform.getMainWindow()
  let provenanceBaselineReady = false
  const reviewedLinkedPackageUpdates = new Map<string, LinkedSkillPackageUpdate>()

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
    dotagents_machine_inventory: async (): Promise<DotagentsMachineInventoryJson> => {
      const inventory = await scanDotagentsMachine(loadAgentConfigs(getAgentsDir()))
      return dotagentsMachineToJson(inventory)
    },
    dotagents_doctor: async (params: { libraryRoot: string }): Promise<DotagentsDoctorJson> => {
      const configs = loadAgentConfigs(getAgentsDir())
      return dotagentsDoctorToJson(await doctorLibrary({
        root: params.libraryRoot,
        descriptors: dotagentsDescriptorsFromSkiller(configs),
        platform: process.platform as 'darwin' | 'linux' | 'win32',
        home: homedir(),
      }))
    },
    dotagents_materialization_status: async (params: { libraryRoot: string }): Promise<DotagentsMaterializationStatusJson> =>
      dotagentsStatusToJson(await getMaterializationStatus(params.libraryRoot)),
    dotagents_skill_discovery: async (): Promise<DotagentsSkillDiscoveryJson> => {
      const discovery = await scanDotagentsSkillDiscovery(loadDetectedAgents('dotagents_skill_discovery'))
      return dotagentsDiscoveryToJson(discovery.report, discovery.suggestions)
    },
    dotagents_audit: async (params: { libraryRoot: string; visibility: 'private' | 'team' | 'public' }): Promise<DotagentsAuditJson> =>
      dotagentsAuditToJson(await auditLibrary({ root: params.libraryRoot, visibility: params.visibility })),
    dotagents_import_plan: async (params: { libraryRoot: string; decisions: DotagentsImportDecision[] }): Promise<DotagentsImportPlanJson> =>
      dotagentsImportPlanToJson(await planDotagentsImportFromDiscovery(
        params.libraryRoot,
        loadDetectedAgents('dotagents_import_plan'),
        params.decisions,
      )),
    read_skills_cli_lock: async () => readSkillsCliLock(),
    scan_all_skills: async () => {
      const agents = loadDetectedAgents('scan_all_skills')
      let skills = scanAllSkills(agents)
      // dotagents owns the device-local baseline. A fresh install acknowledges
      // the existing toolkit once; only skills arriving afterwards surface as new.
      const skillsCli = new Map((readSkillsCliLock()?.skills ?? []).map((entry) => [entry.name, entry]))
      const observed = observeLocalSkills(skills.map((skill) => {
        const entry = skillsCli.get(skill.id)
        return entry
          ? {
              skill: skill.id,
              source: 'skills.sh' as const,
              repository: entry.source_url,
              skill_path: entry.skill_path,
              ref: entry.ref,
            }
          : { skill: skill.id }
      }))
      if (observed.added.length > 0) skills = scanAllSkills(agents)
      const json = skills.map(skillToJson)
      // Deep Git provenance discovery can traverse hundreds of agent roots.
      // It must never delay the first useful All Skills view. dotagents fills
      // missing source evidence in the background; a later refresh receives
      // the richer state without a visible "checking sources" phase.
      void scanSyncInventoryWithDotagents(agents)
        .then((inventory) => {
          observeLocalSkills(inventory.items.map((item) => item.gitSource
            ? { skill: item.candidateKey, source: 'git' as const, repository: item.gitSource.url, skill_path: item.gitSource.skillPath, ref: item.gitSource.ref, observed_integrity: item.integrity }
            : { skill: item.candidateKey, observed_integrity: item.integrity }))
          // The initial list deliberately returns before deep provenance
          // discovery. Refresh active caches once those read-only facts are
          // ready so a first-run baseline cannot leave a stale review badge.
          if (!provenanceBaselineReady) {
            provenanceBaselineReady = true
            rpc.send('skills_changed')
          }
        })
        .catch(() => undefined)
      setImmediate(() => ensureSkillWatcherStarted?.('after_scan_all_skills'))
      return json
    },
    check_global_skill_updates: async (): Promise<GlobalSkillUpdateCheckJson> => {
      const agents = loadDetectedAgents('check_global_skill_updates')
      const toJsonItems = (items: Awaited<ReturnType<typeof checkGlobalSkillUpdates>>['items']) => items.map((item) => ({
        skill: item.skill,
        description: item.description,
        local_path: item.localPath,
        state: item.state,
        repository: item.repository,
        skill_path: item.skillPath,
        source: item.source,
        managed: item.managed,
        local_integrity: item.localIntegrity,
        remote_integrity: item.remoteIntegrity,
        ...(item.reason ? { reason: item.reason } : {}),
      }))
      rpc.send('global_skill_update_progress', { phase: 'started', completed_sources: 0, total_sources: 0, items: [] })
      const check = await checkGlobalSkillUpdates({
        roots: syncInventoryRoots(agents).map((root) => ({
          path: root.path,
          kind: root.kind,
          ...(root.agentSlug ? { agent: root.agentSlug } : {}),
        })),
        sources: readLocalSkillSources(),
        skillsCliLock: readSkillsCliLock(),
        managedRoots: [sharedSkillsDir()],
        cacheDirectory: (repository) => join(
          appDataRootPath(),
          'source-checkouts',
          createHash('sha256').update(repository).digest('hex').slice(0, 20),
        ),
        onProgress: (progress) => rpc.send('global_skill_update_progress', {
          phase: 'progress',
          completed_sources: progress.completedSources,
          total_sources: progress.totalSources,
          items: toJsonItems(progress.items),
        }),
      })
      const result = {
        checked_at: check.checkedAt,
        items: toJsonItems(check.items),
        new_from_sources: check.newFromSources.map((item) => ({
          skill: item.skill,
          repository: item.repository,
          skill_path: item.skillPath,
          description: item.description,
        })),
      }
      rpc.send('global_skill_update_progress', { phase: 'complete', completed_sources: 0, total_sources: 0, items: result.items })
      return result
    },
    review_linked_skill_package_update: async (params: { repository: string }): Promise<LinkedSkillPackageUpdateJson> => {
      const repository = normalizeGitIdentity(params.repository)
      const packages = await discoverLinkedSkillPackages(sharedSkillsDir())
      for (const candidate of packages) {
        try {
          const reviewed = await planLinkedSkillPackageUpdate({
            sharedRoot: sharedSkillsDir(),
            packageRoot: candidate.root,
            sourcePolicy: exactSourceSecurityPolicy([repository]),
          })
          const remote = reviewed.plan?.remoteIdentity ?? repository
          if (normalizeGitIdentity(remote) !== repository) continue
          if (reviewed.plan) reviewedLinkedPackageUpdates.set(reviewed.plan.planId, reviewed)
          return {
            plan_id: reviewed.plan?.planId ?? '',
            package_name: basename(reviewed.package.root),
            repository: remote,
            linked_skills: reviewed.package.skills,
            state: reviewed.state,
            changed_files: reviewed.plan?.files ?? [],
            local_changes: reviewed.localChanges,
          }
        } catch {
          // This installed package does not match the requested source or is not safe to update.
        }
      }
      throw new Error('No clean installed package was found for this source. Update it through its original installer.')
    },
    apply_linked_skill_package_update: async (params: { plan_id: string }): Promise<{ package_name: string; updated_skills: string[] }> => {
      const reviewed = reviewedLinkedPackageUpdates.get(params.plan_id)
      if (!reviewed) throw new Error('This package review expired. Review the package update again.')
      if (!reviewed.plan) throw new Error('This package has local changes. Review or commit them before updating.')
      const result = await applyLinkedSkillPackageUpdate({
        sharedRoot: sharedSkillsDir(),
        packageRoot: reviewed.package.root,
        plan: reviewed.plan,
      })
      reviewedLinkedPackageUpdates.delete(params.plan_id)
      rpc.send('skills_changed')
      return { package_name: basename(result.package.root), updated_skills: result.package.skills }
    },
    apply_reviewed_global_skill_updates: async (params: { updates: { skill: string; repository: string; skill_path: string | null; expected_local_integrity: string; expected_remote_integrity: string }[] }): Promise<{ updated: string[] }> => {
      const updates = params.updates.map((update) => ({
        skill: update.skill,
        repository: update.repository,
        skillPath: update.skill_path,
        expectedLocalIntegrity: update.expected_local_integrity,
        expectedRemoteIntegrity: update.expected_remote_integrity,
      }))
      const result = await applyReviewedManagedSkillUpdates({
        root: sharedSkillsDir(),
        sources: readLocalSkillSources(),
        updates,
        onProgress: (progress) => rpc.send('skill_update_progress', {
          done: progress.done,
          total: progress.total,
          current_skill: progress.currentSkill,
          phase: progress.phase,
        }),
        cacheDirectory: (repository) => join(
          appDataRootPath(),
          'source-checkouts',
          createHash('sha256').update(repository).digest('hex').slice(0, 20),
        ),
      })
      const sources = readLocalSkillSources()
      for (const item of result.updated) {
        const current = sources[item.skill]
        if (!current) continue
        saveLocalSkillSource(item.skill, {
          source: current.source,
          repository: current.repository,
          skill_path: current.skill_path,
          ref: current.ref,
          content_sha256: current.content_sha256,
          observed_integrity: item.integrity,
          ownership: current.ownership,
          forked_from: current.forked_from,
        })
      }
      return { updated: result.updated.map((item) => item.skill) }
    },
    review_global_skill_update: async (params: { skill: string; repository: string; skill_path: string | null; expected_local_integrity: string; expected_remote_integrity: string }) => {
      const update = {
        skill: params.skill,
        repository: params.repository,
        skillPath: params.skill_path,
        expectedLocalIntegrity: params.expected_local_integrity,
        expectedRemoteIntegrity: params.expected_remote_integrity,
      }
      const details = await reviewGlobalSkillUpdate({
        root: sharedSkillsDir(),
        sources: readLocalSkillSources(),
        update,
        cacheDirectory: (repository) => join(appDataRootPath(), 'source-checkouts', createHash('sha256').update(repository).digest('hex').slice(0, 20)),
      })
      return { skill: details.skill, changes: details.changes.map((change) => ({ path: change.path, kind: change.kind, local_size: change.localSize, remote_size: change.remoteSize })) }
    },
    scan_agent_skills: async (params: { agentSlug: string }) => {
      const { agentSlug } = params
      const all = scanAllSkills(loadDetectedAgents())
      return all
        .filter((s) => s.installations.some((i) => i.agent_slug === agentSlug))
        .map(skillToJson)
    },
    mark_skill_reviewed: async (params: { skillId: string }): Promise<void> => {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(params.skillId)) throw new Error('Invalid skill identifier')
      markLocalSkillReviewed(params.skillId)
    },
    claim_skill_ownership: async (params: { skillId: string }): Promise<void> => {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(params.skillId)) throw new Error('Invalid skill identifier')
      const source = scanAllSkills(loadDetectedAgents('claim_skill_ownership')).find((skill) => skill.id === params.skillId)
      if (!source) throw new Error('This local skill is no longer available')
      const current = readLocalSkillSources()[params.skillId]
      if (current?.ownership === 'external') throw new Error('Fork an external skill before changing it')
      if (current?.ownership === 'forked' || current?.ownership === 'owned') return
      saveLocalSkillSource(params.skillId, {
        source: current?.source ?? 'local',
        repository: current?.repository ?? null,
        skill_path: current?.skill_path ?? null,
        ref: current?.ref ?? null,
        content_sha256: current?.content_sha256 ?? null,
        ownership: 'owned',
      })
    },
    list_skill_improvement_notes: async (params: { skillId: string }): Promise<SkillImprovementNoteJson[]> => {
      const record = readLocalSkillSources()[params.skillId]
      if (!record || (record.ownership !== 'owned' && record.ownership !== 'forked')) return []
      return readSkillImprovementNotes(params.skillId)
    },
    add_skill_improvement_note: async (params: { skillId: string; prompt: string; actual: string; expected: string }): Promise<SkillImprovementNoteJson> => {
      const record = readLocalSkillSources()[params.skillId]
      if (!record || (record.ownership !== 'owned' && record.ownership !== 'forked')) {
        throw new Error('Only your own skills and forks can be improved here')
      }
      return addSkillImprovementNote(params.skillId, params)
    },
    fork_skill_to_library: async (params: { skillId: string; forkId: string }): Promise<SkillJson> => {
      const source = scanAllSkills(loadDetectedAgents('fork_skill_to_library')).find((skill) => skill.id === params.skillId)
      if (!source) throw new Error('This source skill is no longer available')
      const provenance = readLocalSkillSources()[params.skillId]
      if (!provenance || provenance.ownership !== 'external') throw new Error('Only an external skill can be forked')
      forkSkillToLibrary({
        sourceDirectory: source.canonical_path,
        libraryDirectory: sharedSkillsDir(),
        forkId: params.forkId,
        upstream: {
          repository: provenance.repository,
          skill_path: provenance.skill_path,
          ref: provenance.ref,
        },
      })
      const fork = scanAllSkills(loadDetectedAgents('fork_skill_to_library')).find((skill) => skill.id === params.forkId)
      if (!fork) throw new Error('The fork was created but could not be indexed')
      return skillToJson(fork)
    },
    skill_quality_overview: async (): Promise<SkillQualityOverviewJson> =>
      inspectSkillQualityOverview(scanAllSkills(loadDetectedAgents('skill_quality_overview'))),
    skill_quality_reveal_file: async (params: { qualityId: string; relativePath: string }) => {
      if (!/^[a-f0-9]{16}$/.test(params.qualityId)) throw new Error('Invalid quality item identity')
      assertPortableRelativePath(params.relativePath)
      const skill = scanAllSkills(loadDetectedAgents('skill_quality_reveal_file')).find(
        (candidate) => skillQualityIdentity(candidate) === params.qualityId,
      )
      if (!skill) throw new Error('This skill is no longer available locally')
      const root = realpathSync(skill.canonical_path)
      const filePath = join(root, ...params.relativePath.split('/'))
      const relativeTarget = relative(root, filePath)
      if (!relativeTarget || relativeTarget.startsWith(`..${sep}`) || relativeTarget === '..') {
        throw new Error('This quality artifact is outside the skill')
      }
      let cursor = root
      for (const segment of params.relativePath.split('/')) {
        cursor = join(cursor, segment)
        let metadata
        try {
          metadata = lstatSync(cursor)
        } catch {
          throw new Error('This quality artifact is no longer available locally')
        }
        if (metadata.isSymbolicLink()) throw new Error('Linked quality artifacts cannot be revealed')
      }
      if (!lstatSync(filePath).isFile()) throw new Error('This quality artifact is not a regular file')
      platform.showItemInFolder(filePath)
    },
    skill_quality_reveal_folder: async (params: { qualityId: string }) => {
      if (!/^[a-f0-9]{16}$/.test(params.qualityId)) throw new Error('Invalid quality item identity')
      const skill = scanAllSkills(loadDetectedAgents('skill_quality_reveal_folder')).find(
        (candidate) => skillQualityIdentity(candidate) === params.qualityId,
      )
      if (!skill) throw new Error('This skill is no longer available locally')
      let metadata
      try {
        metadata = lstatSync(skill.canonical_path)
      } catch {
        throw new Error('This skill is no longer available locally')
      }
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error('This skill folder is not safe to reveal')
      platform.showItemInFolder(skill.canonical_path)
    },
    skill_quality_eval_preview: async (params: SkillQualityEvalPreviewRequestJson): Promise<SkillQualityEvalPlanJson> => {
      if (!/^[a-f0-9]{16}$/.test(params.qualityId)) throw new Error('Invalid quality item identity')
      const skill = scanAllSkills(loadDetectedAgents('skill_quality_eval_preview')).find(
        (candidate) => skillQualityIdentity(candidate) === params.qualityId,
      )
      if (!skill) throw new Error('This skill is no longer available locally')
      const image = params.sandboxImage?.trim() || 'skillet-eval'
      const inspection = await inspectLocalDockerImage(image)
      const credentialInspection = inspectLocalCredentialProfile(params.credentialProfile ?? 'none')
      return createSkillQualityEvalPlan(skill, params, inspection, credentialInspection)
    },
    skill_quality_dry_start: async (params: {
      request: SkillQualityEvalPreviewRequestJson
      expectedPlanId: string
    }): Promise<SkillQualityDryRunReportJson> => {
      if (params.request.mode !== 'dry') throw new Error('Only dry-check plans can use this runner')
      if (!/^[a-f0-9]{64}$/.test(params.expectedPlanId)) throw new Error('Invalid reviewed plan identity')
      const skill = scanAllSkills(loadDetectedAgents('skill_quality_dry_start')).find(
        (candidate) => skillQualityIdentity(candidate) === params.request.qualityId,
      )
      if (!skill) throw new Error('This skill is no longer available locally')
      const image = params.request.sandboxImage?.trim() || 'skillet-eval'
      const inspection = await inspectLocalDockerImage(image)
      const credentialInspection = inspectLocalCredentialProfile(params.request.credentialProfile ?? 'none')
      const plan = createSkillQualityEvalPlan(skill, params.request, inspection, credentialInspection)
      if (plan.plan_id !== params.expectedPlanId) {
        throw new Error('The skill, eval artifacts, sandbox image, or review policy changed. Review a fresh plan before running.')
      }
      return runSkillQualityDryPlan({ skill, plan })
    },
    skill_quality_measured_start: async (params: {
      request: SkillQualityEvalPreviewRequestJson
      expectedPlanId: string
    }): Promise<SkillQualityMeasuredReportJson> => {
      if (params.request.mode !== 'measured') throw new Error('Only measured plans can use this runner')
      if (!/^[a-f0-9]{64}$/.test(params.expectedPlanId)) throw new Error('Invalid reviewed plan identity')
      const skill = scanAllSkills(loadDetectedAgents('skill_quality_measured_start')).find(
        (candidate) => skillQualityIdentity(candidate) === params.request.qualityId,
      )
      if (!skill) throw new Error('This skill is no longer available locally')
      const image = params.request.sandboxImage?.trim() || 'skillet-eval'
      const inspection = await inspectLocalDockerImage(image)
      const credentialInspection = inspectLocalCredentialProfile(params.request.credentialProfile ?? 'none')
      const plan = createSkillQualityEvalPlan(skill, params.request, inspection, credentialInspection)
      if (plan.plan_id !== params.expectedPlanId) {
        throw new Error('The skill, eval artifacts, sandbox image, credentials, or review policy changed. Review a fresh plan before running.')
      }
      return runSkillQualityMeasuredPlan({ skill, plan })
    },
    list_sync_profiles: async (): Promise<SyncProfileStatusJson[]> => listSyncProfiles(),
	refresh_sync_profiles: async (params?: { requestId?: string }): Promise<SyncProfileStatusJson[]> => withCancellableLibraryCheck(params?.requestId, (signal) => listSyncProfiles(true, signal)),
	sync_select_profile: async (params: { profileId: string }): Promise<{ selected: boolean }> => {
		rememberActiveSyncProfile(params.profileId)
		return { selected: true }
	},
	sync_disconnect_preview: async (params: { profileId: string }): Promise<SyncDisconnectPreviewJson> => {
		const plan = await createSyncDisconnectReview(params.profileId)
		return {
			plan_id: plan.planId,
			profile_id: plan.profileId,
			remote_identity: plan.remoteIdentity,
			can_disconnect: plan.canDisconnect,
			blockers: plan.blockers,
		}
	},
	sync_disconnect_apply: async (params: { profileId: string; planId: string }): Promise<{ disconnected: boolean }> => {
		const plan = await createSyncDisconnectReview(params.profileId)
		await applyReviewedSyncDisconnect(params.planId, plan, () => platform.trashItem(syncWorkspacePath(params.profileId)))
		const remaining = await listSyncProfiles()
		replaceActiveSyncProfile(remaining[0]?.profile_id ?? null)
		return { disconnected: true }
	},
	sync_remote_trust_preview: async (params: { profileId: string; minimumReleaseAgeMinutes?: number }): Promise<SyncRemoteTrustPreviewJson> => {
	  assertSyncStableId(params.profileId)
	  if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
	  const plan = await planSyncWorkspaceRemoteTrust(
	    syncWorkspacePath(params.profileId),
	    params.minimumReleaseAgeMinutes ?? DEFAULT_MINIMUM_RELEASE_AGE_MINUTES,
	  )
	  return {
	    plan_id: plan.planId,
	    remote_identity: plan.remoteIdentity,
	    minimum_release_age_minutes: plan.sourcePolicy.minimum_release_age_minutes,
	  }
	},
	sync_remote_trust_apply: async (params: { profileId: string; planId: string; minimumReleaseAgeMinutes: number }): Promise<void> => {
	  assertSyncStableId(params.profileId)
	  if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
	  await applySyncWorkspaceRemoteTrust(
	    syncWorkspacePath(params.profileId),
	    params.planId,
	    params.minimumReleaseAgeMinutes,
	  )
	},
    scan_sync_inventory: async (): Promise<SyncInventoryJson> => syncInventoryToJson(),
		get_sync_skill_preview: async (params: { skillId: string }): Promise<SyncSkillPreviewJson> => syncSkillPreviewToJson(params.skillId),
    sync_history: async (params: { profileId: string }): Promise<SyncHistoryEntryJson[]> => {
      assertSyncStableId(params.profileId)
      if (!hasSyncWorkspace(params.profileId)) return []
      return listOperationHistory(syncWorkspacePath(params.profileId)).map((record) => {
        const unavailableChange = record.changes.find((change) => change.inverse.kind === 'unavailable')
        return {
          id: record.id,
          operation: record.operation,
          source_plan_id: record.source_plan_id,
          completed_at: record.completed_at,
          undone_at: record.undone_at,
          undo_available: record.undo_available && !record.undone_at,
          undo_unavailable_reason:
            unavailableChange?.inverse.kind === 'unavailable' ? unavailableChange.inverse.reason : null,
          changes: record.changes.map((change) => ({ path: change.path, item_kind: change.itemKind })),
        }
      })
    },
    sync_undo_preview: async (params: { profileId: string; historyId: string }): Promise<SyncUndoPreviewJson> => {
      assertSyncStableId(params.profileId)
      if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
      const plan = planOperationUndo(syncWorkspacePath(params.profileId), params.historyId)
      return {
        plan_id: plan.planId,
        history_id: plan.historyId,
        source_plan_id: plan.sourcePlanId,
        has_conflicts: plan.hasConflicts,
        changes: plan.changes.map((change) => ({
          path: change.path,
          item_kind: change.itemKind,
          action: change.inverse.kind === 'absent' ? 'remove-created' : 'restore-previous',
          ...(change.reason ? { reason: change.reason } : {}),
        })),
      }
    },
    sync_undo_apply: async (params: { profileId: string; historyId: string; planId: string }): Promise<{ restored: string[] }> => {
      assertSyncStableId(params.profileId)
      if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
      const workspace = syncWorkspacePath(params.profileId)
      const record = readOperationHistory(workspace, params.historyId)
      const plan = planOperationUndo(workspace, params.historyId)
      if (plan.planId !== params.planId) throw new Error('Library content changed after Undo review. Review it again.')
      const result = applyOperationUndo(workspace, plan)
      if (record.operation === 'restore-library-skills') {
        const versions = record.changes.flatMap((change) =>
          change.itemKind === 'skill' && change.postcondition.kind === 'directory'
            ? [{ id: change.path, remoteSha256: change.postcondition.integrity }]
            : [],
        )
        if (versions.length > 0) {
          writeSyncLedgerAt(
            syncLedgerPath(params.profileId),
            recordSyncLedgerDeviceChoices(params.profileId, readSyncLedger(params.profileId), versions),
          )
          rpc.send('skills_changed')
        }
      }
      return { restored: result.restored }
    },
    dotagents_resource_overview: async (params: { profileId: string }): Promise<DotagentsResourceOverviewJson> => {
      assertSyncStableId(params.profileId)
      if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
      const workspace = syncWorkspacePath(params.profileId)
      if (!isCanonicalSyncLibrary(workspace)) throw new Error('Upgrade this legacy library before managing agent resources')
      const [manifest, status] = await Promise.all([
        Promise.resolve(readSyncManifestFromWorkspace(workspace)),
        getSyncWorkspaceStatus(workspace),
      ])
      return readResourceLibraryOverview({
        workspace,
        profileId: params.profileId,
        mode: manifest.profile.mode,
        changed: status.changed,
        recentlyAdded: readLocalSyncRecentlyAddedSkills(workspace),
      })
    },
    dotagents_library_mark_seen: async (params: { profileId: string; skillId: string }): Promise<{ ok: true }> => {
      assertSyncStableId(params.profileId)
      assertSyncStableId(params.skillId)
      if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
      const workspace = syncWorkspacePath(params.profileId)
      clearLocalSyncRecentlyAddedSkill(workspace, params.skillId)
      return { ok: true }
    },
    dotagents_library_local_changes: async (params: { profileId: string }): Promise<DotagentsLibraryLocalChangesJson> => {
      assertSyncStableId(params.profileId)
      if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
      const workspace = syncWorkspacePath(params.profileId)
      if (!isCanonicalSyncLibrary(workspace)) throw new Error('Upgrade this legacy library before reviewing local changes')

      const inventory = await readRecentLocalInventory('dotagents_library_local_changes')
      let ledger = readSyncLedger(params.profileId)
      // Older libraries recorded only the portable manifest. Capture the
      // current cross-agent inventory once before presenting changes, so a
      // user who has just created or connected a library is not asked to
      // review pre-existing agent copies as if they edited them today.
      if (!ledger?.observed_content_hashes) {
        const manifest = readSyncManifestFromWorkspace(workspace)
        ledger = makeSyncLedger(
          params.profileId,
          manifest.skills
            .filter((skill): skill is Extract<typeof skill, { kind: 'bundled' }> => skill.kind === 'bundled')
            .map((skill) => ({ id: skill.id, sha256: skill.sha256 })),
          ledger?.external_kept_sources,
          Object.fromEntries(inventory.items.map((item) => [item.candidateKey, item.contentHash])),
        )
        writeSyncLedgerAt(syncLedgerPath(params.profileId), ledger)
      }
      const restore = createSyncRestorePlan(workspace, sharedSkillsDir(), ledger ?? undefined)
      const changes = classifyLibraryLocalChanges({
        inventory,
        manifest: restore.manifest,
        ledger,
        restoreEntries: restore.entries,
        libraryExclusions: readLocalSyncLibraryExclusions(workspace),
      })
      return { profile_id: params.profileId, scanned_at: new Date().toISOString(), changes }
    },
    dotagents_library_local_change_preview: async (params: { profileId: string; skillId: string; file?: string }): Promise<DotagentsLibraryLocalChangePreviewJson> => {
      assertSyncStableId(params.profileId)
      assertSyncStableId(params.skillId)
      if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
      const workspace = syncWorkspacePath(params.profileId)
      if (!isCanonicalSyncLibrary(workspace)) throw new Error('Upgrade this legacy library before inspecting local changes')
      const cacheKey = `${params.profileId}:${params.skillId}`
      let cached = localChangePreviewCache.get(cacheKey)
      if (!cached || cached.expiresAt < Date.now()) {
        const inventory = await readRecentLocalInventory('dotagents_library_local_change_preview')
        const ledger = readSyncLedger(params.profileId)
        const restore = createSyncRestorePlan(workspace, sharedSkillsDir(), ledger ?? undefined)
        const change = classifyLibraryLocalChanges({ inventory, manifest: restore.manifest, ledger, restoreEntries: restore.entries, libraryExclusions: readLocalSyncLibraryExclusions(workspace) })
          .find((candidate) => candidate.id === params.skillId)
        if (!change) throw new Error('This local change is no longer present. Refresh the library.')
        const item = inventory.items.find((candidate) => candidate.candidateKey === params.skillId)
        if (change.kind === 'missing-local' || !item) {
          cached = { expiresAt: Date.now() + LOCAL_CHANGE_PREVIEW_TTL_MS, response: { profile_id: params.profileId, id: params.skillId, kind: change.kind, local_files: [] } }
        } else if (change.kind === 'new-local' || change.kind === 'kept-local') {
          const files = planBundledSkillExport(item.candidateKey, item.sourcePath).files.map((file) => file.relativePath)
          cached = { expiresAt: Date.now() + LOCAL_CHANGE_PREVIEW_TTL_MS, localPath: item.sourcePath, response: { profile_id: params.profileId, id: params.skillId, kind: change.kind, local_files: files } }
        } else {
          const managed = restore.manifest.skills.find((candidate) => candidate.id === params.skillId)
          if (!managed || managed.kind !== 'bundled') throw new Error('This change cannot be compared as a portable skill bundle')
          const libraryPath = join(workspace, managed.path)
          const comparison = buildBundledConflictComparison({ id: managed.id, libraryPath, localPath: item.sourcePath })
          cached = { expiresAt: Date.now() + LOCAL_CHANGE_PREVIEW_TTL_MS, localPath: item.sourcePath, libraryPath, response: { profile_id: params.profileId, id: params.skillId, kind: change.kind, local_files: [], comparison } }
        }
        localChangePreviewCache.set(cacheKey, cached)
      }
      if (!params.file) return cached.response
      if (cached.response.kind === 'new-local' && cached.localPath) {
        try {
          return { ...cached.response, file_preview: previewNewLocalBundleFile({ localPath: cached.localPath, file: params.file, files: cached.response.local_files }) }
        } catch {
          return cached.response
        }
      }
      if (cached.response.comparison && cached.localPath && cached.libraryPath) {
        try {
          return { ...cached.response, file_preview: previewBundledConflictFile({ libraryPath: cached.libraryPath, localPath: cached.localPath, file: params.file, comparison: cached.response.comparison }) }
        } catch {
          return cached.response
        }
      }
      return cached.response
    },
    dotagents_library_new_local_preview: async (params: { profileId: string; skillIds: string[] }): Promise<DotagentsLibraryNewLocalPreviewJson> => {
      assertSyncStableId(params.profileId)
      const ids = selectedSyncSkillIds(params.skillIds)
      if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
      const workspace = syncWorkspacePath(params.profileId)
      if (!isCanonicalSyncLibrary(workspace)) throw new Error('Upgrade this legacy library before reviewing local changes')
      const manifest = readSyncManifestFromWorkspace(workspace)
      const existingIds = new Set(manifest.skills.map((skill) => skill.id))
      const inventory = await readRecentLocalInventory('dotagents_library_new_local_preview')
      const selected = ids.map((id) => inventory.items.find((item) => item.candidateKey === id))
      if (selected.some((item) => !item)) throw new Error('A selected skill changed or is no longer available. Refresh the review.')

      const skills = selected.map((item) => ({
        id: item!.candidateKey,
        displayName: item!.displayName,
        sourcePath: item!.sourcePath,
        contentHash: item!.contentHash,
        installationAgentSlugs: [...new Set(item!.locations.flatMap((location) => location.agentSlug ? [location.agentSlug] : []))].sort(),
      }))
      const existingSkillIds = skills.filter((skill) => existingIds.has(skill.id)).map((skill) => skill.id)
      if (existingSkillIds.length > 0) {
        // Updating a private bundled copy is safe and explicit in the same
        // review. Public/team entries may be immutable external references;
        // their source conversion belongs to a dedicated review, never this
        // convenience flow.
        if (manifest.profile.mode !== 'private') throw new Error('Shared library skills stay linked to their source. Review their library version instead.')
        for (const skill of skills.filter((candidate) => existingIds.has(candidate.id))) {
          const existing = manifest.skills.find((candidate) => candidate.id === skill.id)
          if (!existing || existing.kind !== 'bundled' || existing.sha256 === skill.contentHash) {
            throw new Error('A selected skill no longer has a local change. Refresh the changes list.')
          }
        }
      }
      if (manifest.profile.mode !== 'private') {
        // Shared libraries preserve provenance by default. The same planner
        // used when a library is created resolves external skills to immutable
        // references and keeps unverifiable sources out of the review instead
        // of quietly copying them into a public/team repository.
        const sharedReview = await createSyncCenterPublishPlan(ids, manifest.profile.mode)
        const included = new Map(sharedReview.plan.manifest.skills.map((skill) => [skill.id, skill]))
        const linkedSkills = sharedReview.plan.manifest.skills
          .filter((skill): skill is Extract<typeof skill, { kind: 'reference' | 'skills_sh' }> => skill.kind === 'reference' || skill.kind === 'skills_sh')
          .map((skill) => ({
            id: skill.id,
            display_name: skills.find((item) => item.id === skill.id)?.displayName ?? skill.id,
            source: skill.kind === 'skills_sh' ? 'skills.sh' as const : 'Git' as const,
          }))
        const skippedSkills = skills
          .filter((skill) => !included.has(skill.id))
          .map((skill) => ({
            id: skill.id,
            display_name: skill.displayName,
            reason: (() => {
              const source = sharedReview.unresolvedSources.find((candidate) => candidate.id === skill.id)
              return source ? unresolvedSourceReasonLabel(source.reason) : 'Its source could not be verified yet.'
            })(),
          }))
        const planId = computePlanId({
          kind: 'dotagents-library-new-local-shared',
          schemaVersion: 1,
          profileId: params.profileId,
          manifest,
          reviewPlanId: sharedReview.reviewPlanId,
          skills: skills.map(({ id, contentHash, installationAgentSlugs }) => ({ id, contentHash, installationAgentSlugs })),
        })
        pruneNewLocalLibraryPlans()
        newLocalLibraryPlans.set(planId, { profileId: params.profileId, skills, existingSkillIds, sharedReview, createdAt: Date.now() })
        const secretFindings = secretFindingsForLibraryReview(skills, syncSecretFindingsForJson(sharedReview.plan.bundledSkills), readSyncLedger(params.profileId)?.acknowledged_secret_findings)
        return {
          profile_id: params.profileId,
          plan_id: planId,
          updated_skill_ids: [],
          skills: sharedReview.plan.bundledSkills.map((skill) => ({ id: skill.id, display_name: skills.find((item) => item.id === skill.id)?.displayName ?? skill.id, files: skill.files.length, paths: skill.files.map((file) => file.relativePath) })),
          linked_skills: linkedSkills,
          skipped_skills: skippedSkills,
          secret_findings: secretFindings.filter((finding) => !finding.acknowledged).map(({ relative_path, acknowledged: _acknowledged, ...finding }) => ({ ...finding, file: relative_path })),
          has_blockers: secretFindings.some((finding) => !finding.acknowledged),
        }
      }

      const update = createSyncPublishPlan(params.profileId, manifest.profile.mode, skills.map(({ id, sourcePath, installationAgentSlugs }) => ({ id, sourcePath, installationAgentSlugs })), manifest.agent_policy)
      const planId = computePlanId({
        kind: 'dotagents-library-new-local',
        schemaVersion: 1,
        profileId: params.profileId,
        manifest,
        skills: skills.map(({ id, contentHash, installationAgentSlugs }) => ({ id, contentHash, installationAgentSlugs })),
      })
      pruneNewLocalLibraryPlans()
      newLocalLibraryPlans.set(planId, { profileId: params.profileId, skills, existingSkillIds, createdAt: Date.now() })
      const secretFindings = secretFindingsForLibraryReview(skills, syncSecretFindingsForJson(update.bundledSkills), readSyncLedger(params.profileId)?.acknowledged_secret_findings)
      return {
        profile_id: params.profileId,
        plan_id: planId,
        updated_skill_ids: existingSkillIds,
        skills: update.bundledSkills.map((skill) => ({ id: skill.id, display_name: skills.find((item) => item.id === skill.id)?.displayName ?? skill.id, files: skill.files.length, paths: skill.files.map((file) => file.relativePath) })),
        linked_skills: [],
        skipped_skills: [],
        secret_findings: secretFindings.filter((finding) => !finding.acknowledged).map(({ relative_path, acknowledged: _acknowledged, ...finding }) => ({ ...finding, file: relative_path })),
        has_blockers: secretFindings.some((finding) => !finding.acknowledged),
      }
    },
    dotagents_library_new_local_apply: async (params: { profileId: string; planId: string; acknowledgedSecretFindingKeys?: string[] }): Promise<{ pushed: boolean }> => {
      assertSyncStableId(params.profileId)
      if (!/^[a-f0-9]{64}$/.test(params.planId)) throw new Error('Invalid local change review')
      pruneNewLocalLibraryPlans()
      const reviewed = newLocalLibraryPlans.get(params.planId)
      if (!reviewed || reviewed.profileId !== params.profileId) throw new Error('This local change review expired. Review the changes again.')
      if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
      const workspace = syncWorkspacePath(params.profileId)
      const status = await getSyncWorkspaceStatus(workspace)
      if (!status.remoteUrl || status.changed) throw new Error('Review existing library changes before saving newly found skills')
      const manifest = readSyncManifestFromWorkspace(workspace)
      const inventory = await scanSyncInventoryWithDotagents(loadDetectedAgents('dotagents_library_new_local_apply'))
      const current = new Map(inventory.items.map((item) => [item.candidateKey, item]))
      const candidates: SyncPublishCandidate[] = reviewed.skills.map((skill) => {
        const item = current.get(skill.id)
        if (!item || item.contentHash !== skill.contentHash || item.sourcePath !== skill.sourcePath) throw new Error(`${skill.displayName} changed after review. Refresh the changes list.`)
        return { id: skill.id, sourcePath: skill.sourcePath, installationAgentSlugs: skill.installationAgentSlugs }
      })
      const existingSkillIds = new Set(manifest.skills.filter((skill) => reviewed.skills.some((reviewedSkill) => reviewedSkill.id === skill.id)).map((skill) => skill.id))
      if (existingSkillIds.size !== reviewed.existingSkillIds.length || reviewed.existingSkillIds.some((id) => !existingSkillIds.has(id))) {
        throw new Error('This library changed after review. Refresh the changes list.')
      }
      for (const id of reviewed.existingSkillIds) {
        const existing = manifest.skills.find((skill) => skill.id === id)
        if (manifest.profile.mode !== 'private' || !existing || existing.kind !== 'bundled') {
          throw new Error('This library changed after review. Refresh the changes list.')
        }
      }
      const update = reviewed.sharedReview?.plan ?? createSyncPublishPlan(params.profileId, manifest.profile.mode, candidates, manifest.agent_policy)
      const acknowledgedKeys = new Set((params.acknowledgedSecretFindingKeys ?? []).filter((key): key is string => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key)))
      const ledgerBeforeSave = readSyncLedger(params.profileId)
      const currentSecretFindings = secretFindingsForLibraryReview(reviewed.skills, syncSecretFindingsForJson(update.bundledSkills), ledgerBeforeSave?.acknowledged_secret_findings)
      const unacknowledged = currentSecretFindings.filter((finding) => !finding.acknowledged && !acknowledgedKeys.has(finding.acknowledgement_key))
      if (unacknowledged.length > 0) throw new Error('Possible secrets were found after review. Review and explicitly acknowledge the listed findings before saving.')
      const approvedSecretFindings = currentSecretFindings
        .filter((finding) => finding.acknowledged || acknowledgedKeys.has(finding.acknowledgement_key))
        .map((finding) => ({
          skillId: finding.skill_id,
          rule: finding.rule,
          relativePath: finding.relative_path,
          line: finding.line,
          column: finding.column,
        }))
      const merged = mergeBundledUpdateIntoManifest(manifest, update, { allowNew: true })
      const canonical = await planCanonicalSyncLibrary(workspace, merged, reviewed.sharedReview ? {
        // Newly selected sources were already checked during the review and
        // are now pinned to immutable commits. Resolve the whole merged
        // library under its normal exact-source policy so older, previously
        // approved dependencies remain valid too.
        cacheRoot: join(syncProfilesDirectory(), '.source-cache', 'git'),
      } : undefined)
      applySyncPublishFiles(workspace, merged, canonical.portableFiles, { acknowledgedSecretFindings: approvedSecretFindings })
      const transport = await gitTransportForWorkspace(workspace)
      await commitSyncWorkspace(workspace, 'Skiller sync: add reviewed local skills', {
        acknowledgedSecretFindings: approvedSecretFindings.map((finding) => ({
          file: `skills/${finding.skillId}/${finding.relativePath}`,
          rule: finding.rule as import('dotagents/git-workspace').GitWorkspaceSecretFinding['rule'],
          line: finding.line,
          column: finding.column,
        })),
      })
      await pushSyncWorkspace(workspace, undefined, transport?.port)
      clearLocalSyncLibraryExclusions(workspace, reviewed.skills.map((skill) => skill.id))
      markLocalSyncSkillsRecentlyAdded(workspace, update.bundledSkills.map((skill) => skill.id))
      const ledger = ledgerBeforeSave
      const next = new Map(Object.entries(ledger?.skills ?? {}).map(([id, entry]) => [id, { sha256: entry.sha256, keptRemoteSha256: entry.kept_remote_sha256 }]))
      for (const skill of update.bundledSkills) next.set(skill.id, { sha256: skill.sha256, keptRemoteSha256: undefined })
      const acknowledgedSecretFindings = { ...(ledger?.acknowledged_secret_findings ?? {}) }
      for (const finding of currentSecretFindings) if (acknowledgedKeys.has(finding.acknowledgement_key)) acknowledgedSecretFindings[finding.acknowledgement_key] = { acknowledged_at: new Date().toISOString() }
      writeSyncLedgerAt(syncLedgerPath(params.profileId), {
        ...makeSyncLedger(params.profileId, [...next.entries()].map(([id, entry]) => ({ id, ...entry })), ledger?.external_kept_sources),
        ...(Object.keys(acknowledgedSecretFindings).length > 0 ? { acknowledged_secret_findings: acknowledgedSecretFindings } : {}),
      })
      newLocalLibraryPlans.delete(params.planId)
      return { pushed: true }
    },
    dotagents_library_removal_preview: async (params: { profileId: string; skillId: string }): Promise<DotagentsLibraryRemovalPreviewJson> => {
      assertSyncStableId(params.profileId)
      assertSyncStableId(params.skillId)
      if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
      const workspace = syncWorkspacePath(params.profileId)
      if (!isCanonicalSyncLibrary(workspace)) throw new Error('Upgrade this legacy library before managing agent resources')
      const status = await getSyncWorkspaceStatus(workspace)
      if (status.changed) throw new Error('Review existing library changes before removing a skill')
      const overview = readResourceLibraryOverview({
        workspace,
        profileId: params.profileId,
        mode: readSyncManifestFromWorkspace(workspace).profile.mode,
        changed: status.changed,
      })
      const resource = overview.resources.find((entry) => entry.id === params.skillId)
      if (!resource) throw new Error('This skill is no longer in the library. Refresh and try again.')
      const removal = planCanonicalLibraryRemoval(workspace, params.skillId)
      pruneNewLocalLibraryPlans()
      libraryRemovalPlans.set(removal.planId, {
        profileId: params.profileId,
        skillId: params.skillId,
        skillName: resource.id,
        removedPath: removal.removedPath,
        portableFiles: removal.portableFiles,
        createdAt: Date.now(),
      })
      return { profile_id: params.profileId, plan_id: removal.planId, skill_id: params.skillId, skill_name: resource.id }
    },
    dotagents_library_removal_apply: async (params: { profileId: string; planId: string }): Promise<{ pushed: boolean }> => {
      assertSyncStableId(params.profileId)
      if (!/^[a-f0-9]{64}$/.test(params.planId)) throw new Error('Invalid library removal review')
      pruneNewLocalLibraryPlans()
      const reviewed = libraryRemovalPlans.get(params.planId)
      if (!reviewed || reviewed.profileId !== params.profileId) throw new Error('This library removal review expired. Review it again.')
      const workspace = syncWorkspacePath(params.profileId)
      const status = await getSyncWorkspaceStatus(workspace)
      if (status.changed) throw new Error('The library changed after review. Review the removal again.')
      const fresh = planCanonicalLibraryRemoval(workspace, reviewed.skillId)
      if (fresh.planId !== params.planId) throw new Error('The library changed after review. Review the removal again.')

      const target = join(workspace, ...reviewed.removedPath.split('/'))
      assertPortableRelativePath(reviewed.removedPath)
      if (!existsSync(target) || lstatSync(target).isSymbolicLink()) throw new Error('The saved skill changed after review. Review the removal again.')
      const quarantine = join(workspace, '.dotagents', `remove-${params.planId}`)
      const update = planLibraryUpdate({ root: workspace, skills: [], portableFiles: reviewed.portableFiles })
      if (update.hasConflicts || update.secretFindings.length > 0) throw new Error('The library changed after review. Review the removal again.')
      try {
        mkdirSync(dirname(quarantine), { recursive: true })
        renameSync(target, quarantine)
        applyLibraryUpdatePlan(update, { portableFiles: reviewed.portableFiles })
        rmSync(quarantine, { recursive: true, force: true })
      } catch (cause) {
        if (!existsSync(target) && existsSync(quarantine)) renameSync(quarantine, target)
        throw cause
      }
      const transport = await gitTransportForWorkspace(workspace)
      await commitSyncWorkspace(workspace, `Skiller sync: remove ${reviewed.skillName} from library`)
      await pushSyncWorkspace(workspace, undefined, transport?.port)
      // Removing from a library is not an uninstall. Remember that the local
      // copy is intentionally kept, so the next scan does not falsely present
      // it as a newly discovered skill. A content change reopens the review.
      const local = (await readRecentLocalInventory('dotagents_library_removal_apply')).items
        .find((item) => item.candidateKey === reviewed.skillId)
      if (local) writeLocalSyncLibraryExclusion(workspace, { id: local.candidateKey, integrity: local.contentHash })
      clearLocalSyncRecentlyAddedSkill(workspace, reviewed.skillId)
      libraryRemovalPlans.delete(params.planId)
      return { pushed: true }
    },
		dotagents_resource_content: async (params: { profileId: string; key: string; file?: string }): Promise<DotagentsResourceContentJson> => {
			assertSyncStableId(params.profileId)
			if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
			const workspace = syncWorkspacePath(params.profileId)
			if (!isCanonicalSyncLibrary(workspace)) throw new Error('Upgrade this legacy library before previewing its contents')
			const [manifest, status] = await Promise.all([
				Promise.resolve(readSyncManifestFromWorkspace(workspace)),
				getSyncWorkspaceStatus(workspace),
			])
			return readResourceLibraryContent({ workspace, profileId: params.profileId, mode: manifest.profile.mode, changed: status.changed, key: params.key, file: params.file })
		},
    dotagents_library_health: async (params: { profileId: string }): Promise<DotagentsLibraryHealthJson> => {
      assertSyncStableId(params.profileId)
      if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
      const workspace = syncWorkspacePath(params.profileId)
      if (!isCanonicalSyncLibrary(workspace)) throw new Error('Upgrade this legacy library before reviewing its health')
      return libraryRepairSession.health(workspace, params.profileId)
    },
    dotagents_library_repair_preview: async (params: { profileId: string; selectedCodes: string[] }): Promise<DotagentsLibraryRepairPreviewJson> => {
      assertSyncStableId(params.profileId)
      if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
      const workspace = syncWorkspacePath(params.profileId)
      if (!isCanonicalSyncLibrary(workspace)) throw new Error('Upgrade this legacy library before repairing it')
      return libraryRepairSession.preview({ workspace, profileId: params.profileId, selectedCodes: params.selectedCodes })
    },
    dotagents_library_repair_apply: async (params: { profileId: string; planId: string }): Promise<{ history_id: string }> => {
      assertSyncStableId(params.profileId)
      if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
      const workspace = syncWorkspacePath(params.profileId)
      if (!isCanonicalSyncLibrary(workspace)) throw new Error('Upgrade this legacy library before repairing it')
      return libraryRepairSession.apply({ workspace, profileId: params.profileId, planId: params.planId })
    },
    sync_center_publish_preview: async (params?: { requestId?: string; selectedKeys?: string[]; decisions?: ImportDecision[]; mode?: 'private' | 'team' | 'public'; minimumReleaseAgeMinutes?: number }): Promise<SyncPublishPreviewJson> => {
      const requestId = params?.requestId?.trim()
      const controller = requestId ? new AbortController() : undefined
      if (requestId && controller) syncCenterReviewControllers.set(requestId, controller)
      try {
        const result = await createSyncCenterPublishPlan(
          params?.selectedKeys,
          params?.mode ?? 'private',
          params?.decisions,
          params?.minimumReleaseAgeMinutes ?? DEFAULT_MINIMUM_RELEASE_AGE_MINUTES,
          undefined,
          (progress) => rpc.send('sync_source_review_progress', progress),
          controller?.signal,
        )
        return syncPublishPlanToJson(
          result.plan,
          result.reviewPlanId,
          result.sourceAuthorizationId,
          result.sourcePolicy,
          result.unresolvedSources,
          result.decisions,
          result.sourceTrust,
          result.sourceAges,
        )
      } finally {
        if (requestId && syncCenterReviewControllers.get(requestId) === controller) syncCenterReviewControllers.delete(requestId)
      }
    },
    sync_center_publish_preview_cancel: async (params: { requestId: string }) => {
      const controller = syncCenterReviewControllers.get(params.requestId)
      controller?.abort()
      return { cancelled: Boolean(controller) }
    },
    sync_local_publish_preview: async (params: { profileId: string }): Promise<SyncLocalPublishPreviewJson> => {
      assertSyncStableId(params.profileId)
      if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
      const workspace = syncWorkspacePath(params.profileId)
      const plan = await planSyncWorkspaceLocalPublish(workspace)
      return {
        plan_id: plan.planId,
        files: plan.files.map((file) => file.path),
        has_blockers: plan.hasBlockers,
        secret_findings: plan.secretFindings,
        unsafe_paths: plan.unsafePaths,
        audit_errors: plan.auditErrors,
      }
    },
    sync_local_publish_apply: async (params: { profileId: string; planId: string }) => {
      assertSyncStableId(params.profileId)
      if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
	  const workspace = syncWorkspacePath(params.profileId)
	  const transport = await gitTransportForWorkspace(workspace)
      return applyReviewedSyncWorkspaceLocalPublish(workspace, params.planId, undefined, transport?.port)
    },
    sync_push_pending: async (params: { profileId: string }) => {
      assertSyncStableId(params.profileId)
      if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
      const workspace = syncWorkspacePath(params.profileId)
      const status = await getSyncWorkspaceStatus(workspace)
      if (status.changed) throw new Error('Review the local library changes before uploading')
      if (status.ahead <= 0) return { pushed: false }
	  const transport = await gitTransportForWorkspace(workspace)
      await pushSyncWorkspace(workspace, undefined, transport?.port)
      return { pushed: true }
    },
    sync_center_publish: async (params: {
      remoteUrl: string
      selectedKeys?: string[]
      decisions?: ImportDecision[]
      mode: 'private' | 'team' | 'public'
      license?: SyncCenterLicense
      planId: string
      sourceAuthorizationId: string
      minimumReleaseAgeMinutes: number
    }) => {
      const remoteUrl = params.remoteUrl.trim()
      if (!remoteUrl) throw new Error('A Git remote is required')
      assertCredentialFreeGitRemote(remoteUrl)
	  const gitTransport = await gitTransportForRemote(remoteUrl)
	  const librarySourcePolicy = reviewedRemoteSourcePolicy(remoteUrl, params.minimumReleaseAgeMinutes)
	  const license = syncCenterPublicLicense(params.mode, params.license)
      const remoteIdentity = normalizeGitIdentity(remoteUrl)
      const existingProfile = (await listSyncProfiles()).find((item) => item.remote_identity === remoteIdentity)
      if (existingProfile) {
        throw new Error(`This library is already connected as ${existingProfile.profile_id}. Open it in Agent Library instead of creating a duplicate.`)
      }
      await assertSyncRemoteEmpty(remoteUrl, librarySourcePolicy, undefined, gitTransport?.environment)
      const profileId = availableSyncProfileId(remoteUrl)
      const workspace = syncWorkspacePath(profileId)
		const publishPlan = await createSyncCenterPublishPlan(
        params.selectedKeys,
        params.mode,
        params.decisions,
        params.minimumReleaseAgeMinutes,
        params.sourceAuthorizationId,
		  (progress) => rpc.send('sync_source_review_progress', progress),
		)
		assertReviewedPublishPlan(params.planId, publishPlan.reviewPlanId)
      if (publishPlan.plan.manifest.skills.length === 0) {
        throw new Error('No reviewed skill can be included yet. Adjust the cooling-off period or reconnect the affected Git sources.')
      }
      const canonical = await planCanonicalSyncLibrary(workspace, publishPlan.plan, {
        license,
        sourcePolicy: publishPlan.sourcePolicy,
        cacheRoot: join(syncProfilesDirectory(), '.source-cache', 'git'),
      })
		applySyncPublishFiles(workspace, publishPlan.plan, canonical.portableFiles)
		await initializeSyncWorkspace(workspace, remoteUrl, librarySourcePolicy, gitTransport?.port)
		writeLocalSyncSourceSecurityPolicy(workspace, librarySourcePolicy)
		  const commit = await commitSyncWorkspace(workspace, 'Skiller sync: update skill library')
      await pushSyncWorkspace(workspace, librarySourcePolicy, gitTransport?.port)
      writeSyncLedgerAt(
        syncLedgerPath(profileId),
        makeSyncLedger(profileId, publishPlan.plan.manifest.skills
          .filter((skill): skill is Extract<typeof skill, { kind: 'bundled' }> => skill.kind === 'bundled')
			.map((skill) => ({ id: skill.id, sha256: skill.sha256 })), readSyncLedger(profileId)?.external_kept_sources),
      )
		rememberActiveSyncProfile(profileId)
      return { profile_id: profileId, commit, pushed: true }
    },
    sync_three_way_review: async (params: { profileId: string; requestId?: string }): Promise<SyncThreeWayReviewJson> => withCancellableLibraryCheck(params.requestId, async (signal) => {
      assertSyncStableId(params.profileId)
      if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
      const workspace = syncWorkspacePath(params.profileId)
      const status = await getSyncWorkspaceStatus(workspace)
      if (!status.remoteUrl) throw new Error('This library has no Git remote')
      if (status.changed) throw new Error('Sync workspace has uncommitted changes; resolve them before reviewing')
	  const previousLock = readCanonicalSyncLock(workspace)
		const transport = await gitTransportForWorkspace(workspace)
		const workspacePlan = await planSyncWorkspaceFastForward(workspace, signal, transport?.port)
		if (isLibraryDocumentationOnlyUpdate(workspacePlan.files)) {
			syncProfileCheckStates.rememberSuccess(params.profileId)
			return {
				profile_id: params.profileId,
				workspace_plan_id: workspacePlan.planId,
				reconciliation_plan_id: libraryDocumentationUpdatePlanId(workspacePlan.planId, workspacePlan.files, computePlanId),
				reconciliation_engine: 'dotagents' as const,
				library_update_only: true,
				library_update_files: workspacePlan.files,
				dependency_changes: [],
				skills: [],
			}
		}
		const storedLedger = readSyncLedger(params.profileId)
		const ledger = bootstrapSyncLedgerFromManifest(
			params.profileId,
			readSyncManifestFromWorkspace(workspace).skills,
			storedLedger,
		)
		if (!storedLedger) writeSyncLedgerAt(syncLedgerPath(params.profileId), ledger)
		const reviewed = await inspectSyncWorkspaceFastForward(workspacePlan, (checkout) => {
			const restore = createSyncRestorePlan(checkout, sharedSkillsDir(), ledger ?? undefined)
			return {
				nextLock: readCanonicalSyncLock(checkout),
				restore,
				bundledComparisons: new Map(restore.entries
					.filter((entry) => entry.threeWayAction === 'conflict' || entry.threeWayAction === 'unmanaged' || entry.threeWayAction === 'kept-local')
					.map((entry) => [entry.id, buildBundledConflictComparison({ id: entry.id, libraryPath: entry.sourcePath, localPath: entry.targetPath })])),
			}
		}, signal, transport?.port)
	  syncProfileCheckStates.rememberSuccess(params.profileId)
	  const nextLock = reviewed.nextLock
	  const metadataOnlySkills = metadataOnlySkillIds(previousLock, nextLock)
	  const dependencyChanges = previousLock && nextLock
		? diffLibraryLocks(previousLock, nextLock).filter((change) => change.action !== 'unchanged')
		: []
		const restore = reviewed.restore
		const agents = loadDetectedAgents('sync_three_way_review')
		const routing = syncRestoreAgentRouting(workspace, restore.manifest, agents)
		const externalSkills = restore.manifest.skills.filter((skill): skill is ManagedExternalSkill => skill.kind === 'reference' || skill.kind === 'skills_sh')
      return {
        profile_id: params.profileId,
			workspace_plan_id: workspacePlan.planId,
			reconciliation_plan_id: syncRestorePlanId(restore),
			reconciliation_engine: restore.engine,
			library_update_only: false,
			library_update_files: [],
		dependency_changes: dependencyChanges.map((change) => ({
			dependency: change.dependency,
			action: change.action as 'added' | 'updated' | 'removed',
			from_commit: change.fromCommit,
			to_commit: change.toCommit,
			from_license: change.fromLicense,
			to_license: change.toLicense,
			skills_added: change.skillsAdded,
			skills_removed: change.skillsRemoved,
		})),
			skills: [
			...restore.entries.map((entry) => ({
				id: entry.id,
				kind: 'bundled' as const,
				action: entry.threeWayAction,
				target_agents: routing.forSkill(entry.id),
				...((entry.threeWayAction === 'conflict' || entry.threeWayAction === 'unmanaged' || entry.threeWayAction === 'kept-local')
					? { comparison: reviewed.bundledComparisons.get(entry.id) }
					: {}),
			})),
			...externalSkills.map((skill) => {
				const externalAction = externalReviewAction(skill, agents, ledger?.external_kept_sources, metadataOnlySkills.has(skill.id))
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
					target_agents: routing.forSkill(skill.id),
					source: { repository: externalSkillRepository(skill), ref: skill.ref },
				}
			}),
			],
      }
    }),
		sync_external_conflict_preview: async (params: { profileId: string; skillId: string; workspacePlanId: string; reconciliationPlanId: string; requestId?: string }): Promise<SyncConflictComparisonJson> => withCancellableLibraryCheck(params.requestId, async (signal) => {
			assertSyncStableId(params.profileId)
			assertSyncStableId(params.skillId)
			if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
			const workspace = syncWorkspacePath(params.profileId)
			const status = await getSyncWorkspaceStatus(workspace)
			if (!status.remoteUrl || status.changed) throw new Error('Review this library again before comparing versions')
			const transport = await gitTransportForWorkspace(workspace)
			const workspacePlan = await planSyncWorkspaceFastForward(workspace, signal, transport?.port)
			if (workspacePlan.planId !== params.workspacePlanId) throw new Error('The library changed after review. Review it again before comparing versions.')
			const ledger = readSyncLedger(params.profileId)
			const restore = await inspectSyncWorkspaceFastForward(
				workspacePlan,
				(checkout) => createSyncRestorePlan(checkout, sharedSkillsDir(), ledger ?? undefined),
				signal,
				transport?.port,
			)
			assertReviewedReconciliationPlan(params.reconciliationPlanId, restore)
			const skill = restore.manifest.skills.find((candidate): candidate is ManagedExternalSkill =>
				candidate.id === params.skillId && (candidate.kind === 'reference' || candidate.kind === 'skills_sh'))
			if (!skill) throw new Error('This external skill is no longer part of the reviewed library')
			const agents = loadDetectedAgents('sync_external_conflict_preview')
			if (externalReviewAction(skill, agents, ledger?.external_kept_sources) !== 'conflict') {
				throw new Error('This skill no longer has a conflict. Review the library again.')
			}
			const localPath = resolveSkillSourcePath(skill.id, agents)
			let prepared: PreparedGitSkillInstall | null = null
			try {
				prepared = await prepareGitSkillInstall(
					externalSkillRepository(skill),
					skill.skill_path,
					skill.ref,
					skill.id,
					skill.sha256,
					exactSourceSecurityPolicy([externalSkillRepository(skill)]),
					signal,
				)
				return buildBundledConflictComparison({ id: skill.id, libraryPath: prepared.sourceDir, localPath })
			} catch (error) {
				if (error instanceof Error && error.name === 'AbortError') throw error
				const reason = classifySyncSourceFailure(error)
				throw new Error(reason === 'authentication'
					? 'Sign in to this skill’s Git server, then compare again.'
					: reason === 'timeout' || reason === 'unavailable'
						? 'The original source is not reachable right now. Check your connection, then compare again.'
						: 'The exact saved source version could not be loaded. Review its source details before replacing either copy.')
			} finally {
				if (prepared) discardPreparedGitSkill(prepared)
			}
		}),
    sync_apply_remote_changes: async (params: { profileId: string; skillIds: string[]; workspacePlanId: string; reconciliationPlanId: string }) => applyReviewedRemoteChanges(params.profileId, params.skillIds, rpc, params.workspacePlanId, params.reconciliationPlanId),
	 sync_accept_remote_library_update: async (params: { profileId: string; workspacePlanId: string; reconciliationPlanId: string }) => acceptReviewedRemoteLibraryUpdate(params.profileId, params.workspacePlanId, params.reconciliationPlanId),
	 sync_apply_conflicting_remote_changes: async (params: { profileId: string; skillIds: string[]; workspacePlanId: string; reconciliationPlanId: string }) => applyReviewedRemoteChanges(params.profileId, params.skillIds, rpc, params.workspacePlanId, params.reconciliationPlanId, true),
	 sync_publish_local_changes: async (params: { profileId: string; skillIds: string[]; workspacePlanId: string; reconciliationPlanId: string }) => publishReviewedLocalChanges(params.profileId, params.skillIds, params.workspacePlanId, params.reconciliationPlanId),
	 sync_adopt_local_changes: async (params: { profileId: string; skillIds: string[]; workspacePlanId: string; reconciliationPlanId: string }) => publishReviewedLocalChanges(params.profileId, params.skillIds, params.workspacePlanId, params.reconciliationPlanId, { allowConflict: true }),
	 sync_keep_local_changes: async (params: { profileId: string; skillIds: string[]; workspacePlanId: string; reconciliationPlanId: string }) => keepReviewedLocalChanges(params.profileId, params.skillIds, params.workspacePlanId, params.reconciliationPlanId),
	 sync_keep_external_local_changes: async (params: { profileId: string; skillIds: string[]; workspacePlanId: string; reconciliationPlanId: string }) => keepReviewedExternalChanges(params.profileId, params.skillIds, params.workspacePlanId, params.reconciliationPlanId),
    sync_recovery_status: async (params: { profileId: string }) => {
      assertSyncStableId(params.profileId)
      const restore = readRestoreJournalAt(syncJournalPath(params.profileId))
      const update = inspectLibraryUpdateRecovery(libraryUpdateJournalPath(syncWorkspacePath(params.profileId)))
      const operations = [
        ...(restore ? [{
          kind: 'restore' as const,
          item_count: restore.entries.length,
          changed_item_count: 'kind' in restore
            ? null
            : restore.entries.filter((entry) => entry.stage !== 'pending').length,
        }] : []),
        ...(update ? [{
          kind: 'library-update' as const,
          item_count: update.itemCount,
          changed_item_count: update.changedItemCount,
        }] : []),
      ]
      return { pending: operations.length > 0, operations }
    },
    sync_recovery_rollback: async (params: { profileId: string }) => {
      assertSyncStableId(params.profileId)
      const restored = recoverRestoreJournalAt(syncJournalPath(params.profileId))
      const published = recoverLibraryUpdate(libraryUpdateJournalPath(syncWorkspacePath(params.profileId)))
      return { recovered: restored || published }
    },
    sync_center_connect_preview: async (params: { remoteUrl: string; agentSlugs: string[]; minimumReleaseAgeMinutes: number; requestId?: string }): Promise<SyncConnectPreviewJson> => withCancellableLibraryCheck(params.requestId, async (signal) => {
      const { clone_plan_id: _clonePlanId, ...preview } = await planSyncCenterConnection(params, signal)
      return preview
    }),
    sync_git_destination_preview: async (params: { remoteUrl: string; requestId?: string }): Promise<SyncGitDestinationPreviewJson> => withCancellableLibraryCheck(params.requestId, async (signal) => {
      const remoteUrl = params.remoteUrl.trim()
      if (!remoteUrl) throw new Error('Enter the empty Git repository that will store this library.')
      assertCredentialFreeGitRemote(remoteUrl)
      await assertSyncRemoteEmpty(
        remoteUrl,
        reviewedRemoteSourcePolicy(remoteUrl, 0),
        signal ? new CancellableGitRunner(signal) : undefined,
      )
      return { remote_identity: normalizeGitIdentity(remoteUrl) }
    }),
    sync_library_check_cancel: async (params: { requestId: string }) => {
      const controller = syncLibraryCheckControllers.get(params.requestId)
      controller?.abort()
      syncLibraryCheckControllers.delete(params.requestId)
      return { cancelled: Boolean(controller) }
    },
	sync_center_connect: async (params: { profileId: string; remoteUrl: string; agentSlugs: string[]; planId: string; minimumReleaseAgeMinutes: number; requestId?: string }): Promise<SyncProfileStatusJson> => withCancellableLibraryCheck(params.requestId, async (signal) => {
	  const reviewed = await planSyncCenterConnection(params, signal)
      if (reviewed.plan_id !== params.planId) {
        throw new Error('Repository, destination, or selected agents changed after review. Review the connection again.')
      }
      const connected = await cloneSyncProfile({
        profileId: reviewed.profile_id,
        remoteUrl: params.remoteUrl,
        agentSlugs: reviewed.agent_slugs,
        clonePlanId: reviewed.clone_plan_id,
        minimumReleaseAgeMinutes: params.minimumReleaseAgeMinutes,
	  }, signal)
		rememberActiveSyncProfile(connected.profile_id)
		return connected
	}),
    sync_github_create_repo_preview: async (params: { repository: string; visibility: 'private' | 'public' }): Promise<SyncGitHubRepositoryPreviewJson> => {
      const plan = planGitHubSyncRepository(params.repository, params.visibility)
      const token = await requireGitHubAccessToken()
      const preflight = await preflightGitHubSyncRepository(plan, token)
      if (preflight.status === 'conflict') {
        throw new ProviderOperationError('conflict', 'This GitHub repository name is already in use.')
      }
      return { plan_id: plan.planId, repository: plan.repository, visibility: plan.visibility }
    },
    sync_github_create_repo: async (params: { repository: string; visibility: 'private' | 'public'; planId: string }) => {
      const plan = planGitHubSyncRepository(params.repository, params.visibility)
      if (plan.planId !== params.planId) {
        throw new Error('GitHub repository name or visibility changed after review. Review it again.')
      }
      try {
        return { remoteUrl: await createGitHubSyncRepository(plan, await requireGitHubAccessToken()), problem: null }
      } catch (error) {
        return { remoteUrl: null, problem: { kind: classifyProviderFailure(error) } }
      }
    },
    sync_gitlab_create_project_preview: async (params: { project: string; visibility: 'private' | 'public' }): Promise<SyncGitLabProjectPreviewJson> => {
      const plan = planGitLabSyncProject(params.project, params.visibility)
      const preflight = await preflightGitLabSyncProject(plan, await requireGitLabAccessToken())
      if (preflight.status === 'conflict') {
        throw new ProviderOperationError('conflict', 'This GitLab project name is already in use.')
      }
      return { plan_id: plan.planId, project: plan.project, visibility: plan.visibility }
    },
    sync_gitlab_create_project: async (params: { project: string; visibility: 'private' | 'public'; planId: string }) => {
      const plan = planGitLabSyncProject(params.project, params.visibility)
      if (plan.planId !== params.planId) {
        throw new Error('GitLab project name or visibility changed after review. Review it again.')
      }
      try {
        return { remoteUrl: await createGitLabSyncProject(plan, await requireGitLabAccessToken()), problem: null }
      } catch (error) {
        return { remoteUrl: null, problem: { kind: classifyProviderFailure(error) } }
      }
    },
    sync_provider_libraries: async (params: { provider: 'github' | 'gitlab'; requestId?: string }): Promise<SyncProviderLibrariesResultJson> => {
      const requestId = params.requestId?.trim()
      const controller = requestId ? new AbortController() : undefined
      if (requestId && controller) syncProviderBrowseControllers.set(requestId, controller)
      try {
        try {
          const libraries = params.provider === 'github'
            ? await listGitHubSyncRepositories(await requireGitHubAccessToken(), controller?.signal)
            : await listGitLabSyncProjects(await requireGitLabAccessToken(), controller?.signal)
          return {
            libraries: libraries.map((library) => ({
              provider: params.provider,
              label: library.label,
              remote_url: library.remote,
            })),
            problem: null,
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') throw error
          return { libraries: [], problem: { kind: classifyProviderFailure(error) } }
        }
      } finally {
        if (requestId && syncProviderBrowseControllers.get(requestId) === controller) syncProviderBrowseControllers.delete(requestId)
      }
    },
    sync_provider_libraries_cancel: async (params: { requestId: string }) => {
      const controller = syncProviderBrowseControllers.get(params.requestId)
      controller?.abort()
		syncProviderDeviceAuthorizations.delete(params.requestId)
      return { cancelled: Boolean(controller) }
    },
	  sync_provider_check: async (params: { provider: 'github' | 'gitlab'; requestId?: string }) => {
		const controller = new AbortController()
		if (params.requestId) {
			const previous = syncProviderBrowseControllers.get(params.requestId)
			previous?.abort()
			syncProviderBrowseControllers.set(params.requestId, controller)
		}
		try {
			const status = params.provider === 'github'
				? await checkGitHubConnection(await requireGitHubAccessToken(), controller.signal)
				: await checkGitLabConnection(await requireGitLabAccessToken(), controller.signal)
			return { connected: true, account: status.account, problem: null }
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') throw error
			return { connected: false, account: null, problem: { kind: classifyProviderFailure(error) } }
		} finally {
			if (params.requestId && syncProviderBrowseControllers.get(params.requestId) === controller) {
				syncProviderBrowseControllers.delete(params.requestId)
			}
		}
	  },
	  sync_provider_sign_in_start: async (params: { provider: 'github' | 'gitlab'; requestId: string }) => {
		const controller = new AbortController()
		const previous = syncProviderBrowseControllers.get(params.requestId)
		previous?.abort()
		syncProviderBrowseControllers.set(params.requestId, controller)
      try {
		if (params.provider === 'github') {
			const authorization = await startGitHubDeviceAuthorization(GITHUB_DEVICE_FLOW_CLIENT_ID, controller.signal)
			await platform.openExternal(authorization.verificationUriComplete ?? authorization.verificationUri)
			syncProviderDeviceAuthorizations.set(params.requestId, { provider: 'github', deviceCode: authorization.deviceCode, interval: authorization.interval })
			return { started: true, verification_url: authorization.verificationUriComplete ?? authorization.verificationUri, user_code: authorization.userCode, expires_in: authorization.expiresIn }
		} else {
			const authorization = await startGitLabDeviceAuthorization(GITLAB_DEVICE_FLOW_CLIENT_ID, controller.signal)
			await platform.openExternal(authorization.verificationUriComplete ?? authorization.verificationUri)
			syncProviderDeviceAuthorizations.set(params.requestId, { provider: 'gitlab', deviceCode: authorization.deviceCode, interval: authorization.interval })
			return { started: true, verification_url: authorization.verificationUriComplete ?? authorization.verificationUri, user_code: authorization.userCode, expires_in: authorization.expiresIn }
		}
      } catch (error) {
		if (error instanceof Error && error.name === 'AbortError') throw error
		return { started: false, problem: { kind: classifyProviderFailure(error) } }
	  } finally {
		if (syncProviderBrowseControllers.get(params.requestId) === controller && !syncProviderDeviceAuthorizations.has(params.requestId)) syncProviderBrowseControllers.delete(params.requestId)
      }
    },
	  sync_provider_sign_in_finish: async (params: { provider: 'github' | 'gitlab'; requestId: string }) => {
		const authorization = syncProviderDeviceAuthorizations.get(params.requestId)
		const controller = syncProviderBrowseControllers.get(params.requestId)
		if (!authorization || authorization.provider !== params.provider || !controller)
			return { connected: false, account: null, problem: { kind: 'authentication' } }
		try {
			if (params.provider === 'github') {
				const token = await finishGitHubDeviceAuthorization(GITHUB_DEVICE_FLOW_CLIENT_ID, authorization.deviceCode, authorization.interval, controller.signal)
				await writeProviderToken('github', token.accessToken)
				const status = await checkGitHubConnection(token.accessToken, controller.signal)
				return { connected: true, account: status.account, problem: null }
			}
			const token = await finishGitLabDeviceAuthorization(GITLAB_DEVICE_FLOW_CLIENT_ID, authorization.deviceCode, authorization.interval, controller.signal)
			await writeProviderToken('gitlab', token.accessToken)
			const status = await checkGitLabConnection(token.accessToken, controller.signal)
			return { connected: true, account: status.account, problem: null }
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') throw error
			return { connected: false, account: null, problem: { kind: classifyProviderFailure(error) } }
		} finally {
			syncProviderDeviceAuthorizations.delete(params.requestId)
			if (syncProviderBrowseControllers.get(params.requestId) === controller) syncProviderBrowseControllers.delete(params.requestId)
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
            'git',
            undefined,
            undefined,
            undefined,
            exactSourceSecurityPolicy([src.repo_url]),
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
            'skills.sh',
            undefined,
            undefined,
            undefined,
            exactSourceSecurityPolicy([repo]),
          )
          return
        }
        case 'ClawHub': {
          const repo = src.repository?.trim()
          if (!repo) throw new Error('repository url is required')
          await installSkillFromGit(
			repo,
			'.',
			targetAgents,
			agents,
			'clawhub',
			undefined,
			undefined,
			undefined,
			exactSourceSecurityPolicy([repo]),
		  )
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
      void params
      throw new Error('Review the available updates before applying a change. Direct updates are disabled to protect local work.')
    },
    update_all_skills: async () => {
      void rpc
      throw new Error('Review the available updates before applying a change. Direct updates are disabled to protect local work.')
    },
    list_skill_files: async (params: { path: string }) => {
      const suppliedPath = params.path.replace(/\//g, sep)
      const root = realpathSync(suppliedPath.endsWith(`${sep}SKILL.md`) ? dirname(suppliedPath) : suppliedPath)
      const files: string[] = []
      const walk = (directory: string, depth: number) => {
        if (depth > 6 || files.length >= 128) return
        for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
          if (files.length >= 128 || entry.isSymbolicLink()) continue
          const absolutePath = join(directory, entry.name)
          if (entry.isDirectory()) {
            walk(absolutePath, depth + 1)
            continue
          }
          if (!entry.isFile()) continue
          const portablePath = relative(root, absolutePath).split(sep).join('/')
          if (!portablePath || portablePath.startsWith('../')) continue
          files.push(portablePath)
        }
      }
      walk(root, 0)
      return files.sort((left, right) => left === 'SKILL.md' ? -1 : right === 'SKILL.md' ? 1 : left.localeCompare(right))
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
        'git',
        undefined,
        undefined,
        undefined,
        exactSourceSecurityPolicy([repoUrl]),
      )
    },
    fetch_remote_skill_content: async (params: {
      repoUrl: string
      skillName?: string | null
      skillPath?: string | null
      filePath?: string | null
      source?: string | null
      catalogId?: string | null
    }) => {
      const { repoUrl, skillName, skillPath, filePath, source, catalogId } = params
      return fetchRemoteSkillContent(repoUrl, skillName, skillPath, filePath, source, catalogId)
    },
    list_remote_skill_files: async (params: {
      repoUrl: string
      skillName?: string | null
      skillPath?: string | null
      source?: string | null
      catalogId?: string | null
    }) => {
      return listRemoteSkillFiles(params.repoUrl, params.skillName, params.skillPath, params.source, params.catalogId)
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
        skill_path: s.skill_path ?? null,
        installs: s.installs ?? null,
        source: s.source,
      }
      await installFromMarketplace(
        internal,
        params.targetAgents,
		loadDetectedAgents(),
		exactSourceSecurityPolicy(internal.repository ? [internal.repository] : []),
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
	  }, exactSourceSecurityPolicy([normalizeSkillRepoUrl(params.repoUrl)]))
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
	  const current = listSkillRepos().find((repo) => repo.id === params.repoIdParam)
	  if (!current?.repo_url) throw new Error('Repository has no reviewed remote source')
      const repo = await syncSkillRepo(params.repoIdParam, (p) => {
        rpc.send('repo_progress', p)
	  }, exactSourceSecurityPolicy([current.repo_url]))
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
		open_skill_folder: async (params: { skillId: string }) => {
			const skill = scanAllSkills(loadDetectedAgents('open_skill_folder')).find(
				(candidate) => candidate.id === params.skillId,
			)
			if (!skill) throw new Error('This skill is no longer available locally')
			const folder = skill.canonical_path
			if (!existsSync(folder) || !lstatSync(folder).isDirectory()) {
				throw new Error('This skill folder is no longer available locally')
			}
			await platform.openPath(folder)
		},
		reveal_sync_secret_finding: async (params: { skillId: string; relativePath: string }) => {
			assertSyncStableId(params.skillId)
			assertPortableRelativePath(params.relativePath)
			const item = (await scanSyncInventoryWithDotagents(loadDetectedAgents('reveal_sync_secret_finding'))).items.find((candidate) => candidate.candidateKey === params.skillId)
			if (!item) throw new Error('This skill is no longer available locally')
			const filePath = join(item.sourcePath, params.relativePath)
			if (!existsSync(filePath)) throw new Error('This file is no longer available locally')
			platform.showItemInFolder(filePath)
		},
		open_sync_secret_finding: async (params: { skillId: string; relativePath: string; line?: number; column?: number }) => {
			assertSyncStableId(params.skillId)
			assertPortableRelativePath(params.relativePath)
			if (params.line !== undefined && (!Number.isInteger(params.line) || params.line < 1)) throw new Error('Invalid file line')
			if (params.column !== undefined && (!Number.isInteger(params.column) || params.column < 1)) throw new Error('Invalid file column')
			const item = (await scanSyncInventoryWithDotagents(loadDetectedAgents('open_sync_secret_finding'))).items.find((candidate) => candidate.candidateKey === params.skillId)
			if (!item) throw new Error('This skill is no longer available locally')
			const filePath = join(item.sourcePath, params.relativePath)
			if (!existsSync(filePath)) throw new Error('This file is no longer available locally')
			const openedAtLine = params.line !== undefined && await platform.openPathAtLine?.(filePath, params.line, params.column) === true
			if (!openedAtLine) await platform.openPath(filePath)
			return { openedAtLine }
		},
		reveal_sync_invalid_entry: async (params: { invalidId: string }) => {
			if (!/^[a-f0-9]{64}$/.test(params.invalidId)) throw new Error('Invalid skipped-folder identity')
			const sourcePath = syncInvalidSources.get(params.invalidId)
			if (!sourcePath || !existsSync(sourcePath)) throw new Error('This skipped folder is no longer available. Refresh the library review.')
			platform.showItemInFolder(sourcePath)
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
		  await installSkillToProjectFromGit(
			src.repo_url,
			rel,
			projectPath,
			undefined,
			exactSourceSecurityPolicy([src.repo_url]),
		  )
          return
        }
        case 'SkillsSh':
        case 'ClawHub': {
          const repo = src.repository?.trim()
          if (!repo) throw new Error('repository url is required')
		  await installSkillToProjectFromGit(repo, '.', projectPath, undefined, exactSourceSecurityPolicy([repo]))
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
        skill_path: s.skill_path ?? null,
        installs: s.installs ?? null,
        source: s.source,
      }
	  await installMarketplaceSkillToProject(
		internal,
		params.projectPath,
		exactSourceSecurityPolicy(internal.repository ? [internal.repository] : []),
	  )
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
