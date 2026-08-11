import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { parse as parseYaml } from 'yaml'
import { computePlanId } from 'dotagents'
import { scanTextForSecrets } from 'dotagents/audit'
import type {
  SkillQualityEvalPlanJson,
  SkillQualityEvalPreviewRequestJson,
} from '../shared/rpc-schema'
import type { Skill } from './skill-types'
import { inspectSkillQuality, skillQualityIdentity } from './skill-quality'

const MAX_ARTIFACT_FILES = 2_000
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_CASES = 500
const DEFAULT_IMAGE = 'skillet-eval'
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/
const IMAGE_REFERENCE = /^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,254}$/
const execFileAsync = promisify(execFile)

export type DockerImageInspection = {
  available: boolean
  imageId: string | null
  reason?: string
}

export type CredentialInspection = { available: boolean; reason?: string }

export function inspectLocalCredentialProfile(profile: 'none' | 'codex' | 'claude'): CredentialInspection {
  if (profile === 'none') return { available: true }
  const candidates = profile === 'codex'
    ? [join(homedir(), '.codex')]
    : [join(homedir(), '.claude'), join(homedir(), '.claude.json')]
  const available = candidates.some((candidate) => {
    try {
      const metadata = lstatSync(candidate)
      return !metadata.isSymbolicLink() && (metadata.isDirectory() || metadata.isFile())
    } catch {
      return false
    }
  })
  return available
    ? { available: true }
    : { available: false, reason: `The local ${profile} credential profile is unavailable or linked. Skiller does not follow credential links.` }
}

export async function inspectLocalDockerImage(reference: string): Promise<DockerImageInspection> {
  if (!IMAGE_REFERENCE.test(reference)) throw new Error('Sandbox image reference is invalid')
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['image', 'inspect', '--format={{.Id}}', reference],
      { timeout: 10_000, maxBuffer: 16 * 1024 },
    )
    const imageId = stdout.trim()
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) {
      return { available: false, imageId: null, reason: 'Docker returned an invalid image identity.' }
    }
    return { available: true, imageId }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { available: false, imageId: null, reason: 'Docker is not installed or is not available to Skiller.' }
    }
    return { available: false, imageId: null, reason: `Docker image “${reference}” is not available locally. Skiller will never pull it automatically.` }
  }
}

export type SkillQualityEvalCase = {
  id: string
  file: string
  behavior: string
  prompt: string
  fixture: string | null
  trials: number
  timeout: number
  setup: string | null
  checks: { kind: 'file_exists' | 'shell' | 'judge'; value: string }[]
}

type ArtifactSnapshot = {
  hash: string
  fileCount: number
  totalBytes: number
  secretFindings: { relativePath: string; rule: string; line: number }[]
}

function regularFile(root: string, relativePath: string): Buffer {
  const target = join(root, ...relativePath.split('/'))
  let metadata
  try {
    metadata = lstatSync(target)
  } catch {
    throw new Error(`${relativePath} is missing or unreadable`)
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`${relativePath} must be a regular file`)
  if (metadata.size > MAX_FILE_BYTES) throw new Error(`${relativePath} exceeds the safe evaluation-plan limit`)
  try {
    return readFileSync(target)
  } catch {
    throw new Error(`${relativePath} is missing or unreadable`)
  }
}

function artifactFiles(root: string): string[] {
  const output: string[] = []
  const walk = (relativeDirectory: string) => {
    const directory = relativeDirectory ? join(root, ...relativeDirectory.split('/')) : root
    const directoryLabel = relativeDirectory ? `${relativeDirectory}/` : 'skill root'
    let metadata
    try {
      metadata = lstatSync(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw new Error(`${directoryLabel} is unreadable`)
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`${directoryLabel} must be a regular directory`)
    }
    let entries: Dirent[]
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      throw new Error(`${directoryLabel} is unreadable`)
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      if (!relativeDirectory && (entry.name === '.git' || entry.name === '.dotagents' || entry.name === 'node_modules')) continue
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) throw new Error(`${relativePath} must not be a symbolic link`)
      if (entry.isDirectory()) walk(relativePath)
      else if (entry.isFile()) output.push(relativePath)
      else throw new Error(`${relativePath} is not a regular file or directory`)
      if (output.length > MAX_ARTIFACT_FILES) throw new Error(`Quality artifacts exceed ${MAX_ARTIFACT_FILES} files`)
    }
  }
  walk('')
  return [...new Set(output)].sort()
}

function snapshotArtifacts(root: string): ArtifactSnapshot {
  let totalBytes = 0
  const secretFindings: ArtifactSnapshot['secretFindings'] = []
  const digest = createHash('sha256')
  const files = artifactFiles(root)
  for (const relativePath of files) {
    const content = regularFile(root, relativePath)
    totalBytes += content.byteLength
    if (totalBytes > MAX_ARTIFACT_BYTES) throw new Error('Quality artifacts exceed the 50 MiB snapshot limit')
    digest.update(relativePath).update('\0').update(createHash('sha256').update(content).digest('hex')).update('\0')
    if (!content.includes(0)) {
      for (const finding of scanTextForSecrets(content.toString('utf8'))) {
        secretFindings.push({ relativePath, rule: finding.rule, line: finding.line })
      }
    }
  }
  return { hash: digest.digest('hex'), fileCount: files.length, totalBytes, secretFindings }
}

