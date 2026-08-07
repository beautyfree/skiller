import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
  SyncInventoryJson,
	SyncSkillPreviewJson,
  SyncConnectPreviewJson,
  SyncGitHubRepositoryPreviewJson,
  SyncGitLabProjectPreviewJson,
  SyncProviderLibraryJson,
  SyncThreeWayReviewJson,
  SyncHistoryEntryJson,
  SyncUndoPreviewJson,
  DotagentsLibraryHealthJson,
  DotagentsLibraryRepairPreviewJson,
  DotagentsScopeCompositionPreviewJson,
  DotagentsScopeCompositionUndoPreviewJson,
  DotagentsScopeMigrationPreviewJson,
  DotagentsScopeOverviewJson,
  DotagentsResourceOverviewJson,
  DotagentsResourceSelectionJson,
  DotagentsResourceAdoptionRequestJson,
  DotagentsResourceAdoptionPreviewJson,
  SyncPublishPreviewJson,
  SyncSourceReviewProgressJson,
  UpdateAllResultJson,
  UpdateProgressJson,
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
import { hasLibraryUpdateRecovery, libraryUpdateJournalPath, recoverLibraryUpdate } from 'dotagents/library-update'
import { computePlanId, GitDependencyResolver } from 'dotagents'
import { applyOperationUndo, listOperationHistory, planOperationUndo } from 'dotagents/history'
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
import { scanAllSkills } from './scanner'
import { inspectSkillQualityOverview, skillQualityIdentity } from './skill-quality'
import { createSkillQualityEvalPlan, inspectLocalCredentialProfile, inspectLocalDockerImage } from './skill-quality-eval'
import { runSkillQualityDryPlan } from './skill-quality-dry-run'
import { runSkillQualityMeasuredPlan } from './skill-quality-measured-run'
import { LibraryRepairSession, readResourceLibraryOverview, ResourceAdoptionSession } from './resource-library'
import { ScopeCompositionSession, type ScopeProfileReference } from './scope-composition'
import { discardPreparedGitSkill, installPreparedGitSkill, installSkillFromGit, installSkillFromPath, prepareGitSkillInstall, type PreparedGitSkillInstall } from './install'
import {
  detachSharedSkill,
	unlinkInheritedSkillFromAgentConfigs,
  uninstallSkill,
  uninstallDirectSkillFromAll,
  uninstallSkillFromAll,
} from './uninstall'
import { updateAll, updateSingleSkill } from './update'
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
import { readProvenance, type ProvenanceEntry } from './provenance'
import { scanSyncInventory } from './sync-inventory'
import { planBundledSkillExport } from './sync-export'
import { parseSkillMdFile } from './parser'
import { makeSyncLedger, readSyncLedger, writeSyncLedgerAt, syncLedgerPath } from './sync-ledger'
import { readRestoreJournalAt, recoverRestoreJournalAt, syncJournalPath } from './sync-journal'
import { createGitHubSyncRepository, listGitHubSyncRepositories, planGitHubSyncRepository } from './github-sync'
import { createGitLabSyncProject, listGitLabSyncProjects, planGitLabSyncProject } from './gitlab-sync'
import { applySyncPublishFiles, applySyncPublishPlan, createSyncPublishPlan, mergeBundledUpdateIntoManifest, type SyncPublishCandidate } from './sync-publish'
import { applySyncRestorePlan, createSyncRestorePlan, syncRestorePlanId } from './sync-restore'
import { canonicalSyncAgentRouting, isCanonicalSyncLibrary, planCanonicalSyncLibrary, readCanonicalSyncLock, readSyncManifestFromWorkspace, writeLocalSyncAgentSelection, writeLocalSyncSourceSecurityPolicy } from './sync-dotagents'
import { withReviewTimeout } from './review-timeout'
import { classifyExternalRestore, externalKeptSourceMatches, externalSkillDirectory, externalSkillRepository, type ManagedExternalSkill, type ExternalRestoreAction } from './sync-external'
import { assertCredentialFreeGitRemote, assertPortableRelativePath, assertSyncStableId, syncProfileIdFromRemote, type SyncManifest } from './sync-profile'
import {
	applySyncWorkspaceRemoteTrust,
  applyReviewedSyncWorkspaceFastForward,
  commitSyncWorkspace,
  cloneSyncWorkspace,
  getSyncWorkspaceStatus,
  hasSyncWorkspace,
  initializeSyncWorkspace,
  inspectSyncWorkspaceFastForward,
  planSyncWorkspaceClone,
  planSyncWorkspaceFastForward,
  pushSyncWorkspace,
  setSyncWorkspaceRemote,
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
const resourceAdoptionSession = new ResourceAdoptionSession()
const libraryRepairSession = new LibraryRepairSession()
const scopeCompositionSession = new ScopeCompositionSession({
  stateFile: join(appDataRootPath(), 'scope-composition.local.json'),
  resolveWorkspace: syncWorkspacePath,
})

export type BunSideRpc = {
  send: (
    name: keyof AppRPCSchema['bun']['messages'],
    payload?:
      | UpdateProgressJson
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

type SyncCenterConnectPlan = SyncConnectPreviewJson & { clone_plan_id: string }

async function planSyncCenterConnection(params: {
  profileId?: string
  remoteUrl: string
  agentSlugs: string[]
  minimumReleaseAgeMinutes: number
}): Promise<SyncCenterConnectPlan> {
  const remoteUrl = params.remoteUrl.trim()
  if (!remoteUrl) throw new Error('Enter the Git repository that contains your library')
  assertCredentialFreeGitRemote(remoteUrl)
  const profileId = params.profileId ?? availableSyncProfileId(remoteUrl)
  assertSyncStableId(profileId)
  const agentSlugs = selectedDetectedAgentSlugs(params.agentSlugs, loadDetectedAgents('sync_center_connect_preview'))
  const sourcePolicy = reviewedRemoteSourcePolicy(remoteUrl, params.minimumReleaseAgeMinutes)
  const clone = await planSyncWorkspaceClone(remoteUrl, syncWorkspacePath(profileId), sourcePolicy)
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
}): Promise<SyncProfileStatusJson> {
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
    await cloneSyncWorkspace(
      remoteUrl,
      workspace,
      reviewedRemoteSourcePolicy(remoteUrl, params.minimumReleaseAgeMinutes),
      params.clonePlanId,
    )
    const canonical = isCanonicalSyncLibrary(workspace)
    const manifest = readSyncManifestFromWorkspace(workspace)
    // Legacy profiles used their portable id as their local storage key.
    // Canonical dotagents libraries deliberately separate the repository name
    // from this computer's private profile id.
    if (!canonical && manifest.profile.id !== params.profileId) {
      throw new Error('The legacy remote profile id does not match the requested profile')
    }
    if (localAgentSlugs !== undefined) {
      if (!canonical) throw new Error('Choose-local-agents requires a canonical dotagents library')
      writeLocalSyncAgentSelection(workspace, localAgentSlugs)
    }
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
	  remote_trust_required: false,
    }
  } catch (error) {
    // The destination was proven absent above and belongs solely to this
    // failed clone attempt, so removing it cannot touch an existing profile.
    rmSync(workspace, { recursive: true, force: true })
    throw error
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
	  const remoteTrust = await inspectSyncWorkspaceRemoteTrust(workspace)
	  if (refreshRemote && status.remoteUrl) {
		if (remoteTrust.required) {
		  checkError = 'Review this library remote before Skiller checks it from this device.'
		} else {
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
		remote_trust_required: remoteTrust.required,
      })
    } catch {
      // An incomplete/non-Skiller Git folder is intentionally not a profile.
    }
  }
  return result
}

