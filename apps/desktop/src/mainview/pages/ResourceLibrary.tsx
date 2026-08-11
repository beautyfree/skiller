import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Command,
  FileDiff,
  FileText,
  Image,
  LibraryBig,
  Loader2,
  MoreHorizontal,
  Puzzle,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import { Button } from '@/mainview/components/ui/button'
import { Tooltip } from '@/mainview/components/ui/tooltip'
import MarkdownContent from '@/mainview/components/MarkdownContent'
import SearchInput from '@/mainview/components/SearchInput'
import { ScrollFade } from '@/mainview/components/ScrollFade'
import { useToast } from '@/mainview/components/ToastProvider'
import { invoke, openUrl } from '@/mainview/lib/native'
import { libraryDisplayName } from '@/mainview/lib/sync-library-name'
import { cn } from '@/mainview/lib/utils'
import SyncCenter from '@/mainview/pages/SyncCenter'
import type {
  DotagentsResourceKindJson,
  DotagentsLibraryHealthJson,
  DotagentsLibraryRepairPreviewJson,
  DotagentsResourceOverviewJson,
  DotagentsResourceContentJson,
  DotagentsLibraryLocalChangesJson,
  DotagentsLibraryLocalChangePreviewJson,
  DotagentsLibraryNewLocalPreviewJson,
  SyncDisconnectPreviewJson,
  SyncProfileStatusJson,
  SyncRemoteTrustPreviewJson,
  SyncThreeWayReviewJson,
} from '@/shared/rpc-schema'

type Filter = 'all' | 'changes' | DotagentsResourceKindJson
type LibraryResource = DotagentsResourceOverviewJson['resources'][number]
type LocalChange = DotagentsLibraryLocalChangesJson['changes'][number]
type LibraryListEntry = {
  key: string
  resource?: LibraryResource
  change?: LocalChange
}

function FileChangePreview({ diff }: { diff: string }) {
  const lines = diff.split('\n')
  const contentLines = lines.filter((line) => !line.startsWith('--- ') && !line.startsWith('+++ '))

  return <section className="overflow-hidden rounded-lg border border-border/70 bg-background" aria-label="Changes in this file">
    <pre className="overflow-x-auto pb-2 font-mono text-[11px] leading-5">
      {contentLines.map((line, index) => {
        const added = line.startsWith('+ ')
        const removed = line.startsWith('- ')
        const unchanged = line.startsWith('  ')
        const marker = added ? '+' : removed ? '−' : unchanged ? '·' : ' '
        const value = added || removed || unchanged ? line.slice(2) : line
        return <div key={`${index}:${line}`} className={cn(
          'grid min-w-max grid-cols-[1.8rem_minmax(0,1fr)] px-3',
          added && 'bg-emerald-500/12 text-emerald-950 dark:text-emerald-100',
          removed && 'bg-red-500/12 text-red-950 dark:text-red-100',
          !added && !removed && 'text-muted-foreground',
        )}><span className="select-none text-center opacity-70">{marker}</span><code className="whitespace-pre">{value || ' '}</code></div>
      })}
    </pre>
  </section>
}

function ImagePreview({ source, alt }: { source: string; alt: string }) {
  return <figure className="overflow-hidden rounded-lg border border-border/70 bg-muted/20 p-3">
    <img src={source} alt={alt} className="mx-auto max-h-[min(60dvh,42rem)] max-w-full rounded-md object-contain" />
  </figure>
}

const kinds: { kind: DotagentsResourceKindJson; label: string; description: string; icon: typeof Puzzle }[] = [
  { kind: 'skill', label: 'Skill', description: 'A reusable capability with SKILL.md', icon: Puzzle },
  { kind: 'instruction', label: 'Instruction', description: 'Always-on or conditional guidance', icon: FileText },
  { kind: 'command', label: 'Command', description: 'A named Markdown command', icon: Command },
  { kind: 'subagent', label: 'Subagent', description: 'A portable role definition', icon: Bot },
]

function ManageLibrariesDialog({
  open,
  libraries,
  activeProfileId,
  activeProfile,
  disconnectPreview,
  busy,
  onClose,
  onOpenLibrary,
  onReviewRemoval,
  onCancelRemoval,
  onRemoveLibrary,
}: {
  open: boolean
  libraries: SyncProfileStatusJson[]
  activeProfileId: string | null
  activeProfile: SyncProfileStatusJson | null
  disconnectPreview: SyncDisconnectPreviewJson | null
  busy: boolean
  onClose: () => void
  onOpenLibrary: (profileId: string) => void
  onReviewRemoval: () => void
  onCancelRemoval: () => void
  onRemoveLibrary: () => void
}) {
  const [removalOpen, setRemovalOpen] = useState(false)
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const actionMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose, open])

  useEffect(() => {
    if (!actionMenuOpen) return
    const closeOnOutsidePointer = (event: MouseEvent) => {
      if (!actionMenuRef.current?.contains(event.target as Node)) setActionMenuOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsidePointer)
    return () => document.removeEventListener('mousedown', closeOnOutsidePointer)
  }, [actionMenuOpen])

  if (!open) return null
  const dismissRemoval = () => {
    setRemovalOpen(false)
    onCancelRemoval()
  }

  return <>
    <div className="modal-shell modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4">
    <button type="button" className="absolute inset-0 cursor-default" aria-label="Close library manager" onClick={onClose} disabled={busy} />
    <section role="dialog" aria-modal="true" aria-labelledby="manage-libraries-title" className="modal-panel relative z-10 w-[min(34rem,calc(100vw-2rem))] overflow-hidden rounded-2xl outline-none animate-modal-in glass-elevated">
      <header className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
        <div><h2 id="manage-libraries-title" className="text-lg font-semibold tracking-[-0.025em]">Libraries</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">Each library is a separate Git repository.</p></div>
        <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose} disabled={busy}><X className="size-4" /></Button>
      </header>
      <div className="max-h-[min(52dvh,32rem)] overflow-y-auto p-2">
        <div className="space-y-1">
          {libraries.map((library) => {
            const isActive = library.profile_id === activeProfileId
            const libraryUrl = library.remote_identity && /^https?:\/\//i.test(library.remote_identity) ? library.remote_identity : null
            return <div key={library.profile_id} className={cn('flex items-center gap-3 rounded-xl px-3 py-3', isActive ? 'bg-muted/45' : 'hover:bg-muted/25')}><span className={cn('grid size-8 shrink-0 place-items-center rounded-lg text-xs font-semibold', isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{isActive ? '✓' : '·'}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{libraryDisplayName(library)}</p><p className="mt-0.5 text-xs text-muted-foreground">{library.mode === 'public' ? 'Public' : library.mode === 'team' ? 'Team' : 'Private'}{libraryUrl ? <> · <button type="button" onClick={() => openUrl(libraryUrl)} className="text-primary underline-offset-2 hover:underline">Open repository</button></> : null}</p></div>{isActive ? <><span className="text-xs font-medium text-muted-foreground">Current</span><div ref={actionMenuRef} className="relative"><Button size="icon-sm" variant="ghost" aria-label={`Actions for ${libraryDisplayName(library)}`} aria-haspopup="menu" aria-expanded={actionMenuOpen} onClick={() => setActionMenuOpen((current) => !current)} disabled={busy}><MoreHorizontal className="size-4" /></Button>{actionMenuOpen && <div role="menu" className="absolute right-0 top-[calc(100%+0.25rem)] z-20 w-48 rounded-lg border border-border/70 bg-popover p-1 shadow-lg"><button type="button" role="menuitem" className="flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs font-medium text-destructive outline-none hover:bg-destructive/10 focus-visible:bg-destructive/10" onClick={() => { setActionMenuOpen(false); setRemovalOpen(true) }}><Trash2 className="size-3.5" />Remove from Skiller…</button></div>}</div></> : <Button size="sm" variant="outline" onClick={() => onOpenLibrary(library.profile_id)} disabled={busy}>Open</Button>}</div>
          })}
        </div>
      </div>
    </section>
    </div>
    {/* This confirmation sits above the library manager, which already owns
        the page overlay. Do not add a second backdrop or the page will pulse
        darker while the confirmation opens. */}
    {removalOpen && activeProfile && <div className="modal-shell fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Cancel removal" onClick={dismissRemoval} disabled={busy} />
      <section role="dialog" aria-modal="true" aria-labelledby="remove-library-title" className="modal-panel relative z-10 w-[min(30rem,calc(100vw-2rem))] overflow-hidden rounded-2xl outline-none animate-modal-in glass-elevated">
        <header className="px-5 pb-3 pt-5"><h2 id="remove-library-title" className="text-base font-semibold tracking-[-0.02em]">Remove this library from Skiller?</h2><p className="mt-2 text-sm leading-5 text-muted-foreground">The repository and installed agent content stay untouched. Skiller only removes this computer’s connection.</p></header>
        {disconnectPreview && <div className="mx-5 rounded-xl border border-destructive/25 bg-destructive/[0.045] px-3 py-2.5 text-xs leading-5 text-muted-foreground">{disconnectPreview.can_disconnect ? 'The local library copy will be moved to Trash.' : disconnectPreview.blockers[0] ?? 'This library cannot be removed right now.'}</div>}
        <footer className="mt-4 flex items-center justify-end gap-2 border-t border-border/70 px-5 py-3"><Button size="sm" variant="ghost" onClick={dismissRemoval} disabled={busy}>Cancel</Button>{disconnectPreview ? <Button size="sm" variant="outline" className="border-destructive/35 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onRemoveLibrary} disabled={busy || !disconnectPreview.can_disconnect}>{busy ? 'Removing…' : 'Remove from Skiller'}</Button> : <Button size="sm" variant="outline" className="border-destructive/35 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onReviewRemoval} disabled={busy}>{busy ? 'Preparing…' : 'Remove from Skiller'}</Button>}</footer>
      </section>
    </div>}
  </>
}

