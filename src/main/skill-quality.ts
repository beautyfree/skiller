import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type {
  SkillQualityIssueJson,
  SkillQualityOverviewJson,
  SkillQualityStatusJson,
} from '../shared/rpc-schema'
import type { Skill } from './skill-types'

const MAX_SPEC_BYTES = 1024 * 1024
const MAX_CASE_BYTES = 256 * 1024
const MAX_CASES = 500
const KNOWN_SPEC_SECTIONS = new Set(['Intent', 'Triggers', 'Behaviors', 'Constraints'])
const REQUIRED_SPEC_SECTIONS = ['Intent', 'Triggers', 'Behaviors'] as const
const KNOWN_CASE_FIELDS = new Set(['behavior', 'prompt', 'fixture', 'setup', 'checks', 'trials', 'timeout'])
const CHECK_KINDS = new Set(['file_exists', 'shell', 'judge'])

type ParsedBehavior = {
  id: string
  name: string
  line: number
  scenarioCount: number
}

type ParsedSpec = {
  title: string | null
  behaviors: ParsedBehavior[]
  constraintIds: Set<string>
  issues: SkillQualityIssueJson[]
}

type ParsedCase = {
  id: string
  file: string
  behavior: string
  fixture?: string
  deterministicChecks: number
  judgeChecks: number
  shellChecks: number
  hasSetup: boolean
}

type CasesResult = {
  cases: ParsedCase[]
  issues: SkillQualityIssueJson[]
}

function issue(
  area: SkillQualityIssueJson['area'],
  severity: SkillQualityIssueJson['severity'],
  code: string,
  message: string,
  details: Pick<SkillQualityIssueJson, 'hint' | 'file' | 'line'> = {},
): SkillQualityIssueJson {
  return {
    area,
    severity,
    code,
    message,
    ...(details.hint ? { hint: details.hint } : {}),
    ...(details.file ? { file: details.file } : {}),
    ...(details.line ? { line: details.line } : {}),
  }
}

export function skillQualityIdentity(skill: Skill): string {
  return createHash('sha256')
    .update(`${skill.id}\0${skill.canonical_path}`)
    .digest('hex')
    .slice(0, 16)
}

function skillOriginLabel(skill: Skill): string {
  if (skill.source?.kind === 'SkillsSh') return 'skills.sh source'
  if (skill.source?.kind === 'GitRepository') return 'Git source'
  if (skill.source?.kind === 'ClawHub') return 'ClawHub source'
  if (skill.collection) {
    const parts = skill.canonical_path.split(/[/\\]+/).filter(Boolean)
    const collectionIndex = parts.lastIndexOf(skill.collection)
    const container = collectionIndex >= 0 ? parts.slice(collectionIndex + 1, -1) : []
    return `${skill.collection} · ${container.length ? container.slice(-2).join('/') : 'root'}`
  }
  if (skill.scope.kind === 'AgentLocal') return `${skill.scope.agent} local`
  return 'Shared library'
}

function revealableArtifact(root: string, relativePath: string | undefined): boolean {
  if (!relativePath || relativePath.endsWith('/')) return false
  try {
    const metadata = lstatSync(join(root, ...relativePath.split('/')))
    return metadata.isFile() && !metadata.isSymbolicLink()
  } catch {
    return false
  }
}

function exactEntry(root: string, name: string): boolean {
  try {
    return readdirSync(root).includes(name)
  } catch {
    return false
  }
}

