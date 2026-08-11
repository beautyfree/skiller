import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  AlertTriangle,
  Check,
  CircleDashed,
  FileCheck2,
  FileText,
  FolderOpen,
  FlaskConical,
  Gauge,
  ListChecks,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'
import { Button } from '@/mainview/components/ui/button'
import { Tooltip } from '@/mainview/components/ui/tooltip'
import { invoke } from '@/mainview/lib/native'
import { cn } from '@/mainview/lib/utils'
import type {
  SkillQualityIssueJson,
  SkillQualityDryRunReportJson,
  SkillQualityEvalPlanJson,
  SkillQualityMeasuredReportJson,
  SkillQualityOverviewJson,
  SkillQualityStatusJson,
} from '@/shared/rpc-schema'

type Filter = 'all' | 'ready' | 'needs-work'
type MeasuredHarness = 'codex' | 'claude'

const stateCopy: Record<SkillQualityStatusJson['state'], { label: string; tone: string }> = {
  ready: { label: 'Ready', tone: 'text-emerald-700 dark:text-emerald-300' },
  'needs-spec': { label: 'Needs spec', tone: 'text-amber-700 dark:text-amber-300' },
  'needs-skill': { label: 'Needs runtime', tone: 'text-amber-700 dark:text-amber-300' },
  stale: { label: 'Out of date', tone: 'text-amber-700 dark:text-amber-300' },
  'needs-evals': { label: 'Needs coverage', tone: 'text-amber-700 dark:text-amber-300' },
  blocked: { label: 'Needs attention', tone: 'text-red-700 dark:text-red-300' },
}

function percent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0
  return Math.round((numerator / denominator) * 100)
}

