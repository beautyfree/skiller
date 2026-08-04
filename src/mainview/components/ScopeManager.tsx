import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FolderKanban, Laptop, Layers3, Loader2, RotateCcw, ShieldCheck, UserRound, X } from 'lucide-react'
import { Button } from '@/mainview/components/ui/button'
import { useToast } from '@/mainview/components/ToastProvider'
import { invoke } from '@/mainview/lib/native'
import type {
  DotagentsScopeCompositionPreviewJson,
  DotagentsScopeCompositionUndoPreviewJson,
  DotagentsScopeMigrationPreviewJson,
  DotagentsScopeOverviewJson,
} from '@/shared/rpc-schema'

type Scope = 'personal' | 'project'

function sorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'))
}

function sameValues(left: string[], right: string[]): boolean {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right))
}

export function ScopeManager({ profileId }: { profileId: string | null }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const overview = useQuery<DotagentsScopeOverviewJson>({
    queryKey: ['dotagents-scope-overview'],
    queryFn: () => invoke('dotagents_scope_overview', {}),
  })
  const current = overview.data?.profiles.find((profile) => profile.profile_id === profileId) ?? null
  const [migrationPreview, setMigrationPreview] = useState<DotagentsScopeMigrationPreviewJson | null>(null)
  const [migrationBusy, setMigrationBusy] = useState<'idle' | 'reviewing' | 'applying'>('idle')
  const [managerOpen, setManagerOpen] = useState(false)
  const [personalProfileId, setPersonalProfileId] = useState<string | null>(null)
  const [projectProfileId, setProjectProfileId] = useState<string | null>(null)
  const [exclusions, setExclusions] = useState<string[]>([])
  const [compositionPreview, setCompositionPreview] = useState<DotagentsScopeCompositionPreviewJson | null>(null)
  const [compositionBusy, setCompositionBusy] = useState<'idle' | 'reviewing' | 'applying'>('idle')
  const [undoPreview, setUndoPreview] = useState<DotagentsScopeCompositionUndoPreviewJson | null>(null)
  const [undoBusy, setUndoBusy] = useState<'idle' | 'reviewing' | 'applying'>('idle')
  const [error, setError] = useState<string | null>(null)

  const personalProfiles = useMemo(
    () => (overview.data?.profiles ?? []).filter((profile) => profile.scope === 'personal' && !profile.error),
    [overview.data?.profiles],
  )
  const projectProfiles = useMemo(
    () => (overview.data?.profiles ?? []).filter((profile) => profile.scope === 'project' && !profile.error),
    [overview.data?.profiles],
  )

  useEffect(() => {
    setMigrationPreview(null)
    setMigrationBusy('idle')
    setManagerOpen(false)
    setCompositionPreview(null)
    setUndoPreview(null)
    setError(null)
  }, [profileId])

  function openManager() {
    const active = overview.data?.active
    setPersonalProfileId(
      active?.personal_profile_id
      ?? (current?.scope === 'personal' ? current.profile_id : null)
      ?? (personalProfiles.length === 1 ? personalProfiles[0]?.profile_id ?? null : null),
    )
    setProjectProfileId(
      active?.project_profile_id
      ?? (current?.scope === 'project' ? current.profile_id : null)
      ?? (projectProfiles.length === 1 ? projectProfiles[0]?.profile_id ?? null : null),
    )
    setExclusions(active?.exclusions ?? [])
    setCompositionPreview(active ?? null)
    setUndoPreview(null)
    setError(null)
    setManagerOpen(true)
  }

  async function reviewMigration(scope: Scope) {
    if (!profileId) return
    setMigrationBusy('reviewing')
    setError(null)
    try {
      setMigrationPreview(await invoke('dotagents_scope_migration_preview', { profileId, scope }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The scope classification could not be reviewed.')
    } finally {
      setMigrationBusy('idle')
    }
  }

  async function applyMigration() {
    if (!migrationPreview) return
    setMigrationBusy('applying')
    setError(null)
    try {
      await invoke('dotagents_scope_migration_apply', {
        profileId: migrationPreview.profile_id,
        planId: migrationPreview.plan_id,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dotagents-scope-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['dotagents-resource-overview', migrationPreview.profile_id] }),
        queryClient.invalidateQueries({ queryKey: ['sync-history', migrationPreview.profile_id] }),
        queryClient.invalidateQueries({ queryKey: ['sync-profiles'] }),
      ])
      toast('The reviewed portable scope was added. Nothing was committed or pushed.')
      setMigrationPreview(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The reviewed scope could not be applied.')
    } finally {
      setMigrationBusy('idle')
    }
  }

  async function reviewComposition() {
    setCompositionBusy('reviewing')
    setError(null)
    try {
      setCompositionPreview(await invoke('dotagents_scope_composition_preview', {
        personalProfileId,
        projectProfileId,
        exclusions: sorted(exclusions),
      }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Device composition could not be reviewed.')
    } finally {
      setCompositionBusy('idle')
    }
  }

  async function applyComposition() {
    if (!compositionPreview) return
    setCompositionBusy('applying')
    setError(null)
    try {
      await invoke('dotagents_scope_composition_apply', { planId: compositionPreview.plan_id })
      await queryClient.invalidateQueries({ queryKey: ['dotagents-scope-overview'] })
      toast('This reviewed Personal and Project toolkit is now active on this device.')
      setManagerOpen(false)
      setCompositionPreview(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The reviewed Device composition could not be applied.')
    } finally {
      setCompositionBusy('idle')
    }
  }

  async function reviewCompositionUndo() {
    setUndoBusy('reviewing')
    setError(null)
    try {
      const preview = await invoke('dotagents_scope_composition_undo_preview', {})
      if (!preview) {
        toast('There is no Device composition change to undo yet.')
        return
      }
      setUndoPreview(preview)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Device Undo could not be reviewed.')
    } finally {
      setUndoBusy('idle')
    }
  }

  async function applyCompositionUndo() {
    if (!undoPreview) return
    setUndoBusy('applying')
    setError(null)
    try {
      await invoke('dotagents_scope_composition_undo_apply', { planId: undoPreview.plan_id })
      await queryClient.invalidateQueries({ queryKey: ['dotagents-scope-overview'] })
      toast('The reviewed Device composition was restored locally.')
      setUndoPreview(null)
      setCompositionPreview(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The reviewed Device Undo could not be applied.')
    } finally {
      setUndoBusy('idle')
    }
  }

  function toggleResource(resourceKey: string, included: boolean) {
    setExclusions((currentExclusions) => included
      ? currentExclusions.filter((key) => key !== resourceKey)
      : sorted([...currentExclusions, resourceKey]))
  }

  if (!profileId || overview.isLoading) return null
  if (overview.isError) {
    return <section className="shrink-0 border-b border-red-500/20 bg-red-500/[0.045] px-6 py-3 text-xs text-red-700 dark:text-red-300">Scope information could not be loaded. No library or Device setting changed.</section>
  }
  if (!current) return null
  if (current.error) {
    return <section className="shrink-0 border-b border-amber-500/20 bg-amber-500/[0.045] px-6 py-3 text-xs text-amber-800 dark:text-amber-200">{current.error}</section>
  }

  if (current.migration_required) {
    return (
      <section className="shrink-0 border-b border-primary/20 bg-primary/[0.045] px-6 py-4" aria-label="Portable library scope">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex max-w-3xl items-start gap-3">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Layers3 className="size-4" /></span>
            <div>
              <p className="text-sm font-semibold">Where does this library belong?</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Personal travels across your work. Project carries shared context for one repository or team. This explicit choice becomes portable; Device exclusions never do.</p>
            </div>
          </div>
          {!migrationPreview && (
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="outline" onClick={() => void reviewMigration('personal')} disabled={migrationBusy !== 'idle'}><UserRound className="size-3.5" />Use as Personal</Button>
              <Button size="sm" variant="outline" onClick={() => void reviewMigration('project')} disabled={migrationBusy !== 'idle'}><FolderKanban className="size-3.5" />Use as Project</Button>
            </div>
          )}
        </div>
        {migrationBusy === 'reviewing' && <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Reviewing the current portable library…</p>}
        {migrationPreview && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/20 bg-background/80 p-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Reviewed classification</p><p className="mt-1 text-sm font-medium">{migrationPreview.library} becomes {migrationPreview.scope === 'personal' ? 'Personal' : 'Project'}</p><p className="mt-1 text-xs text-muted-foreground">Adds only <span className="font-mono text-foreground">dotagents.scope.json</span>. No commit, push, remote access, or Device path.</p></div>
            <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setMigrationPreview(null)} disabled={migrationBusy !== 'idle'}>Back</Button><Button size="sm" onClick={() => void applyMigration()} disabled={migrationBusy !== 'idle'}>{migrationBusy === 'applying' ? <><Loader2 className="size-3.5 animate-spin" />Applying…</> : <><ShieldCheck className="size-3.5" />Apply reviewed scope</>}</Button></div>
          </div>
        )}
        {error && <p className="mt-3 text-xs text-red-700 dark:text-red-300">{error}</p>}
      </section>
    )
  }

  const active = overview.data?.active
  const reviewCurrent = Boolean(
    compositionPreview
    && compositionPreview.personal_profile_id === personalProfileId
    && compositionPreview.project_profile_id === projectProfileId
    && sameValues(compositionPreview.exclusions, exclusions),
  )
  const differsFromActive = !active
    || active.personal_profile_id !== personalProfileId
    || active.project_profile_id !== projectProfileId
    || !sameValues(active.exclusions, exclusions)
  const undoActiveResourceCount = undoPreview?.composition?.resources.filter((resource) => !resource.excluded_by_device).length ?? 0
  const undoExcludedResourceCount = undoPreview?.composition?.resources.filter((resource) => resource.excluded_by_device).length ?? 0
  const undoDescription = !undoPreview?.composition
    ? 'This restores the prior empty Device toolkit. Portable libraries stay unchanged.'
    : `Restores ${undoActiveResourceCount} ${undoActiveResourceCount === 1 ? 'resource' : 'resources'} on this device${undoExcludedResourceCount ? ` and keeps ${undoExcludedResourceCount} local ${undoExcludedResourceCount === 1 ? 'exclusion' : 'exclusions'}` : ''}.`

  return (
    <section className="shrink-0 border-b border-border/70 bg-muted/[0.18] px-6 py-3" aria-label="Personal Project and Device scopes">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">{current.scope === 'personal' ? <UserRound className="size-3.5" /> : <FolderKanban className="size-3.5" />}</span>
          <div><p className="text-xs font-semibold">{current.scope === 'personal' ? 'Personal library' : 'Project library'} <span className="font-normal text-muted-foreground">· {current.library}</span></p><p className="mt-0.5 text-[11px] text-muted-foreground">{active ? String(active.resources.filter((resource) => !resource.excluded_by_device).length) + ' resources active on this device' : 'Not yet included in this device toolkit'}</p></div>
        </div>
        <Button size="sm" variant="outline" onClick={openManager}><Laptop className="size-3.5" />Manage this device</Button>
      </div>

      {managerOpen && (
        <div className="mt-3 rounded-xl border border-border bg-background/85 p-4 shadow-sm">
          <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold">Build this device toolkit</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Combine at most one Personal and one Project library. Exclusions stay only on this computer.</p></div><button type="button" aria-label="Close scope manager" onClick={() => setManagerOpen(false)} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-3.5" /></button></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-medium">Personal library<select value={personalProfileId ?? ''} onChange={(event) => { setPersonalProfileId(event.target.value || null); setCompositionPreview(null) }} className="h-9 rounded-md border border-border bg-background px-3 text-xs"><option value="">None</option>{personalProfiles.map((profile) => <option key={profile.profile_id} value={profile.profile_id}>{profile.library}</option>)}</select></label>
            <label className="grid gap-1.5 text-xs font-medium">Project library<select value={projectProfileId ?? ''} onChange={(event) => { setProjectProfileId(event.target.value || null); setCompositionPreview(null) }} className="h-9 rounded-md border border-border bg-background px-3 text-xs"><option value="">None</option>{projectProfiles.map((profile) => <option key={profile.profile_id} value={profile.profile_id}>{profile.library}</option>)}</select></label>
          </div>

          {compositionPreview && (
            <div className="mt-4">
              {compositionPreview.conflicts.length > 0 && <div className="mb-3 rounded-lg bg-amber-500/[0.08] px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200"><AlertTriangle className="mr-2 inline size-3.5" />{String(compositionPreview.conflicts.length)} resource conflicts need a library decision before this composition can apply.</div>}
              {compositionPreview.issues.map((issue) => <p key={issue.code + ':' + issue.resource_key} className="mb-2 text-xs text-red-700 dark:text-red-300">{issue.message}</p>)}
              <div className="max-h-44 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border/70">
                {compositionPreview.resources.map((resource) => {
                  const included = !exclusions.includes(resource.key)
                  return <label key={resource.key} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/30"><input type="checkbox" checked={included} onChange={(event) => toggleResource(resource.key, event.target.checked)} className="size-4 cursor-pointer accent-primary" /><span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-2"><span className="truncate text-xs font-medium">{resource.id}</span><span className="rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{resource.kind}</span></span><span className="block text-[10px] text-muted-foreground">{resource.origins.map((origin) => origin.scope).join(' + ')}</span></span><span className="text-[10px] text-muted-foreground">{included ? 'On this device' : 'Excluded locally'}</span></label>
                })}
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
            <p className="text-[11px] leading-4 text-muted-foreground">{reviewCurrent ? (compositionPreview?.has_blockers ? 'Blocked until every conflict is resolved.' : 'Exact libraries, immutable contents, and Device exclusions reviewed.') : 'Review is read-only and must be repeated after every choice.'}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => void reviewCompositionUndo()} disabled={compositionBusy !== 'idle' || undoBusy !== 'idle'}>{undoBusy === 'reviewing' ? <><Loader2 className="size-3.5 animate-spin" />Reviewing Undo…</> : <><RotateCcw className="size-3.5" />Review Undo</>}</Button>
              {!reviewCurrent && <Button size="sm" variant="outline" onClick={() => void reviewComposition()} disabled={compositionBusy !== 'idle' || undoBusy !== 'idle' || (!personalProfileId && !projectProfileId)}>{compositionBusy === 'reviewing' ? <><Loader2 className="size-3.5 animate-spin" />Reviewing…</> : 'Review toolkit'}</Button>}
              {reviewCurrent && differsFromActive && <Button size="sm" onClick={() => void applyComposition()} disabled={compositionBusy !== 'idle' || undoBusy !== 'idle' || Boolean(compositionPreview?.has_blockers)}>{compositionBusy === 'applying' ? <><Loader2 className="size-3.5 animate-spin" />Applying…</> : 'Use on this device'}</Button>}
              {reviewCurrent && !differsFromActive && <Button size="sm" disabled><ShieldCheck className="size-3.5" />Saved on this device</Button>}
            </div>
          </div>
          {undoPreview && <div className={`mt-3 rounded-lg border px-3 py-3 text-xs ${undoPreview.has_conflicts ? 'border-amber-500/30 bg-amber-500/[0.06] text-amber-800 dark:text-amber-200' : 'border-primary/20 bg-primary/[0.05]'}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">Restore previous Device toolkit</p><p className="mt-1 leading-5 text-muted-foreground">{undoPreview.has_conflicts ? 'The active toolkit or a selected library changed, so this Undo is safely blocked.' : undoDescription}</p></div><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setUndoPreview(null)} disabled={undoBusy !== 'idle'}>Close</Button><Button size="sm" variant="outline" onClick={() => void applyCompositionUndo()} disabled={undoBusy !== 'idle' || undoPreview.has_conflicts}>{undoBusy === 'applying' ? <><Loader2 className="size-3.5 animate-spin" />Restoring…</> : <><RotateCcw className="size-3.5" />Restore reviewed toolkit</>}</Button></div></div></div>}
          {error && <p className="mt-3 text-xs text-red-700 dark:text-red-300">{error}</p>}
        </div>
      )}
    </section>
  )
}
