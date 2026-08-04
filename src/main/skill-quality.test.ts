import { createHash } from 'node:crypto'
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectSkillQuality, inspectSkillQualityOverview } from './skill-quality'
import type { Skill } from './skill-types'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const validSpec = `# Review

## Intent

Make code reviews safer.

## Triggers

- **SHOULD** run when the user asks for a code review
- **SHOULD NOT** run for prose editing

## Behaviors

### Behavior: Find risky changes

The agent SHALL identify risky changes.

#### Scenario: A risky patch

- **WHEN** a patch changes authentication
- **THEN** the review explains the risk

## Constraints

### Constraint: Never edit

The agent MUST NOT modify the workspace.

<!-- skillet-version: 1.7.0 -->
`

function fixture(): { root: string; skill: Skill } {
  const root = mkdtempSync(join(tmpdir(), 'skiller-quality-'))
  roots.push(root)
  return {
    root,
    skill: {
      id: 'review',
      name: 'Review',
      description: 'Reviews code safely.',
      canonical_path: root,
      source: { kind: 'LocalPath', path: root },
      scope: { kind: 'SharedLibrary' },
      installations: [],
      footprint_listing_source_chars: 0,
      footprint_listing_slice_chars: 0,
      footprint_name_chars: 6,
      footprint_skill_md_chars: 0,
      listing_excluded: false,
    },
  }
}

function writeReadySkill(root: string): void {
  writeFileSync(join(root, 'spec.md'), validSpec)
  const hash = createHash('sha256').update(validSpec).digest('hex').slice(0, 12)
  writeFileSync(
    join(root, 'SKILL.md'),
    `---\nname: review\ndescription: Reviews code safely.\nspec_hash: ${hash}\n---\n# Review\n`,
  )
  mkdirSync(join(root, 'evals/cases'), { recursive: true })
  writeFileSync(
    join(root, 'evals/cases/find-risky-changes.yaml'),
    'behavior: find-risky-changes\nprompt: Review this patch.\nchecks:\n  - judge: The review identifies authentication risk.\n',
  )
}

describe('Skill Quality structural inspection', () => {
  test('reports a current spec, runtime, and covered behavior as ready', () => {
    const current = fixture()
    writeReadySkill(current.root)
    const status = inspectSkillQuality(current.skill)
    expect(status.state).toBe('ready')
    expect(status.quality_id).toMatch(/^[a-f0-9]{16}$/)
    expect(status.origin_label).toBe('Shared library')
    expect(status.spec).toMatchObject({ valid: true, behavior_count: 1, constraint_count: 1 })
    expect(status.spec.behaviors[0]).toMatchObject({
      id: 'find-risky-changes',
      scenario_count: 1,
      covered_by: ['find-risky-changes'],
    })
    expect(status.evals).toMatchObject({ case_count: 1, covered_behavior_count: 1, judge_check_count: 1 })
  })

  test('makes stale spec linkage and missing coverage visible', () => {
    const current = fixture()
    writeReadySkill(current.root)
    writeFileSync(join(current.root, 'SKILL.md'), '---\nname: review\ndescription: Reviews.\nspec_hash: old\n---\n')
    rmSync(join(current.root, 'evals/cases/find-risky-changes.yaml'))
    const status = inspectSkillQuality(current.skill)
    expect(status.state).toBe('stale')
    expect(status.skill.stale).toBe(true)
    expect(status.issues.map((entry) => entry.code)).toContain('stale-spec-hash')
    expect(status.issues.map((entry) => entry.code)).toContain('uncovered-behavior')
  })

  test('explains missing and legacy specs without requiring an agent CLI', () => {
    const current = fixture()
    writeFileSync(join(current.root, 'SKILL.md'), '---\nname: review\ndescription: Reviews.\n---\n')
    writeFileSync(join(current.root, 'SPEC.md'), '# Legacy\n')
    const status = inspectSkillQuality(current.skill)
    expect(status.state).toBe('needs-spec')
    expect(status.issues).toContainEqual(expect.objectContaining({ code: 'legacy-uppercase-spec' }))
  })

  test('parses shell-bearing cases but never executes setup or checks', () => {
    const current = fixture()
    writeReadySkill(current.root)
    const sentinel = join(current.root, 'executed.txt')
    writeFileSync(
      join(current.root, 'evals/cases/find-risky-changes.yaml'),
      `behavior: find-risky-changes\nprompt: Review this patch.\nsetup: touch ${sentinel}\nchecks:\n  - shell: touch ${sentinel}\n`,
    )
    const overview = inspectSkillQualityOverview([current.skill])
    expect(overview.execution).toEqual({
      mode: 'structural-only',
      agent_sessions_started: false,
      shell_commands_started: false,
      network_started: false,
    })
    expect(overview.skills[0]?.evals).toMatchObject({ shell_check_count: 1, setup_script_count: 1 })
    expect(existsSync(sentinel)).toBe(false)
    expect(JSON.stringify(overview)).not.toContain(current.root)
  })

  test('refuses linked eval case files instead of following them', () => {
    const current = fixture()
    writeReadySkill(current.root)
    const outside = join(current.root, 'outside.yaml')
    writeFileSync(outside, 'behavior: find-risky-changes\nprompt: Unsafe\nchecks:\n  - judge: pass\n')
    rmSync(join(current.root, 'evals/cases/find-risky-changes.yaml'))
    symlinkSync(outside, join(current.root, 'evals/cases/linked.yaml'))
    const status = inspectSkillQuality(current.skill)
    expect(status.state).toBe('blocked')
    expect(status.issues).toContainEqual(expect.objectContaining({ code: 'unsafe-eval-case', area: 'safety' }))
  })

  test('distinguishes duplicate collection entries without exposing an absolute path', () => {
    const current = fixture()
    const nested = join(current.root, 'gstack', '.agents', 'skills', 'review')
    mkdirSync(nested, { recursive: true })
    writeReadySkill(nested)
    const status = inspectSkillQuality({
      ...current.skill,
      canonical_path: nested,
      collection: 'gstack',
    })
    expect(status.origin_label).toBe('gstack · .agents/skills')
    expect(JSON.stringify(status)).not.toContain(current.root)
  })
})