export default function QualityCenter() {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const quality = useQuery<SkillQualityOverviewJson>({
    queryKey: ['skill-quality'],
    queryFn: () => invoke('skill_quality_overview'),
    staleTime: 30_000,
  })
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (quality.data?.skills ?? []).filter((skill) => {
      if (filter === 'ready' && skill.state !== 'ready') return false
      if (filter === 'needs-work' && skill.state === 'ready') return false
      return !needle || `${skill.name} ${skill.description ?? ''} ${skill.origin_label}`.toLowerCase().includes(needle)
    })
  }, [filter, quality.data?.skills, query])
  const selected = useMemo(
    () => filtered.find((skill) => skill.quality_id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  )

  useEffect(() => {
    if (selected && selected.quality_id !== selectedId) setSelectedId(selected.quality_id)
  }, [selected, selectedId])

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 76,
    overscan: 8,
  })

  const coverage = percent(
    quality.data?.summary.covered_behaviors ?? 0,
    quality.data?.summary.total_behaviors ?? 0,
  )

  return (
    <div className="quality-center flex h-full min-h-0 flex-col overflow-hidden bg-[linear-gradient(180deg,color-mix(in_oklab,var(--card)_97%,var(--primary)_3%),var(--card)_14rem)]">
      <header className="border-b border-border/70 px-6 pb-5 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[62ch]">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/80">
              <FlaskConical className="size-3.5" aria-hidden="true" />
              Skill Quality
            </div>
            <h1 className="text-[clamp(1.35rem,2.2vw,1.85rem)] font-semibold leading-tight tracking-[-0.045em] text-foreground">
              Know what a skill promises—and whether its tests prove it.
            </h1>
            <p className="mt-2 max-w-[64ch] text-[13px] leading-5 text-muted-foreground">
              Review specs, runtime freshness, and behavior coverage without starting an agent or running downloaded code.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex min-h-8 items-center gap-2 rounded-md border border-emerald-700/15 bg-emerald-500/[0.07] px-3 text-[12px] font-medium text-emerald-800 dark:text-emerald-200">
              <LockKeyhole className="size-3.5" aria-hidden="true" />
              Structural review only
            </div>
            <Tooltip content="Refresh quality review">
            <span className="inline-flex">
            <Button
              variant="outline"
              size="icon"
              onClick={() => quality.refetch()}
              disabled={quality.isFetching}
              aria-label="Refresh quality review"
            >
              <RefreshCw className={cn('size-4', quality.isFetching && 'animate-spin')} />
            </Button>
            </span>
            </Tooltip>
          </div>
        </div>

        <div className="mt-5 grid max-w-3xl grid-cols-3 divide-x divide-border/70 border-y border-border/70 py-3">
          <Metric label="Skills reviewed" value={quality.data?.summary.total ?? 0} />
          <Metric label="Ready" value={quality.data?.summary.ready ?? 0} />
          <Metric label="Behavior coverage" value={`${coverage}%`} />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(250px,320px)_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-border/70 lg:border-b-0 lg:border-r" aria-label="Skills quality list">
          <div className="z-10 shrink-0 border-b border-border/70 bg-card/95 p-3 backdrop-blur-sm">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">Search skills</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a skill"
                className="h-8 w-full rounded-md border border-border bg-background/70 pl-8 pr-3 text-[13px] outline-none placeholder:text-muted-foreground/70 focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15"
              />
            </label>
            <div className="mt-2 flex gap-1" role="tablist" aria-label="Quality filters">
              {([
                ['all', 'All'],
                ['ready', 'Ready'],
                ['needs-work', 'Needs work'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={filter === value}
                  onClick={() => setFilter(value)}
                  className={cn(
                    'min-h-7 rounded-md px-2.5 text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
                    filter === value
                      ? 'bg-black/[0.06] text-foreground dark:bg-white/[0.1]'
                      : 'text-muted-foreground hover:bg-black/[0.035] hover:text-foreground dark:hover:bg-white/[0.05]',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
            {quality.isLoading ? (
              Array.from({ length: 7 }).map((_, index) => (
                <div key={index} className="space-y-2 px-4 py-3.5 animate-pulse">
                  <div className="h-3.5 w-2/3 rounded bg-muted" />
                  <div className="h-2.5 w-1/2 rounded bg-muted/70" />
                </div>
              ))
            ) : filtered.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <CircleDashed className="mx-auto size-6 text-muted-foreground/50" aria-hidden="true" />
                <p className="mt-3 text-[13px] font-medium text-foreground">No skills in this view</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Try another filter or search term.</p>
              </div>
            ) : (
              <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const skill = filtered[virtualRow.index]
                  if (!skill) return null
                  return (
                    <div
                      key={skill.quality_id}
                      ref={rowVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      className="absolute left-0 top-0 w-full border-b border-border/60"
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      <SkillRow
                        skill={skill}
                        selected={selected?.quality_id === skill.quality_id}
                        onSelect={() => setSelectedId(skill.quality_id)}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </aside>

        <section className="min-h-0 min-w-0 overflow-y-auto" aria-live="polite">
          {quality.isError ? (
            <div className="mx-auto max-w-xl px-8 py-20 text-center">
              <AlertTriangle className="mx-auto size-7 text-red-600" aria-hidden="true" />
              <h2 className="mt-4 text-base font-semibold">Quality review could not be loaded</h2>
              <p className="mt-2 text-sm text-muted-foreground">{quality.error instanceof Error ? quality.error.message : 'Try refreshing the review.'}</p>
            </div>
          ) : selected ? (
            <QualityDetail skill={selected} />
          ) : !quality.isLoading ? (
            <div className="mx-auto max-w-lg px-8 py-20 text-center">
              <FileText className="mx-auto size-7 text-muted-foreground/50" aria-hidden="true" />
              <h2 className="mt-4 text-base font-semibold">No local skills found</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Install or import a skill, then return here to review its quality artifacts.</p>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-4 first:pl-0">
      <div className="text-lg font-semibold tabular-nums tracking-[-0.03em] text-foreground">{value}</div>
      <div className="mt-0.5 text-[11px] font-medium text-muted-foreground">{label}</div>
    </div>
  )
}

function SkillRow({ skill, selected, onSelect }: { skill: SkillQualityStatusJson; selected: boolean; onSelect: () => void }) {
  const state = stateCopy[skill.state]
  const coverage = percent(skill.evals.covered_behavior_count, skill.spec.behavior_count)
  const errors = skill.issues.filter((entry) => entry.severity === 'error').length
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'group flex min-h-[76px] w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40',
        selected ? 'bg-primary/[0.075]' : 'hover:bg-black/[0.025] dark:hover:bg-white/[0.035]',
      )}
    >
      <span className={cn('size-2 shrink-0 rounded-full', skill.state === 'ready' ? 'bg-emerald-500' : errors > 0 ? 'bg-red-500' : 'bg-amber-500')} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-foreground">{skill.name}</span>
        <span className={cn('mt-1 flex items-center gap-2 text-[11px] font-medium', state.tone)}>
          {state.label}
          <span className="text-muted-foreground/80">{skill.spec.behavior_count ? `${coverage}% covered` : 'No behaviors'}</span>
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/65">{skill.origin_label}</span>
      </span>
      <span className="text-[11px] tabular-nums text-muted-foreground/70">{skill.issues.length || ''}</span>
    </button>
  )
}

function QualityDetail({ skill }: { skill: SkillQualityStatusJson }) {
  const [evalPlan, setEvalPlan] = useState<SkillQualityEvalPlanJson | null>(null)
  const [evalPlanError, setEvalPlanError] = useState<string | null>(null)
  const [evalPlanLoading, setEvalPlanLoading] = useState<'dry' | 'measured' | null>(null)
  const [dryReport, setDryReport] = useState<SkillQualityDryRunReportJson | null>(null)
  const [measuredReport, setMeasuredReport] = useState<SkillQualityMeasuredReportJson | null>(null)
  const [dryRunLoading, setDryRunLoading] = useState(false)
  const [measuredRunLoading, setMeasuredRunLoading] = useState(false)
  const [measuredNetwork, setMeasuredNetwork] = useState(false)
  const [measuredHarness, setMeasuredHarness] = useState<MeasuredHarness>('codex')
  const [measuredCredential, setMeasuredCredential] = useState<'none' | MeasuredHarness>('none')
  const [sandboxImage, setSandboxImage] = useState('skillet-eval')
  const state = stateCopy[skill.state]
  const errors = skill.issues.filter((entry) => entry.severity === 'error')
  const warnings = skill.issues.filter((entry) => entry.severity === 'warning')

  useEffect(() => {
    setEvalPlan(null)
    setEvalPlanError(null)
    setEvalPlanLoading(null)
    setDryReport(null)
    setMeasuredReport(null)
    setDryRunLoading(false)
    setMeasuredRunLoading(false)
    setMeasuredNetwork(false)
    setMeasuredHarness('codex')
    setMeasuredCredential('none')
  }, [skill.quality_id])

  const reviewEvaluation = async (
    mode: 'dry' | 'measured',
    measuredOptions = { network: measuredNetwork, harness: measuredHarness, credential: measuredCredential },
  ) => {
    setEvalPlanLoading(mode)
    setEvalPlanError(null)
    try {
      const plan = await invoke('skill_quality_eval_preview', {
        qualityId: skill.quality_id,
        mode,
        sandboxImage,
        concurrency: 2,
        ...(mode === 'measured' ? {
          harness: measuredOptions.harness,
          baseline: true,
          trials: 3,
          network: measuredOptions.network,
          credentialProfile: measuredOptions.credential,
        } : {}),
      })
      setEvalPlan(plan)
      setDryReport(null)
      setMeasuredReport(null)
    } catch (error) {
      setEvalPlanError(error instanceof Error ? error.message : 'Evaluation plan could not be created.')
    } finally {
      setEvalPlanLoading(null)
    }
  }

  const updateMeasuredReview = async (next: { network?: boolean; harness?: MeasuredHarness; credential?: 'none' | MeasuredHarness }) => {
    const options = {
      network: next.network ?? measuredNetwork,
      harness: next.harness ?? measuredHarness,
      credential: next.credential ?? (next.harness && next.harness !== measuredHarness ? 'none' : measuredCredential),
    }
    setMeasuredNetwork(options.network)
    setMeasuredHarness(options.harness)
    setMeasuredCredential(options.credential)
    await reviewEvaluation('measured', options)
  }

  const runDryChecks = async () => {
    if (!evalPlan || evalPlan.mode !== 'dry' || !evalPlan.ready_to_start) return
    setDryRunLoading(true)
    setEvalPlanError(null)
    try {
      const report = await invoke('skill_quality_dry_start', {
        request: {
          qualityId: skill.quality_id,
          mode: 'dry',
          sandboxImage,
          concurrency: 2,
        },
        expectedPlanId: evalPlan.plan_id,
      })
      setDryReport(report)
    } catch (error) {
      setEvalPlanError(error instanceof Error ? error.message : 'Dry checks could not be completed safely.')
    } finally {
      setDryRunLoading(false)
    }
  }

  const runMeasuredChecks = async () => {
    if (!evalPlan || evalPlan.mode !== 'measured' || !evalPlan.ready_to_start) return
    setMeasuredRunLoading(true)
    setEvalPlanError(null)
    try {
      const report = await invoke('skill_quality_measured_start', {
        request: {
          qualityId: skill.quality_id,
          mode: 'measured',
          sandboxImage,
          concurrency: 2,
          harness: measuredHarness,
          baseline: true,
          trials: 3,
          network: measuredNetwork,
          credentialProfile: measuredCredential,
        },
        expectedPlanId: evalPlan.plan_id,
      })
      setMeasuredReport(report)
    } catch (error) {
      setEvalPlanError(error instanceof Error ? error.message : 'Measured trials could not be completed safely.')
    } finally {
      setMeasuredRunLoading(false)
    }
  }
  return (
    <div className="animate-fade-in-up px-6 py-6 xl:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-5">
        <div className="min-w-0">
          <div className={cn('mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]', state.tone)}>{state.label}</div>
          <h2 className="truncate text-xl font-semibold tracking-[-0.04em] text-foreground">{skill.name}</h2>
          <div className="mt-1 text-[11px] font-medium text-primary/75">{skill.origin_label}</div>
          <p className="mt-1.5 max-w-[65ch] text-[13px] leading-5 text-muted-foreground">{skill.description || 'No short description in SKILL.md.'}</p>
        </div>
        <div className="text-right text-[11px] leading-5 text-muted-foreground">
          <div>{errors.length} errors · {warnings.length} warnings</div>
          <div>{skill.spec.behavior_count} behaviors · {skill.evals.case_count} cases</div>
        </div>
      </div>

      <section className="py-6" aria-labelledby="artifact-flow-title">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 id="artifact-flow-title" className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Artifact flow</h3>
          <span className="text-[11px] text-muted-foreground">Intent → instructions → proof</span>
        </div>
        <div className="grid grid-cols-1 divide-y divide-border/70 border-y border-border/70 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <ArtifactStep
            icon={FileText}
            label="Spec"
            value={skill.spec.present ? (skill.spec.valid ? 'Valid structure' : 'Needs repair') : 'Not created'}
            ok={skill.spec.present && skill.spec.valid}
            meta={skill.spec.hash ? `hash ${skill.spec.hash}` : 'spec.md'}
          />
          <ArtifactStep
            icon={FileCheck2}
            label="Rendered skill"
            value={!skill.skill.present ? 'Missing' : skill.skill.stale === true ? 'Spec link is out of date' : skill.skill.recorded_spec_hash ? 'Linked to current spec' : skill.spec.present ? 'Spec link missing' : 'Waiting for spec'}
            ok={skill.skill.present && skill.skill.stale === false}
            meta="SKILL.md"
          />
          <ArtifactStep
            icon={ListChecks}
            label="Evals"
            value={`${skill.evals.covered_behavior_count} of ${skill.spec.behavior_count} behaviors covered`}
            ok={skill.spec.behavior_count > 0 && skill.evals.covered_behavior_count === skill.spec.behavior_count}
            meta={`${skill.evals.case_count} cases`}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-x-8 gap-y-8 xl:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)]">
        <section aria-labelledby="behaviors-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 id="behaviors-title" className="text-sm font-semibold text-foreground">Behavior coverage</h3>
            <span className="text-[11px] text-muted-foreground">Each promise needs at least one case</span>
          </div>
          {skill.spec.behaviors.length ? (
            <div className="divide-y divide-border/70 border-y border-border/70">
              {skill.spec.behaviors.map((behavior) => {
                const covered = behavior.covered_by.length > 0
                return (
                  <div key={behavior.id} className="flex items-start gap-3 py-3.5">
                    <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full', covered ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300')}>
                      {covered ? <Check className="size-3" aria-hidden="true" /> : <CircleDashed className="size-3" aria-hidden="true" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-foreground">{behavior.name}</div>
                      <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
                        {behavior.scenario_count} {behavior.scenario_count === 1 ? 'scenario' : 'scenarios'}
                        {covered ? ` · ${behavior.covered_by.join(', ')}` : ' · no eval case'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <EmptyLine icon={FileText} text="Create spec.md to define observable behaviors." />
          )}
        </section>

        <section aria-labelledby="eval-shape-title">
          <h3 id="eval-shape-title" className="mb-3 text-sm font-semibold text-foreground">Eval shape</h3>
          <dl className="divide-y divide-border/70 border-y border-border/70 text-[12px]">
            <Fact label="Deterministic checks" value={skill.evals.deterministic_check_count} />
            <Fact label="Semantic judge checks" value={skill.evals.judge_check_count} />
            <Fact label="Shell checks" value={skill.evals.shell_check_count} />
            <Fact label="Setup scripts" value={skill.evals.setup_script_count} />
          </dl>
          {(skill.evals.shell_check_count > 0 || skill.evals.setup_script_count > 0) && (
            <div className="mt-3 flex gap-2 text-[11px] leading-4 text-amber-800 dark:text-amber-200">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              These commands are listed, not executed. A disposable sandbox and explicit review are required before a run.
            </div>
          )}
        </section>
      </div>

      <section className="mt-8 border-t border-border/70 pt-6" aria-labelledby="findings-title">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h3 id="findings-title" className="text-sm font-semibold text-foreground">What to work on</h3>
          <span className="text-[11px] text-muted-foreground">No files are changed from this review</span>
        </div>
        {skill.issues.length ? (
          <div className="divide-y divide-border/70 border-y border-border/70">
            {skill.issues.map((finding, index) => <Finding key={`${finding.code}-${finding.file}-${finding.line}-${index}`} finding={finding} qualityId={skill.quality_id} />)}
          </div>
        ) : (
          <div className="flex items-center gap-3 border-y border-border/70 py-4 text-[13px] text-emerald-800 dark:text-emerald-200">
            <Check className="size-4" aria-hidden="true" />
            Structure, spec linkage, and behavior coverage are ready.
          </div>
        )}
      </section>

      <section className="mt-8 border-t border-border/70 pt-6" aria-labelledby="evaluation-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-[62ch]">
          <div className="flex items-center gap-2">
            <Gauge className="size-4 text-primary" aria-hidden="true" />
            <h3 id="evaluation-title" className="text-sm font-semibold text-foreground">Measured evaluation</h3>
          </div>
          <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">
            Create a deterministic review first. It snapshots every artifact and shows setup, shell checks, sandbox identity, network, credentials, trials, and report destination before anything runs.
          </p>
        </div>
          <div className="flex shrink-0 flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] font-medium text-muted-foreground">Local Docker image</span>
              <input
                value={sandboxImage}
                onChange={(event) => setSandboxImage(event.target.value)}
                spellCheck={false}
                className="h-8 w-36 rounded-md border border-border bg-background/70 px-2.5 font-mono text-[11px] outline-none focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15"
                aria-label="Local Docker image"
              />
            </label>
            <div className="block">
              <span className="mb-1 block text-[10px] font-medium text-muted-foreground">Harness</span>
              <div className="flex h-8 overflow-hidden rounded-md border border-border" role="group" aria-label="Measured evaluation harness">
                {(['codex', 'claude'] as const).map((harness) => (
                  <button
                    key={harness}
                    type="button"
                    onClick={() => updateMeasuredReview({ harness })}
                    className={cn(
                      'min-w-14 px-2 text-[11px] font-medium transition-colors',
                      harness === measuredHarness ? 'bg-foreground text-background' : 'bg-background/70 text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                    aria-pressed={harness === measuredHarness}
                  >
                    {harness === 'codex' ? 'Codex' : 'Claude'}
                  </button>
                ))}
              </div>
            </div>
            <Button variant="outline" onClick={() => reviewEvaluation('dry')} disabled={evalPlanLoading !== null}>
              {evalPlanLoading === 'dry' ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <ShieldCheck className="size-3.5" aria-hidden="true" />}
              Review dry checks
            </Button>
            <Button variant="ghost" onClick={() => reviewEvaluation('measured')} disabled={evalPlanLoading !== null}>
              {evalPlanLoading === 'measured' ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Gauge className="size-3.5" aria-hidden="true" />}
              Preview lift setup
            </Button>
          </div>
        </div>
        {evalPlanError && (
          <div className="mt-4 border-y border-red-500/25 py-3 text-[12px] leading-5 text-red-700 dark:text-red-300">{evalPlanError}</div>
        )}
        {evalPlan && (
          <EvaluationReview
            plan={evalPlan}
            dryReport={dryReport}
            measuredReport={measuredReport}
            running={dryRunLoading || measuredRunLoading}
            onStart={evalPlan.mode === 'dry' ? runDryChecks : runMeasuredChecks}
            onEnableNetwork={() => updateMeasuredReview({ network: true })}
            onUseHarnessProfile={() => updateMeasuredReview({ credential: measuredHarness })}
            onDisableNetwork={() => updateMeasuredReview({ network: false })}
            onRemoveCredential={() => updateMeasuredReview({ credential: 'none' })}
            onClose={() => {
              setEvalPlan(null)
              setDryReport(null)
              setMeasuredReport(null)
            }}
          />
        )}
      </section>
    </div>
  )
}

function EvaluationReview({
  plan,
  dryReport,
  measuredReport,
  running,
  onStart,
  onEnableNetwork,
  onUseHarnessProfile,
  onDisableNetwork,
  onRemoveCredential,
  onClose,
}: {
  plan: SkillQualityEvalPlanJson
  dryReport: SkillQualityDryRunReportJson | null
  measuredReport: SkillQualityMeasuredReportJson | null
  running: boolean
  onStart: () => void
  onEnableNetwork: () => void
  onUseHarnessProfile: () => void
  onDisableNetwork: () => void
  onRemoveCredential: () => void
  onClose: () => void
}) {
  return (
    <div className="mt-5 border-y border-border/70 bg-black/[0.018] py-5 dark:bg-white/[0.018]">
      <div className="flex items-start justify-between gap-4 pr-1">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary/80">
            <LockKeyhole className="size-3.5" aria-hidden="true" />
            Reviewed plan · {plan.mode === 'dry' ? 'dry checks' : 'measured lift'}
          </div>
          <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">Nothing has run. Any artifact, image, or policy change produces a different plan.</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close evaluation review">
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-2 divide-x divide-y divide-border/70 border-y border-border/70 sm:grid-cols-4 sm:divide-y-0">
        <ReviewFact label="Cases" value={String(plan.cases.length)} />
        <ReviewFact label="Trials" value={String(plan.cases.reduce((sum, entry) => sum + entry.trials, 0))} />
        <ReviewFact label="Sandbox" value={plan.sandbox.available ? 'Image pinned' : 'Unavailable'} />
        <ReviewFact label="Network" value={plan.sandbox.network ? 'Explicitly on' : 'Off'} />
      </div>

      <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[11px] leading-5">
        <dt className="text-muted-foreground">Plan</dt><dd className="truncate font-mono text-foreground">{plan.plan_id.slice(0, 20)}</dd>
        <dt className="text-muted-foreground">Artifacts</dt><dd className="text-foreground">{plan.artifacts.file_count} files · {formatBytes(plan.artifacts.total_bytes)} · <span className="font-mono">{plan.artifacts.snapshot_sha256.slice(0, 12)}</span></dd>
        <dt className="text-muted-foreground">Harness</dt><dd className="text-foreground">{plan.harness.name === 'none' ? 'None—checks only' : `${plan.harness.name}${plan.harness.model ? ` · ${plan.harness.model}` : ''}${plan.harness.baseline ? ' · with baseline' : ''}`}</dd>
        <dt className="text-muted-foreground">Credentials</dt><dd className="text-foreground">{plan.sandbox.credential_profile === 'none' ? 'None mounted' : `${plan.sandbox.credential_profile} profile`}</dd>
        <dt className="text-muted-foreground">Report</dt><dd className="text-foreground">{plan.report.local_destination}</dd>
      </dl>
      {plan.mode === 'measured' && (plan.sandbox.network || plan.sandbox.credential_profile !== 'none') && (
        <div className="mt-3 flex flex-wrap gap-2">
          {plan.sandbox.network && <Button size="xs" variant="ghost" onClick={onDisableNetwork} disabled={running}>Turn network off</Button>}
          {plan.sandbox.credential_profile !== 'none' && <Button size="xs" variant="ghost" onClick={onRemoveCredential} disabled={running}>Remove credential profile</Button>}
        </div>
      )}

      {plan.command_review.length > 0 && (
        <div className="mt-5">
          <h4 className="text-[12px] font-semibold text-foreground">Commands requiring review</h4>
          <div className="mt-2 divide-y divide-border/70 border-y border-border/70">
            {plan.command_review.map((entry, index) => (
              <div key={`${entry.case_id}-${entry.kind}-${index}`} className="py-3">
                <div className="mb-1.5 text-[10px] font-medium text-muted-foreground">{entry.case_id} · {entry.kind} · {entry.file}</div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-black/[0.055] px-3 py-2 text-[11px] leading-5 text-foreground dark:bg-black/25">{entry.command}</pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {plan.blockers.length > 0 ? (
        <div className="mt-5 border-y border-amber-500/30 py-3">
          <div className="text-[12px] font-semibold text-amber-800 dark:text-amber-200">Resolve before a run</div>
          <div className="mt-2 space-y-2">
            {plan.blockers.map((blocker, index) => (
              <div key={`${blocker.code}-${index}`} className="flex gap-2 text-[11px] leading-5 text-amber-800/90 dark:text-amber-100/90">
                <CircleDashed className="mt-1 size-3 shrink-0" aria-hidden="true" />
                <span>{blocker.message}{blocker.file ? ` · ${blocker.file}${blocker.line ? `:${blocker.line}` : ''}` : ''}</span>
              </div>
            ))}
          </div>
          {plan.mode === 'measured' && (
            <div className="mt-3 flex flex-wrap gap-2">
              {plan.blockers.some((entry) => entry.code === 'network-disabled') && (
                <Button size="sm" variant="outline" onClick={onEnableNetwork} disabled={running}>Allow network for this plan</Button>
              )}
              {plan.blockers.some((entry) => entry.code === 'credential-profile-required') && (
                <Button size="sm" variant="outline" onClick={onUseHarnessProfile} disabled={running}>Use {plan.harness.name === 'claude' ? 'Claude' : 'Codex'} profile read-only</Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-y border-emerald-500/25 py-3 text-[12px] text-emerald-800 dark:text-emerald-200">
          <span className="flex items-center gap-2">
            <Check className="size-4" aria-hidden="true" />
            Plan is ready. Execution remains opt-in and has no host fallback.
          </span>
          {!dryReport && !measuredReport && (
            <Button size="sm" onClick={onStart} disabled={running}>
              {running ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : plan.mode === 'dry' ? <ShieldCheck className="size-3.5" aria-hidden="true" /> : <Gauge className="size-3.5" aria-hidden="true" />}
              {running ? 'Running in Docker…' : plan.mode === 'dry' ? 'Run dry checks' : 'Run measured trials'}
            </Button>
          )}
        </div>
      )}
      {dryReport && <DryReport report={dryReport} />}
      {measuredReport && <MeasuredReport report={measuredReport} />}
    </div>
  )
}

function MeasuredReport({ report }: { report: SkillQualityMeasuredReportJson }) {
  return (
    <div className="mt-5 border-t border-border/70 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className={cn('text-[12px] font-semibold', report.status === 'blocked' ? 'text-red-700 dark:text-red-300' : report.status === 'completed-with-failures' ? 'text-amber-800 dark:text-amber-200' : 'text-emerald-800 dark:text-emerald-200')}>Measured lift report</h4>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{report.summary.trials} trials · {report.summary.passed} passed · {report.summary.failed} failed · {report.summary.errored} errors</p>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{report.report_id}</span>
      </div>
      <div className="mt-3 divide-y divide-border/70 border-y border-border/70">
        {report.behaviors.map((entry) => (
          <div key={entry.behavior} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-4 py-3 text-[11px]">
            <span className="truncate font-semibold text-foreground">{entry.behavior}</span>
            <span className="text-muted-foreground">skill {Math.round(entry.skill_pass_rate * 100)}%</span>
            <span className="text-muted-foreground">baseline {entry.baseline_pass_rate === null ? '—' : `${Math.round(entry.baseline_pass_rate * 100)}%`}</span>
            <span className={cn('font-semibold tabular-nums', entry.lift !== null && entry.lift > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground')}>lift {entry.lift === null ? '—' : `${entry.lift >= 0 ? '+' : ''}${Math.round(entry.lift * 100)}%`}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DryReport({ report }: { report: SkillQualityDryRunReportJson }) {
  const tone = report.status === 'blocked'
    ? 'text-red-700 dark:text-red-300'
    : report.summary.vacuous > 0
      ? 'text-amber-800 dark:text-amber-200'
      : 'text-emerald-800 dark:text-emerald-200'
  return (
    <div className="mt-5 border-t border-border/70 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className={cn('text-[12px] font-semibold', tone)}>
            {report.status === 'completed'
              ? 'Dry checks require agent action'
              : report.status === 'completed-with-findings'
                ? 'Review vacuous cases'
                : 'Dry run needs attention'}
          </h4>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{report.summary.cases} cases · {report.summary.vacuous} vacuous · {report.summary.requires_action} require action · {report.summary.errors} errors</p>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{report.report_id}</span>
      </div>
      <div className="mt-3 divide-y divide-border/70 border-y border-border/70">
        {report.cases.map((entry) => (
          <div key={entry.id} className="flex items-start justify-between gap-4 py-3 text-[11px]">
            <div>
              <div className="font-semibold text-foreground">{entry.id}</div>
              <div className="mt-0.5 text-muted-foreground">{entry.behavior}{entry.resumed ? ' · resumed' : ''}</div>
            </div>
            <span className={cn('font-semibold', entry.status === 'requires-action' ? 'text-emerald-700 dark:text-emerald-300' : entry.status === 'vacuous' ? 'text-amber-700 dark:text-amber-300' : entry.status === 'error' ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground')}>{entry.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ReviewFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-3 first:pl-0 sm:first:pl-0">
      <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-[12px] font-semibold text-foreground">{value}</div>
    </div>
  )
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KiB`
  return `${Math.round(value / (1024 * 102.4)) / 10} MiB`
}

function ArtifactStep({ icon: Icon, label, value, ok, meta }: { icon: typeof FileText; label: string; value: string; ok: boolean; meta: string }) {
  return (
    <div className="flex gap-3 px-4 py-4 first:pl-0 sm:first:pl-0">
      <span className={cn('grid size-8 shrink-0 place-items-center rounded-md', ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300')}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</div>
        <div className="mt-1 text-[13px] font-medium text-foreground">{value}</div>
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground/75">{meta}</div>
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  )
}

function Finding({ finding, qualityId }: { finding: SkillQualityIssueJson; qualityId: string }) {
  const critical = finding.severity === 'error'
  return (
    <div className="flex gap-3 py-3.5">
      <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full', critical ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300')}>
        {critical ? <AlertTriangle className="size-3" aria-hidden="true" /> : <CircleDashed className="size-3" aria-hidden="true" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium leading-5 text-foreground">{finding.message}</div>
        {finding.hint && <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{finding.hint}</p>}
        {(finding.file || finding.line) && <div className="mt-1 text-[10px] font-medium text-muted-foreground/70">{finding.file}{finding.line ? ` · line ${finding.line}` : ''}</div>}
      </div>
      {finding.file && finding.revealable && (
        <Button
          variant="ghost"
          size="xs"
          className="mt-0.5 shrink-0"
          onClick={() => invoke('skill_quality_reveal_file', { qualityId, relativePath: finding.file! })}
        >
          Show file
        </Button>
      )}
      {finding.code === 'missing-spec' && (
        <Button
          variant="ghost"
          size="xs"
          className="mt-0.5 shrink-0"
          onClick={() => invoke('skill_quality_reveal_folder', { qualityId })}
        >
          <FolderOpen className="size-3.5" aria-hidden="true" />
          Open folder
        </Button>
      )}
    </div>
  )
}

function EmptyLine({ icon: Icon, text }: { icon: typeof FileText; text: string }) {
  return (
    <div className="flex items-center gap-3 border-y border-border/70 py-5 text-[13px] text-muted-foreground">
      <Icon className="size-4" aria-hidden="true" />
      {text}
    </div>
  )
}
