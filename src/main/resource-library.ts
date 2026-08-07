import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { applyResourceAdoption, planResourceAdoption, type AdoptResourcePlan } from 'dotagents/adopt'
import { doctorLibrary } from 'dotagents/doctor'
import { applyDoctorRepair, planDoctorRepair, type DoctorRepairPlan } from 'dotagents/repair'
import { resourceManifestSchema, type ResourceDescriptor } from 'dotagents/resource-model'
import { parseLibraryManifest } from 'dotagents/library'
import type {
  DotagentsResourceAdoptionPreviewJson,
  DotagentsResourceAdoptionRequestJson,
  DotagentsResourceKindJson,
  DotagentsLibraryHealthJson,
  DotagentsLibraryRepairPreviewJson,
  DotagentsResourceOverviewJson,
  DotagentsResourceSelectionJson,
} from '../shared/rpc-schema'

const TOKEN_TTL_MS = 15 * 60_000

type Selection = { id: string; kind: DotagentsResourceKindJson; path: string; name: string; createdAt: number }
type Planned = { plan: AdoptResourcePlan; profileId: string; sourceName: string; createdAt: number }
type RepairPlanned = { plan: DoctorRepairPlan; profileId: string; workspace: string; createdAt: number }

function stableId(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) throw new Error('Resource id must be lowercase kebab-case')
  return normalized
}

function descriptorFromRequest(request: DotagentsResourceAdoptionRequestJson): ResourceDescriptor {
  const id = stableId(request.id)
  if (request.kind === 'skill') return { kind: 'skill', id, path: `skills/${id}` }
  if (request.kind === 'instruction') {
    const activation = request.activation ?? 'always'
    return {
      kind: 'instruction', id, path: `instructions/${id}.md`, format: 'markdown', activation,
      ...(activation === 'conditional' ? { condition: request.condition?.trim() || 'When explicitly requested' } : {}),
    }
  }
  if (request.kind === 'command') {
    return { kind: 'command', id, path: `commands/${id}.md`, format: 'markdown', invocation: stableId(request.invocation ?? id) }
  }
  return { kind: 'subagent', id, path: `subagents/${id}.md`, format: 'markdown', role: request.role?.trim() || id }
}

function readResources(workspace: string): ResourceDescriptor[] {
  const file = join(workspace, 'resources.json')
  if (!existsSync(file)) return []
  const metadata = lstatSync(file)
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > 1024 * 1024) {
    throw new Error('resources.json is not a bounded regular file')
  }
  return resourceManifestSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).resources
}

export function readResourceLibraryOverview(input: {
  workspace: string
  profileId: string
  mode: 'private' | 'team' | 'public'
  changed: boolean
}): DotagentsResourceOverviewJson {
  const parsed = parseLibraryManifest(readFileSync(join(input.workspace, 'skills.json'), 'utf8'))
  if (!parsed.ok) throw new Error('The canonical library manifest needs repair before resources can be managed')
  const v2 = readResources(input.workspace)
  const resources: DotagentsResourceOverviewJson['resources'] = parsed.value.skills.map((skillPath) => {
    const parts = skillPath.split('/')
    const id = parts[parts.length - 1] ?? skillPath
    return { key: `skill:${id}`, kind: 'skill', id, path: skillPath, source: 'skill-library' }
  })
  for (const resource of v2) {
    const key = `${resource.kind}:${resource.id}`
    if (resources.some((entry) => entry.key === key)) continue
    resources.push({ key, kind: resource.kind, id: resource.id, path: resource.path, source: 'resource-v2' })
  }
  resources.sort((left, right) => left.key.localeCompare(right.key, 'en'))
  return { profile_id: input.profileId, mode: input.mode, changed: input.changed, resources }
}

export class ResourceAdoptionSession {
  private selections = new Map<string, Selection>()
  private plans = new Map<string, Planned>()

  private prune(): void {
    const cutoff = Date.now() - TOKEN_TTL_MS
    for (const [id, selection] of this.selections) if (selection.createdAt < cutoff) this.selections.delete(id)
    for (const [id, plan] of this.plans) if (plan.createdAt < cutoff) this.plans.delete(id)
  }

  registerSelection(path: string, kind: DotagentsResourceKindJson): DotagentsResourceSelectionJson {
    this.prune()
    const metadata = lstatSync(path)
    const directory = metadata.isDirectory() && !metadata.isSymbolicLink()
    const file = metadata.isFile() && !metadata.isSymbolicLink()
    if (kind === 'skill' ? !directory : !file) throw new Error(kind === 'skill' ? 'Choose a regular skill folder' : 'Choose a regular file')
    const id = randomUUID()
    const name = basename(path)
    this.selections.set(id, { id, kind, path, name, createdAt: Date.now() })
    return { selection_id: id, kind, name, entry_type: directory ? 'directory' : 'file' }
  }

