import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  applyLegacyScopeMigrationPlan,
  createLegacyScopeMigrationPlan,
  createScopeCompositionPlan,
  readPortableScopeDescriptor,
  type PortableScope,
  type ScopeCompositionPlan,
  type ScopeMigrationPlan,
} from 'dotagents/scope'
import { loadLibrary, type LibraryFiles } from 'dotagents/library'
import { computePlanId } from 'dotagents'
import { z } from 'zod'
import type {
  DotagentsScopeCompositionPreviewJson,
  DotagentsScopeCompositionUndoPreviewJson,
  DotagentsScopeMigrationPreviewJson,
  DotagentsScopeOverviewJson,
  DotagentsScopeProfileJson,
} from '../shared/rpc-schema'

const SESSION_TTL_MS = 15 * 60_000
const MAX_DEVICE_SCOPE_LOCAL_BYTES = 512 * 1024
const PROFILE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i
const RESOURCE_KEY = /^(skill|instruction|command|subagent):[a-z0-9]+(?:-[a-z0-9]+)*$/

const deviceScopeStateSchema = z.object({
  schema_version: z.literal(1),
  personal_profile_id: z.string().regex(PROFILE_ID).nullable(),
  project_profile_id: z.string().regex(PROFILE_ID).nullable(),
  exclusions: z.array(z.string().regex(RESOURCE_KEY)).max(10_000),
}).strict()

type DeviceScopeState = z.infer<typeof deviceScopeStateSchema>
export type ScopeProfileReference = { profileId: string; canonical: boolean }
type MigrationCached = { profileId: string; plan: ScopeMigrationPlan; createdAt: number }
type CompositionRequest = {
  personalProfileId: string | null
  projectProfileId: string | null
  exclusions: string[]
}
type CompositionCached = { request: CompositionRequest; preview: DotagentsScopeCompositionPreviewJson; createdAt: number }
type UndoCached = {
  historyId: string
  expectedState: DeviceScopeState
  targetState: DeviceScopeState
  targetPreview: DotagentsScopeCompositionPreviewJson | null
  createdAt: number
}

const emptyState: DeviceScopeState = {
  schema_version: 1,
  personal_profile_id: null,
  project_profile_id: null,
  exclusions: [],
}

const deviceScopeHistoryRecordSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().uuid(),
  operation: z.enum(['scope-composition', 'scope-composition-undo']),
  source_plan_id: z.string().regex(/^[a-f0-9]{64}$/),
  completed_at: z.string().datetime(),
  before: deviceScopeStateSchema,
  after: deviceScopeStateSchema,
}).strict()

const deviceScopeHistorySchema = z.object({
  schema_version: z.literal(1),
  records: z.array(deviceScopeHistoryRecordSchema).max(50),
}).strict()

const deviceScopeJournalSchema = z.object({
  schema_version: z.literal(1),
  record: deviceScopeHistoryRecordSchema,
}).strict()

type DeviceScopeHistoryRecord = z.infer<typeof deviceScopeHistoryRecordSchema>
type DeviceScopeHistory = z.infer<typeof deviceScopeHistorySchema>
type DeviceScopeJournal = z.infer<typeof deviceScopeJournalSchema>

function sameState(left: DeviceScopeState, right: DeviceScopeState): boolean {
  return left.personal_profile_id === right.personal_profile_id
    && left.project_profile_id === right.project_profile_id
    && left.exclusions.length === right.exclusions.length
    && left.exclusions.every((value, index) => value === right.exclusions[index])
}

function stableProfileId(value: string): string {
  if (!PROFILE_ID.test(value)) throw new Error('Invalid scope profile id')
  return value
}

function stableExclusions(values: string[]): string[] {
  return [...new Set(values.map((value) => {
    if (!RESOURCE_KEY.test(value)) throw new Error('Invalid Device exclusion')
    return value
  }))].sort((left, right) => left.localeCompare(right, 'en'))
}

function safeIssue(): string {
  return 'This canonical library needs repair before its scope can be managed.'
}

function mapComposition(
  plan: ScopeCompositionPlan,
  request: CompositionRequest,
  wrapperPlanId: string,
): DotagentsScopeCompositionPreviewJson {
  return {
    plan_id: wrapperPlanId,
    personal_profile_id: request.personalProfileId,
    project_profile_id: request.projectProfileId,
    exclusions: plan.device.exclusions,
    resources: plan.resources.map((resource) => ({
      key: resource.key,
      kind: resource.kind,
      id: resource.id,
      excluded_by_device: resource.excludedByDevice,
      origins: resource.origins.map((origin) => ({
        scope: origin.scope,
        library: origin.library,
        kind: origin.kind,
        resource_kind: origin.resourceKind,
      })),
    })),
    conflicts: plan.conflicts.map((conflict) => ({
      resource_key: conflict.resourceKey,
      origins: conflict.origins.map((origin) => ({
        scope: origin.scope,
        library: origin.library,
        kind: origin.kind,
        resource_kind: origin.resourceKind,
      })),
    })),
    issues: plan.issues.map((issue) => ({
      code: issue.code,
      scope: issue.scope,
      library: issue.library,
      resource_key: issue.resourceKey,
      message: issue.message,
    })),
    has_blockers: plan.hasBlockers,
  }
}