function readBoundedRegularFile(root: string, relativePath: string, maximumBytes: number): Buffer {
  const target = join(root, ...relativePath.split('/'))
  const metadata = lstatSync(target)
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${relativePath} must be a regular file`)
  }
  if (metadata.size > maximumBytes) throw new Error(`${relativePath} exceeds the safe read limit`)
  return readFileSync(target)
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function parseSpec(content: string): ParsedSpec {
  const issues: SkillQualityIssueJson[] = []
  const lines = content.split(/\r?\n/)
  const seenSections = new Set<string>()
  const behaviors: ParsedBehavior[] = []
  const constraintIds = new Set<string>()
  const identities = new Map<string, number>()
  let title: string | null = null
  let section: string | null = null
  let currentBehavior: { id: string; name: string; line: number; scenarioCount: number; normative: boolean } | null = null
  let currentScenario: { name: string; line: number; hasWhen: boolean; hasThen: boolean } | null = null
  let currentConstraint: { id: string; name: string; line: number; mustNot: boolean } | null = null
  let intentHasText = false
  let triggerCount = 0
  let inFence = false

  const closeScenario = () => {
    if (!currentScenario) return
    if (!currentScenario.hasWhen) {
      issues.push(issue('spec', 'error', 'scenario-missing-when', `Scenario “${currentScenario.name}” has no WHEN or GIVEN bullet.`, {
        file: 'spec.md',
        line: currentScenario.line,
        hint: 'Add a concrete - **WHEN** condition.',
      }))
    }
    if (!currentScenario.hasThen) {
      issues.push(issue('spec', 'error', 'scenario-missing-then', `Scenario “${currentScenario.name}” has no THEN or AND bullet.`, {
        file: 'spec.md',
        line: currentScenario.line,
        hint: 'Add an observable - **THEN** outcome.',
      }))
    }
    currentScenario = null
  }

  const recordIdentity = (id: string, name: string, line: number) => {
    if (!id) {
      issues.push(issue('spec', 'error', 'empty-identity', `“${name}” does not produce a stable identifier.`, {
        file: 'spec.md',
        line,
      }))
      return
    }
    const previous = identities.get(id)
    if (previous) {
      issues.push(issue('spec', 'error', 'duplicate-identity', `Duplicate behavior or constraint id “${id}”.`, {
        file: 'spec.md',
        line,
        hint: `Rename one of the headings; the first is on line ${previous}.`,
      }))
      return
    }
    identities.set(id, line)
  }

  const closeBehavior = () => {
    closeScenario()
    if (!currentBehavior) return
    if (currentBehavior.scenarioCount === 0) {
      issues.push(issue('spec', 'error', 'behavior-without-scenario', `Behavior “${currentBehavior.name}” has no scenario.`, {
        file: 'spec.md',
        line: currentBehavior.line,
        hint: 'Add at least one #### Scenario block.',
      }))
    }
    if (!currentBehavior.normative) {
      issues.push(issue('spec', 'warning', 'behavior-not-normative', `Behavior “${currentBehavior.name}” has no SHALL or MUST statement.`, {
        file: 'spec.md',
        line: currentBehavior.line,
      }))
    }
    recordIdentity(currentBehavior.id, currentBehavior.name, currentBehavior.line)
    behaviors.push({
      id: currentBehavior.id,
      name: currentBehavior.name,
      line: currentBehavior.line,
      scenarioCount: currentBehavior.scenarioCount,
    })
    currentBehavior = null
  }

  const closeConstraint = () => {
    if (!currentConstraint) return
    if (!currentConstraint.mustNot) {
      issues.push(issue('spec', 'warning', 'constraint-not-normative', `Constraint “${currentConstraint.name}” has no MUST NOT statement.`, {
        file: 'spec.md',
        line: currentConstraint.line,
      }))
    }
    recordIdentity(currentConstraint.id, currentConstraint.name, currentConstraint.line)
    constraintIds.add(currentConstraint.id)
    currentConstraint = null
  }

  for (const [index, raw] of lines.entries()) {
    const lineNumber = index + 1
    const trimmed = raw.trim()
    if (trimmed.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence || (trimmed.startsWith('<!--') && trimmed.endsWith('-->'))) continue
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw.trimEnd())
    if (heading) {
      const depth = heading[1]?.length ?? 0
      const headingTitle = heading[2]?.trim() ?? ''
      if (depth === 1) {
        if (!title) title = headingTitle
        else issues.push(issue('spec', 'error', 'multiple-titles', 'spec.md must have exactly one top-level title.', { file: 'spec.md', line: lineNumber }))
        continue
      }
      if (depth === 2) {
        closeBehavior()
        closeConstraint()
        section = headingTitle
        if (KNOWN_SPEC_SECTIONS.has(headingTitle)) seenSections.add(headingTitle)
        else issues.push(issue('spec', 'warning', 'unknown-section', `Unknown spec section “${headingTitle}”.`, { file: 'spec.md', line: lineNumber }))
        continue
      }
      if (headingTitle.startsWith('Behavior:')) {
        if (depth !== 3) {
          issues.push(issue('spec', 'error', 'behavior-heading-depth', 'Behavior headings require exactly three # characters.', { file: 'spec.md', line: lineNumber }))
          continue
        }
        closeBehavior()
        closeConstraint()
        const name = headingTitle.slice('Behavior:'.length).trim()
        if (section !== 'Behaviors') {
          issues.push(issue('spec', 'error', 'behavior-outside-section', `Behavior “${name}” is outside ## Behaviors.`, { file: 'spec.md', line: lineNumber }))
        }
        if (!name || name.includes('<!--')) {
          issues.push(issue('spec', 'error', 'behavior-placeholder', 'Replace the behavior heading placeholder.', { file: 'spec.md', line: lineNumber }))
          continue
        }
        currentBehavior = { id: slugify(name), name, line: lineNumber, scenarioCount: 0, normative: false }
        continue
      }
      if (headingTitle.startsWith('Scenario:')) {
        if (depth !== 4) {
          issues.push(issue('spec', 'error', 'scenario-heading-depth', 'Scenario headings require exactly four # characters.', { file: 'spec.md', line: lineNumber }))
          continue
        }
        closeScenario()
        const name = headingTitle.slice('Scenario:'.length).trim()
        if (!currentBehavior) {
          issues.push(issue('spec', 'error', 'scenario-without-behavior', `Scenario “${name}” has no enclosing behavior.`, { file: 'spec.md', line: lineNumber }))
          continue
        }
        currentBehavior.scenarioCount += 1
        currentScenario = { name, line: lineNumber, hasWhen: false, hasThen: false }
        continue
      }
      if (headingTitle.startsWith('Constraint:')) {
        if (depth !== 3) {
          issues.push(issue('spec', 'error', 'constraint-heading-depth', 'Constraint headings require exactly three # characters.', { file: 'spec.md', line: lineNumber }))
          continue
        }
        closeBehavior()
        closeConstraint()
        const name = headingTitle.slice('Constraint:'.length).trim()
        if (section !== 'Constraints') {
          issues.push(issue('spec', 'error', 'constraint-outside-section', `Constraint “${name}” is outside ## Constraints.`, { file: 'spec.md', line: lineNumber }))
        }
        currentConstraint = { id: slugify(name), name, line: lineNumber, mustNot: false }
        continue
      }
      issues.push(issue('spec', 'warning', 'unknown-heading', `Unrecognized heading “${headingTitle}”.`, { file: 'spec.md', line: lineNumber }))
      continue
    }

    if (section === 'Intent' && trimmed) intentHasText = true
    if (section === 'Triggers' && /^-\s+\*\*(?:SHOULD|SHOULD NOT)\*\*/.test(trimmed)) triggerCount += 1
    if (currentBehavior && !currentScenario && /\b(?:SHALL|MUST)\b/.test(trimmed)) currentBehavior.normative = true
    if (currentConstraint && /\bMUST NOT\b/.test(trimmed)) currentConstraint.mustNot = true
    if (currentScenario) {
      const bullet = /^-\s+\*\*([A-Z ]+)\*\*:?[ \t]*(.*)$/.exec(trimmed)
      const tag = bullet?.[1]
      if (tag === 'WHEN' || tag === 'GIVEN') currentScenario.hasWhen = true
      if (tag === 'THEN' || tag === 'AND') currentScenario.hasThen = true
    }
  }
  closeBehavior()
  closeConstraint()
  if (inFence) issues.push(issue('spec', 'warning', 'unclosed-code-fence', 'spec.md has an unclosed code fence.', { file: 'spec.md', line: lines.length }))
  if (!title) issues.push(issue('spec', 'error', 'missing-title', 'spec.md has no top-level title.', { file: 'spec.md', line: 1 }))
  for (const required of REQUIRED_SPEC_SECTIONS) {
    if (!seenSections.has(required)) issues.push(issue('spec', 'error', 'missing-section', `spec.md is missing ## ${required}.`, { file: 'spec.md' }))
  }
  if (seenSections.has('Intent') && !intentHasText) issues.push(issue('spec', 'error', 'empty-intent', 'The Intent section is empty.', { file: 'spec.md' }))
  if (seenSections.has('Triggers') && triggerCount === 0) issues.push(issue('spec', 'warning', 'empty-triggers', 'Triggers has no SHOULD or SHOULD NOT bullets.', { file: 'spec.md' }))
  if (seenSections.has('Behaviors') && behaviors.length === 0) issues.push(issue('spec', 'error', 'empty-behaviors', 'The Behaviors section has no behaviors.', { file: 'spec.md' }))
  return { title, behaviors, constraintIds, issues }
}

