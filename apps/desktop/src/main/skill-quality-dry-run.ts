import { execFile } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { promisify } from 'node:util'
import { scanTextForSecrets } from 'dotagents/audit'
import type { SkillQualityDryRunReportJson, SkillQualityEvalPlanJson } from '../shared/rpc-schema'
import { appDataRootPath } from './settings'
import { readSkillQualityEvalCases } from './skill-quality-eval'
import type { Skill } from './skill-types'

const execFileAsync = promisify(execFile)
const MAX_FIXTURE_FILES = 2_000
const MAX_FIXTURE_BYTES = 50 * 1024 * 1024
const MAX_OUTPUT_BYTES = 4_000

export type DryCommandResult = {
  code: number
  stdout: string
  stderr: string
  timedOut?: boolean
}

export type DryCommandExecutor = (input: {
  imageId: string
  workspace: string
  command: string
  timeoutMs: number
}) => Promise<DryCommandResult>

export function dockerDryRunArgs(input: Parameters<DryCommandExecutor>[0]): string[] {
  return [
    'run', '--rm',
    '--network', 'none',
    '--read-only',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--pids-limit', '128',
    '--memory', '512m',
    '--cpus', '1',
    '--user', '65534:65534',
    '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=64m',
    '--mount', `type=bind,src=${input.workspace},dst=/workspace`,
    '--workdir', '/workspace',
    input.imageId,
    'sh', '-eu', '-c', input.command,
  ]
}

export const dockerDryCommandExecutor: DryCommandExecutor = async (input) => {
  try {
    const { stdout, stderr } = await execFileAsync('docker', dockerDryRunArgs(input), {
      timeout: input.timeoutMs,
      maxBuffer: 1024 * 1024,
      killSignal: 'SIGKILL',
    })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean }
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: typeof failure.stdout === 'string' ? failure.stdout : '',
      stderr: typeof failure.stderr === 'string' ? failure.stderr : '',
      timedOut: failure.killed === true,
    }
  }
}

function safeRelativePath(value: string): boolean {
  if (!value || value.startsWith('/') || value.startsWith('\\') || /^[a-zA-Z]:/.test(value)) return false
  const parts = value.split(/[\\/]+/)
  return parts.every((part) => part && part !== '.' && part !== '..')
}

export function copyQualityFixture(skillRoot: string, fixture: string | null, workspace: string): void {
  if (!fixture) return
  const sourceRoot = join(skillRoot, 'evals', 'fixtures', fixture)
  let fileCount = 0
  let totalBytes = 0
  const walk = (source: string, destination: string) => {
    const metadata = lstatSync(source)
    if (metadata.isSymbolicLink()) throw new Error('Fixture links are not allowed')
    if (metadata.isDirectory()) {
      mkdirSync(destination, { recursive: true, mode: 0o777 })
      chmodSync(destination, 0o777)
      for (const entry of readdirSync(source).sort()) walk(join(source, entry), join(destination, entry))
      return
    }
    if (!metadata.isFile()) throw new Error('Fixture contains an unsupported filesystem entry')
    fileCount += 1
    totalBytes += metadata.size
    if (fileCount > MAX_FIXTURE_FILES || totalBytes > MAX_FIXTURE_BYTES) throw new Error('Fixture exceeds the safe copy limit')
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(source, destination)
    chmodSync(destination, 0o666)
  }
  walk(sourceRoot, workspace)
}

export function safeQualityWorkspacePath(workspace: string, relativePath: string): boolean {
  if (!safeRelativePath(relativePath)) return false
  let cursor = workspace
  for (const segment of relativePath.split(/[\\/]+/)) {
    cursor = join(cursor, segment)
    try {
      const metadata = lstatSync(cursor)
      if (metadata.isSymbolicLink()) return false
    } catch {
      return false
    }
  }
  return cursor === workspace || cursor.startsWith(`${workspace}${sep}`)
}

export function safeQualityOutput(stdout: string, stderr: string, workspace: string): { output?: string; output_redacted?: boolean } {
  const combined = [stdout, stderr].filter(Boolean).join('\n').split(workspace).join('<workspace>').slice(0, MAX_OUTPUT_BYTES)
  if (!combined) return {}
  if (scanTextForSecrets(combined).length > 0) return { output: '[redacted: possible secret in command output]', output_redacted: true }
  return { output: combined }
}

export function writeQualityJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

function readCachedCase(path: string, planId: string, caseId: string): SkillQualityDryRunReportJson['cases'][number] | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { plan_id?: unknown; result?: unknown }
    if (parsed.plan_id !== planId || !parsed.result || typeof parsed.result !== 'object') return null
    const result = parsed.result as Record<string, unknown>
    const statuses = new Set(['vacuous', 'requires-action', 'indeterminate', 'error'])
    const checkKinds = new Set(['file_exists', 'shell', 'judge', 'setup'])
    const checkStatuses = new Set(['pass', 'fail', 'skipped', 'error'])
    if (
      result.id !== caseId
      || typeof result.behavior !== 'string'
      || !statuses.has(String(result.status))
      || typeof result.duration_ms !== 'number'
      || !Number.isFinite(result.duration_ms)
      || result.duration_ms < 0
      || !Array.isArray(result.checks)
    ) return null
    const checks: SkillQualityDryRunReportJson['cases'][number]['checks'] = []
    for (const candidate of result.checks) {
      if (!candidate || typeof candidate !== 'object') return null
      const check = candidate as Record<string, unknown>
      if (!checkKinds.has(String(check.kind)) || !checkStatuses.has(String(check.status))) return null
      checks.push({
        kind: check.kind as SkillQualityDryRunReportJson['cases'][number]['checks'][number]['kind'],
        status: check.status as SkillQualityDryRunReportJson['cases'][number]['checks'][number]['status'],
      })
    }
    return {
      id: caseId,
      behavior: result.behavior,
      status: result.status as SkillQualityDryRunReportJson['cases'][number]['status'],
      duration_ms: result.duration_ms,
      resumed: true,
      checks,
    }
  } catch {
    return null
  }
}

