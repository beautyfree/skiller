import { createHash } from 'node:crypto'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSkillQualityEvalPlan } from './skill-quality-eval'
import { skillQualityIdentity } from './skill-quality'
import type { Skill } from './skill-types'

const roots: string[] = []
const image = { available: true, imageId: `sha256:${'a'.repeat(64)}` }

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(command = 'test -f result.txt'): Skill {
  const root = mkdtempSync(join(tmpdir(), 'skiller-eval-plan-'))
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
  const specHash = createHash('sha256').update(spec).digest('hex').slice(0, 12)
  writeFileSync(join(root, 'spec.md'), spec)
  writeFileSync(join(root, 'SKILL.md'), `---\nname: review\ndescription: Reviews risk.\nspec_hash: ${specHash}\n---\n# Review\n`)
  mkdirSync(join(root, 'evals', 'cases'), { recursive: true })
  writeFileSync(
    join(root, 'evals', 'cases', 'find-risk.yaml'),
    `behavior: find-risk\nprompt: Review this patch.\nsetup: touch result.txt\nchecks:\n  - shell: ${command}\n  - judge: The response explains risk.\ntrials: 2\ntimeout: 60\n`,
  )
  return {
    id: 'review',
    name: 'Review',
    description: 'Reviews risk.',
    canonical_path: root,
    source: { kind: 'LocalPath', path: root },
    scope: { kind: 'SharedLibrary' },
    installations: [],
    footprint_listing_source_chars: 0,
    footprint_listing_slice_chars: 0,
    footprint_name_chars: 6,
    footprint_skill_md_chars: 0,
    listing_excluded: false,
  }
}

describe('Skill Quality evaluation plans', () => {
  test('creates a deterministic network-off Docker dry plan without host paths', () => {
    const skill = fixture()
    const request = { qualityId: skillQualityIdentity(skill), mode: 'dry' as const }
    const first = createSkillQualityEvalPlan(skill, request, image)
    const second = createSkillQualityEvalPlan(skill, request, image)
    expect(first.plan_id).toBe(second.plan_id)
    expect(first.ready_to_start).toBe(true)
    expect(first.sandbox).toMatchObject({
      kind: 'docker',
      image_id: image.imageId,
      network: false,
      credential_profile: 'none',
      direct_host_fallback: false,
    })
    expect(first.harness).toMatchObject({ name: 'none', baseline: false })
    expect(first.cases[0]).toMatchObject({ trials: 1, shell_checks: 1, judge_checks: 1 })
    expect(JSON.stringify(first)).not.toContain(skill.canonical_path)
  })

  test('keeps measured trials blocked until network and matching credentials are reviewed', () => {
    const skill = fixture()
    const plan = createSkillQualityEvalPlan(skill, {
      qualityId: skillQualityIdentity(skill),
      mode: 'measured',
      harness: 'codex',
      baseline: true,
    }, image)
    expect(plan.ready_to_start).toBe(false)
    expect(plan.blockers.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'credential-profile-required',
      'network-disabled',
    ]))
    expect(plan.report.includes_baseline_lift).toBe(true)
  })

  test('binds a measured plan to the explicit network, credential, model, and image decisions', () => {
    const skill = fixture()
    const request = {
      qualityId: skillQualityIdentity(skill),
      mode: 'measured' as const,
      harness: 'codex' as const,
      credentialProfile: 'codex' as const,
      network: true,
      model: 'gpt-5',
      effort: 'medium' as const,
      baseline: true,
      trials: 3,
      concurrency: 2,
    }
    const plan = createSkillQualityEvalPlan(skill, request, image)
    const changedImage = createSkillQualityEvalPlan(skill, request, { ...image, imageId: `sha256:${'b'.repeat(64)}` })
    expect(plan.ready_to_start).toBe(true)
    expect(plan.harness).toMatchObject({ name: 'codex', model: 'gpt-5', effort: 'medium', baseline: true })
    expect(plan.cases[0]?.trials).toBe(3)
    expect(changedImage.plan_id).not.toBe(plan.plan_id)
  })

  test('redacts possible secrets from command review and blocks the plan', () => {
    const secret = 'postgres://admin:verysecret@example.invalid/db'
    const skill = fixture(`printf '%s' '${secret}'`)
    const plan = createSkillQualityEvalPlan(skill, { qualityId: skillQualityIdentity(skill), mode: 'dry' }, image)
    expect(plan.ready_to_start).toBe(false)
    expect(plan.blockers.some((entry) => entry.code.startsWith('possible-secret-'))).toBe(true)
    expect(JSON.stringify(plan)).not.toContain(secret)
  })

  test('refuses linked fixture content before creating an executable plan', () => {
    const skill = fixture()
    const outside = join(skill.canonical_path, 'outside.txt')
    writeFileSync(outside, 'outside')
    mkdirSync(join(skill.canonical_path, 'evals', 'fixtures', 'sample'), { recursive: true })
    symlinkSync(outside, join(skill.canonical_path, 'evals', 'fixtures', 'sample', 'linked.txt'))
    const plan = createSkillQualityEvalPlan(skill, { qualityId: skillQualityIdentity(skill), mode: 'dry' }, image)
    expect(plan.ready_to_start).toBe(false)
    expect(plan.blockers).toContainEqual(expect.objectContaining({ code: 'unsafe-artifacts' }))
  })

  test('never serializes an absolute path when eval artifacts are missing', () => {
    const skill = fixture()
    rmSync(join(skill.canonical_path, 'evals'), { recursive: true })
    const plan = createSkillQualityEvalPlan(skill, { qualityId: skillQualityIdentity(skill), mode: 'dry' }, image)
    expect(plan.blockers).toContainEqual(expect.objectContaining({
      code: 'unsafe-artifacts',
      message: 'evals/cases/ is missing or unreadable',
    }))
    expect(JSON.stringify(plan)).not.toContain(skill.canonical_path)
  })

  test('binds bundled resource files to the reviewed artifact snapshot', () => {
    const skill = fixture()
    mkdirSync(join(skill.canonical_path, 'references'))
    writeFileSync(join(skill.canonical_path, 'references', 'guide.md'), 'first')
    const request = { qualityId: skillQualityIdentity(skill), mode: 'dry' as const }
    const first = createSkillQualityEvalPlan(skill, request, image)
    writeFileSync(join(skill.canonical_path, 'references', 'guide.md'), 'second')
    const second = createSkillQualityEvalPlan(skill, request, image)
    expect(second.plan_id).not.toBe(first.plan_id)
    expect(second.artifacts.snapshot_sha256).not.toBe(first.artifacts.snapshot_sha256)
  })

  test('blocks linked bundled resources instead of following them', () => {
    const skill = fixture()
    mkdirSync(join(skill.canonical_path, 'references'))
    const outside = join(skill.canonical_path, 'outside-resource.md')
    writeFileSync(outside, 'outside')
    symlinkSync(outside, join(skill.canonical_path, 'references', 'linked.md'))
    const plan = createSkillQualityEvalPlan(skill, { qualityId: skillQualityIdentity(skill), mode: 'dry' }, image)
    expect(plan.ready_to_start).toBe(false)
    expect(plan.blockers).toContainEqual(expect.objectContaining({ code: 'unsafe-artifacts' }))
  })
})