function frontmatter(content: string): Record<string, unknown> {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return {}
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end < 0) return {}
  try {
    const parsed = parseYaml(lines.slice(1, end).join('\n'), { maxAliasCount: 25 })
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function parseCases(root: string): CasesResult {
  const cases: ParsedCase[] = []
  const issues: SkillQualityIssueJson[] = []
  const casesRoot = join(root, 'evals', 'cases')
  let entries: string[] = []
  try {
    const metadata = lstatSync(casesRoot)
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      issues.push(issue('safety', 'error', 'linked-eval-directory', 'evals/cases must be a regular directory.', { file: 'evals/cases/' }))
      return { cases, issues }
    }
    entries = readdirSync(casesRoot).filter((entry) => /\.ya?ml$/.test(entry)).sort()
  } catch {
    return { cases, issues }
  }
  if (entries.length > MAX_CASES) {
    issues.push(issue('safety', 'error', 'too-many-eval-cases', `This skill has more than ${MAX_CASES} eval cases.`, { file: 'evals/cases/' }))
    entries = entries.slice(0, MAX_CASES)
  }
  for (const entry of entries) {
    const file = `evals/cases/${entry}`
    let content: string
    try {
      content = readBoundedRegularFile(root, file, MAX_CASE_BYTES).toString('utf8')
    } catch (error) {
      issues.push(issue('safety', 'error', 'unsafe-eval-case', error instanceof Error ? error.message : 'Eval case could not be read safely.', { file }))
      continue
    }
    let value: unknown
    try {
      value = parseYaml(content, { maxAliasCount: 25 })
    } catch (error) {
      issues.push(issue('evals', 'error', 'invalid-case-yaml', error instanceof Error ? error.message.split('\n')[0] ?? 'Invalid YAML' : 'Invalid YAML', { file }))
      continue
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      issues.push(issue('evals', 'error', 'invalid-case-shape', 'Eval case must be a YAML mapping.', { file }))
      continue
    }
    const data = value as Record<string, unknown>
    for (const key of Object.keys(data)) {
      if (!KNOWN_CASE_FIELDS.has(key)) issues.push(issue('evals', 'warning', 'unknown-case-field', `Unknown eval case field “${key}”.`, { file }))
    }
    const behavior = typeof data.behavior === 'string' && data.behavior.trim() ? data.behavior.trim() : null
    const prompt = typeof data.prompt === 'string' && data.prompt.trim() ? data.prompt : null
    if (!behavior) issues.push(issue('evals', 'error', 'missing-case-behavior', 'Eval case has no behavior id.', { file }))
    if (!prompt) issues.push(issue('evals', 'error', 'missing-case-prompt', 'Eval case has no user prompt.', { file }))
    let deterministicChecks = 0
    let judgeChecks = 0
    let shellChecks = 0
    const checks = data.checks
    if (!Array.isArray(checks)) {
      issues.push(issue('evals', 'error', 'missing-case-checks', 'Eval case needs at least one check.', { file }))
    } else {
      for (const [checkIndex, check] of checks.entries()) {
        if (!check || typeof check !== 'object' || Array.isArray(check) || Object.keys(check).length !== 1) {
          issues.push(issue('evals', 'error', 'invalid-case-check', `Check ${checkIndex + 1} must be a one-key mapping.`, { file }))
          continue
        }
        const [kind] = Object.keys(check)
        const raw = kind ? (check as Record<string, unknown>)[kind] : undefined
        if (!kind || !CHECK_KINDS.has(kind)) {
          issues.push(issue('evals', 'error', 'unsupported-check', `Check ${checkIndex + 1} uses an unsupported type.`, { file }))
          continue
        }
        if (typeof raw !== 'string' || !raw.trim()) {
          issues.push(issue('evals', 'error', 'empty-check', `Check ${checkIndex + 1} has no value.`, { file }))
          continue
        }
        if (kind === 'judge') judgeChecks += 1
        else deterministicChecks += 1
        if (kind === 'shell') shellChecks += 1
      }
    }
    const trials = data.trials ?? 1
    if (typeof trials !== 'number' || !Number.isInteger(trials) || trials < 1) issues.push(issue('evals', 'error', 'invalid-trials', 'trials must be a positive integer.', { file }))
    const timeout = data.timeout ?? 300
    if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) issues.push(issue('evals', 'error', 'invalid-timeout', 'timeout must be a positive finite number.', { file }))
    const fixture = typeof data.fixture === 'string' && data.fixture.trim() ? data.fixture.trim() : undefined
    if (data.fixture !== undefined && !fixture) issues.push(issue('evals', 'error', 'invalid-fixture', 'fixture must be a non-empty directory name.', { file }))
    if (data.setup !== undefined && typeof data.setup !== 'string') issues.push(issue('evals', 'error', 'invalid-setup', 'setup must be a shell script string.', { file }))
    if (!behavior || !prompt || issues.some((entryIssue) => entryIssue.file === file && entryIssue.severity === 'error')) continue
    cases.push({
      id: basename(entry).replace(/\.ya?ml$/, ''),
      file,
      behavior,
      ...(fixture ? { fixture } : {}),
      deterministicChecks,
      judgeChecks,
      shellChecks,
      hasSetup: typeof data.setup === 'string' && Boolean(data.setup.trim()),
    })
  }
  return { cases, issues }
}

