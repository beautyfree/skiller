import { execFile } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import type { SkillQualityEvalPlanJson, SkillQualityMeasuredReportJson } from '../shared/rpc-schema'
import { appDataRootPath } from './settings'
import {
  copyQualityFixture,
  mapQualityConcurrency,
  safeQualityOutput,
  safeQualityWorkspacePath,
  writeQualityJsonAtomic,
  type DryCommandResult,
} from './skill-quality-dry-run'
import { readSkillQualityEvalCases } from './skill-quality-eval'
import type { Skill } from './skill-types'

const execFileAsync = promisify(execFile)
const MAX_SKILL_FILES = 2_000
const MAX_SKILL_BYTES = 50 * 1024 * 1024

type Harness = 'codex' | 'claude'

export type MeasuredSandboxExecutor = {
  shell(input: { imageId: string; workspace: string; command: string; timeoutMs: number }): Promise<DryCommandResult>
  agent(input: {
    imageId: string
    workspace: string
    harness: Harness
    model: string | null
    effort: 'low' | 'medium' | 'high' | 'xhigh'
    prompt: string
    timeoutMs: number
    credentialProfile: Harness
    environmentNames: string[]
  }): Promise<DryCommandResult & { response: string }>
}

function credentialMounts(profile: Harness): { source: string; target: string }[] {
  const candidates = profile === 'codex'
    ? [{ source: join(homedir(), '.codex'), target: '/root/.codex' }]
    : [
        { source: join(homedir(), '.claude'), target: '/root/.claude' },
        { source: join(homedir(), '.claude.json'), target: '/root/.claude.json' },
      ]
  return candidates.flatMap((candidate) => {
    try {
      const metadata = lstatSync(candidate.source)
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) return []
      return [{ ...candidate, source: realpathSync(candidate.source) }]
    } catch {
      return []
    }
  })
}

export function measuredBaseDockerArgs(workspace: string, imageId: string): string[] {
  return [
    'run', '--rm', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--pids-limit', '256', '--memory', '1g', '--cpus', '2',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m',
    '--mount', `type=bind,src=${workspace},dst=/workspace`,
    '--workdir', '/workspace', '--env', 'HOME=/root', imageId,
  ]
}