export function readSkillQualityEvalCases(root: string): SkillQualityEvalCase[] {
  const directory = join(root, 'evals', 'cases')
  let metadata
  try {
    metadata = lstatSync(directory)
  } catch {
    throw new Error('evals/cases/ is missing or unreadable')
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error('evals/cases/ must be a regular directory')
  let directoryEntries: string[]
  try {
    directoryEntries = readdirSync(directory)
  } catch {
    throw new Error('evals/cases/ is unreadable')
  }
  const entries = directoryEntries
    .filter((entry) => /\.ya?ml$/.test(entry))
    .sort()
  if (entries.length > MAX_CASES) throw new Error(`Quality evaluation is limited to ${MAX_CASES} cases`)
  return entries.map((entry) => {
    const file = `evals/cases/${entry}`
    const value = parseYaml(regularFile(root, file).toString('utf8'), { maxAliasCount: 25 })
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${file} must be a YAML mapping`)
    const data = value as Record<string, unknown>
    if (typeof data.behavior !== 'string' || !data.behavior.trim()) throw new Error(`${file} has no behavior id`)
    if (typeof data.prompt !== 'string' || !data.prompt.trim()) throw new Error(`${file} has no prompt`)
    const rawChecks = data.checks
    if (!Array.isArray(rawChecks) || rawChecks.length === 0) throw new Error(`${file} has no checks`)
    const checks = rawChecks.map((raw, index): SkillQualityEvalCase['checks'][number] => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 1) {
        throw new Error(`${file} check ${index + 1} must be a one-key mapping`)
      }
      const [kind] = Object.keys(raw)
      const rawValue = kind ? (raw as Record<string, unknown>)[kind] : undefined
      if (kind !== 'file_exists' && kind !== 'shell' && kind !== 'judge') throw new Error(`${file} check ${index + 1} is unsupported`)
      if (typeof rawValue !== 'string' || !rawValue.trim()) throw new Error(`${file} check ${index + 1} has no value`)
      return { kind, value: rawValue }
    })
    const trials = data.trials ?? 1
    const timeout = data.timeout ?? 300
    if (typeof trials !== 'number' || !Number.isInteger(trials) || trials < 1) throw new Error(`${file} trials must be a positive integer`)
    if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) throw new Error(`${file} timeout must be positive`)
    if (data.setup !== undefined && typeof data.setup !== 'string') throw new Error(`${file} setup must be a string`)
    const fixture = data.fixture === undefined ? null : data.fixture
    if (fixture !== null && (typeof fixture !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(fixture) || fixture === '.' || fixture === '..')) {
      throw new Error(`${file} fixture must be a portable directory name`)
    }
    return {
      id: basename(entry).replace(/\.ya?ml$/, ''),
      file,
      behavior: data.behavior.trim(),
      prompt: data.prompt,
      fixture,
      trials,
      timeout,
      setup: typeof data.setup === 'string' && data.setup.trim() ? data.setup : null,
      checks,
    }
  })
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, name: string): number {
  const current = value ?? fallback
  if (!Number.isInteger(current) || current < minimum || current > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return current
}

function safeModel(value: string | undefined): string | null {
  if (value === undefined || !value.trim()) return null
  const model = value.trim()
  if (model.length > 128 || /[\u0000-\u001f\u007f]/.test(model)) throw new Error('Model name is invalid')
  return model
}

export function createSkillQualityEvalPlan(
  skill: Skill,
  request: SkillQualityEvalPreviewRequestJson,
  imageInspection: DockerImageInspection,
  credentialInspection: CredentialInspection = { available: true },
): SkillQualityEvalPlanJson {
  if (request.qualityId !== skillQualityIdentity(skill)) throw new Error('Quality item identity is stale')
  const mode = request.mode
  const status = inspectSkillQuality(skill)
  const blockers: SkillQualityEvalPlanJson['blockers'] = []
  if (status.state !== 'ready') {
    blockers.push({ code: 'quality-not-ready', message: 'Resolve structural findings and behavior coverage before evaluation.' })
  }

  let snapshot: ArtifactSnapshot
  let cases: SkillQualityEvalCase[] = []
  try {
    snapshot = snapshotArtifacts(skill.canonical_path)
    cases = readSkillQualityEvalCases(skill.canonical_path)
  } catch (error) {
    snapshot = { hash: createHash('sha256').update('unavailable').digest('hex'), fileCount: 0, totalBytes: 0, secretFindings: [] }
    const message = error instanceof Error
      ? error.message.split(skill.canonical_path).join('<skill>')
      : 'Quality artifacts could not be snapshotted safely.'
    blockers.push({ code: 'unsafe-artifacts', message })
  }
  for (const finding of snapshot.secretFindings) {
    blockers.push({
      code: `possible-secret-${finding.rule}`,
      message: 'A possible secret in a quality artifact must be removed before evaluation.',
      file: finding.relativePath,
      line: finding.line,
    })
  }

  const trialsOverride = request.trials === undefined ? null : boundedInteger(request.trials, 1, 1, 10, 'trials')
  const concurrency = boundedInteger(request.concurrency, 2, 1, 4, 'concurrency')
  const image = request.sandboxImage?.trim() || DEFAULT_IMAGE
  if (!IMAGE_REFERENCE.test(image)) throw new Error('Sandbox image reference is invalid')
  if (!imageInspection.available || !imageInspection.imageId) {
    blockers.push({ code: 'sandbox-unavailable', message: imageInspection.reason || `Docker image “${image}” is not available locally.` })
  }

  const environmentNames = [...new Set(request.environmentNames ?? [])].sort()
  if (environmentNames.length > 16 || environmentNames.some((name) => !ENV_NAME.test(name))) {
    throw new Error('Environment allowlist contains an invalid variable name')
  }
  const harness: SkillQualityEvalPlanJson['harness']['name'] = mode === 'dry' ? 'none' : request.harness ?? 'codex'
  const credentialProfile = mode === 'dry' ? 'none' : request.credentialProfile ?? 'none'
  const network = mode === 'dry' ? false : request.network === true
  const baseline = mode === 'measured' && request.baseline === true
  if (mode === 'measured' && credentialProfile !== harness) {
    blockers.push({ code: 'credential-profile-required', message: `Select the reviewed ${harness} credential profile for this sandbox.` })
  }
  if (mode === 'measured' && credentialProfile === harness && !credentialInspection.available) {
    blockers.push({ code: 'credential-profile-unavailable', message: credentialInspection.reason || `The local ${harness} credential profile is unavailable.` })
  }
  if (mode === 'measured' && !network) {
    blockers.push({ code: 'network-disabled', message: 'Measured agent trials need an explicit network grant. Network remains off by default.' })
  }

  const commandReview: SkillQualityEvalPlanJson['command_review'] = []
  for (const evalCase of cases) {
    const commands = [
      ...(evalCase.setup ? [{ kind: 'setup' as const, command: evalCase.setup }] : []),
      ...evalCase.checks.filter((check) => check.kind === 'shell').map((check) => ({ kind: 'shell-check' as const, command: check.value })),
    ]
    for (const command of commands) {
      const secretFindings = scanTextForSecrets(command.command)
      if (secretFindings.length > 0) {
        for (const finding of secretFindings) {
          blockers.push({
            code: `possible-secret-${finding.rule}`,
            message: `A possible secret in ${command.kind === 'setup' ? 'setup' : 'a shell check'} must be removed before review.`,
            file: evalCase.file,
            line: finding.line,
          })
        }
        continue
      }
      commandReview.push({ case_id: evalCase.id, kind: command.kind, command: command.command, file: evalCase.file })
    }
  }

  const caseSummary = cases.map((evalCase) => ({
    id: evalCase.id,
    behavior: evalCase.behavior,
    fixture: evalCase.fixture,
    trials: mode === 'dry' ? 1 : trialsOverride ?? evalCase.trials,
    timeout_seconds: Math.min(evalCase.timeout, 900),
    deterministic_checks: evalCase.checks.filter((check) => check.kind !== 'judge').length,
    judge_checks: evalCase.checks.filter((check) => check.kind === 'judge').length,
    shell_checks: evalCase.checks.filter((check) => check.kind === 'shell').length,
    has_setup: evalCase.setup !== null,
  }))

  const payload = {
    schema: 1,
    quality_id: request.qualityId,
    skill: { name: status.name, origin_label: status.origin_label },
    mode,
    artifacts: {
      snapshot_sha256: snapshot.hash,
      file_count: snapshot.fileCount,
      total_bytes: snapshot.totalBytes,
      spec_hash: status.spec.hash,
    },
    cases: caseSummary,
    harness: {
      name: harness,
      model: mode === 'measured' ? safeModel(request.model) : null,
      effort: mode === 'measured' ? request.effort ?? 'low' : null,
      baseline,
      concurrency,
    },
    sandbox: {
      kind: 'docker' as const,
      image,
      image_id: imageInspection.imageId,
      available: imageInspection.available,
      network,
      credential_profile: credentialProfile,
      environment_names: environmentNames,
      direct_host_fallback: false as const,
    },
    command_review: commandReview,
    blockers,
  }
  const planId = computePlanId(payload)
  return {
    plan_id: planId,
    quality_id: request.qualityId,
    skill: payload.skill,
    mode,
    artifacts: payload.artifacts,
    cases: caseSummary,
    harness: payload.harness,
    sandbox: payload.sandbox,
    command_review: commandReview,
    blockers,
    report: {
      resume_id: planId.slice(0, 20),
      local_destination: `Skiller device data · quality/${planId.slice(0, 20)}`,
      includes_baseline_lift: baseline,
    },
    ready_to_start: blockers.length === 0,
  }
}