function fixtureExists(root: string, fixture: string): boolean {
  if (!/^[a-zA-Z0-9._-]+$/.test(fixture) || fixture === '.' || fixture === '..') return false
  try {
    const metadata = lstatSync(join(root, 'evals', 'fixtures', fixture))
    return metadata.isDirectory() && !metadata.isSymbolicLink()
  } catch {
    return false
  }
}

export function inspectSkillQuality(skill: Skill): SkillQualityStatusJson {
  const root = skill.canonical_path
  const issues: SkillQualityIssueJson[] = []
  let parsedSpec: ParsedSpec = { title: null, behaviors: [], constraintIds: new Set(), issues: [] }
  let specHash: string | null = null
  const specPresent = exactEntry(root, 'spec.md')
  if (specPresent) {
    try {
      const raw = readBoundedRegularFile(root, 'spec.md', MAX_SPEC_BYTES)
      specHash = createHash('sha256').update(raw).digest('hex').slice(0, 12)
      parsedSpec = parseSpec(raw.toString('utf8'))
      issues.push(...parsedSpec.issues)
    } catch (error) {
      issues.push(issue('safety', 'error', 'unsafe-spec', error instanceof Error ? error.message : 'spec.md could not be read safely.', { file: 'spec.md' }))
    }
  } else {
    const legacy = exactEntry(root, 'SPEC.md')
    issues.push(issue('spec', 'warning', legacy ? 'legacy-uppercase-spec' : 'missing-spec', legacy ? 'Uppercase SPEC.md is legacy input, not a current Skillet spec.' : 'This skill has no spec.md yet.', {
      file: legacy ? 'SPEC.md' : 'spec.md',
      hint: 'Create a lowercase spec.md with Intent, Triggers, Behaviors, and scenarios.',
    }))
  }

  let skillPresent = false
  let recordedSpecHash: string | null = null
  let stale: boolean | null = null
  if (exactEntry(root, 'SKILL.md')) {
    skillPresent = true
    try {
      const raw = readBoundedRegularFile(root, 'SKILL.md', MAX_SPEC_BYTES).toString('utf8')
      const meta = frontmatter(raw)
      if (!meta.name || typeof meta.name !== 'string') issues.push(issue('skill', 'error', 'missing-skill-name', 'SKILL.md frontmatter has no name.', { file: 'SKILL.md' }))
      if (!meta.description || typeof meta.description !== 'string') issues.push(issue('skill', 'error', 'missing-skill-description', 'SKILL.md frontmatter has no description.', { file: 'SKILL.md' }))
      recordedSpecHash = typeof meta.spec_hash === 'string' && meta.spec_hash.trim() ? meta.spec_hash.trim() : null
      if (specHash) {
        stale = recordedSpecHash ? recordedSpecHash !== specHash : null
        if (!recordedSpecHash) issues.push(issue('skill', 'warning', 'missing-spec-hash', 'SKILL.md is not linked to the current spec.', { file: 'SKILL.md', hint: `Add spec_hash: ${specHash} to its frontmatter after reviewing the render.` }))
        else if (stale) issues.push(issue('skill', 'warning', 'stale-spec-hash', 'SKILL.md was rendered from a different spec revision.', { file: 'SKILL.md', hint: 'Review the spec changes, re-render SKILL.md, and update spec_hash.' }))
      }
    } catch (error) {
      issues.push(issue('safety', 'error', 'unsafe-skill', error instanceof Error ? error.message : 'SKILL.md could not be read safely.', { file: 'SKILL.md' }))
    }
  } else {
    issues.push(issue('skill', 'error', 'missing-skill', 'SKILL.md is missing.', { file: 'SKILL.md' }))
  }

  const caseResult = parseCases(root)
  issues.push(...caseResult.issues)
  const behaviorIds = new Set(parsedSpec.behaviors.map((behavior) => behavior.id))
  const coverage = new Map<string, string[]>()
  for (const evalCase of caseResult.cases) {
    if (behaviorIds.has(evalCase.behavior)) {
      coverage.set(evalCase.behavior, [...(coverage.get(evalCase.behavior) ?? []), evalCase.id])
    } else if (!parsedSpec.constraintIds.has(evalCase.behavior)) {
      issues.push(issue('coverage', 'error', 'unknown-case-behavior', `${evalCase.file} references unknown behavior “${evalCase.behavior}”.`, { file: evalCase.file }))
    }
    if (evalCase.fixture && !fixtureExists(root, evalCase.fixture)) {
      issues.push(issue('coverage', 'error', 'missing-case-fixture', `${evalCase.file} references missing fixture “${evalCase.fixture}”.`, { file: evalCase.file }))
    }
  }
  for (const behavior of parsedSpec.behaviors) {
    if (!coverage.has(behavior.id)) issues.push(issue('coverage', 'warning', 'uncovered-behavior', `Behavior “${behavior.name}” has no eval case.`, { file: 'spec.md', line: behavior.line, hint: `Add an eval case with behavior: ${behavior.id}.` }))
  }

  const specValid = specPresent && !issues.some((entry) => entry.area === 'spec' && entry.severity === 'error')
  const hasErrors = issues.some((entry) => entry.severity === 'error')
  const state: SkillQualityStatusJson['state'] = hasErrors
    ? 'blocked'
    : !specPresent
      ? 'needs-spec'
      : !skillPresent
        ? 'needs-skill'
        : stale === true || recordedSpecHash === null
          ? 'stale'
          : parsedSpec.behaviors.length > 0 && coverage.size < parsedSpec.behaviors.length
            ? 'needs-evals'
            : 'ready'

  const rendererIssues = issues.map((entry) => ({
    ...entry,
    ...(revealableArtifact(root, entry.file) ? { revealable: true } : {}),
  }))

  return {
    quality_id: skillQualityIdentity(skill),
    skill_id: skill.id,
    name: skill.name,
    description: skill.description ?? null,
    origin_label: skillOriginLabel(skill),
    state,
    spec: {
      present: specPresent,
      valid: specValid,
      hash: specHash,
      title: parsedSpec.title,
      behavior_count: parsedSpec.behaviors.length,
      constraint_count: parsedSpec.constraintIds.size,
      behaviors: parsedSpec.behaviors.map((behavior) => ({
        id: behavior.id,
        name: behavior.name,
        scenario_count: behavior.scenarioCount,
        covered_by: coverage.get(behavior.id) ?? [],
      })),
    },
    skill: { present: skillPresent, recorded_spec_hash: recordedSpecHash, stale },
    evals: {
      case_count: caseResult.cases.length,
      covered_behavior_count: coverage.size,
      deterministic_check_count: caseResult.cases.reduce((sum, evalCase) => sum + evalCase.deterministicChecks, 0),
      judge_check_count: caseResult.cases.reduce((sum, evalCase) => sum + evalCase.judgeChecks, 0),
      shell_check_count: caseResult.cases.reduce((sum, evalCase) => sum + evalCase.shellChecks, 0),
      setup_script_count: caseResult.cases.filter((evalCase) => evalCase.hasSetup).length,
    },
    issues: rendererIssues,
  }
}

/** Pure disk inspection. It never starts an agent, shell command, sandbox, or network request. */
export function inspectSkillQualityOverview(skills: Skill[]): SkillQualityOverviewJson {
  const statuses = skills
    .map(inspectSkillQuality)
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
  const totalBehaviors = statuses.reduce((sum, status) => sum + status.spec.behavior_count, 0)
  const coveredBehaviors = statuses.reduce((sum, status) => sum + status.evals.covered_behavior_count, 0)
  return {
    scanned_at: new Date().toISOString(),
    execution: {
      mode: 'structural-only',
      agent_sessions_started: false,
      shell_commands_started: false,
      network_started: false,
    },
    summary: {
      total: statuses.length,
      ready: statuses.filter((status) => status.state === 'ready').length,
      needs_work: statuses.filter((status) => status.state !== 'ready').length,
      covered_behaviors: coveredBehaviors,
      total_behaviors: totalBehaviors,
    },
    skills: statuses,
  }
}