  async preview(input: {
    workspace: string
    profileId: string
    mode: 'private' | 'team' | 'public'
    request: DotagentsResourceAdoptionRequestJson
  }): Promise<DotagentsResourceAdoptionPreviewJson> {
    this.prune()
    const selection = this.selections.get(input.request.selectionId)
    if (!selection || selection.kind !== input.request.kind) throw new Error('Choose the resource source again')
    const descriptor = descriptorFromRequest(input.request)
    const plan = await planResourceAdoption({
      libraryRoot: input.workspace,
      sourcePath: selection.path,
      descriptor,
      visibility: input.mode,
    })
    this.plans.set(plan.planId, { plan, profileId: input.profileId, sourceName: selection.name, createdAt: Date.now() })
    return {
      plan_id: plan.planId,
      profile_id: input.profileId,
      source_name: selection.name,
      resource: { key: `${descriptor.kind}:${descriptor.id}`, kind: descriptor.kind, id: descriptor.id, path: descriptor.path },
      files: plan.source.files,
      bytes: plan.source.bytes,
      license: { visibility: plan.licenseReview.visibility, value: plan.licenseReview.libraryLicense, status: plan.licenseReview.status },
      secret_findings: plan.secretFindings.map((finding) => ({
        rule: finding.rule, file: finding.relativePath, line: finding.line, column: finding.column,
      })),
      blockers: plan.blockers,
    }
  }

  async apply(planId: string): Promise<{ history_id: string; resource_key: string }> {
    this.prune()
    if (!/^[a-f0-9]{64}$/.test(planId)) throw new Error('Invalid reviewed adoption plan')
    const cached = this.plans.get(planId)
    if (!cached) throw new Error('This adoption review expired; review it again')
    const result = await applyResourceAdoption(cached.plan, planId)
    this.plans.delete(planId)
    return { history_id: result.historyId, resource_key: `${cached.plan.resource.kind}:${cached.plan.resource.id}` }
  }
}

/**
 * Keeps native library paths and repair preconditions in the main process.
 * The renderer receives only value-free findings and a deterministic plan id.
 */
export class LibraryRepairSession {
  private plans = new Map<string, RepairPlanned>()

  private prune(): void {
    const cutoff = Date.now() - TOKEN_TTL_MS
    for (const [id, plan] of this.plans) if (plan.createdAt < cutoff) this.plans.delete(id)
  }

  async health(workspace: string, profileId: string): Promise<DotagentsLibraryHealthJson> {
    const report = await doctorLibrary({ root: workspace })
    return {
      profile_id: profileId,
      ok: report.ok,
      issues: report.issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity ?? 'error',
        message: issue.message,
        remediation: issue.remediation,
        repairable: issue.code === 'local-state-not-ignored',
      })),
    }
  }

  async preview(input: {
    workspace: string
    profileId: string
    selectedCodes: string[]
  }): Promise<DotagentsLibraryRepairPreviewJson> {
    this.prune()
    const selectedCodes = [...new Set(input.selectedCodes)]
    if (selectedCodes.length === 0) throw new Error('Choose at least one repairable finding')
    const report = await doctorLibrary({ root: input.workspace })
    const plan = planDoctorRepair(report, selectedCodes)
    this.plans.set(plan.planId, {
      plan,
      profileId: input.profileId,
      workspace: input.workspace,
      createdAt: Date.now(),
    })
    return {
      profile_id: input.profileId,
      plan_id: plan.planId,
      has_blockers: plan.hasBlockers,
      actions: plan.actions.map((action) => ({ kind: action.kind, path: action.path, add: action.add })),
      unsupported: plan.unsupported,
    }
  }

  apply(input: { workspace: string; profileId: string; planId: string }): { history_id: string } {
    this.prune()
    if (!/^[a-f0-9]{64}$/.test(input.planId)) throw new Error('Invalid reviewed repair plan')
    const cached = this.plans.get(input.planId)
    if (!cached || cached.profileId !== input.profileId || cached.workspace !== input.workspace) {
      throw new Error('This repair review expired; review it again')
    }
    if (cached.plan.actions.length === 0) throw new Error('The reviewed repair has no changes to apply')
    const result = applyDoctorRepair(input.workspace, cached.plan, input.planId)
    this.plans.delete(input.planId)
    if (!result) throw new Error('The reviewed repair is no longer needed')
    return { history_id: result.historyId }
  }
}
