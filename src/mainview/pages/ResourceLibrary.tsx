import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Command,
  FileText,
  FolderInput,
  LibraryBig,
  Loader2,
  Plus,
  Puzzle,
  ShieldCheck,
  Wrench,
  X,
} from 'lucide-react'
import { Button, buttonVariants } from '@/mainview/components/ui/button'
import { ScopeManager } from '@/mainview/components/ScopeManager'
import { useToast } from '@/mainview/components/ToastProvider'
import { invoke } from '@/mainview/lib/native'
import { cn } from '@/mainview/lib/utils'
import type {
  DotagentsResourceAdoptionPreviewJson,
  DotagentsResourceKindJson,
  DotagentsLibraryHealthJson,
  DotagentsLibraryRepairPreviewJson,
  DotagentsResourceOverviewJson,
  DotagentsResourceSelectionJson,
  SyncProfileStatusJson,
} from '@/shared/rpc-schema'

type Filter = 'all' | DotagentsResourceKindJson

const kinds: { kind: DotagentsResourceKindJson; label: string; description: string; icon: typeof Puzzle }[] = [
  { kind: 'skill', label: 'Skill', description: 'A reusable capability with SKILL.md', icon: Puzzle },
  { kind: 'instruction', label: 'Instruction', description: 'Always-on or conditional guidance', icon: FileText },
  { kind: 'command', label: 'Command', description: 'A named Markdown command', icon: Command },
  { kind: 'subagent', label: 'Subagent', description: 'A portable role definition', icon: Bot },
]