async function executeDocker(args: string[], timeoutMs: number): Promise<DryCommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync('docker', args, {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
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

export const dockerMeasuredSandboxExecutor: MeasuredSandboxExecutor = {
  shell: async (input) => executeDocker([
    ...measuredBaseDockerArgs(input.workspace, input.imageId).slice(0, -1),
    '--network', 'none', input.imageId, 'sh', '-eu', '-c', input.command,
  ], input.timeoutMs),
  agent: async (input) => {
    const mounts = credentialMounts(input.credentialProfile)
    if (mounts.length === 0) return { code: 1, stdout: '', stderr: 'Reviewed credential profile is unavailable', response: '' }
    const resultFile = join(input.workspace, '.skiller-last-message')
    rmSync(resultFile, { force: true })
    const args = measuredBaseDockerArgs(input.workspace, input.imageId).slice(0, -1)
    args.push('--network', 'bridge')
    for (const mount of mounts) args.push('--mount', `type=bind,src=${mount.source},dst=${mount.target},readonly`)
    for (const name of input.environmentNames) args.push('--env', name)
    args.push(input.imageId)
    if (input.harness === 'codex') {
      args.push(
        'codex', 'exec',
        ...(input.model ? ['-m', input.model] : []),
        '-c', `model_reasoning_effort="${input.effort}"`,
        '-C', '/workspace', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox',
        '--ephemeral', '--color', 'never', '-o', '/workspace/.skiller-last-message', input.prompt,
      )
    } else {
      args.push('claude', '-p', ...(input.model ? ['--model', input.model] : []), '--effort', input.effort, '--dangerously-skip-permissions', input.prompt)
    }
    const result = await executeDocker(args, input.timeoutMs)
    let response = input.harness === 'claude' ? result.stdout : ''
    if (input.harness === 'codex' && existsSync(resultFile)) {
      try {
        response = readFileSync(resultFile, 'utf8').slice(0, 128 * 1024)
      } catch {
        response = ''
      }
    }
    rmSync(resultFile, { force: true })
    return { ...result, response }
  },
}

function copySkillForHarness(skill: Skill, workspace: string, harness: Harness): void {
  const slug = skill.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill'
  const destination = harness === 'claude'
    ? join(workspace, '.claude', 'skills', slug)
    : join(workspace, '.skiller', 'skill')
  let files = 0
  let bytes = 0
  const walk = (source: string, target: string, relativePath: string) => {
    const metadata = lstatSync(source)
    if (metadata.isSymbolicLink()) throw new Error(`Skill resource ${relativePath || '<root>'} is linked`)
    if (metadata.isDirectory()) {
      mkdirSync(target, { recursive: true, mode: 0o755 })
      for (const entry of readdirSync(source).sort()) {
        if (!relativePath && (entry === '.git' || entry === '.dotagents' || entry === 'node_modules' || entry === 'evals' || entry === 'spec.md')) continue
        walk(join(source, entry), join(target, entry), relativePath ? `${relativePath}/${entry}` : entry)
      }
      return
    }
    if (!metadata.isFile()) throw new Error(`Skill resource ${relativePath} is unsupported`)
    files += 1
    bytes += metadata.size
    if (files > MAX_SKILL_FILES || bytes > MAX_SKILL_BYTES) throw new Error('Skill resources exceed the safe copy limit')
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
    chmodSync(target, 0o644)
  }
  walk(skill.canonical_path, destination, '')
  if (harness === 'codex') {
    const skillMd = readFileSync(join(destination, 'SKILL.md'), 'utf8')
    const existingPath = join(workspace, 'AGENTS.md')
    const existing = existsSync(existingPath) ? readFileSync(existingPath, 'utf8') : ''
    writeFileSync(existingPath, `${existing}${existing ? '\n\n' : ''}<!-- skiller-eval-skill -->\nThe skill under .skiller/skill applies to this task. Follow it.\n\n${skillMd}\n`, { mode: 0o644 })
  }
}

function workspaceListing(workspace: string): string {
  const entries: string[] = []
  const walk = (directory: string) => {
    if (entries.length >= 500) return
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      const path = join(directory, entry.name)
      const rel = relative(workspace, path).split(sep).join('/')
      if (entry.isSymbolicLink()) entries.push(`${rel} [link omitted]`)
      else if (entry.isDirectory()) {
        entries.push(`${rel}/`)
        walk(path)
      } else if (entry.isFile()) entries.push(rel)
      if (entries.length >= 500) break
    }
  }
  walk(workspace)
  return entries.join('\n').slice(0, 16_000)
}

function readCachedTrial(
  path: string,
  planId: string,
  expected: { variant: 'skill' | 'baseline'; trial: number },
): SkillQualityMeasuredReportJson['cases'][number]['trials'][number] | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { plan_id?: unknown; result?: unknown }
    if (parsed.plan_id !== planId || !parsed.result || typeof parsed.result !== 'object') return null
    const result = parsed.result as Record<string, unknown>
    const statuses = new Set(['pass', 'fail', 'error'])
    const checkKinds = new Set(['file_exists', 'shell', 'judge', 'setup', 'harness'])
    if (
      result.variant !== expected.variant
      || result.trial !== expected.trial
      || !statuses.has(String(result.status))
      || typeof result.duration_ms !== 'number'
      || !Number.isFinite(result.duration_ms)
      || result.duration_ms < 0
      || !Array.isArray(result.checks)
    ) return null
    const checks: SkillQualityMeasuredReportJson['cases'][number]['trials'][number]['checks'] = []
    for (const candidate of result.checks) {
      if (!candidate || typeof candidate !== 'object') return null
      const check = candidate as Record<string, unknown>
      if (!checkKinds.has(String(check.kind)) || !statuses.has(String(check.status))) return null
      checks.push({
        kind: check.kind as SkillQualityMeasuredReportJson['cases'][number]['trials'][number]['checks'][number]['kind'],
        status: check.status as SkillQualityMeasuredReportJson['cases'][number]['trials'][number]['checks'][number]['status'],
      })
    }
    return {
      variant: expected.variant,
      trial: expected.trial,
      status: result.status as SkillQualityMeasuredReportJson['cases'][number]['trials'][number]['status'],
      duration_ms: result.duration_ms,
      resumed: true,
      checks,
    }
  } catch {
    return null
  }
}