export class ScopeCompositionSession {
  private migrationPlans = new Map<string, MigrationCached>()
  private compositionPlans = new Map<string, CompositionCached>()
  private undoPlans = new Map<string, UndoCached>()

  constructor(private options: { stateFile: string; resolveWorkspace: (profileId: string) => string }) {}

  private prune(): void {
    const cutoff = Date.now() - SESSION_TTL_MS
    for (const [id, plan] of this.migrationPlans) if (plan.createdAt < cutoff) this.migrationPlans.delete(id)
    for (const [id, plan] of this.compositionPlans) if (plan.createdAt < cutoff) this.compositionPlans.delete(id)
    for (const [id, plan] of this.undoPlans) if (plan.createdAt < cutoff) this.undoPlans.delete(id)
  }

  private historyFile(): string {
    return this.options.stateFile + '.history.json'
  }

  private journalFile(): string {
    return this.options.stateFile + '.journal.json'
  }

  private writeJson(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true })
    const temporary = path + '.' + randomUUID() + '.tmp'
    try {
      writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      renameSync(temporary, path)
    } finally {
      rmSync(temporary, { force: true })
    }
  }

  private readStateRaw(): DeviceScopeState {
    if (!existsSync(this.options.stateFile)) return emptyState
    try {
      if (statSync(this.options.stateFile).size > MAX_DEVICE_SCOPE_LOCAL_BYTES) {
        throw new Error('Device scope settings exceed the local retention limit')
      }
      return deviceScopeStateSchema.parse(JSON.parse(readFileSync(this.options.stateFile, 'utf8')))
    } catch {
      throw new Error('Device scope settings need repair before composition can change')
    }
  }

  private readHistory(): DeviceScopeHistory {
    const path = this.historyFile()
    if (!existsSync(path)) return { schema_version: 1, records: [] }
    try {
      if (statSync(path).size > MAX_DEVICE_SCOPE_LOCAL_BYTES) {
        throw new Error('Device scope history exceeds the local retention limit')
      }
      return deviceScopeHistorySchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      throw new Error('Device scope history needs repair before composition can change')
    }
  }

  private boundedHistory(records: DeviceScopeHistoryRecord[]): DeviceScopeHistory {
    const retained = records.slice(-50)
    // Keep this byte count identical to writeJson(), including indentation.
    const bytes = () => Buffer.byteLength(JSON.stringify({ schema_version: 1, records: retained }, null, 2) + '\n', 'utf8')
    while (retained.length > 1 && bytes() > MAX_DEVICE_SCOPE_LOCAL_BYTES) retained.shift()
    if (bytes() > MAX_DEVICE_SCOPE_LOCAL_BYTES) {
      throw new Error('This Device change is too large to retain safely in local history')
    }
    return deviceScopeHistorySchema.parse({ schema_version: 1, records: retained })
  }

  private writeHistory(history: DeviceScopeHistory): void {
    this.writeJson(this.historyFile(), this.boundedHistory(history.records))
  }

  private recoverJournal(): void {
    const path = this.journalFile()
    if (!existsSync(path)) return
    let journal: DeviceScopeJournal
    try {
      journal = deviceScopeJournalSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      throw new Error('Device scope recovery needs repair before composition can change')
    }
    const current = this.readStateRaw()
    const history = this.readHistory()
    const existing = history.records.find((record) => record.id === journal.record.id)
    if (sameState(current, journal.record.after)) {
      if (existing && JSON.stringify(existing) !== JSON.stringify(journal.record)) {
        throw new Error('Device scope history needs repair before composition can change')
      }
      if (!existing) this.writeHistory({ schema_version: 1, records: [...history.records, journal.record] })
    } else if (sameState(current, journal.record.before)) {
      if (existing) throw new Error('Device scope recovery needs repair before composition can change')
    } else {
      throw new Error('Device scope recovery needs repair before composition can change')
    }
    rmSync(path, { force: true })
  }

  private readState(): DeviceScopeState {
    this.recoverJournal()
    return this.readStateRaw()
  }

  private writeState(state: DeviceScopeState): void {
    const parsed = deviceScopeStateSchema.parse(state)
    this.writeJson(this.options.stateFile, parsed)
  }

  private commitDeviceState(
    before: DeviceScopeState,
    after: DeviceScopeState,
    operation: DeviceScopeHistoryRecord['operation'],
    sourcePlanId: string,
  ): void {
    if (sameState(before, after)) return
    const record = deviceScopeHistoryRecordSchema.parse({
      schema_version: 1,
      id: randomUUID(),
      operation,
      source_plan_id: sourcePlanId,
      completed_at: new Date().toISOString(),
      before,
      after,
    })
    // Refuse before state changes when the inverse record cannot fit locally.
    const nextHistory = this.boundedHistory([...this.readHistory().records, record])
    this.writeJson(this.journalFile(), { schema_version: 1, record })
    this.writeState(after)
    this.writeHistory(nextHistory)
    rmSync(this.journalFile(), { force: true })
  }

  private async load(profileId: string): Promise<LibraryFiles> {
    const loaded = await loadLibrary(this.options.resolveWorkspace(stableProfileId(profileId)))
    if (!loaded.ok) throw new Error(safeIssue())
    return loaded.value
  }

  async overview(profiles: ScopeProfileReference[]): Promise<DotagentsScopeOverviewJson> {
    const mapped: DotagentsScopeProfileJson[] = []
    for (const profile of profiles) {
      if (!profile.canonical) {
        mapped.push({
          profile_id: profile.profileId,
          library: profile.profileId,
          scope: null,
          migration_required: false,
          error: 'Upgrade this legacy library before assigning a portable scope.',
        })
        continue
      }
      try {
        const library = await this.load(profile.profileId)
        const descriptor = readPortableScopeDescriptor(library.root)
        mapped.push({
          profile_id: profile.profileId,
          library: library.manifest.name,
          scope: descriptor?.scope ?? null,
          migration_required: descriptor === null,
          error: null,
        })
      } catch {
        mapped.push({
          profile_id: profile.profileId,
          library: profile.profileId,
          scope: null,
          migration_required: false,
          error: safeIssue(),
        })
      }
    }
    const state = this.readState()
    const hasActive = state.personal_profile_id !== null || state.project_profile_id !== null
    let active: DotagentsScopeCompositionPreviewJson | null = null
    let activeError: string | null = null
    if (hasActive) {
      try {
        active = await this.previewComposition({
          profiles,
          personalProfileId: state.personal_profile_id,
          projectProfileId: state.project_profile_id,
          exclusions: state.exclusions,
        })
      } catch {
        activeError = 'The active Device composition needs a fresh review.'
      }
    }
    return { profiles: mapped, active, active_error: activeError }
  }

  async previewMigration(input: {
    profileId: string
    scope: PortableScope
  }): Promise<DotagentsScopeMigrationPreviewJson> {
    this.prune()
    const library = await this.load(input.profileId)
    const plan = await createLegacyScopeMigrationPlan(library, input.scope)
    this.migrationPlans.set(plan.planId, { profileId: input.profileId, plan, createdAt: Date.now() })
    return {
      profile_id: input.profileId,
      plan_id: plan.planId,
      library: plan.library,
      scope: input.scope,
      file: 'dotagents.scope.json',
      content: plan.descriptor!,
    }
  }

  async applyMigration(input: { profileId: string; planId: string }): Promise<{ history_id: string }> {
    this.prune()
    const cached = this.migrationPlans.get(input.planId)
    if (!cached || cached.profileId !== input.profileId) throw new Error('This scope review expired; review it again')
    const library = await this.load(input.profileId)
    const result = await applyLegacyScopeMigrationPlan(library, cached.plan, input.planId)
    this.migrationPlans.delete(input.planId)
    return { history_id: result.historyId }
  }

  async previewComposition(input: {
    profiles: ScopeProfileReference[]
    personalProfileId: string | null
    projectProfileId: string | null
    exclusions: string[]
  }): Promise<DotagentsScopeCompositionPreviewJson> {
    this.prune()
    const available = new Map(input.profiles.filter((profile) => profile.canonical).map((profile) => [profile.profileId, profile]))
    const personalProfileId = input.personalProfileId ? stableProfileId(input.personalProfileId) : null
    const projectProfileId = input.projectProfileId ? stableProfileId(input.projectProfileId) : null
    if (!personalProfileId && !projectProfileId) throw new Error('Choose at least one Personal or Project library')
    if (personalProfileId && personalProfileId === projectProfileId) throw new Error('Personal and Project must use different libraries')
    const selections: { scope: PortableScope; profileId: string; library: LibraryFiles }[] = []
    for (const [scope, profileId] of [['personal', personalProfileId], ['project', projectProfileId]] as const) {
      if (!profileId) continue
      if (!available.has(profileId)) throw new Error('The selected ' + scope + ' library is unavailable')
      const library = await this.load(profileId)
      const descriptor = readPortableScopeDescriptor(library.root)
      if (descriptor?.scope !== scope) throw new Error('The selected library is not declared as ' + scope)
      selections.push({ scope, profileId, library })
    }
    const request: CompositionRequest = {
      personalProfileId,
      projectProfileId,
      exclusions: stableExclusions(input.exclusions),
    }
    const core = await createScopeCompositionPlan(
      selections.map((selection) => ({ scope: selection.scope, library: selection.library })),
      { exclusions: request.exclusions },
    )
    const wrapperPlanId = computePlanId({
      kind: 'skiller-scope-composition',
      schemaVersion: 1,
      personalProfileId,
      projectProfileId,
      corePlanId: core.planId,
    })
    const preview = mapComposition(core, request, wrapperPlanId)
    this.compositionPlans.set(wrapperPlanId, { request, preview, createdAt: Date.now() })
    return preview
  }

  async applyComposition(planId: string, profiles: ScopeProfileReference[]): Promise<DotagentsScopeCompositionPreviewJson> {
    this.prune()
    const cached = this.compositionPlans.get(planId)
    if (!cached) throw new Error('This Device composition review expired; review it again')
    const refreshed = await this.previewComposition({ profiles, ...cached.request })
    if (refreshed.plan_id !== planId) throw new Error('A selected library changed after review; review composition again')
    if (refreshed.has_blockers) throw new Error('Resolve every scope conflict before applying this Device composition')
    const next = deviceScopeStateSchema.parse({
      schema_version: 1,
      personal_profile_id: cached.request.personalProfileId,
      project_profile_id: cached.request.projectProfileId,
      exclusions: cached.request.exclusions,
    })
    this.commitDeviceState(this.readState(), next, 'scope-composition', planId)
    this.compositionPlans.delete(planId)
    return refreshed
  }

  async previewCompositionUndo(profiles: ScopeProfileReference[]): Promise<DotagentsScopeCompositionUndoPreviewJson | null> {
    this.prune()
    const history = this.readHistory().records
    const record = history[history.length - 1]
    if (!record) return null
    const current = this.readState()
    const target = record.before
    let composition: DotagentsScopeCompositionPreviewJson | null = null
    let hasConflicts = !sameState(current, record.after)
    if (target.personal_profile_id || target.project_profile_id) {
      try {
        composition = await this.previewComposition({
          profiles,
          personalProfileId: target.personal_profile_id,
          projectProfileId: target.project_profile_id,
          exclusions: target.exclusions,
        })
        hasConflicts ||= composition.has_blockers
      } catch {
        hasConflicts = true
      }
    }
    const planId = computePlanId({
      kind: 'skiller-scope-composition-undo',
      schemaVersion: 1,
      historyId: record.id,
      current,
      target,
      targetPlanId: composition?.plan_id ?? null,
    })
    this.undoPlans.set(planId, {
      historyId: record.id,
      expectedState: record.after,
      targetState: target,
      targetPreview: composition,
      createdAt: Date.now(),
    })
    return {
      plan_id: planId,
      history_id: record.id,
      has_conflicts: hasConflicts,
      target: {
        personal_profile_id: target.personal_profile_id,
        project_profile_id: target.project_profile_id,
        exclusions: target.exclusions,
      },
      composition,
    }
  }

  async applyCompositionUndo(planId: string, profiles: ScopeProfileReference[]): Promise<DotagentsScopeCompositionPreviewJson | null> {
    this.prune()
    const cached = this.undoPlans.get(planId)
    if (!cached) throw new Error('This Device undo review expired; review it again')
    if (!sameState(this.readState(), cached.expectedState)) {
      throw new Error('This device toolkit changed after review; review Undo again')
    }
    let refreshed: DotagentsScopeCompositionPreviewJson | null = null
    if (cached.targetState.personal_profile_id || cached.targetState.project_profile_id) {
      refreshed = await this.previewComposition({
        profiles,
        personalProfileId: cached.targetState.personal_profile_id,
        projectProfileId: cached.targetState.project_profile_id,
        exclusions: cached.targetState.exclusions,
      })
      if (refreshed.has_blockers || refreshed.plan_id !== cached.targetPreview?.plan_id) {
        throw new Error('A selected library changed after review; review Undo again')
      }
    }
    this.commitDeviceState(cached.expectedState, cached.targetState, 'scope-composition-undo', planId)
    this.undoPlans.delete(planId)
    return refreshed
  }
}