function SaveSelectionDialog({
  preview,
  busy,
  onClose,
  onConfirm,
}: {
  preview: DotagentsLibraryNewLocalPreviewJson | null
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  if (!preview) return null
  const savedCount = preview.skills.length + preview.linked_skills.length
  const copiedFiles = preview.skills.reduce((total, skill) => total + skill.files, 0)
  const title = preview.updated_skill_ids.length > 0 ? `Save ${savedCount} selected skills?` : `Add ${savedCount} skills to your library?`
  return <div className="modal-shell modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4">
    <button type="button" className="absolute inset-0 cursor-default" aria-label="Close save confirmation" onClick={onClose} disabled={busy} />
    <section role="dialog" aria-modal="true" aria-labelledby="save-selection-title" className="modal-panel relative z-10 w-[min(38rem,calc(100vw-2rem))] overflow-hidden rounded-2xl outline-none animate-modal-in glass-elevated">
      <header className="flex items-start gap-3 px-5 pb-3 pt-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/[0.1] text-primary"><Cloud className="size-4" /></span>
        <div className="min-w-0"><h2 id="save-selection-title" className="text-base font-semibold tracking-[-0.02em]">{title}</h2><p className="mt-0.5 text-sm leading-5 text-muted-foreground">Nothing is saved until you confirm.</p></div>
      </header>
      <div className="max-h-[min(52dvh,28rem)] overflow-y-auto px-5 pb-4">
        <div className="flex items-center gap-2 border-y border-border/60 py-3 text-xs text-muted-foreground"><span className="font-medium text-foreground">{savedCount} {savedCount === 1 ? 'skill' : 'skills'}</span>{copiedFiles > 0 && <><span aria-hidden="true">·</span><span>{copiedFiles} {copiedFiles === 1 ? 'file' : 'files'} copied</span></>}{preview.linked_skills.length > 0 && <><span aria-hidden="true">·</span><span>{preview.linked_skills.length} linked</span></>}</div>
        {preview.skills.length > 0 && <section className="pt-4"><p className="text-xs font-medium text-muted-foreground">Saved to your library</p><ul className="mt-2 divide-y divide-border/60">{preview.skills.map((skill) => <li key={skill.id} className="flex items-center gap-2 py-2"><FileText className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-sm font-medium">{skill.display_name}</span><span className="shrink-0 text-xs text-muted-foreground">{skill.files} {skill.files === 1 ? 'file' : 'files'}</span></li>)}</ul></section>}
        {preview.linked_skills.length > 0 && <section className="pt-4"><p className="text-xs font-medium text-muted-foreground">Kept linked to source</p><ul className="mt-2 divide-y divide-border/60">{preview.linked_skills.map((skill) => <li key={skill.id} className="flex items-center gap-2 py-2"><FileText className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-sm font-medium">{skill.display_name}</span><span className="shrink-0 text-xs text-muted-foreground">{skill.source}</span></li>)}</ul></section>}
        {preview.skipped_skills.length > 0 && <section className="mt-4 border-t border-amber-500/25 pt-3"><p className="text-sm font-medium text-amber-800 dark:text-amber-200">{preview.skipped_skills.length} {preview.skipped_skills.length === 1 ? 'skill needs attention' : 'skills need attention'}</p><ul className="mt-2 space-y-1.5 text-xs leading-5 text-amber-800/85 dark:text-amber-100/85">{preview.skipped_skills.map((skill) => <li key={skill.id}><span className="font-medium">{skill.display_name}</span> · {skill.reason}</li>)}</ul></section>}
        {preview.secret_findings.length > 0 && <section className="mt-4 border-t border-destructive/25 pt-3"><p className="text-sm font-medium text-destructive">{preview.secret_findings.length} possible {preview.secret_findings.length === 1 ? 'secret blocks saving' : 'secrets block saving'}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">The matched values are never shown. Resolve the listed files before saving.</p></section>}
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-border/70 px-5 py-3"><Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={onConfirm} disabled={busy || preview.has_blockers || savedCount === 0}>{busy ? <><Loader2 className="size-3.5 animate-spin" />Saving…</> : <><Cloud className="size-3.5" />Save to library</>}</Button></footer>
    </section>
  </div>
}

export default function ResourceLibrary() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [profileId, setProfileId] = useState<string | null>(null)
  const [addingLibrary, setAddingLibrary] = useState(false)
  const [managingLibraries, setManagingLibraries] = useState(false)
  const [disconnectPreview, setDisconnectPreview] = useState<SyncDisconnectPreviewJson | null>(null)
  const [disconnectBusy, setDisconnectBusy] = useState(false)
  const [selectedNewLocalIds, setSelectedNewLocalIds] = useState<string[]>([])
  const [newLocalPreview, setNewLocalPreview] = useState<DotagentsLibraryNewLocalPreviewJson | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
	const [search, setSearch] = useState('')
	const [selectedResourceKey, setSelectedResourceKey] = useState<string | null>(null)
	const [selectedChangeKey, setSelectedChangeKey] = useState<string | null>(null)
	const [selectedResourceFile, setSelectedResourceFile] = useState<string | null>(null)
	const [filesByResourceKey, setFilesByResourceKey] = useState<Record<string, string[]>>({})
	const resourceListScrollRef = useRef<HTMLDivElement>(null)
  const [repairPreview, setRepairPreview] = useState<DotagentsLibraryRepairPreviewJson | null>(null)
  const [repairBusy, setRepairBusy] = useState<'idle' | 'reviewing' | 'applying'>('idle')
  const [repairError, setRepairError] = useState<string | null>(null)
  const [syncBusy, setSyncBusy] = useState<'idle' | 'reviewing' | 'saving'>('idle')
  const [remoteReview, setRemoteReview] = useState<SyncThreeWayReviewJson | null>(null)
  const [remoteTrustPreview, setRemoteTrustPreview] = useState<SyncRemoteTrustPreviewJson | null>(null)
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [statusRefreshBusy, setStatusRefreshBusy] = useState(false)
  const remoteReviewRequestRef = useRef<string | null>(null)
  const statusRefreshRequestRef = useRef<string | null>(null)
  const lastBackgroundRefreshAtRef = useRef(0)

  // The sidebar can be clicked while this route is already active. React Router
  // intentionally leaves the route mounted in that case, so explicitly return
  // from a transient Add Library journey to the library overview.
  useEffect(() => {
    const openLibrary = () => {
      setAddingLibrary(false)
      setManagingLibraries(false)
      setDisconnectPreview(null)
      setNewLocalPreview(null)
    }
    window.addEventListener('skiller:open-agent-library', openLibrary)
    return () => window.removeEventListener('skiller:open-agent-library', openLibrary)
  }, [])

  const profiles = useQuery<SyncProfileStatusJson[]>({
    queryKey: ['sync-profiles'],
    // Load the local snapshot first. The page performs exactly one explicit
    // background refresh once the active profile is known; doing both here and
    // in the effect below would fetch the same remote twice on every visit.
    queryFn: () => invoke('list_sync_profiles'),
    refetchOnWindowFocus: 'always',
  })
  useEffect(() => {
    if (!profileId && profiles.data?.[0]) setProfileId(profiles.data[0].profile_id)
  }, [profileId, profiles.data])

  async function chooseActiveLibrary(nextProfileId: string) {
    if (!nextProfileId || nextProfileId === profileId) return
    const previousProfileId = profileId
    setProfileId(nextProfileId)
    setRepairPreview(null)
    setRepairError(null)
    try {
      await invoke('sync_select_profile', { profileId: nextProfileId })
      await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
    } catch (selectionError) {
      setProfileId(previousProfileId)
      toast(selectionError instanceof Error ? selectionError.message : String(selectionError), 'destructive')
    }
  }

  async function reviewLibraryRemoval() {
    if (!profileId) return
    setDisconnectBusy(true)
    try {
      setDisconnectPreview(await invoke('sync_disconnect_preview', { profileId }))
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : String(cause), 'destructive')
    } finally {
      setDisconnectBusy(false)
    }
  }

  async function removeLibraryFromSkiller() {
    if (!disconnectPreview) return
    setDisconnectBusy(true)
    try {
      await invoke('sync_disconnect_apply', { profileId: disconnectPreview.profile_id, planId: disconnectPreview.plan_id })
      const nextProfiles = await invoke('list_sync_profiles')
      queryClient.setQueryData(['sync-profiles'], nextProfiles)
      setProfileId(nextProfiles[0]?.profile_id ?? null)
      setDisconnectPreview(null)
      setManagingLibraries(false)
      toast('The library was removed from Skiller. Its repository and agent folders were not changed.')
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : String(cause), 'destructive')
    } finally {
      setDisconnectBusy(false)
    }
  }
  const overview = useQuery<DotagentsResourceOverviewJson>({
    queryKey: ['dotagents-resource-overview', profileId],
    queryFn: () => invoke('dotagents_resource_overview', { profileId: profileId! }),
    enabled: Boolean(profileId),
    refetchOnWindowFocus: 'always',
  })
  const health = useQuery<DotagentsLibraryHealthJson>({
    queryKey: ['dotagents-library-health', profileId],
    queryFn: () => invoke('dotagents_library_health', { profileId: profileId! }),
    enabled: Boolean(profileId),
    refetchOnWindowFocus: 'always',
  })
  const localChanges = useQuery<DotagentsLibraryLocalChangesJson>({
    queryKey: ['dotagents-library-local-changes', profileId],
    queryFn: () => invoke('dotagents_library_local_changes', { profileId: profileId! }),
    enabled: Boolean(profileId),
    staleTime: 30_000,
    // This is a local filesystem comparison, not a remote poll. It is safe to
    // refresh quietly whenever Agent Library regains focus.
    refetchOnWindowFocus: 'always',
  })
  const recovery = useQuery<{ pending: boolean; operations: Array<{ kind: 'restore' | 'library-update'; item_count: number | null; changed_item_count: number | null }> }>({
    queryKey: ['sync-recovery', profileId],
    queryFn: () => invoke('sync_recovery_status', { profileId: profileId! }),
    enabled: Boolean(profileId),
    refetchOnWindowFocus: 'always',
  })
  const refreshLibraryState = useCallback(async ({ foreground = false }: { foreground?: boolean } = {}) => {
    if (!profileId) return
    // Window focus and visibility events commonly arrive together. One remote
    // comparison is enough; never create a second visible "checking" state.
    if (statusRefreshRequestRef.current) return
    const requestId = crypto.randomUUID()
    statusRefreshRequestRef.current = requestId
    if (foreground) setStatusRefreshBusy(true)
    try {
      // A remote check is the only operation represented by this affordance.
      // Content/health reads can be noticeably slower on a large library, so
      // never make the visible "Checking" state wait for them as well.
      const nextProfiles = await invoke('refresh_sync_profiles', { requestId })
      if (statusRefreshRequestRef.current !== requestId) return
      queryClient.setQueryData(['sync-profiles'], nextProfiles)
      void queryClient.invalidateQueries({ queryKey: ['dotagents-resource-overview', profileId] })
      void queryClient.invalidateQueries({ queryKey: ['dotagents-library-health', profileId] })
      void queryClient.invalidateQueries({ queryKey: ['dotagents-library-local-changes', profileId] })
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        toast(cause instanceof Error ? cause.message : String(cause), 'destructive')
      }
    } finally {
      if (statusRefreshRequestRef.current === requestId) {
        statusRefreshRequestRef.current = null
        if (foreground) setStatusRefreshBusy(false)
      }
    }
  }, [profileId, queryClient, toast])

  function cancelStatusRefresh() {
    const requestId = statusRefreshRequestRef.current
    if (!requestId) return
    statusRefreshRequestRef.current = null
    setStatusRefreshBusy(false)
    void invoke('sync_library_check_cancel', { requestId })
    toast('Check stopped. Nothing in your library changed.')
  }
  useEffect(() => {
    if (!profileId) return
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'visible') return
      // This is Git-client-style background freshness checking, not an action
      // the user initiated. Avoid re-checking every time a browser window gains
      // focus while still refreshing after a meaningful time away.
      if (Date.now() - lastBackgroundRefreshAtRef.current < 60_000) return
      lastBackgroundRefreshAtRef.current = Date.now()
      void refreshLibraryState()
    }
    lastBackgroundRefreshAtRef.current = Date.now()
    void refreshLibraryState()
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      // A page change must not leave a network/Git comparison running with no
      // visible status or cancellation affordance. This only aborts the
      // read-only check; it can never discard library data or undo a save.
      const requestId = statusRefreshRequestRef.current
      if (requestId) {
        statusRefreshRequestRef.current = null
        void invoke('sync_library_check_cancel', { requestId })
      }
    }
  }, [profileId, refreshLibraryState])

  useEffect(() => () => {
    // The review itself is also a cancellable, no-write comparison. Keep the
    // same guarantee when Agent Library unmounts mid-review.
    const requestId = remoteReviewRequestRef.current
    if (requestId) {
      remoteReviewRequestRef.current = null
      void invoke('sync_library_check_cancel', { requestId })
    }
  }, [])
	const visible = useMemo<LibraryListEntry[]>(() => {
		const normalizedSearch = search.trim().toLocaleLowerCase()
    const changesById = new Map((localChanges.data?.changes ?? []).map((change) => [change.id, change]))
    const resources = overview.data?.resources ?? []
    const knownIds = new Set(resources.map((resource) => resource.id))
    const resourceRows = resources.map((resource) => ({ key: resource.key, resource, change: changesById.get(resource.id) }))
    // Git clients put actionable work before the clean tree. Keep that order
    // even in the all-items view so no separate "show changes" mode is needed.
    const rows: LibraryListEntry[] = [
      ...resourceRows.filter((entry) => entry.change),
      ...(localChanges.data?.changes ?? [])
        .filter((change) => !knownIds.has(change.id))
        .map((change) => ({ key: `local-change:${change.kind}:${change.id}`, change })),
      ...resourceRows.filter((entry) => !entry.change),
    ]

		return rows.filter((entry) => {
      const resource = entry.resource
      const change = entry.change
      const matchesFilter = filter === 'all'
        || (filter === 'changes' ? Boolean(change) : resource?.kind === filter)
      const searchable = resource
        ? `${resource.id} ${resource.path} ${resource.kind} ${change?.kind ?? ''}`
        : `${change?.display_name ?? ''} ${change?.detail ?? ''} ${change?.kind ?? ''}`
      return matchesFilter && (!normalizedSearch || searchable.toLocaleLowerCase().includes(normalizedSearch))
    })
	}, [filter, localChanges.data?.changes, overview.data?.resources, search])
	useEffect(() => {
    const selected = visible.find((entry) => entry.resource?.key === selectedResourceKey || entry.key === selectedChangeKey)
		if (selected) return
		const first = visible[0]
		setSelectedResourceKey(first?.resource?.key ?? null)
		setSelectedChangeKey(first?.change ? first.key : first?.resource ? null : first?.key ?? null)
		setSelectedResourceFile(first?.resource?.kind === 'skill' && !first.change ? 'SKILL.md' : null)
	}, [selectedChangeKey, selectedResourceKey, visible])
	const selectedResource = useMemo(() => overview.data?.resources.find((resource) => resource.key === selectedResourceKey) ?? null, [overview.data?.resources, selectedResourceKey])
	const selectedLocalChange = useMemo(() => visible.find((entry) => entry.key === selectedChangeKey)?.change ?? null, [selectedChangeKey, visible])
	// First fetch the real changed-file tree. Do not invent SKILL.md while this
	// is pending: a change can be an asset or a reference file instead.
	const localChangeSummary = useQuery<DotagentsLibraryLocalChangePreviewJson>({
		queryKey: ['dotagents-library-local-change-summary', profileId, selectedLocalChange?.id],
		queryFn: () => invoke('dotagents_library_local_change_preview', { profileId: profileId!, skillId: selectedLocalChange!.id }),
		enabled: Boolean(profileId && selectedLocalChange),
		staleTime: 20_000,
	})
	const localChangeFilePreview = useQuery<DotagentsLibraryLocalChangePreviewJson>({
		queryKey: ['dotagents-library-local-change-file', profileId, selectedLocalChange?.id, selectedResourceFile],
		queryFn: () => invoke('dotagents_library_local_change_preview', { profileId: profileId!, skillId: selectedLocalChange!.id, file: selectedResourceFile! }),
		enabled: Boolean(profileId && selectedLocalChange && selectedResourceFile && localChangeSummary.data),
		staleTime: 20_000,
	})
	useEffect(() => {
		if (!profileId || !localChanges.data?.changes.length) return
		let cancelled = false
		const timeout = window.setTimeout(() => {
			void (async () => {
				// Change reviews are normally read in sequence. Warm the compact tree
				// and its first changed file while the user is looking at the list,
				// one item at a time so the Electron main process stays responsive.
				for (const change of localChanges.data!.changes.slice(0, 24)) {
					if (cancelled) return
					let summary: DotagentsLibraryLocalChangePreviewJson
					try {
						summary = await queryClient.fetchQuery({
							queryKey: ['dotagents-library-local-change-summary', profileId, change.id],
							queryFn: () => invoke('dotagents_library_local_change_preview', { profileId, skillId: change.id }),
							staleTime: 20_000,
						})
					} catch {
						// The selected item will show its normal per-item error. One
						// unreadable change must not stop warming the rest of the list.
						continue
					}
					if (cancelled) return
					const comparison = summary.comparison
					const firstFile = comparison
						? [...comparison.changed_files, ...comparison.only_on_computer, ...comparison.only_in_library][0]
						: summary.local_files[0]
					if (!firstFile) continue
					try {
						await queryClient.prefetchQuery({
							queryKey: ['dotagents-library-local-change-file', profileId, change.id, firstFile],
							queryFn: () => invoke('dotagents_library_local_change_preview', { profileId, skillId: change.id, file: firstFile }),
							staleTime: 20_000,
						})
					} catch {
						// See the per-file state when the user opens it.
					}
				}
			})()
		}, 250)
		return () => { cancelled = true; window.clearTimeout(timeout) }
	}, [localChanges.data?.changes, profileId, queryClient])
	const resourceContent = useQuery<DotagentsResourceContentJson>({
		queryKey: ['dotagents-resource-content', profileId, selectedResourceKey, selectedResourceFile],
		queryFn: () => invoke('dotagents_resource_content', { profileId: profileId!, key: selectedResourceKey!, ...(selectedResourceFile ? { file: selectedResourceFile } : {}) }),
		// A changed item is rendered from its comparison. Requesting its ordinary
		// file content as well made every file click wait for two IPC calls and
		// briefly replaced the current comparison with a skeleton.
		enabled: Boolean(profileId && selectedResourceKey && !selectedLocalChange),
		staleTime: 60_000,
		refetchOnWindowFocus: false,
	})
	useEffect(() => {
		if (!resourceContent.data) return
		setFilesByResourceKey((current) => current[resourceContent.data!.key]?.join('\0') === resourceContent.data!.files.join('\0') ? current : { ...current, [resourceContent.data!.key]: resourceContent.data!.files })
	}, [resourceContent.data])
	const selectedFiles = useMemo(() => {
		const comparison = localChangeSummary.data?.comparison
		if (comparison) return [
			...comparison.changed_files.map((path) => ({ path, status: 'modified' as const })),
			...comparison.only_on_computer.map((path) => ({ path, status: 'added' as const })),
			...comparison.only_in_library.map((path) => ({ path, status: 'deleted' as const })),
		]
		if (selectedLocalChange) {
			if (localChangeSummary.data?.local_files.length) return localChangeSummary.data.local_files.map((path) => ({ path, status: 'added' as const }))
			// The comparison has not arrived yet. A changed item is not guaranteed to
			// contain SKILL.md (it can be an asset-only or deleted resource), so keep
			// the file pane empty and render its loading skeleton instead of guessing.
			return []
		}
		const knownFiles = selectedResource ? filesByResourceKey[selectedResource.key] : undefined
		// A clean portable skill always has SKILL.md; its regular content preview is
		// independent from the change-comparison loading state above.
		return (knownFiles ?? (selectedResource?.kind === 'skill' ? ['SKILL.md'] : [])).map((path) => ({ path, status: null }))
	}, [filesByResourceKey, localChangeSummary.data?.comparison, localChangeSummary.data?.local_files, selectedLocalChange, selectedResource])
	useEffect(() => {
		if (selectedFiles.length === 0) return
		if (!selectedResourceFile || !selectedFiles.some((file) => file.path === selectedResourceFile)) setSelectedResourceFile(selectedFiles[0]!.path)
	}, [selectedFiles, selectedResourceFile])
	const deferredResourceContent = useDeferredValue(resourceContent.data)
	const resourceContentIsStale = Boolean(resourceContent.data && deferredResourceContent?.content_path !== resourceContent.data.content_path)
  const counts = useMemo(() => Object.fromEntries(kinds.map(({ kind }) => [kind, overview.data?.resources.filter((entry) => entry.kind === kind).length ?? 0])), [overview.data?.resources])
  const libraryEmpty = overview.isSuccess && overview.data.resources.length === 0
  const localChangeCount = localChanges.data?.changes.length ?? 0
  const profile = profiles.data?.find((candidate) => candidate.profile_id === profileId) ?? profiles.data?.[0] ?? null
  const selectedReviewableChange = selectedLocalChange
    && (selectedLocalChange.kind === 'new-local' || (profile?.mode === 'private' && selectedLocalChange.kind === 'changed-local'))
    ? selectedLocalChange
    : null
  const remoteLibraryUrl = profile?.remote_identity && /^https?:\/\//i.test(profile.remote_identity) ? profile.remote_identity : null
  const repairableCodes = useMemo(
    () => [...new Set((health.data?.issues ?? []).filter((issue) => issue.repairable).map((issue) => issue.code))],
    [health.data?.issues],
  )
  useEffect(() => {
    setRepairPreview(null)
    setRepairError(null)
    setRepairBusy('idle')
  }, [profileId])

  async function reviewNewLocalChanges(skillIds = selectedNewLocalIds) {
    if (!profileId || skillIds.length === 0) return
    setSelectedNewLocalIds(skillIds)
    setSyncBusy('reviewing')
    try {
      setNewLocalPreview(await invoke('dotagents_library_new_local_preview', { profileId, skillIds }))
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : String(cause), 'destructive')
    } finally {
      setSyncBusy('idle')
    }
  }

  async function saveReviewedNewLocalChanges() {
    if (!profileId || !newLocalPreview) return
    setSyncBusy('saving')
    try {
      await invoke('dotagents_library_new_local_apply', { profileId, planId: newLocalPreview.plan_id })
      const savedCount = newLocalPreview.skills.length + newLocalPreview.linked_skills.length
      const savedSummary = [
        newLocalPreview.skills.length > 0 && `${newLocalPreview.skills.length} saved as ${newLocalPreview.skills.length === 1 ? 'a copy' : 'copies'}`,
        newLocalPreview.linked_skills.length > 0 && `${newLocalPreview.linked_skills.length} kept linked to source`,
      ].filter(Boolean).join(' · ')
      const changedCount = newLocalPreview.updated_skill_ids.length
      const action = changedCount > 0
        ? `${savedCount} ${savedCount === 1 ? 'skill was' : 'skills were'} saved to your library (${changedCount} ${changedCount === 1 ? 'updated' : 'updated'})`
        : `${savedCount} ${savedCount === 1 ? 'skill was' : 'skills were'} added to your library`
      toast(`${action}${savedSummary ? `: ${savedSummary}.` : '.'}`)
      setNewLocalPreview(null)
      setSelectedNewLocalIds([])
      setFilter('all')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sync-profiles'] }),
        queryClient.invalidateQueries({ queryKey: ['dotagents-resource-overview', profileId] }),
        queryClient.invalidateQueries({ queryKey: ['dotagents-library-local-changes', profileId] }),
      ])
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : String(cause), 'destructive')
    } finally {
      setSyncBusy('idle')
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
      toast('The reviewed local repair was applied. Its result is available in Agent Library.')
      setRepairPreview(null)
    } catch (cause) {
      setRepairError(cause instanceof Error ? cause.message : 'The reviewed library repair could not be applied.')
    } finally {
      setRepairBusy('idle')
    }
  }

  async function reviewRemoteChanges() {
    if (!profileId) return
    const requestId = crypto.randomUUID()
    remoteReviewRequestRef.current = requestId
    setSyncBusy('reviewing')
    try {
      const nextReview = await invoke('sync_three_way_review', { profileId, requestId })
      if (remoteReviewRequestRef.current !== requestId) return
      const actionable = nextReview.library_update_only || nextReview.dependency_changes.length > 0 || nextReview.skills.some((skill) => !['unchanged', 'kept-local'].includes(skill.action))
      if (!actionable) {
        setRemoteReview(null)
        refreshLibraryState()
        toast('Your library and this computer are already in sync.')
        return
      }
      setRemoteReview(nextReview)
    } catch (cause) {
      if (remoteReviewRequestRef.current !== requestId) return
      toast(cause instanceof Error ? cause.message : String(cause), 'destructive')
    } finally {
      if (remoteReviewRequestRef.current === requestId) {
        remoteReviewRequestRef.current = null
        setSyncBusy('idle')
      }
    }
  }

  function cancelRemoteReview() {
    const requestId = remoteReviewRequestRef.current
    if (!requestId) return
    remoteReviewRequestRef.current = null
    setSyncBusy('idle')
    void invoke('sync_library_check_cancel', { requestId })
    toast('Check stopped. Nothing in your library changed.')
  }

  async function refreshRemoteReview() {
    if (!profileId) return
    const nextReview = await invoke('sync_three_way_review', { profileId })
    const actionable = nextReview.library_update_only || nextReview.dependency_changes.length > 0 || nextReview.skills.some((skill) => !['unchanged', 'kept-local'].includes(skill.action))
    setRemoteReview(actionable ? nextReview : null)
    refreshLibraryState()
    if (!actionable) toast('Your library and this computer are now in sync.')
  }

  async function resolveRemoteSkill(skill: SyncThreeWayReviewJson['skills'][number], decision: 'library' | 'local' | 'keep') {
    if (!profileId || !remoteReview) return
    setSyncBusy('saving')
    try {
      const reviewParams = { profileId, skillIds: [skill.id], workspacePlanId: remoteReview.workspace_plan_id, reconciliationPlanId: remoteReview.reconciliation_plan_id }
      if (decision === 'library') {
        await invoke(skill.action === 'take-remote' ? 'sync_apply_remote_changes' : 'sync_apply_conflicting_remote_changes', reviewParams)
      } else if (decision === 'local') {
        await invoke('sync_adopt_local_changes', reviewParams)
      } else {
        await invoke(skill.kind === 'bundled' ? 'sync_keep_local_changes' : 'sync_keep_external_local_changes', reviewParams)
      }
      await refreshRemoteReview()
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : String(cause), 'destructive')
    } finally {
      setSyncBusy('idle')
    }
  }

  async function acceptMetadataOnlyUpdate() {
    if (!profileId || !remoteReview) return
    setSyncBusy('saving')
    try {
      await invoke('sync_accept_remote_library_update', { profileId, workspacePlanId: remoteReview.workspace_plan_id, reconciliationPlanId: remoteReview.reconciliation_plan_id })
      await refreshRemoteReview()
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : String(cause), 'destructive')
    } finally {
      setSyncBusy('idle')
    }
  }

  async function reviewRemoteAccess() {
    if (!profileId) return
    setSyncBusy('reviewing')
    try {
      setRemoteTrustPreview(await invoke('sync_remote_trust_preview', { profileId, minimumReleaseAgeMinutes: 7 * 24 * 60 }))
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : String(cause), 'destructive')
    } finally {
      setSyncBusy('idle')
    }
  }

  async function allowRemoteAccess() {
    if (!profileId || !remoteTrustPreview) return
    setSyncBusy('saving')
    try {
      await invoke('sync_remote_trust_apply', {
        profileId,
        planId: remoteTrustPreview.plan_id,
        minimumReleaseAgeMinutes: remoteTrustPreview.minimum_release_age_minutes,
      })
      setRemoteTrustPreview(null)
      refreshLibraryState()
      toast('This library can now check for updates on this computer.')
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : String(cause), 'destructive')
    } finally {
      setSyncBusy('idle')
    }
  }

  async function recoverInterruptedChange() {
    if (!profileId) return
    setRecoveryBusy(true)
    try {
      const result = await invoke('sync_recovery_rollback', { profileId })
      toast(result.recovered ? 'The interrupted change was safely undone.' : 'No interrupted change was found.')
      await Promise.all([
        recovery.refetch(),
        queryClient.invalidateQueries({ queryKey: ['sync-profiles'] }),
        queryClient.invalidateQueries({ queryKey: ['dotagents-resource-overview', profileId] }),
      ])
      refreshLibraryState()
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : String(cause), 'destructive')
    } finally {
      setRecoveryBusy(false)
    }
  }

  const initialLocalCheckPending = Boolean(profileId && localChanges.isLoading && !localChanges.data)
  const syncStatus = useMemo(() => {
    if (initialLocalCheckPending) return { label: 'Checking changes on this computer', tone: 'text-muted-foreground', kind: 'checking' as const }
    if ((localChanges.data?.changes.length ?? 0) > 0) return { label: `${localChanges.data!.changes.length} ${localChanges.data!.changes.length === 1 ? 'change needs' : 'changes need'} review`, tone: 'text-amber-700 dark:text-amber-300', kind: 'local' as const }
    if (profile?.remote_trust_required) return { label: 'Review remote access', tone: 'text-amber-700 dark:text-amber-300', kind: 'remote' as const }
    if (profile?.check_error) return { label: 'Could not check for updates', tone: 'text-amber-700 dark:text-amber-300', kind: 'check-error' as const }
    if (overview.data?.changed || profile?.changed) return { label: 'Local changes found', tone: 'text-amber-700 dark:text-amber-300', kind: 'local' as const }
    if ((profile?.ahead ?? 0) > 0) return { label: `${profile!.ahead} ${profile!.ahead === 1 ? 'change is' : 'changes are'} waiting to upload`, tone: 'text-amber-700 dark:text-amber-300', kind: 'local' as const }
    if ((profile?.behind ?? 0) > 0) return { label: `${profile!.behind} ${profile!.behind === 1 ? 'update is' : 'updates are'} ready to review`, tone: 'text-primary', kind: 'remote' as const }
    return { label: 'Up to date on this computer', tone: 'text-emerald-700 dark:text-emerald-300', kind: 'fresh' as const }
  }, [initialLocalCheckPending, localChanges.data?.changes.length, overview.data?.changed, profile])
  const syncActionLabel = statusRefreshBusy
    ? 'Stop checking'
    : syncBusy === 'reviewing' && remoteReviewRequestRef.current
      ? 'Stop checking'
      : syncBusy === 'reviewing'
        ? 'Reviewing…'
        : profile?.remote_trust_required
            ? 'Review access'
            : syncStatus.kind === 'remote'
              ? 'Review updates'
        : syncStatus.kind === 'check-error'
                ? 'Check again'
                : 'Sync with library'
  const showSyncAction = statusRefreshBusy
    || (syncBusy === 'reviewing' && Boolean(remoteReviewRequestRef.current))
    || (syncStatus.kind !== 'fresh' && syncStatus.kind !== 'checking' && syncStatus.kind !== 'local')

  if (addingLibrary) {
    return <SyncCenter embedded allowExisting onComplete={(createdProfileId) => {
      setProfileId(createdProfileId)
      setAddingLibrary(false)
    }} onClose={() => setAddingLibrary(false)} />
  }

  if (!profiles.isLoading && (profiles.data?.length ?? 0) === 0) {
    return <SyncCenter embedded />
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border/70 px-6 pb-5 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <LibraryBig className="size-5 text-primary" aria-hidden="true" />
            <h1 className="text-[clamp(1.35rem,2.2vw,1.85rem)] font-semibold leading-tight tracking-[-0.045em]">Agent Library</h1>
          </div>
          <div className="flex items-center gap-2">
            {(profiles.data?.length ?? 0) > 1 && (
              <label className="relative"><span className="sr-only">Active library</span><select value={profileId ?? ''} onChange={(event) => void chooseActiveLibrary(event.target.value)} className="h-9 appearance-none rounded-md border border-border bg-background pl-3 pr-8 text-xs font-medium outline-none focus:ring-2 focus:ring-ring/40">{profiles.data?.map((profile) => <option key={profile.profile_id} value={profile.profile_id}>{libraryDisplayName(profile)}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /></label>
            )}
            <Button size="sm" variant="outline" className="h-9 px-3" onClick={() => { setDisconnectPreview(null); setManagingLibraries(true) }}>Manage libraries</Button>
            <Button size="sm" variant="outline" className="h-9 px-3" onClick={() => setAddingLibrary(true)}>Add library</Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
            {profile && <span>{profile.mode === 'public' ? 'Public' : profile.mode === 'team' ? 'Team' : 'Private'} library ·</span>}
            {profile && (remoteLibraryUrl ? (
              <Tooltip content={`Open ${remoteLibraryUrl} in browser`}>
              <button
                type="button"
                onClick={() => openUrl(remoteLibraryUrl)}
                className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {libraryDisplayName(profile)}
              </button>
              </Tooltip>
            ) : <span>{libraryDisplayName(profile)}</span>)}
            {profile && <span aria-hidden="true">·</span>}
            <span>{overview.data?.resources.length ?? 0} items</span>
            <span aria-hidden="true">·</span>
            <span className={cn('inline-flex items-center gap-1.5 font-medium', statusRefreshBusy ? 'text-muted-foreground' : syncStatus.tone)}>{statusRefreshBusy || syncStatus.kind === 'checking' ? <Loader2 className="size-3.5 animate-spin" /> : syncStatus.kind === 'fresh' ? <CheckCircle2 className="size-3.5" /> : <span className="size-1.5 rounded-full bg-current" />}{statusRefreshBusy ? 'Checking saved library' : syncStatus.label}</span>
            {showSyncAction && (
              <button
                type="button"
                onClick={() => statusRefreshBusy ? cancelStatusRefresh() : syncBusy === 'reviewing' && remoteReviewRequestRef.current ? cancelRemoteReview() : profile?.remote_trust_required ? void reviewRemoteAccess() : syncStatus.kind === 'remote' ? void reviewRemoteChanges() : void refreshLibraryState({ foreground: true })}
                disabled={syncBusy !== 'idle' && !remoteReviewRequestRef.current && !statusRefreshBusy}
                className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {statusRefreshBusy ? <Loader2 className="size-3 animate-spin" /> : <Cloud className="size-3" />}
                {syncActionLabel}
              </button>
            )}
          </div>
          <div className="w-full sm:w-56 sm:shrink-0">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search library"
              debounce={0}
            />
          </div>
        </div>
      </header>

      {profile?.check_error && !statusRefreshBusy && (
        <section className="shrink-0 border-b border-amber-500/25 bg-amber-500/[0.055] px-6 py-3" aria-label="Library update check needs attention">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex min-w-0 items-center gap-2 text-amber-800 dark:text-amber-200"><AlertTriangle className="size-3.5 shrink-0" /><span><strong>Updates were not checked.</strong> {profile.check_error}</span></div>
            <Button size="xs" variant="outline" className="shrink-0 border-amber-500/30 bg-background/70" onClick={() => void refreshLibraryState({ foreground: true })}>Check again</Button>
          </div>
        </section>
      )}

      {syncBusy === 'reviewing' && remoteReviewRequestRef.current && (
        <section className="shrink-0 border-b border-border/70 bg-muted/25 px-6 py-3" role="status" aria-live="polite">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin text-primary" /><span><strong className="text-foreground">Checking your library.</strong> Comparing this computer with the saved library. Nothing changes while this runs.</span></div>
        </section>
      )}

      {remoteTrustPreview && (
        <section className="shrink-0 border-b border-amber-500/25 bg-amber-500/[0.055] px-6 py-4" aria-label="Allow library updates">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Allow this library to check for updates?</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Skiller will remember this exact address on this computer. It will not download, install, upload, or change anything yet.</p>
              <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground hover:underline">Library address and safety policy</summary><p className="mt-2 break-all font-mono text-[11px]">{remoteTrustPreview.remote_identity}</p><p className="mt-1">Newly published updates wait 7 days before they can be applied.</p></details>
            </div>
            <div className="flex shrink-0 items-center gap-2"><Button size="sm" variant="ghost" onClick={() => setRemoteTrustPreview(null)} disabled={syncBusy !== 'idle'}>Not now</Button><Button size="sm" onClick={() => void allowRemoteAccess()} disabled={syncBusy !== 'idle'}>{syncBusy === 'saving' ? <><Loader2 className="size-3.5 animate-spin" />Allowing…</> : 'Allow updates'}</Button></div>
          </div>
        </section>
      )}

      {recovery.data?.pending && (
        <section className="shrink-0 border-b border-amber-500/25 bg-amber-500/[0.055] px-6 py-4" aria-label="Recover interrupted library change">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-500/12 text-amber-700 dark:text-amber-300"><AlertTriangle className="size-4" /></span><div><p className="text-sm font-semibold">A library change was interrupted</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Skiller paused this library before continuing. Undo returns only the interrupted items to their safe checkpoint; your remote library and unrelated files stay unchanged.</p></div></div>
            <Button size="sm" variant="outline" onClick={() => void recoverInterruptedChange()} disabled={recoveryBusy}>{recoveryBusy ? <><Loader2 className="size-3.5 animate-spin" />Undoing…</> : 'Undo interrupted change'}</Button>
          </div>
        </section>
      )}

      {remoteReview && (
        <section className="shrink-0 border-b border-primary/20 bg-primary/[0.045] px-6 py-4" aria-label="Review library updates">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Review library updates</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Your library was checked before this review. Nothing on this computer changes until you choose what to apply.</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setRemoteReview(null)}>Close review</Button>
          </div>
          {remoteReview.library_update_only && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/70 px-3 py-2.5 text-xs"><div><strong>Library notes changed.</strong> Your skills on this computer were not part of this update.{remoteReview.library_update_files.length > 0 && <span className="ml-1 text-muted-foreground">{remoteReview.library_update_files.join(', ')}</span>}</div><Button size="xs" onClick={() => void acceptMetadataOnlyUpdate()} disabled={syncBusy !== 'idle'}>{syncBusy === 'saving' ? 'Updating…' : 'Update library notes'}</Button></div>}
          {!remoteReview.library_update_only && remoteReview.dependency_changes.length > 0 && remoteReview.skills.every((skill) => ['unchanged', 'kept-local'].includes(skill.action)) && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/70 px-3 py-2.5 text-xs"><span><strong>Only the library record changed.</strong> Your installed files are identical.</span><Button size="xs" onClick={() => void acceptMetadataOnlyUpdate()} disabled={syncBusy !== 'idle'}>{syncBusy === 'saving' ? 'Updating…' : 'Update library record'}</Button></div>}
          <div className="mt-3 max-h-56 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border/70 bg-background/70">
            {remoteReview.skills.filter((skill) => !['unchanged', 'kept-local'].includes(skill.action)).map((skill) => {
              const needsDecision = skill.action === 'conflict' || skill.action === 'unmanaged'
              return <div key={skill.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3"><div className="min-w-0"><p className="text-xs font-semibold">{skill.id}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{needsDecision ? 'The library and this computer differ. Choose deliberately.' : skill.action === 'take-remote' ? 'A reviewed library version is ready for this computer.' : 'A local improvement is ready to save to the library.'}</p></div><div className="flex shrink-0 flex-wrap gap-1.5">{skill.action === 'take-remote' ? <Button size="xs" onClick={() => void resolveRemoteSkill(skill, 'library')} disabled={syncBusy !== 'idle'}>Use library version</Button> : skill.action === 'publish-local' ? <Button size="xs" onClick={() => void resolveRemoteSkill(skill, 'local')} disabled={syncBusy !== 'idle'}>Save local version</Button> : <><Button size="xs" variant="outline" onClick={() => void resolveRemoteSkill(skill, 'library')} disabled={syncBusy !== 'idle'}>Use library</Button><Button size="xs" variant="outline" onClick={() => void resolveRemoteSkill(skill, 'local')} disabled={syncBusy !== 'idle'}>Save local</Button><Button size="xs" variant="ghost" onClick={() => void resolveRemoteSkill(skill, 'keep')} disabled={syncBusy !== 'idle'}>Keep both</Button></>}</div></div>
            })}
          </div>
        </section>
      )}

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

		<div className="flex min-h-0 flex-1 flex-col">
				<div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 px-6 py-3">
					<div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter library by type">
						<button type="button" onClick={() => setFilter('all')} className={cn('rounded-md px-2.5 py-1 text-xs font-medium transition-colors', filter === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>All items <span className="ml-1 opacity-75">{(overview.data?.resources.length ?? 0) + (localChanges.data?.changes.filter((change) => !overview.data?.resources.some((resource) => resource.id === change.id)).length ?? 0)}</span></button>
						<button type="button" onClick={() => { setFilter('changes'); setNewLocalPreview(null) }} className={cn('rounded-md px-2.5 py-1 text-xs font-medium transition-colors', filter === 'changes' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>Changes <span className="ml-1 opacity-75">{localChangeCount}</span></button>
						{kinds.map(({ kind: value, label }) => <button key={value} type="button" onClick={() => setFilter(value)} className={cn('rounded-md px-2.5 py-1 text-xs font-medium transition-colors', filter === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>{label}<span className="ml-1 opacity-75">{counts[value] ?? 0}</span></button>)}
					</div>
				</div>
				{localChangeCount > 0 && selectedNewLocalIds.length > 0 && !newLocalPreview && <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-muted/20 px-6 py-2.5 text-xs">
          <p className="text-muted-foreground">{selectedNewLocalIds.length} {selectedNewLocalIds.length === 1 ? 'item is' : 'items are'} selected. You will confirm the exact plan before anything is saved.</p>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="xs" onClick={() => void reviewNewLocalChanges()} disabled={syncBusy !== 'idle'}>{syncBusy === 'reviewing' ? <><Loader2 className="size-3.5 animate-spin" />Preparing…</> : <><Cloud className="size-3.5" />Save {selectedNewLocalIds.length} selected</>}</Button>
          </div>
        </div>}
				<div className="flex min-h-0 flex-1 flex-col lg:flex-row">
					<div className="relative min-h-0 min-w-0 flex-1 max-lg:max-h-[44%] max-lg:flex-none lg:w-[clamp(22rem,32vw,28rem)] lg:flex-none">
            <div ref={resourceListScrollRef} className="h-full min-h-0 overflow-y-auto">
          {overview.isError ? (
            <div className="grid min-h-72 place-items-center text-center"><div><AlertTriangle className="mx-auto size-7 text-red-500" /><p className="mt-3 text-sm font-medium">Agent Library could not be loaded</p><p className="mt-1 text-xs text-muted-foreground">Nothing changed. Retry the local library review.</p><Button size="sm" variant="outline" className="mt-4" onClick={() => overview.refetch()}>Try again</Button></div></div>
						) : overview.isLoading || initialLocalCheckPending ? Array.from({ length: 7 }).map((_, index) => <div key={index} className="flex animate-pulse items-center gap-3 border-b border-border/60 px-4 py-3.5"><div className="size-9 rounded-lg bg-muted" /><div className="space-y-2"><div className="h-3 w-36 rounded bg-muted" /><div className="h-2.5 w-52 rounded bg-muted/60" /></div></div>) : visible.length === 0 ? (
							<div className="grid min-h-72 place-items-center text-center"><div><LibraryBig className="mx-auto size-7 text-muted-foreground/50" /><p className="mt-3 text-sm font-medium">No {filter === 'all' ? 'library items' : filter === 'changes' ? 'changes' : `${filter}s`} here yet</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{libraryEmpty ? 'Skiller will show agent content here after you review and save changes found on this computer.' : `This library has no ${filter === 'changes' ? 'changes' : filter} items matching the current view.`}</p></div></div>
						) : visible.map((entry, index) => {
              const resource = entry.resource
              const change = entry.change
              const definition = kinds.find((item) => item.kind === resource?.kind) ?? kinds[0]
              const Icon = definition.icon
              const selected = resource ? resource.key === selectedResourceKey : entry.key === selectedChangeKey
              // Like GitHub's Files changed view, review controls live beside the
              // changed item in the main list. The Changes filter only narrows
              // focus; it must not be a required detour before taking action.
              const reviewableChange = change && (change.kind === 'new-local' || (profile?.mode === 'private' && change.kind === 'changed-local')) ? change : null
              const statusCode = change?.kind === 'new-local' ? '??' : change?.kind === 'changed-local' ? 'M' : change?.kind === 'missing-local' ? 'D' : null
              const statusLabel = change?.kind === 'new-local' ? 'New' : statusCode
              const previous = visible[index - 1]
              const showsChangeGroups = filter === 'all' || filter === 'changes'
              const startsTrackedChanges = showsChangeGroups
                && Boolean(change)
                && change?.kind !== 'new-local'
                && (!previous?.change || previous.change.kind === 'new-local')
              const startsUntracked = showsChangeGroups
                && change?.kind === 'new-local'
                && previous?.change?.kind !== 'new-local'
              const startsCleanLibrary = filter === 'all' && !change && Boolean(previous?.change)
							return <div key={entry.key}>
                  {startsTrackedChanges && <div className="flex items-center gap-2 border-b border-border/60 bg-muted/[0.18] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"><FileDiff className="size-3" />Changes</div>}
                  {startsUntracked && <div className="flex items-center gap-2 border-b border-border/60 bg-muted/[0.18] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"><FileText className="size-3" />New on this computer</div>}
                  {startsCleanLibrary && <div className="flex items-center gap-2 border-b border-border/60 bg-muted/[0.18] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"><CheckCircle2 className="size-3" />Library</div>}
					<button type="button" onClick={() => { setSelectedResourceKey(resource?.key ?? null); setSelectedChangeKey(change ? entry.key : null); setSelectedResourceFile(resource?.kind === 'skill' && !change ? 'SKILL.md' : null) }} className={cn('relative flex w-full items-center gap-3 border-b border-border/60 px-4 py-3.5 text-left transition-colors', selected ? 'bg-primary/[0.12] shadow-[inset_3px_0_0_hsl(var(--primary))]' : 'hover:bg-muted/30')}>
                    {reviewableChange ? <label className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-muted/50" onClick={(event) => event.stopPropagation()}><input type="checkbox" className="cursor-pointer" checked={selectedNewLocalIds.includes(reviewableChange.id)} onChange={() => setSelectedNewLocalIds((current) => current.includes(reviewableChange.id) ? current.filter((id) => id !== reviewableChange.id) : [...current, reviewableChange.id])} aria-label={`Include ${reviewableChange.display_name}`} /></label> : <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/[0.07] text-primary"><Icon className="size-4" /></span>}
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{resource?.id ?? change?.display_name}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{resource?.path ?? 'skills/' + (change?.id ?? '')}</p></div>
                    <div className="flex shrink-0 items-center gap-1.5">{statusCode && <Tooltip content={change?.kind === 'new-local' ? 'New on this computer' : change?.kind === 'changed-local' ? 'Changed on this computer' : 'No longer on this computer'}><span className={cn('grid min-w-6 place-items-center rounded-md px-1.5 py-1 font-mono text-[10px] font-semibold', statusCode === '??' ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' : statusCode === 'D' ? 'bg-destructive/12 text-destructive' : 'bg-amber-500/15 text-amber-800 dark:text-amber-200')}>{statusLabel}</span></Tooltip>}<span className="rounded-md bg-muted/60 px-2 py-1 text-[10px] font-medium text-muted-foreground">{definition.label}</span></div>
                  </button>
                </div>
            })}
						</div>
							<ScrollFade viewportRef={resourceListScrollRef} />
					</div>
						<aside className="flex min-h-0 flex-1 flex-col border-t border-border/70 lg:w-[54%] lg:border-l lg:border-t-0">
              {(selectedResource || selectedLocalChange) ? <>
                <div className="shrink-0 border-b border-border/70 px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{selectedResource?.id ?? selectedLocalChange?.display_name}</p>
                      <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{selectedResource?.path ?? selectedLocalChange?.detail}</p>
                      {selectedResource && <p className="mt-1 text-[10px] text-muted-foreground">Source: {selectedResource.source_url ? <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => openUrl(selectedResource.source_url!)}>{selectedResource.source_label}</button> : selectedResource.source_label}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {selectedReviewableChange && (
                        <Button
                          size="xs"
                          onClick={() => void reviewNewLocalChanges([selectedReviewableChange.id])}
                          disabled={syncBusy !== 'idle'}
                        >
                          {syncBusy === 'reviewing' ? <><Loader2 className="size-3.5 animate-spin" />Preparing…</> : <><Cloud className="size-3.5" />Save to library</>}
                        </Button>
                      )}
                      {selectedLocalChange ? <Tooltip content={selectedLocalChange.kind === 'new-local' ? 'New on this computer' : selectedLocalChange.kind === 'changed-local' ? 'Changed on this computer' : 'No longer on this computer'}><span className="rounded-md bg-muted/60 px-2 py-1 font-mono text-[10px] font-semibold text-muted-foreground">{selectedLocalChange.kind === 'new-local' ? 'New' : selectedLocalChange.kind === 'changed-local' ? 'M' : 'D'}</span></Tooltip> : <span className="rounded-md bg-muted/60 px-2 py-1 text-[10px] font-medium text-muted-foreground">{kinds.find((item) => item.kind === selectedResource?.kind)?.label}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex min-h-0 flex-1">
                  <nav className="w-44 shrink-0 overflow-y-auto border-r border-border/70 bg-muted/[0.16] py-2" aria-label="Files in selected library item">
                    <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Files</p>
					{selectedFiles.length === 0 && (selectedLocalChange ? localChangeSummary.isLoading : resourceContent.isLoading) ? <div className="space-y-2 px-3 py-2.5 animate-pulse"><div className="h-3 w-24 rounded bg-muted" /><div className="h-3 w-16 rounded bg-muted/70" /></div> : selectedFiles.length === 0 ? <p className="px-3 py-2 text-[11px] text-muted-foreground">No changed files to preview</p> : null}
                    {selectedFiles.map((file) => <button key={`${file.status ?? 'clean'}:${file.path}`} type="button" onClick={() => setSelectedResourceFile(file.path)} className={cn('flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[11px] transition-colors', selectedResourceFile === file.path ? 'bg-primary/[0.12] text-foreground' : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground')}>
                      {file.status ? <Tooltip content={file.status === 'modified' ? 'Changed' : file.status === 'added' ? 'New' : 'Removed'}><span className={cn('grid size-4 shrink-0 place-items-center rounded text-[9px] font-sans font-bold', file.status === 'deleted' ? 'bg-destructive/12 text-destructive' : file.status === 'added' ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-800 dark:text-amber-200')}>{file.status === 'modified' ? 'M' : file.status === 'added' ? 'A' : 'D'}</span></Tooltip> : /(?:png|jpe?g|gif|webp)$/i.test(file.path) ? <Image className="size-3.5 shrink-0" /> : <FileText className="size-3.5 shrink-0" />}
                      <span className="min-w-0 truncate">{file.path}</span>
                    </button>)}
                  </nav>
                  <div className="min-w-0 flex-1 overflow-y-auto px-5 py-5">
					{(selectedLocalChange ? localChangeSummary.isLoading || !selectedResourceFile || localChangeFilePreview.isLoading : resourceContent.isLoading || resourceContentIsStale) ? <div className="space-y-3 animate-pulse"><div className="h-4 w-40 rounded bg-muted" /><div className="h-3 w-full rounded bg-muted/70" /><div className="h-3 w-5/6 rounded bg-muted/70" /></div> : localChangeFilePreview.data?.file_preview ? <div>{localChangeFilePreview.data.file_preview.image_data_url ? <ImagePreview source={localChangeFilePreview.data.file_preview.image_data_url} alt={localChangeFilePreview.data.file_preview.path} /> : localChangeFilePreview.data.file_preview.diff ? <><div className="mb-3 flex items-center gap-2 text-xs font-medium"><FileDiff className="size-3.5 text-primary" />Changes in this file</div><FileChangePreview diff={localChangeFilePreview.data.file_preview.diff} /></> : <p className="rounded-lg border border-border/70 bg-muted/25 p-4 text-xs text-muted-foreground">{localChangeFilePreview.data.file_preview.unavailable_reason}</p>}</div> : resourceContent.isError ? <div className="grid min-h-48 place-items-center text-center"><div><AlertTriangle className="mx-auto size-6 text-amber-600" /><p className="mt-3 text-sm font-medium">Preview is unavailable</p><p className="mt-1 text-xs text-muted-foreground">{resourceContent.error instanceof Error ? resourceContent.error.message : 'Refresh the library and try again.'}</p></div></div> : deferredResourceContent?.image_data_url ? <ImagePreview source={deferredResourceContent.image_data_url} alt={selectedResourceFile ?? selectedResource?.id ?? 'Library image'} /> : deferredResourceContent ? <MarkdownContent content={deferredResourceContent.content} /> : <div className="grid min-h-48 place-items-center text-center text-xs text-muted-foreground">Choose a file to inspect its change.</div>}
                  </div>
                </div>
              </> : <div className="grid flex-1 place-items-center text-center text-xs text-muted-foreground">Choose a library item to inspect it.</div>}
						</aside>
				</div>
      </div>

      <ManageLibrariesDialog
        open={managingLibraries}
        libraries={profiles.data ?? []}
        activeProfileId={profileId}
        activeProfile={profile}
        disconnectPreview={disconnectPreview}
        busy={disconnectBusy}
        onClose={() => { setManagingLibraries(false); setDisconnectPreview(null) }}
        onOpenLibrary={(nextProfileId) => { void chooseActiveLibrary(nextProfileId); setManagingLibraries(false) }}
        onReviewRemoval={() => void reviewLibraryRemoval()}
        onCancelRemoval={() => setDisconnectPreview(null)}
        onRemoveLibrary={() => void removeLibraryFromSkiller()}
      />
      <SaveSelectionDialog
        preview={newLocalPreview}
        busy={syncBusy === 'saving'}
        onClose={() => setNewLocalPreview(null)}
        onConfirm={() => void saveReviewedNewLocalChanges()}
      />
    </div>
  )
}