function slug(value: string): string {
  const withoutExtension = value.replace(/\.[^.]+$/, '')
  return withoutExtension.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'resource'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function ResourceLibrary() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [profileId, setProfileId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selection, setSelection] = useState<DotagentsResourceSelectionJson | null>(null)
  const [kind, setKind] = useState<DotagentsResourceKindJson | null>(null)
  const [resourceId, setResourceId] = useState('')
  const [activation, setActivation] = useState<'always' | 'conditional'>('always')
  const [condition, setCondition] = useState('')
  const [role, setRole] = useState('')
  const [preview, setPreview] = useState<DotagentsResourceAdoptionPreviewJson | null>(null)
  const [busy, setBusy] = useState<'idle' | 'picking' | 'reviewing' | 'applying'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [repairPreview, setRepairPreview] = useState<DotagentsLibraryRepairPreviewJson | null>(null)
  const [repairBusy, setRepairBusy] = useState<'idle' | 'reviewing' | 'applying'>('idle')
  const [repairError, setRepairError] = useState<string | null>(null)

  const profiles = useQuery<SyncProfileStatusJson[]>({
    queryKey: ['sync-profiles'],
    queryFn: () => invoke('list_sync_profiles'),
  })
  useEffect(() => {
    if (!profileId && profiles.data?.[0]) setProfileId(profiles.data[0].profile_id)
  }, [profileId, profiles.data])
  const overview = useQuery<DotagentsResourceOverviewJson>({
    queryKey: ['dotagents-resource-overview', profileId],
    queryFn: () => invoke('dotagents_resource_overview', { profileId: profileId! }),
    enabled: Boolean(profileId),
  })
  const health = useQuery<DotagentsLibraryHealthJson>({
    queryKey: ['dotagents-library-health', profileId],
    queryFn: () => invoke('dotagents_library_health', { profileId: profileId! }),
    enabled: Boolean(profileId),
  })
  const visible = useMemo(
    () => (overview.data?.resources ?? []).filter((resource) => filter === 'all' || resource.kind === filter),
    [filter, overview.data?.resources],
  )
  const counts = useMemo(() => Object.fromEntries(kinds.map(({ kind }) => [kind, overview.data?.resources.filter((entry) => entry.kind === kind).length ?? 0])), [overview.data?.resources])
  const libraryEmpty = overview.isSuccess && overview.data.resources.length === 0
  const repairableCodes = useMemo(
    () => [...new Set((health.data?.issues ?? []).filter((issue) => issue.repairable).map((issue) => issue.code))],
    [health.data?.issues],
  )

  useEffect(() => {
    setRepairPreview(null)
    setRepairError(null)
    setRepairBusy('idle')
  }, [profileId])

  const resetDialog = useCallback(() => {
    setDialogOpen(false)
    setSelection(null)
    setKind(null)
    setResourceId('')
    setActivation('always')
    setCondition('')
    setRole('')
    setPreview(null)
    setError(null)
    setBusy('idle')
  }, [])

  useEffect(() => {
    if (!dialogOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') resetDialog()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [dialogOpen, resetDialog])

  async function chooseSource(nextKind: DotagentsResourceKindJson) {
    setBusy('picking')
    setError(null)
    try {
      const selected = await invoke('dotagents_resource_pick_source', { kind: nextKind })
      if (!selected) return
      setKind(nextKind)
      setSelection(selected)
      const nextId = slug(selected.name)
      setResourceId(nextId)
      setRole(nextId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The source could not be selected.')
    } finally {
      setBusy('idle')
    }
  }

  async function review() {
    if (!profileId || !selection || !kind) return
    setBusy('reviewing')
    setError(null)
    try {
      const result = await invoke('dotagents_resource_adopt_preview', {
        profileId,
        selectionId: selection.selection_id,
        kind,
        id: resourceId,
        ...(kind === 'instruction' ? { activation, ...(activation === 'conditional' ? { condition } : {}) } : {}),
        ...(kind === 'command' ? { invocation: resourceId } : {}),
        ...(kind === 'subagent' ? { role } : {}),
      })
      setPreview(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The resource could not be reviewed.')
    } finally {
      setBusy('idle')
    }
  }

  async function apply() {
    if (!preview) return
    setBusy('applying')
    setError(null)
    try {
      await invoke('dotagents_resource_adopt_apply', { planId: preview.plan_id })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dotagents-resource-overview', preview.profile_id] }),
        queryClient.invalidateQueries({ queryKey: ['sync-profiles'] }),
        queryClient.invalidateQueries({ queryKey: ['sync-history', preview.profile_id] }),
      ])
      toast(`${preview.resource.id} was added to your local library. Review Sync Center before publishing it.`)
      resetDialog()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The reviewed resource could not be added.')
      setBusy('idle')
    }
  }

  async function reviewRepair() {
    if (!profileId || repairableCodes.length === 0) return
    setRepairBusy('reviewing')
    setRepairError(null)
    try {
      setRepairPreview(await invoke('dotagents_library_repair_preview', { profileId, selectedCodes: repairableCodes }))
    } catch (cause) {
      setRepairError(cause instanceof Error ? cause.message : 'The library repair could not be reviewed.')
    } finally {
      setRepairBusy('idle')
    }
  }

  async function applyRepair() {
    if (!profileId || !repairPreview) return
    setRepairBusy('applying')
    setRepairError(null)
    try {
      await invoke('dotagents_library_repair_apply', { profileId, planId: repairPreview.plan_id })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dotagents-library-health', profileId] }),
        queryClient.invalidateQueries({ queryKey: ['dotagents-resource-overview', profileId] }),
        queryClient.invalidateQueries({ queryKey: ['sync-history', profileId] }),
        queryClient.invalidateQueries({ queryKey: ['sync-profiles'] }),
      ])
      toast('The reviewed local repair was applied. You can inspect or undo it in Sync Center.')
      setRepairPreview(null)
    } catch (cause) {
      setRepairError(cause instanceof Error ? cause.message : 'The reviewed library repair could not be applied.')
    } finally {
      setRepairBusy('idle')
    }
  }

  if (!profiles.isLoading && (profiles.data?.length ?? 0) === 0) {
    return (
      <div className="grid h-full place-items-center bg-[linear-gradient(180deg,color-mix(in_oklab,var(--card)_96%,var(--primary)_4%),var(--card)_16rem)] px-6">
        <div className="max-w-lg text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><LibraryBig className="size-6" /></span>
          <h1 className="mt-5 text-2xl font-semibold tracking-[-0.04em]">Your agent library starts in Sync Center</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Create or connect a portable library first. Then this page can hold skills, instructions, commands, and subagents without changing their original local files.</p>
          <Link to="/sync" className={cn(buttonVariants(), 'mt-6')}>Open Sync Center</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[linear-gradient(180deg,color-mix(in_oklab,var(--card)_97%,var(--primary)_3%),var(--card)_14rem)]">
      <header className="shrink-0 border-b border-border/70 px-6 pb-5 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[62ch]">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/80"><LibraryBig className="size-3.5" />Agent Library</div>
            <h1 className="text-[clamp(1.35rem,2.2vw,1.85rem)] font-semibold leading-tight tracking-[-0.045em]">Carry your working toolkit—not just your skills.</h1>
            <p className="mt-2 text-[13px] leading-5 text-muted-foreground">One portable source for skills, instructions, commands, and subagent roles. Local device choices stay local.</p>
          </div>
          <div className="flex items-center gap-2">
            {(profiles.data?.length ?? 0) > 1 && (
              <label className="relative"><span className="sr-only">Library</span><select value={profileId ?? ''} onChange={(event) => setProfileId(event.target.value)} className="h-9 appearance-none rounded-md border border-border bg-background pl-3 pr-8 text-xs font-medium outline-none focus:ring-2 focus:ring-ring/40">{profiles.data?.map((profile) => <option key={profile.profile_id} value={profile.profile_id}>{profile.profile_id}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /></label>
            )}
            {!libraryEmpty && <Button onClick={() => setDialogOpen(true)} disabled={!overview.isSuccess}><Plus className="size-4" />Bring in a resource</Button>}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-border/70 py-3 text-xs">
          <span><strong className="text-base tabular-nums">{overview.data?.resources.length ?? 0}</strong> <span className="ml-1 text-muted-foreground">portable resources</span></span>
          {kinds.map(({ kind: value, label }) => <span key={value} className="text-muted-foreground"><strong className="text-foreground tabular-nums">{counts[value] ?? 0}</strong> {label.toLowerCase()}</span>)}
          {overview.data?.changed && <span className="ml-auto inline-flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300"><span className="size-1.5 rounded-full bg-current" />Local changes need Sync Center review</span>}
        </div>
      </header>

      {health.data && health.data.issues.length > 0 && (
        <section className="shrink-0 border-b border-amber-500/25 bg-amber-500/[0.055] px-6 py-4" aria-label="Library health">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 max-w-3xl items-start gap-3">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-amber-500/12 text-amber-700 dark:text-amber-300"><AlertTriangle className="size-4" /></span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Library health needs attention</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{health.data.issues.length === 1 ? health.data.issues[0].message : `${health.data.issues.length} checks need a decision before this library is fully healthy.`}</p>
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer font-medium text-amber-800 outline-none hover:underline dark:text-amber-200">See checks and next steps</summary>
                  <div className="mt-2 space-y-2 border-l border-amber-500/30 pl-3">
                    {health.data.issues.map((issue, index) => <div key={`${issue.code}:${index}`}><p className="font-medium">{issue.message}</p><p className="mt-0.5 leading-5 text-muted-foreground">{issue.remediation}</p></div>)}
                  </div>
                </details>
              </div>
            </div>
            {repairableCodes.length > 0 && !repairPreview && <Button size="sm" variant="outline" className="shrink-0 border-amber-500/30 bg-background/70" onClick={() => void reviewRepair()} disabled={repairBusy !== 'idle'}>{repairBusy === 'reviewing' ? <><Loader2 className="size-3.5 animate-spin" />Reviewing…</> : <><Wrench className="size-3.5" />Review safe repair</>}</Button>}
          </div>
          {repairPreview && (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-background/80 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-800 dark:text-amber-200">Reviewed repair</p><p className="mt-1 text-sm font-medium">Keep device-only state out of the portable library</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Add <span className="font-mono text-foreground">{repairPreview.actions.flatMap((action) => action.add).join(' and ')}</span> to <span className="font-mono text-foreground">.gitignore</span>. No skills, resources, commits, or remotes will change.</p></div>
                <div className="flex shrink-0 gap-2"><Button size="sm" variant="ghost" onClick={() => { setRepairPreview(null); setRepairError(null) }} disabled={repairBusy !== 'idle'}>Cancel</Button><Button size="sm" onClick={() => void applyRepair()} disabled={repairBusy !== 'idle' || repairPreview.has_blockers || repairPreview.actions.length === 0}>{repairBusy === 'applying' ? <><Loader2 className="size-3.5 animate-spin" />Repairing…</> : <><ShieldCheck className="size-3.5" />Apply reviewed repair</>}</Button></div>
              </div>
            </div>
          )}
          {repairError && <p className="mt-3 text-xs text-red-700 dark:text-red-300">{repairError}</p>}
        </section>
      )}

      <ScopeManager profileId={profileId} />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 gap-1 border-b border-border/70 px-6 py-3" role="tablist" aria-label="Resource filters">
          {([['all', 'All'], ...kinds.map(({ kind: value, label }) => [value, label])] as [Filter, string][]).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={cn('min-h-8 rounded-md px-3 text-xs font-medium transition-colors', filter === value ? 'bg-black/[0.06] text-foreground dark:bg-white/[0.1]' : 'text-muted-foreground hover:bg-black/[0.035] hover:text-foreground dark:hover:bg-white/[0.05]')}>{label}</button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-2">
          {overview.isError ? (
            <div className="grid min-h-72 place-items-center text-center"><div><AlertTriangle className="mx-auto size-7 text-red-500" /><p className="mt-3 text-sm font-medium">Agent Library could not be loaded</p><p className="mt-1 text-xs text-muted-foreground">Nothing changed. Retry the local library review.</p><Button size="sm" variant="outline" className="mt-4" onClick={() => overview.refetch()}>Try again</Button></div></div>
          ) : overview.isLoading ? Array.from({ length: 7 }).map((_, index) => <div key={index} className="flex animate-pulse items-center gap-3 border-b border-border/60 py-4"><div className="size-8 rounded-lg bg-muted" /><div className="space-y-2"><div className="h-3 w-36 rounded bg-muted" /><div className="h-2.5 w-52 rounded bg-muted/60" /></div></div>) : visible.length === 0 ? (
            <div className="grid min-h-72 place-items-center text-center"><div><FolderInput className="mx-auto size-7 text-muted-foreground/50" /><p className="mt-3 text-sm font-medium">No {filter === 'all' ? 'resources' : `${filter}s`} here yet</p><p className="mt-1 text-xs text-muted-foreground">{libraryEmpty ? 'Bring in one explicit local source; Skiller will review it before copying anything.' : `This library has no ${filter} resources. Choose another filter or bring in a new resource.`}</p>{libraryEmpty && <Button size="sm" className="mt-4" onClick={() => setDialogOpen(true)}><Plus className="size-3.5" />Bring in a resource</Button>}</div></div>
          ) : visible.map((resource) => {
            const definition = kinds.find((entry) => entry.kind === resource.kind)!
            const Icon = definition.icon
            return <div key={resource.key} className="flex items-center gap-3 border-b border-border/60 px-1 py-3.5 last:border-b-0"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/[0.07] text-primary"><Icon className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{resource.id}</p><p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{resource.path}</p></div><span className="rounded-md bg-muted/60 px-2 py-1 text-[10px] font-medium text-muted-foreground">{definition.label}</span></div>
          })}
        </div>
      </div>

      {dialogOpen && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-card/70 p-5 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Bring in a resource">
          <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
            <div className="flex items-start justify-between border-b border-border px-6 py-5"><div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Bring in a resource</p><h2 className="mt-1 text-xl font-semibold tracking-[-0.035em]">{preview ? 'Review exactly what will change' : selection ? `Name this ${kind}` : 'What belongs in your library?'}</h2></div><button type="button" onClick={resetDialog} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close"><X className="size-4" /></button></div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {!selection && !preview && <div className="grid gap-3 sm:grid-cols-2">{kinds.map((item) => { const Icon = item.icon; return <button key={item.kind} type="button" autoFocus={item.kind === 'skill'} disabled={busy !== 'idle'} onClick={() => void chooseSource(item.kind)} className="group flex min-h-28 items-start gap-4 rounded-xl border border-border p-4 text-left transition-colors hover:border-primary/30 hover:bg-primary/[0.035] disabled:opacity-50"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"><Icon className="size-4" /></span><span><strong className="block text-sm">{item.label}</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.description}</span></span></button>})}</div>}

              {selection && !preview && kind && <div className="space-y-5"><div className="flex items-center gap-3 border-b border-border pb-4"><CheckCircle2 className="size-4 text-emerald-500" /><div><p className="text-sm font-medium">{selection.name}</p><p className="text-xs text-muted-foreground">Original {selection.entry_type} stays where it is.</p></div><button type="button" className="ml-auto text-xs font-medium text-primary hover:underline" onClick={() => { setSelection(null); setKind(null) }}>Choose again</button></div><label className="grid gap-1.5 text-xs font-medium">Portable id<input autoFocus value={resourceId} onChange={(event) => setResourceId(event.target.value)} className="h-10 rounded-md border border-border bg-background px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring/40" /><span className="font-normal text-muted-foreground">Lowercase words separated by dashes. The library path is chosen safely for you.</span></label>{kind === 'instruction' && <><label className="grid gap-1.5 text-xs font-medium">Activation<select value={activation} onChange={(event) => setActivation(event.target.value as typeof activation)} className="h-10 rounded-md border border-border bg-background px-3 text-sm"><option value="always">Always available</option><option value="conditional">Conditional</option></select></label>{activation === 'conditional' && <label className="grid gap-1.5 text-xs font-medium">When to use it<input value={condition} onChange={(event) => setCondition(event.target.value)} placeholder="When reviewing pull requests" className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40" /></label>}</>}{kind === 'subagent' && <label className="grid gap-1.5 text-xs font-medium">Role<input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Security reviewer" className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40" /></label>}<div className="rounded-lg bg-muted/45 px-4 py-3 text-xs leading-5 text-muted-foreground"><strong className="text-foreground">Next is review, not import.</strong> Skiller checks collisions, linked content, size, possible secrets, and the library license before it can copy anything.</div></div>}

              {preview && <div><div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">{[['Resource', preview.resource.key], ['Destination', preview.resource.path], ['Content', `${preview.files} ${preview.files === 1 ? 'file' : 'files'} · ${formatBytes(preview.bytes)}`], ['Sharing', preview.license.visibility]].map(([label, value]) => <div key={label} className="bg-background px-3 py-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 truncate text-xs font-medium" title={value}>{value}</p></div>)}</div><div className="mt-5 flex items-start gap-3 border-y border-border py-4"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" /><div><p className="text-sm font-medium">The source remains untouched</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Skiller will copy only the reviewed bytes into <span className="font-mono">{preview.resource.path}</span> and update <span className="font-mono">resources.json</span> in one undoable local transaction. Nothing is committed or pushed automatically.</p></div></div>{preview.secret_findings.length > 0 && <div className="mt-4"><p className="text-xs font-semibold text-red-600">Possible secrets need review</p><div className="mt-2 divide-y divide-red-500/20 rounded-lg border border-red-500/25">{preview.secret_findings.map((finding, index) => <p key={`${finding.file}:${finding.line}:${index}`} className="px-3 py-2 font-mono text-[10px] text-red-700 dark:text-red-300">{finding.file}:{finding.line} · {finding.rule}</p>)}</div></div>}{preview.blockers.length > 0 && <div className="mt-4 space-y-2">{preview.blockers.map((blocker) => <div key={`${blocker.code}:${blocker.message}`} className="flex items-start gap-2 rounded-lg bg-amber-500/[0.08] px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /><span>{blocker.message}</span></div>)}</div>}</div>}
              {error && <p className="mt-4 rounded-lg bg-red-500/[0.08] px-3 py-2.5 text-xs leading-5 text-red-700 dark:text-red-300">{error}</p>}
            </div>
            <div className="flex items-center justify-between border-t border-border bg-muted/20 px-6 py-4"><p className="max-w-sm text-[11px] leading-4 text-muted-foreground">{preview ? (preview.blockers.length === 0 ? 'Ready for one local, undoable change.' : 'Nothing can change until every blocker is resolved.') : selection ? 'Review creates a deterministic plan. It does not copy files.' : 'Choose one explicit source to continue.'}</p><div className="flex gap-2">{preview && <Button variant="outline" onClick={() => setPreview(null)} disabled={busy !== 'idle'}>Back</Button>}{selection && !preview && <Button onClick={() => void review()} disabled={busy !== 'idle' || !resourceId}>{busy === 'reviewing' ? <><Loader2 className="size-4 animate-spin" />Reviewing…</> : 'Review resource'}</Button>}{preview && <Button onClick={() => void apply()} disabled={busy !== 'idle' || preview.blockers.length > 0}>{busy === 'applying' ? <><Loader2 className="size-4 animate-spin" />Adding…</> : 'Add to my library'}</Button>}</div></div>
          </div>
        </div>
      )}
    </div>
  )
}