async function scopeProfileReferences(): Promise<ScopeProfileReference[]> {
  return (await listSyncProfiles()).map((profile) => ({
    profileId: profile.profile_id,
    canonical: isCanonicalSyncLibrary(syncWorkspacePath(profile.profile_id)),
  }))
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
    if (!entry?.repository?.trim()) continue
    try {
      // Absolute paths in provenance describe this device's installation, not
      // a portable upstream. Treating them as Git references leaks private
      // paths and produces manifests that cannot be restored elsewhere.
      if (normalizeGitIdentity(entry.repository).startsWith('file://')) continue
      return entry
    } catch {
      // Invalid provenance is never promoted to a network source implicitly.
      // The skill remains usable as owned/local content after user review.
    }
  }
  return null
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
  reason: 'unverified' | 'too-new'
  ageMinutes?: number
  minimumAgeMinutes?: number
}
type SyncCenterLicense = 'MIT' | 'Apache-2.0' | 'CC0-1.0'
type FinalSyncCenterDisposition = Exclude<ImportDisposition, 'suggested'>
type SyncCenterDecisionOutcome = { candidateKey: string; disposition: FinalSyncCenterDisposition; license?: string }
type SyncCenterExternalSource = {
  kind: 'reference' | 'skills_sh'
  repository: string
  requestedRef: string
  skillPath: string
}
type SyncCenterPreparedItem = {
  item: ReturnType<typeof scanSyncInventory>['items'][number]
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

const SYNC_CENTER_REVIEW_CACHE_TTL_MS = 5 * 60 * 1000
const syncCenterReviewCache = new Map<string, { expiresAt: number; result: SyncCenterPublishPlanResult }>()

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

function syncCenterPublicLicense(mode: 'private' | 'public', license: unknown): SyncCenterLicense | undefined {
  if (mode === 'private') return undefined
  if (license === 'MIT' || license === 'Apache-2.0' || license === 'CC0-1.0') return license
  throw new Error('Choose a license before creating a public library')
}

async function createSyncCenterPublishPlan(
  selectedKeys?: string[],
  mode: 'private' | 'public' = 'private',
  reviewedDecisions?: ImportDecision[],
  minimumReleaseAgeMinutes = DEFAULT_MINIMUM_RELEASE_AGE_MINUTES,
  expectedSourceAuthorizationId?: string,
  onSourceReviewProgress?: (progress: SyncSourceReviewProgressJson) => void,
): Promise<SyncCenterPublishPlanResult> {
  const inventory = scanSyncInventory(loadDetectedAgents('sync_center_publish'))
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
	const provenance = readProvenance()
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
    const git = provenanceEntryForInventoryItem(item, provenance)
    const external: SyncCenterExternalSource | null = skillsCliEntry
      ? {
          kind: 'skills_sh',
          repository: skillsCliEntry.source_url.trim(),
          requestedRef: skillsCliEntry.ref?.trim() || 'HEAD',
          skillPath: skillsCliSkillDirectory(skillsCliEntry) ?? '',
        }
      : git?.repository?.trim()
        ? {
            kind: git.source === 'skills.sh' ? 'skills_sh' : 'reference',
            repository: git.repository.trim(),
            requestedRef: git.ref?.trim() || 'HEAD',
            skillPath: externalSkillDirectory(git.skill_path) ?? '',
          }
        : null
    const requested = requestedDisposition(item.candidateKey)
    const disposition: FinalSyncCenterDisposition = requested === 'suggested'
      ? external ? 'dependency' : 'owned'
      : requested
    const reviewed = decisionByKey.get(item.candidateKey)
    outcomes.set(item.candidateKey, {
      candidateKey: item.candidateKey,
      disposition,
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

  const repositories = prepared.flatMap((entry) => entry.external ? [entry.external.repository] : [])
  const sourcePolicy = exactSourceSecurityPolicy(repositories, {
    minimum_release_age_minutes: minimumReleaseAgeMinutes,
  })
  const sourceTrustBySource = new Map<string, SourceTrustDecision>()
  for (const repository of repositories) {
    assertCredentialFreeGitRemote(repository)
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
      ...(entry.external ? {
        source: requireTrustedSource(entry.external.repository, sourcePolicy).source,
        requestedRef: entry.external.requestedRef,
        skillPath: entry.external.skillPath,
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
    if (!entry.external) continue
    const source = requireTrustedSource(entry.external.repository, sourcePolicy).source
    const key = `${source}\u0000${entry.external.requestedRef}`
    const group = sourceGroups.get(key)
    if (group) group.entries.push(entry)
    else sourceGroups.set(key, { source, requestedRef: entry.external.requestedRef, entries: [entry] })
  }
  const resolver = new GitDependencyResolver({
    cacheRoot: join(syncProfilesDirectory(), '.source-cache', 'git'),
    sourcePolicy,
  })
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
    16,
    async (group) => {
      const first = group.entries[0]!.external!
      try {
        const resolved = await withReviewTimeout(resolver.resolve(`sync-center-${computePlanId({ source: group.source, ref: group.requestedRef }).slice(0, 16)}`, {
          url: first.repository,
          ref: group.requestedRef,
          select: [...new Set(group.entries.map((entry) => entry.external!.skillPath))].sort(),
        }), group.source)
        if (!resolved.committed_at) throw new Error(`Git source ${group.source} did not provide a commit timestamp`)
        verifiedSourceGroups += 1
        return { group, resolved } as const
      } catch (error) {
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
          reason: releaseAge ? 'too-new' : 'unverified',
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
    if (entry.disposition === 'owned') {
      candidates.push({ kind: 'bundled', id: entry.item.candidateKey, sourcePath: entry.item.sourcePath, installationAgentSlugs: entry.installationAgentSlugs })
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
	targets: string[],
): Promise<{ skill: ManagedExternalSkill; prepared: PreparedGitSkillInstall; targets: string[] } | null> {
	const action = externalRestoreAction(skill, agents)
	if (action === 'unchanged') return null
	if (action === 'conflict') {
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
	await applyReviewedSyncWorkspaceFastForward(workspace, expectedWorkspacePlanId)
	const ledger = readSyncLedger(profileId)
	const plan = createSyncRestorePlan(workspace, sharedSkillsDir(), ledger ?? undefined)
  assertReviewedReconciliationPlan(expectedPlanId, plan)
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
		const action = entry.threeWayAction
	if (action !== 'take-remote' && !(allowConflict && action === 'conflict')) throw new Error(`Remote change must be resolved manually: ${id}`)
  }
	const routing = syncRestoreAgentRouting(workspace, plan.manifest, agents)
	const preparedExternal: { skill: ManagedExternalSkill; prepared: PreparedGitSkillInstall; targets: string[] }[] = []
	try {
		for (const id of skillIds.filter((id) => externalSkills.has(id))) {
			const prepared = await prepareManagedExternalSkill(externalSkills.get(id)!, agents, routing.forSkill(id))
			if (prepared) preparedExternal.push(prepared)
		}
		applySyncRestorePlan(plan, skillIds.filter((id) => entries.has(id)), profileId)
		for (const id of skillIds.filter((id) => entries.has(id))) {
			const targets = routing.forSkill(id)
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
	await applyReviewedSyncWorkspaceFastForward(workspace, expectedWorkspacePlanId)
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
	await applyReviewedSyncWorkspaceFastForward(workspace, expectedWorkspacePlanId)
	const ledger = readSyncLedger(profileId)
	const restore = createSyncRestorePlan(workspace, sharedSkillsDir(), ledger ?? undefined)
  assertReviewedReconciliationPlan(expectedPlanId, restore)
  const entries = new Map(restore.entries.map((entry) => [entry.id, entry]))
  const nextSkills = new Map(Object.entries(ledger?.skills ?? {}).map(([id, entry]) => [id, { sha256: entry.sha256, keptRemoteSha256: entry.kept_remote_sha256 }]))
  for (const id of skillIds) {
    const entry = entries.get(id)
    if (!entry || entry.localSha256 === null) throw new Error(`Local skill is not available: ${id}`)
		const action = entry.threeWayAction
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
	await applyReviewedSyncWorkspaceFastForward(workspace, expectedWorkspacePlanId)
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

async function fetchRemoteSkillContent(
  repoUrl: string,
  skillName?: string | null
): Promise<string> {
  const trust = requireTrustedSource(repoUrl, exactSourceSecurityPolicy([repoUrl]))
  if (trust.kind !== 'git') throw new Error('Skill preview requires a remote GitHub repository')
  const repository = new URL(trust.source)
  if (repository.protocol !== 'https:' || repository.hostname !== 'github.com') {
    throw new Error('Remote SKILL.md preview currently supports HTTPS GitHub repositories only')
  }
  const parts = repository.pathname.replace(/\.git$/, '').split('/').filter(Boolean)
  if (parts.length !== 2) throw new Error('GitHub repository must identify exactly one owner and repository')
  const rawBase = `https://raw.githubusercontent.com/${encodeURIComponent(parts[0]!)}/${encodeURIComponent(parts[1]!)}`
  const branches = ['main', 'master'] as const
  const filePaths: string[] = []
  if (skillName) filePaths.push(`skills/${encodeURIComponent(skillName)}/SKILL.md`)
  filePaths.push('SKILL.md')

  for (const path of filePaths) {
    for (const branch of branches) {
      const url = `${rawBase}/${branch}/${path}`
      try {
        const res = await fetch(url, { signal: fetchTimeoutSignal(10_000), redirect: 'error' })
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
	refresh_sync_profiles: async (): Promise<SyncProfileStatusJson[]> => listSyncProfiles(true),
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
      return listOperationHistory(syncWorkspacePath(params.profileId)).map((record) => ({
        id: record.id,
        operation: record.operation,
        source_plan_id: record.source_plan_id,
        completed_at: record.completed_at,
        undo_available: record.undo_available,
        changes: record.changes.map((change) => ({ path: change.path, item_kind: change.itemKind })),
      }))
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
      const plan = planOperationUndo(syncWorkspacePath(params.profileId), params.historyId)
      if (plan.planId !== params.planId) throw new Error('Library content changed after Undo review. Review it again.')
      return { restored: applyOperationUndo(syncWorkspacePath(params.profileId), plan).restored }
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
      })
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
    dotagents_scope_overview: async (): Promise<DotagentsScopeOverviewJson> => {
      return scopeCompositionSession.overview(await scopeProfileReferences())
    },
    dotagents_scope_migration_preview: async (params: { profileId: string; scope: 'personal' | 'project' }): Promise<DotagentsScopeMigrationPreviewJson> => {
      assertSyncStableId(params.profileId)
      if (!['personal', 'project'].includes(params.scope)) throw new Error('Choose Personal or Project')
      if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
      if (!isCanonicalSyncLibrary(syncWorkspacePath(params.profileId))) throw new Error('Upgrade this legacy library before assigning a scope')
      return scopeCompositionSession.previewMigration(params)
    },
    dotagents_scope_migration_apply: async (params: { profileId: string; planId: string }): Promise<{ history_id: string }> => {
      assertSyncStableId(params.profileId)
      if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
      if (!isCanonicalSyncLibrary(syncWorkspacePath(params.profileId))) throw new Error('Upgrade this legacy library before assigning a scope')
      return scopeCompositionSession.applyMigration(params)
    },
    dotagents_scope_composition_preview: async (params: {
      personalProfileId: string | null
      projectProfileId: string | null
      exclusions: string[]
    }): Promise<DotagentsScopeCompositionPreviewJson> => {
      if (params.personalProfileId) assertSyncStableId(params.personalProfileId)
      if (params.projectProfileId) assertSyncStableId(params.projectProfileId)
      return scopeCompositionSession.previewComposition({ profiles: await scopeProfileReferences(), ...params })
    },
    dotagents_scope_composition_apply: async (params: { planId: string }): Promise<DotagentsScopeCompositionPreviewJson> => {
      return scopeCompositionSession.applyComposition(params.planId, await scopeProfileReferences())
    },
    dotagents_scope_composition_undo_preview: async (): Promise<DotagentsScopeCompositionUndoPreviewJson | null> => {
      return scopeCompositionSession.previewCompositionUndo(await scopeProfileReferences())
    },
    dotagents_scope_composition_undo_apply: async (params: { planId: string }): Promise<DotagentsScopeCompositionPreviewJson | null> => {
      return scopeCompositionSession.applyCompositionUndo(params.planId, await scopeProfileReferences())
    },
    dotagents_resource_pick_source: async (params: { kind: 'skill' | 'instruction' | 'command' | 'subagent' }): Promise<DotagentsResourceSelectionJson | null> => {
      if (!['skill', 'instruction', 'command', 'subagent'].includes(params.kind)) throw new Error('Unsupported resource kind')
      const selected = params.kind === 'skill'
        ? await platform.pickFolder({ title: 'Choose the skill folder to bring into your library' })
        : await platform.pickFile({ title: `Choose the ${params.kind} file to bring into your library` })
      return selected ? resourceAdoptionSession.registerSelection(selected, params.kind) : null
    },
    dotagents_resource_adopt_preview: async (params: DotagentsResourceAdoptionRequestJson): Promise<DotagentsResourceAdoptionPreviewJson> => {
      assertSyncStableId(params.profileId)
      if (!hasSyncWorkspace(params.profileId)) throw new Error('This library has not been set up on this computer')
      const workspace = syncWorkspacePath(params.profileId)
      if (!isCanonicalSyncLibrary(workspace)) throw new Error('Upgrade this legacy library before managing agent resources')
      const manifest = readSyncManifestFromWorkspace(workspace)
      return resourceAdoptionSession.preview({ workspace, profileId: params.profileId, mode: manifest.profile.mode, request: params })
    },
    dotagents_resource_adopt_apply: async (params: { planId: string }): Promise<{ history_id: string; resource_key: string }> => {
      return resourceAdoptionSession.apply(params.planId)
    },
    sync_center_publish_preview: async (params?: { selectedKeys?: string[]; decisions?: ImportDecision[]; mode?: 'private' | 'public'; minimumReleaseAgeMinutes?: number }): Promise<SyncPublishPreviewJson> => {
      const result = await createSyncCenterPublishPlan(
        params?.selectedKeys,
        params?.mode ?? 'private',
        params?.decisions,
        params?.minimumReleaseAgeMinutes ?? DEFAULT_MINIMUM_RELEASE_AGE_MINUTES,
        undefined,
        (progress) => rpc.send('sync_source_review_progress', progress),
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
    },
    sync_center_publish: async (params: {
      remoteUrl: string
      selectedKeys?: string[]
      decisions?: ImportDecision[]
      mode: 'private' | 'public'
      license?: SyncCenterLicense
      planId: string
      sourceAuthorizationId: string
      minimumReleaseAgeMinutes: number
    }) => {
      const remoteUrl = params.remoteUrl.trim()
      if (!remoteUrl) throw new Error('A Git remote is required')
      assertCredentialFreeGitRemote(remoteUrl)
	  const librarySourcePolicy = reviewedRemoteSourcePolicy(remoteUrl, params.minimumReleaseAgeMinutes)
	  const license = syncCenterPublicLicense(params.mode, params.license)
      const profileId = 'agent-library'
      const workspace = syncWorkspacePath(profileId)
      const existingWorkspace = hasSyncWorkspace(profileId)
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
      const canonical = !existingWorkspace || isCanonicalSyncLibrary(workspace)
        ? await planCanonicalSyncLibrary(workspace, publishPlan.plan, {
            license,
            sourcePolicy: publishPlan.sourcePolicy,
            cacheRoot: join(syncProfilesDirectory(), '.source-cache', 'git'),
          })
        : null
      if (existingWorkspace) {
        const status = await getSyncWorkspaceStatus(workspace)
        if (status.changed) throw new Error('Sync workspace has uncommitted changes; resolve them before publishing')
			if (status.remoteUrl && status.remoteUrl !== remoteUrl) throw new Error('This library already uses a different remote')
		if (!status.remoteUrl) await setSyncWorkspaceRemote(workspace, remoteUrl, librarySourcePolicy)
      }
		if (existingWorkspace && !isCanonicalSyncLibrary(workspace)) {
			// Existing libraries retain their versioned legacy format until the user
			// explicitly migrates; newly created libraries are canonical dotagents.
			applySyncPublishPlan(workspace, publishPlan.plan)
		} else {
			applySyncPublishFiles(workspace, publishPlan.plan, canonical!.portableFiles)
			if (!existingWorkspace) await initializeSyncWorkspace(workspace, remoteUrl, librarySourcePolicy)
		}
		  if (isCanonicalSyncLibrary(workspace)) writeLocalSyncSourceSecurityPolicy(workspace, librarySourcePolicy)
		  const commit = await commitSyncWorkspace(workspace, 'Skiller sync: update skill library')
      await pushSyncWorkspace(workspace, librarySourcePolicy)
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
	  const previousLock = readCanonicalSyncLock(workspace)
		const workspacePlan = await planSyncWorkspaceFastForward(workspace)
		const ledger = readSyncLedger(params.profileId)
		const reviewed = await inspectSyncWorkspaceFastForward(workspacePlan, (checkout) => ({
			nextLock: readCanonicalSyncLock(checkout),
			restore: createSyncRestorePlan(checkout, sharedSkillsDir(), ledger ?? undefined),
		}))
	  const nextLock = reviewed.nextLock
	  const dependencyChanges = previousLock && nextLock
		? diffLibraryLocks(previousLock, nextLock).filter((change) => change.action !== 'unchanged')
		: []
		const restore = reviewed.restore
		const agents = loadDetectedAgents('sync_three_way_review')
		const externalSkills = restore.manifest.skills.filter((skill): skill is ManagedExternalSkill => skill.kind === 'reference' || skill.kind === 'skills_sh')
      return {
        profile_id: params.profileId,
			workspace_plan_id: workspacePlan.planId,
			reconciliation_plan_id: syncRestorePlanId(restore),
			reconciliation_engine: restore.engine,
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
    sync_apply_remote_changes: async (params: { profileId: string; skillIds: string[]; workspacePlanId: string; reconciliationPlanId: string }) => applyReviewedRemoteChanges(params.profileId, params.skillIds, rpc, params.workspacePlanId, params.reconciliationPlanId),
	 sync_apply_conflicting_remote_changes: async (params: { profileId: string; skillIds: string[]; workspacePlanId: string; reconciliationPlanId: string }) => applyReviewedRemoteChanges(params.profileId, params.skillIds, rpc, params.workspacePlanId, params.reconciliationPlanId, true),
	 sync_publish_local_changes: async (params: { profileId: string; skillIds: string[]; workspacePlanId: string; reconciliationPlanId: string }) => publishReviewedLocalChanges(params.profileId, params.skillIds, params.workspacePlanId, params.reconciliationPlanId),
	 sync_adopt_local_changes: async (params: { profileId: string; skillIds: string[]; workspacePlanId: string; reconciliationPlanId: string }) => publishReviewedLocalChanges(params.profileId, params.skillIds, params.workspacePlanId, params.reconciliationPlanId, { allowConflict: true }),
	 sync_keep_local_changes: async (params: { profileId: string; skillIds: string[]; workspacePlanId: string; reconciliationPlanId: string }) => keepReviewedLocalChanges(params.profileId, params.skillIds, params.workspacePlanId, params.reconciliationPlanId),
	 sync_keep_external_local_changes: async (params: { profileId: string; skillIds: string[]; workspacePlanId: string; reconciliationPlanId: string }) => keepReviewedExternalChanges(params.profileId, params.skillIds, params.workspacePlanId, params.reconciliationPlanId),
    sync_recovery_status: async (params: { profileId: string }) => {
      assertSyncStableId(params.profileId)
      const restorePending = readRestoreJournalAt(syncJournalPath(params.profileId)) !== null
      const publishPending = hasLibraryUpdateRecovery(libraryUpdateJournalPath(syncWorkspacePath(params.profileId)))
      return { pending: restorePending || publishPending }
    },
    sync_recovery_rollback: async (params: { profileId: string }) => {
      assertSyncStableId(params.profileId)
      const restored = recoverRestoreJournalAt(syncJournalPath(params.profileId))
      const published = recoverLibraryUpdate(libraryUpdateJournalPath(syncWorkspacePath(params.profileId)))
      return { recovered: restored || published }
    },
    sync_center_connect_preview: async (params: { remoteUrl: string; agentSlugs: string[]; minimumReleaseAgeMinutes: number }): Promise<SyncConnectPreviewJson> => {
      const { clone_plan_id: _clonePlanId, ...preview } = await planSyncCenterConnection(params)
      return preview
    },
    sync_center_connect: async (params: { profileId: string; remoteUrl: string; agentSlugs: string[]; planId: string; minimumReleaseAgeMinutes: number }): Promise<SyncProfileStatusJson> => {
      const reviewed = await planSyncCenterConnection(params)
      if (reviewed.plan_id !== params.planId) {
        throw new Error('Repository, destination, or selected agents changed after review. Review the connection again.')
      }
      return cloneSyncProfile({
        profileId: reviewed.profile_id,
        remoteUrl: params.remoteUrl,
        agentSlugs: reviewed.agent_slugs,
        clonePlanId: reviewed.clone_plan_id,
        minimumReleaseAgeMinutes: params.minimumReleaseAgeMinutes,
      })
    },
    sync_github_create_repo_preview: async (params: { repository: string; visibility: 'private' | 'public' }): Promise<SyncGitHubRepositoryPreviewJson> => {
      const plan = planGitHubSyncRepository(params.repository, params.visibility)
      return { plan_id: plan.planId, repository: plan.repository, visibility: plan.visibility }
    },
    sync_github_create_repo: async (params: { repository: string; visibility: 'private' | 'public'; planId: string }) => {
      const plan = planGitHubSyncRepository(params.repository, params.visibility)
      if (plan.planId !== params.planId) {
        throw new Error('GitHub repository name or visibility changed after review. Review it again.')
      }
      return { remoteUrl: await createGitHubSyncRepository(plan) }
    },
    sync_gitlab_create_project_preview: async (params: { project: string; visibility: 'private' | 'public' }): Promise<SyncGitLabProjectPreviewJson> => {
      const plan = planGitLabSyncProject(params.project, params.visibility)
      return { plan_id: plan.planId, project: plan.project, visibility: plan.visibility }
    },
    sync_gitlab_create_project: async (params: { project: string; visibility: 'private' | 'public'; planId: string }) => {
      const plan = planGitLabSyncProject(params.project, params.visibility)
      if (plan.planId !== params.planId) {
        throw new Error('GitLab project name or visibility changed after review. Review it again.')
      }
      return { remoteUrl: await createGitLabSyncProject(plan) }
    },
    sync_provider_libraries: async (params: { provider: 'github' | 'gitlab' }): Promise<SyncProviderLibraryJson[]> => {
      const libraries = params.provider === 'github'
        ? await listGitHubSyncRepositories()
        : await listGitLabSyncProjects()
      return libraries.map((library) => ({
        provider: params.provider,
        label: library.label,
        remote_url: library.remote,
      }))
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
      const { skillId } = params
	  const repository = readProvenance()[skillId]?.repository?.trim()
      await updateSingleSkill(
		skillId,
		loadDetectedAgents(),
		exactSourceSecurityPolicy(repository ? [repository] : []),
	  )
    },
    update_all_skills: async () => {
      const agents = loadDetectedAgents()
	  const repositories = Object.values(readProvenance()).flatMap((entry) => entry.repository?.trim() ? [entry.repository.trim()] : [])
      const result = await updateAll(agents, (p) => {
        rpc.send('skill_update_progress', p)
	  }, exactSourceSecurityPolicy(repositories))
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