export async function runSkillQualityMeasuredPlan(options: {
  skill: Skill
  plan: SkillQualityEvalPlanJson
  reportRoot?: string
  executor?: MeasuredSandboxExecutor
}): Promise<SkillQualityMeasuredReportJson> {
  const { skill, plan } = options
  if (plan.mode !== 'measured' || plan.harness.name === 'none' || plan.harness.effort === null) throw new Error('Only a reviewed measured plan can use this runner')
  if (!plan.ready_to_start || plan.blockers.length > 0) throw new Error('The reviewed measured plan is blocked')
  if (!plan.sandbox.available || !plan.sandbox.image_id || !plan.sandbox.network) throw new Error('Measured trials require the reviewed network-enabled Docker sandbox')
  if (plan.sandbox.credential_profile !== plan.harness.name) throw new Error('The credential profile does not match the reviewed harness')
  const harness = plan.harness.name
  const definitions = new Map(readSkillQualityEvalCases(skill.canonical_path).map((entry) => [entry.id, entry]))
  const reportId = plan.report.resume_id
  const runRoot = join(options.reportRoot ?? join(appDataRootPath(), 'quality', 'runs'), reportId)
  const executor = options.executor ?? dockerMeasuredSandboxExecutor
  const startedAt = new Date().toISOString()
  const jobs = plan.cases.flatMap((evalCase) => [
    ...Array.from({ length: evalCase.trials }, (_, trial) => ({ evalCase, variant: 'skill' as const, trial })),
    ...(plan.harness.baseline ? Array.from({ length: evalCase.trials }, (_, trial) => ({ evalCase, variant: 'baseline' as const, trial })) : []),
  ])
  const trials = await mapQualityConcurrency(jobs, plan.harness.concurrency, async (job) => {
    const cachePath = join(runRoot, 'trials', `${job.evalCase.id}-${job.variant}-${job.trial + 1}.json`)
    const cached = readCachedTrial(cachePath, plan.plan_id, { variant: job.variant, trial: job.trial + 1 })
    if (cached) return { caseId: job.evalCase.id, result: cached }
    const definition = definitions.get(job.evalCase.id)
    if (!definition) throw new Error(`Eval case “${job.evalCase.id}” changed after review`)
    const workspace = mkdtempSync(join(tmpdir(), 'skiller-measured-'))
    chmodSync(workspace, 0o777)
    const started = Date.now()
    const checks: SkillQualityMeasuredReportJson['cases'][number]['trials'][number]['checks'] = []
    let status: 'pass' | 'fail' | 'error' = 'pass'
    try {
      copyQualityFixture(skill.canonical_path, definition.fixture, workspace)
      if (definition.setup) {
        const setup = await executor.shell({ imageId: plan.sandbox.image_id!, workspace, command: definition.setup, timeoutMs: Math.min(definition.timeout, 900) * 1_000 })
        checks.push({ kind: 'setup', status: setup.code === 0 ? 'pass' : 'error', ...safeQualityOutput(setup.stdout, setup.stderr, workspace) })
        if (setup.code !== 0) status = 'error'
      }
      if (status !== 'error' && job.variant === 'skill') copySkillForHarness(skill, workspace, harness)
      let response = ''
      if (status !== 'error') {
        const run = await executor.agent({
          imageId: plan.sandbox.image_id!, workspace, harness, model: plan.harness.model,
          effort: plan.harness.effort!, prompt: definition.prompt, timeoutMs: Math.min(definition.timeout, 900) * 1_000,
          credentialProfile: harness, environmentNames: plan.sandbox.environment_names,
        })
        response = run.response
        const safe = safeQualityOutput(response, `${run.stdout}\n${run.stderr}`, workspace)
        if (safe.output_redacted || run.code !== 0) {
          checks.push({ kind: 'harness', status: 'error', ...safe })
          status = 'error'
        }
      }
      if (status !== 'error') {
        for (const check of definition.checks) {
          if (check.kind === 'file_exists') {
            const passed = safeQualityWorkspacePath(workspace, check.value)
            checks.push({ kind: 'file_exists', status: passed ? 'pass' : 'fail' })
            if (!passed) status = 'fail'
          } else if (check.kind === 'shell') {
            const result = await executor.shell({ imageId: plan.sandbox.image_id!, workspace, command: check.value, timeoutMs: Math.min(definition.timeout, 900) * 1_000 })
            checks.push({ kind: 'shell', status: result.code === 0 ? 'pass' : 'fail', ...safeQualityOutput(result.stdout, result.stderr, workspace) })
            if (result.code !== 0) status = 'fail'
          } else {
            const judgePrompt = `Evaluate one criterion. Return exactly PASS or FAIL.\n\nCriterion: ${check.value}\n\nUser prompt: ${definition.prompt}\n\nAgent response:\n${response.slice(0, 64_000)}\n\nWorkspace files:\n${workspaceListing(workspace)}`
            const judgeWorkspace = mkdtempSync(join(tmpdir(), 'skiller-judge-'))
            chmodSync(judgeWorkspace, 0o777)
            try {
              const judge = await executor.agent({
                imageId: plan.sandbox.image_id!, workspace: judgeWorkspace, harness, model: plan.harness.model,
                effort: plan.harness.effort!, prompt: judgePrompt, timeoutMs: 120_000,
                credentialProfile: harness, environmentNames: plan.sandbox.environment_names,
              })
              const passed = judge.code === 0 && /^\s*PASS\b/i.test(judge.response)
              checks.push({ kind: 'judge', status: judge.code === 0 ? (passed ? 'pass' : 'fail') : 'error' })
              if (judge.code !== 0) status = 'error'
              else if (!passed) status = 'fail'
            } finally {
              rmSync(judgeWorkspace, { recursive: true, force: true })
            }
          }
        }
      }
    } catch (error) {
      status = 'error'
      const message = error instanceof Error ? error.message.split(skill.canonical_path).join('<skill>') : 'Measured trial failed safely.'
      checks.push({ kind: 'harness', status: 'error', output: message.split(workspace).join('<workspace>') })
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
    const result = { variant: job.variant, trial: job.trial + 1, status, duration_ms: Date.now() - started, resumed: false, checks }
    writeQualityJsonAtomic(cachePath, { plan_id: plan.plan_id, result })
    return { caseId: job.evalCase.id, result }
  })

  const cases = plan.cases.map((evalCase) => {
    const current = trials.filter((entry) => entry.caseId === evalCase.id).map((entry) => entry.result)
    const skillTrials = current.filter((entry) => entry.variant === 'skill')
    const baselineTrials = current.filter((entry) => entry.variant === 'baseline')
    const skillRate = skillTrials.filter((entry) => entry.status === 'pass').length / Math.max(skillTrials.length, 1)
    const baselineRate = plan.harness.baseline
      ? baselineTrials.filter((entry) => entry.status === 'pass').length / Math.max(baselineTrials.length, 1)
      : null
    return {
      id: evalCase.id, behavior: evalCase.behavior, skill_pass_rate: skillRate,
      baseline_pass_rate: baselineRate, lift: baselineRate === null ? null : skillRate - baselineRate,
      trials: current,
    }
  })
  const behaviors = [...new Set(cases.map((entry) => entry.behavior))].map((behavior) => {
    const current = cases.filter((entry) => entry.behavior === behavior)
    const skillTrials = current.flatMap((entry) => entry.trials.filter((trial) => trial.variant === 'skill'))
    const baselineTrials = current.flatMap((entry) => entry.trials.filter((trial) => trial.variant === 'baseline'))
    const skillRate = skillTrials.filter((entry) => entry.status === 'pass').length / Math.max(skillTrials.length, 1)
    const baselineRate = plan.harness.baseline
      ? baselineTrials.filter((entry) => entry.status === 'pass').length / Math.max(baselineTrials.length, 1)
      : null
    return { behavior, skill_pass_rate: skillRate, baseline_pass_rate: baselineRate, lift: baselineRate === null ? null : skillRate - baselineRate, trials: skillTrials.length }
  })
  const allTrials = cases.flatMap((entry) => entry.trials)
  const summary = {
    cases: cases.length, trials: allTrials.length,
    passed: allTrials.filter((entry) => entry.status === 'pass').length,
    failed: allTrials.filter((entry) => entry.status === 'fail').length,
    errored: allTrials.filter((entry) => entry.status === 'error').length,
  }
  const report: SkillQualityMeasuredReportJson = {
    schema: 1, report_id: reportId, plan_id: plan.plan_id, quality_id: plan.quality_id, skill: plan.skill,
    mode: 'measured', status: summary.errored > 0 ? 'blocked' : summary.failed > 0 ? 'completed-with-failures' : 'completed',
    started_at: startedAt, completed_at: new Date().toISOString(),
    harness: { name: harness, model: plan.harness.model, effort: plan.harness.effort },
    sandbox: {
      image_id: plan.sandbox.image_id, network: true, credential_profile: harness,
      environment_names: plan.sandbox.environment_names, direct_host_fallback: false,
    },
    summary, behaviors, cases, local_destination: plan.report.local_destination,
  }
  writeQualityJsonAtomic(join(runRoot, 'report.json'), report)
  return report
}