export async function mapQualityConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await worker(items[index]!)
    }
  })
  await Promise.all(runners)
  return results
}

export async function runSkillQualityDryPlan(options: {
  skill: Skill
  plan: SkillQualityEvalPlanJson
  reportRoot?: string
  executor?: DryCommandExecutor
}): Promise<SkillQualityDryRunReportJson> {
  const { skill, plan } = options
  if (plan.mode !== 'dry') throw new Error('Only a reviewed dry plan can use the dry runner')
  if (!plan.ready_to_start || plan.blockers.length > 0) throw new Error('The reviewed dry plan is blocked')
  if (!plan.sandbox.available || !plan.sandbox.image_id) throw new Error('The reviewed Docker image is unavailable')
  if (plan.sandbox.network || plan.sandbox.credential_profile !== 'none' || plan.sandbox.environment_names.length > 0) {
    throw new Error('Dry checks require a network-off sandbox with no credentials or environment passthrough')
  }
  const definitions = readSkillQualityEvalCases(skill.canonical_path)
  const definitionsById = new Map(definitions.map((entry) => [entry.id, entry]))
  const reportId = plan.report.resume_id
  const reportRoot = options.reportRoot ?? join(appDataRootPath(), 'quality', 'runs')
  const runRoot = join(reportRoot, reportId)
  const casesRoot = join(runRoot, 'cases')
  const executor = options.executor ?? dockerDryCommandExecutor
  const startedAt = new Date().toISOString()

  const results = await mapQualityConcurrency(plan.cases, plan.harness.concurrency, async (summary) => {
    const cachePath = join(casesRoot, `${summary.id}.json`)
    const cached = readCachedCase(cachePath, plan.plan_id, summary.id)
    if (cached) return cached
    const definition = definitionsById.get(summary.id)
    if (!definition) throw new Error(`Eval case “${summary.id}” changed after review`)
    const workspace = mkdtempSync(join(tmpdir(), 'skiller-dry-'))
    chmodSync(workspace, 0o777)
    const started = Date.now()
    const checks: SkillQualityDryRunReportJson['cases'][number]['checks'] = []
    let status: SkillQualityDryRunReportJson['cases'][number]['status'] = 'indeterminate'
    try {
      copyQualityFixture(skill.canonical_path, definition.fixture, workspace)
      if (definition.setup) {
        const result = await executor({ imageId: plan.sandbox.image_id!, workspace, command: definition.setup, timeoutMs: Math.min(definition.timeout, 900) * 1_000 })
        checks.push({ kind: 'setup', status: result.code === 0 ? 'pass' : 'error', ...safeQualityOutput(result.stdout, result.stderr, workspace) })
        if (result.code !== 0) status = 'error'
      }
      if (status !== 'error') {
        for (const check of definition.checks) {
          if (check.kind === 'judge') {
            checks.push({ kind: 'judge', status: 'skipped' })
            continue
          }
          if (check.kind === 'file_exists') {
            checks.push({ kind: 'file_exists', status: safeQualityWorkspacePath(workspace, check.value) ? 'pass' : 'fail' })
            continue
          }
          const result = await executor({ imageId: plan.sandbox.image_id!, workspace, command: check.value, timeoutMs: Math.min(definition.timeout, 900) * 1_000 })
          checks.push({ kind: 'shell', status: result.code === 0 ? 'pass' : 'fail', ...safeQualityOutput(result.stdout, result.stderr, workspace) })
        }
        const deterministic = checks.filter((entry) => entry.kind === 'file_exists' || entry.kind === 'shell')
        status = deterministic.length === 0
          ? 'indeterminate'
          : deterministic.every((entry) => entry.status === 'pass')
            ? 'vacuous'
            : 'requires-action'
      }
    } catch (error) {
      status = 'error'
      const message = error instanceof Error ? error.message.split(skill.canonical_path).join('<skill>') : 'Dry check failed safely.'
      checks.push({ kind: 'setup', status: 'error', output: message.split(workspace).join('<workspace>') })
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
    const result = {
      id: summary.id,
      behavior: summary.behavior,
      status,
      duration_ms: Date.now() - started,
      resumed: false,
      checks,
    }
    writeQualityJsonAtomic(cachePath, { plan_id: plan.plan_id, result })
    return result
  })

  const summary = {
    cases: results.length,
    vacuous: results.filter((entry) => entry.status === 'vacuous').length,
    requires_action: results.filter((entry) => entry.status === 'requires-action').length,
    indeterminate: results.filter((entry) => entry.status === 'indeterminate').length,
    errors: results.filter((entry) => entry.status === 'error').length,
  }
  const report: SkillQualityDryRunReportJson = {
    schema: 1,
    report_id: reportId,
    plan_id: plan.plan_id,
    quality_id: plan.quality_id,
    skill: plan.skill,
    mode: 'dry',
    status: summary.errors > 0 ? 'blocked' : summary.vacuous > 0 ? 'completed-with-findings' : 'completed',
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    sandbox: { image_id: plan.sandbox.image_id, network: false, direct_host_fallback: false },
    summary,
    cases: results,
    local_destination: plan.report.local_destination,
  }
  writeQualityJsonAtomic(join(runRoot, 'report.json'), report)
  return report
}
