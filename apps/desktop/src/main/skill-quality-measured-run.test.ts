import { createHash } from 'node:crypto'
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSkillQualityEvalPlan } from './skill-quality-eval'
import { measuredBaseDockerArgs, runSkillQualityMeasuredPlan, type MeasuredSandboxExecutor } from './skill-quality-measured-run'
import { skillQualityIdentity } from './skill-quality'
import type { Skill } from './skill-types'

const roots: string[] = []
const image = { available: true, imageId: `sha256:${'d'.repeat(64)}` }

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): Skill {
  const root = mkdtempSync(join(tmpdir(), 'skiller-measured-skill-'))
  roots.push(root)
  const spec = `# Review

## Intent

Review changes.

## Triggers

- **SHOULD** run for reviews

## Behaviors

### Behavior: Find risk

The agent SHALL create an analysis file.

#### Scenario: Risky patch

- **WHEN** authentication changes
- **THEN** analysis.txt is created
`
  const hash = createHash('sha256').update(spec).digest('hex').slice(0, 12)
  writeFileSync(join(root, 'spec.md'), spec)
  writeFileSync(join(root, 'SKILL.md'), `---\nname: review\ndescription: Reviews risk.\nspec_hash: ${hash}\n---\nCreate analysis.txt.\n`)
  mkdirSync(join(root, 'evals', 'cases'), { recursive: true })
  writeFileSync(join(root, 'evals', 'cases', 'find-risk.yaml'), 'behavior: find-risk\nprompt: Review.\nchecks:\n  - file_exists: analysis.txt\n  - judge: The response says whether risk was found.\n')
  return {
    id: 'review', name: 'Review', description: 'Reviews risk.', canonical_path: root,
    source: { kind: 'LocalPath', path: root }, scope: { kind: 'SharedLibrary' }, installations: [],
    footprint_listing_source_chars: 0, footprint_listing_slice_chars: 0,
    footprint_name_chars: 6, footprint_skill_md_chars: 0, listing_excluded: false,
  }
}

function reportRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'skiller-measured-reports-'))
  roots.push(root)
  return root
}

describe('sandboxed measured evaluation', () => {
  test('builds a Docker-compatible writable workspace mount', () => {
    const args = measuredBaseDockerArgs('/tmp/workspace', image.imageId)
    expect(args).toContain('type=bind,src=/tmp/workspace,dst=/workspace')
    expect(args.some((entry) => entry.endsWith(',rw'))).toBe(false)
  })

  test('reports repeated skill/baseline trials and lift, then resumes by plan id', async () => {
    const skill = fixture()
    const plan = createSkillQualityEvalPlan(skill, {
      qualityId: skillQualityIdentity(skill), mode: 'measured', harness: 'codex', credentialProfile: 'codex',
      network: true, baseline: true, trials: 2, concurrency: 2,
    }, image)
    let agentCalls = 0
    const executor: MeasuredSandboxExecutor = {
      shell: async () => ({ code: 0, stdout: '', stderr: '' }),
      agent: async ({ workspace, prompt }) => {
        agentCalls += 1
        if (prompt.startsWith('Evaluate one criterion')) return { code: 0, stdout: '', stderr: '', response: 'PASS' }
        if (existsSync(join(workspace, 'AGENTS.md'))) writeFileSync(join(workspace, 'analysis.txt'), 'risk')
        return { code: 0, stdout: '', stderr: '', response: 'Risk was reviewed.' }
      },
    }
    const destination = reportRoot()
    const first = await runSkillQualityMeasuredPlan({ skill, plan, reportRoot: destination, executor })
    const callsAfterFirst = agentCalls
    const second = await runSkillQualityMeasuredPlan({ skill, plan, reportRoot: destination, executor })
    expect(first.status).toBe('completed-with-failures')
    expect(first.summary).toMatchObject({ cases: 1, trials: 4, passed: 2, failed: 2, errored: 0 })
    expect(first.behaviors[0]).toMatchObject({ skill_pass_rate: 1, baseline_pass_rate: 0, lift: 1, trials: 2 })
    expect(second.cases[0]?.trials.every((entry) => entry.resumed)).toBe(true)
    expect(agentCalls).toBe(callsAfterFirst)
    expect(JSON.stringify(first)).not.toContain(skill.canonical_path)
    expect(first.sandbox).toMatchObject({ network: true, credential_profile: 'codex', direct_host_fallback: false })
  })

  test('redacts a possible secret in agent output and marks the trial errored', async () => {
    const skill = fixture()
    const plan = createSkillQualityEvalPlan(skill, {
      qualityId: skillQualityIdentity(skill), mode: 'measured', harness: 'codex', credentialProfile: 'codex', network: true,
    }, image)
    const secret = 'postgres://admin:verysecret@example.invalid/db'
    const executor: MeasuredSandboxExecutor = {
      shell: async () => ({ code: 0, stdout: '', stderr: '' }),
      agent: async () => ({ code: 0, stdout: '', stderr: '', response: secret }),
    }
    const report = await runSkillQualityMeasuredPlan({ skill, plan, reportRoot: reportRoot(), executor })
    expect(report.status).toBe('blocked')
    expect(report.summary.errored).toBe(1)
    expect(JSON.stringify(report)).not.toContain(secret)
  })

  test('validates cached trial identity and drops cached output before reporting it', async () => {
    const skill = fixture()
    const plan = createSkillQualityEvalPlan(skill, {
      qualityId: skillQualityIdentity(skill), mode: 'measured', harness: 'codex', credentialProfile: 'codex',
      network: true, baseline: false, trials: 1,
    }, image)
    const destination = reportRoot()
    const trialRoot = join(destination, plan.report.resume_id, 'trials')
    mkdirSync(trialRoot, { recursive: true })
    writeFileSync(join(trialRoot, 'find-risk-skill-1.json'), JSON.stringify({
      plan_id: plan.plan_id,
      result: {
        variant: 'skill', trial: 1, status: 'pass', duration_ms: 1,
        checks: [{ kind: 'judge', status: 'pass', output: '/Users/private/token=verysecret' }],
      },
    }))
    const report = await runSkillQualityMeasuredPlan({
      skill,
      plan,
      reportRoot: destination,
      executor: {
        shell: async () => { throw new Error('valid cache must resume') },
        agent: async () => { throw new Error('valid cache must resume') },
      },
    })
    expect(report.cases[0]?.trials[0]?.resumed).toBe(true)
    expect(report.cases[0]?.trials[0]?.checks).toEqual([{ kind: 'judge', status: 'pass' }])
    expect(JSON.stringify(report)).not.toContain('/Users/private')
    expect(JSON.stringify(report)).not.toContain('verysecret')
  })
})
