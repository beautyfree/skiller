import { createHash } from 'node:crypto'
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSkillQualityEvalPlan } from './skill-quality-eval'
import { dockerDryRunArgs, runSkillQualityDryPlan, type DryCommandExecutor } from './skill-quality-dry-run'
import { skillQualityIdentity } from './skill-quality'
import type { Skill } from './skill-types'

const roots: string[] = []
const image = { available: true, imageId: `sha256:${'c'.repeat(64)}` }

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(shellCheck = 'test -f result.txt'): Skill {
  const root = mkdtempSync(join(tmpdir(), 'skiller-dry-skill-'))
  roots.push(root)
  const spec = `# Review

## Intent

Review changes.

## Triggers

- **SHOULD** run for reviews

## Behaviors

### Behavior: Find risk

The agent SHALL find risk.

#### Scenario: Risky patch

- **WHEN** authentication changes
- **THEN** the risk is explained
`
  const hash = createHash('sha256').update(spec).digest('hex').slice(0, 12)
  writeFileSync(join(root, 'spec.md'), spec)
  writeFileSync(join(root, 'SKILL.md'), `---\nname: review\ndescription: Reviews risk.\nspec_hash: ${hash}\n---\n`)
  mkdirSync(join(root, 'evals', 'cases'), { recursive: true })
  writeFileSync(join(root, 'evals', 'cases', 'find-risk.yaml'), `behavior: find-risk\nprompt: Review.\nsetup: touch result.txt\nchecks:\n  - shell: ${shellCheck}\n  - judge: Explains risk.\n`)
  return {
    id: 'review', name: 'Review', description: 'Reviews risk.', canonical_path: root,
    source: { kind: 'LocalPath', path: root }, scope: { kind: 'SharedLibrary' }, installations: [],
    footprint_listing_source_chars: 0, footprint_listing_slice_chars: 0,
    footprint_name_chars: 6, footprint_skill_md_chars: 0, listing_excluded: false,
  }
}

function reportRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'skiller-dry-reports-'))
  roots.push(root)
  return root
}

describe('sandboxed dry checks', () => {
  test('builds a Docker-compatible writable workspace mount', () => {
    const args = dockerDryRunArgs({ imageId: image.imageId, workspace: '/tmp/workspace', command: 'true', timeoutMs: 1_000 })
    expect(args).toContain('type=bind,src=/tmp/workspace,dst=/workspace')
    expect(args.some((entry) => entry.endsWith(',rw'))).toBe(false)
  })

  test('runs setup and deterministic checks through the injected sandbox executor and resumes by plan id', async () => {
    const skill = fixture()
    const plan = createSkillQualityEvalPlan(skill, { qualityId: skillQualityIdentity(skill), mode: 'dry' }, image)
    let invocations = 0
    const executor: DryCommandExecutor = async ({ workspace, command }) => {
      invocations += 1
      if (command === 'touch result.txt') {
        writeFileSync(join(workspace, 'result.txt'), '')
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: existsSync(join(workspace, 'result.txt')) ? 0 : 1, stdout: '', stderr: '' }
    }
    const destination = reportRoot()
    const first = await runSkillQualityDryPlan({ skill, plan, reportRoot: destination, executor })
    const second = await runSkillQualityDryPlan({ skill, plan, reportRoot: destination, executor })
    expect(first.status).toBe('completed-with-findings')
    expect(first.summary).toMatchObject({ cases: 1, vacuous: 1, errors: 0 })
    expect(second.cases[0]?.resumed).toBe(true)
    expect(invocations).toBe(2)
    expect(JSON.stringify(first)).not.toContain(skill.canonical_path)
    expect(first.sandbox).toEqual({ image_id: image.imageId, network: false, direct_host_fallback: false })
  })

  test('treats cached output as untrusted and never returns it to the renderer', async () => {
    const skill = fixture()
    const plan = createSkillQualityEvalPlan(skill, { qualityId: skillQualityIdentity(skill), mode: 'dry' }, image)
    const destination = reportRoot()
    const cache = join(destination, plan.report.resume_id, 'cases', 'find-risk.json')
    mkdirSync(join(destination, plan.report.resume_id, 'cases'), { recursive: true })
    writeFileSync(cache, JSON.stringify({
      plan_id: plan.plan_id,
      result: {
        id: 'find-risk', behavior: 'find-risk', status: 'vacuous', duration_ms: 1,
        checks: [{ kind: 'shell', status: 'pass', output: '/Users/private/token=verysecret' }],
      },
    }))
    const report = await runSkillQualityDryPlan({
      skill,
      plan,
      reportRoot: destination,
      executor: async () => { throw new Error('valid cache must resume') },
    })
    expect(report.cases[0]?.resumed).toBe(true)
    expect(report.cases[0]?.checks).toEqual([{ kind: 'shell', status: 'pass' }])
    expect(JSON.stringify(report)).not.toContain('/Users/private')
    expect(JSON.stringify(report)).not.toContain('verysecret')
  })

  test('reports a failing pristine check as requiring agent action', async () => {
    const skill = fixture('test -f agent-output.txt')
    const plan = createSkillQualityEvalPlan(skill, { qualityId: skillQualityIdentity(skill), mode: 'dry' }, image)
    const executor: DryCommandExecutor = async ({ workspace, command }) => {
      if (command === 'touch result.txt') {
        writeFileSync(join(workspace, 'result.txt'), '')
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 1, stdout: '', stderr: 'missing' }
    }
    const report = await runSkillQualityDryPlan({ skill, plan, reportRoot: reportRoot(), executor })
    expect(report.status).toBe('completed')
    expect(report.summary.requires_action).toBe(1)
    expect(report.cases[0]?.status).toBe('requires-action')
  })

  test('redacts possible secrets emitted by a sandbox command', async () => {
    const skill = fixture()
    const plan = createSkillQualityEvalPlan(skill, { qualityId: skillQualityIdentity(skill), mode: 'dry' }, image)
    const secret = 'postgres://admin:verysecret@example.invalid/db'
    const executor: DryCommandExecutor = async () => ({ code: 0, stdout: secret, stderr: '' })
    const report = await runSkillQualityDryPlan({ skill, plan, reportRoot: reportRoot(), executor })
    expect(JSON.stringify(report)).not.toContain(secret)
    expect(report.cases[0]?.checks.some((entry) => entry.output_redacted)).toBe(true)
  })

  test('refuses a blocked plan before any executor invocation', async () => {
    const skill = fixture()
    const plan = createSkillQualityEvalPlan(skill, { qualityId: skillQualityIdentity(skill), mode: 'dry' }, { available: false, imageId: null })
    let invoked = false
    await expect(runSkillQualityDryPlan({
      skill,
      plan,
      reportRoot: reportRoot(),
      executor: async () => {
        invoked = true
        return { code: 0, stdout: '', stderr: '' }
      },
    })).rejects.toThrow('blocked')
    expect(invoked).toBe(false)
  })
})
