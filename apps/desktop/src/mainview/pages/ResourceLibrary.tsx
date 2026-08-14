import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowDown,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Copy,
  FileDiff,
  FileText,
  Github,
  Gitlab,
  LibraryBig,
  Loader2,
  MoreHorizontal,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import { Button } from '@/mainview/components/ui/button'
import { Checkbox } from '@/mainview/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/mainview/components/ui/dropdown-menu'
import { Tooltip } from '@/mainview/components/ui/tooltip'
import MarkdownContent from '@/mainview/components/MarkdownContent'
import SkillContentBrowser from '@/mainview/components/SkillContentBrowser'
import ResizeHandle from '@/mainview/components/ResizeHandle'
import SearchInput from '@/mainview/components/SearchInput'
import { ScrollFade } from '@/mainview/components/ScrollFade'
import { acknowledgeProviderCredentialDisclosure, hasAcknowledgedProviderCredentialDisclosure, providerForRemote, ProviderCredentialDisclosure, type CredentialProvider } from '@/mainview/components/ProviderCredentialDisclosure'
import { useToast } from '@/mainview/components/ToastProvider'
import { useResizable } from '@/mainview/hooks/useResizable'
import { useTransientViewState } from '@/mainview/hooks/useTransientViewState'
import { SKILL_LIST_PANE } from '@/mainview/lib/shell-chrome'
import { invoke, isAbortError, openUrl } from '@/mainview/lib/native'
import { libraryDisplayName, repositoryBrowserUrl } from '@/mainview/lib/sync-library-name'
import { cn } from '@/mainview/lib/utils'
import SyncCenter from '@/mainview/pages/SyncCenter'
import type {
  DotagentsLibraryHealthJson,
  DotagentsLibraryRepairPreviewJson,
  DotagentsResourceOverviewJson,
  DotagentsResourceContentJson,
  DotagentsLibraryLocalChangesJson,
  DotagentsLibraryLocalChangePreviewJson,
  DotagentsLibraryNewLocalPreviewJson,
  DotagentsLibraryRemovalPreviewJson,
  SyncDisconnectPreviewJson,
  SyncProfileStatusJson,
  SyncRemoteTrustPreviewJson,
  SyncThreeWayReviewJson,
} from '@/shared/rpc-schema'

type LibraryResource = DotagentsResourceOverviewJson['resources'][number]
type LocalChange = DotagentsLibraryLocalChangesJson['changes'][number]
type LibrarySection = 'changes' | 'new' | 'kept' | 'library'
type ResourceLibraryCredentialAction = 'review' | 'save-new' | 'remove'
type ProviderReconnectState = {
  provider: CredentialProvider
  requestId?: string
  userCode?: string
  error?: string
}
type LibraryListEntry = {
  key: string
  resource?: LibraryResource
  change?: LocalChange
  package?: { id: string; resources: LibraryResource[] }
  sectionHeader?: { section: LibrarySection; total: number; selectableIds: string[] }
}

function librarySectionFor(entry: LibraryListEntry): LibrarySection {
  return entry.change?.kind === 'new-local' ? 'new'
    : entry.change?.kind === 'kept-local' ? 'kept'
      : entry.change ? 'changes' : 'library'
}

function FileChangePreview({ diff }: { diff: string }) {
  const lines = diff.split('\n')
  const contentLines = lines.filter((line) => !line.startsWith('--- ') && !line.startsWith('+++ '))
  const viewportRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: contentLines.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 20,
    overscan: 16,
  })

  return <section className="overflow-hidden rounded-lg border border-border/70 bg-background" aria-label="Changes in this file">
    <div ref={viewportRef} className="max-h-[min(60dvh,48rem)] overflow-auto font-mono text-[11px] leading-5">
      <div className="relative min-w-max" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => {
        const line = contentLines[item.index] ?? ''
        const index = item.index
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
        )} style={{ position: 'absolute', left: 0, top: 0, transform: `translateY(${item.start}px)`, height: item.size }}><span className="select-none text-center opacity-70">{marker}</span><code className="whitespace-pre">{value || ' '}</code></div>
      })}
      </div>
    </div>
  </section>
}

function ImagePreview({ source, alt }: { source: string; alt: string }) {
  return <figure className="overflow-hidden rounded-lg border border-border/70 bg-muted/20 p-3">
    <img src={source} alt={alt} className="mx-auto max-h-[min(60dvh,42rem)] max-w-full rounded-md object-contain" />
  </figure>
}

function ProviderReconnectDialog({
  state,
  onClose,
  onStart,
  onCopyCode,
}: {
  state: ProviderReconnectState
  onClose: () => void
  onStart: () => void
  onCopyCode: () => void
}) {
  const providerName = state.provider === 'github' ? 'GitHub' : 'GitLab'
  const Icon = state.provider === 'github' ? Github : Gitlab
  const waiting = Boolean(state.requestId)
  return <div className="modal-shell modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4">
    <button type="button" className="absolute inset-0 cursor-default" aria-label="Close reconnect dialog" onClick={onClose} />
    <section role="dialog" aria-modal="true" aria-labelledby="reconnect-provider-title" className="modal-panel relative z-10 w-[min(31rem,calc(100vw-2rem))] overflow-hidden rounded-2xl outline-none animate-modal-in glass-elevated">
      <header className="flex items-start gap-3 px-6 pb-4 pt-6">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></div>
        <div className="min-w-0"><h2 id="reconnect-provider-title" className="text-lg font-semibold tracking-[-0.025em]">Reconnect {providerName}</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">Skiller now keeps its own encrypted connection. Your library, repository, and installed skills will not change.</p></div>
      </header>
      <div className="border-y border-border/70 px-6 py-4">
        {state.userCode ? <div className="text-center"><p className="text-sm font-medium">Finish signing in in your browser</p><p className="mt-1 text-xs text-muted-foreground">Enter this one-time code if {providerName} asks for it.</p><div className="mt-4 flex items-center justify-center gap-2"><code className="rounded-lg border border-border bg-muted/35 px-3 py-2 font-mono text-xl font-semibold tracking-[0.14em] text-foreground">{state.userCode}</code><Button size="icon-sm" variant="outline" aria-label="Copy one-time code" onClick={onCopyCode}><Copy className="size-3.5" /></Button></div><p className="mt-4 inline-flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Waiting for {providerName}…</p></div> : <><p className="text-sm leading-6 text-muted-foreground">Sign in once to continue syncing this library. Skiller will save the new connection in its encrypted app storage.</p><p className="mt-3 text-xs leading-5 text-muted-foreground">macOS may ask once to use <span className="font-medium text-foreground">Skiller Safe Storage</span>. Your password stays with macOS and is never sent to Skiller.</p>{state.error && <p className="mt-3 text-xs font-medium text-destructive">{state.error}</p>}</>}
      </div>
      <footer className="flex items-center justify-end gap-2 px-6 py-4"><Button size="sm" variant="outline" className="min-w-[5.5rem]" onClick={onClose}>{waiting ? 'Cancel' : 'Not now'}</Button>{!waiting && <Button size="sm" className="min-w-[8.5rem]" onClick={onStart}>Reconnect {providerName}</Button>}</footer>
    </section>
  </div>
}

/** First-load placeholder for the detail pane. It prevents an empty-state
 * message from flashing before the library snapshot has established whether
 * there is an item to select. */
function LibraryDetailSkeleton() {
  return <div className="flex min-h-0 flex-1 flex-col" aria-label="Loading library item">
    <div className="shrink-0 border-b border-border/70 px-5 py-4">
      <div className="h-4 w-40 animate-skeleton" />
      <div className="mt-2 h-3 w-72 max-w-full animate-skeleton" />
      <div className="mt-2 h-2.5 w-52 animate-skeleton" />
    </div>
    <div className="grid min-h-0 flex-1 grid-cols-[11rem_minmax(0,1fr)] gap-5 p-5">
      <div className="space-y-3 border-r border-border/60 pr-4">
        {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-8 animate-skeleton" />)}
      </div>
      <div className="space-y-3 pt-1">
        <div className="h-4 w-48 animate-skeleton" />
        <div className="h-3 w-full animate-skeleton" />
        <div className="h-3 w-11/12 animate-skeleton" />
        <div className="h-3 w-4/5 animate-skeleton" />
      </div>
    </div>
  </div>
}

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

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose, open])

  if (!open) return null
  const dismissRemoval = () => {
    setRemovalOpen(false)
    onCancelRemoval()
  }

  return <>
    <div className="modal-shell modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4">
    <button type="button" className="absolute inset-0 cursor-default" aria-label="Close library manager" onClick={onClose} disabled={busy} />
    <section role="dialog" aria-modal="true" aria-labelledby="manage-libraries-title" className="modal-panel relative z-10 w-[min(34rem,calc(100vw-2rem))] overflow-visible rounded-2xl outline-none animate-modal-in glass-elevated">
      <header className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
        <div><h2 id="manage-libraries-title" className="text-lg font-semibold tracking-[-0.025em]">Libraries</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">Each library is a separate Git repository.</p></div>
        <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose} disabled={busy}><X className="size-4" /></Button>
      </header>
      <div className="max-h-[min(52dvh,32rem)] overflow-y-auto p-2">
        <div className="space-y-1">
          {libraries.map((library) => {
            const isActive = library.profile_id === activeProfileId
            const libraryUrl = library.remote_identity && /^https?:\/\//i.test(library.remote_identity) ? library.remote_identity : null
            return <div key={library.profile_id} className={cn('flex items-center gap-3 rounded-xl px-3 py-3', isActive ? 'bg-muted/45' : 'hover:bg-muted/25')}><span className={cn('grid size-8 shrink-0 place-items-center rounded-lg text-xs font-semibold', isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{isActive ? '✓' : '·'}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{libraryDisplayName(library)}</p><p className="mt-0.5 text-xs text-muted-foreground">{library.mode === 'public' ? 'Public' : library.mode === 'team' ? 'Team' : 'Private'}{libraryUrl ? <> · <button type="button" onClick={() => openUrl(libraryUrl)} className="text-primary underline-offset-2 hover:underline">Open repository</button></> : null}</p></div>{isActive ? <><span className="text-xs font-medium text-muted-foreground">Current</span><DropdownMenu><DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`Actions for ${libraryDisplayName(library)}`} disabled={busy} />}><MoreHorizontal className="size-4" /></DropdownMenuTrigger><DropdownMenuContent className="w-48"><DropdownMenuGroup><DropdownMenuItem variant="destructive" onClick={() => setRemovalOpen(true)}><Trash2 />Remove from Skiller…</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu></> : <Button size="sm" variant="outline" onClick={() => onOpenLibrary(library.profile_id)} disabled={busy}>Open</Button>}</div>
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
        <footer className="mt-4 flex items-center justify-end gap-2 border-t border-border/70 px-5 py-3"><Button size="sm" variant="outline" className="min-w-[5.5rem]" onClick={dismissRemoval} disabled={busy}>Cancel</Button>{disconnectPreview ? <Button size="sm" variant="outline" className="border-destructive/35 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onRemoveLibrary} disabled={busy || !disconnectPreview.can_disconnect}>{busy ? 'Removing…' : 'Remove from Skiller'}</Button> : <Button size="sm" variant="outline" className="border-destructive/35 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onReviewRemoval} disabled={busy}>{busy ? 'Preparing…' : 'Remove from Skiller'}</Button>}</footer>
      </section>
    </div>}
  </>
}

function SaveSelectionDialog({
  preview,
  destination,
  destinationUrl,
  busy,
  onClose,
  onConfirm,
  onOpenSecretFinding,
}: {
  preview: DotagentsLibraryNewLocalPreviewJson | null
  destination: string
  destinationUrl: string | null
  busy: boolean
  onClose: () => void
  onConfirm: (acknowledgedSecretFindingKeys: string[]) => void
  onOpenSecretFinding: (skillId: string, relativePath: string, line: number, column: number) => void
}) {
  if (!preview) return null
  const savedCount = preview.skills.length + preview.linked_skills.length
  const copiedFiles = preview.skills.reduce((total, skill) => total + skill.files, 0)
  const isUpdate = preview.updated_skill_ids.length > 0
  const itemLabel = savedCount === 1 ? 'skill' : 'skills'
  const title = `Save ${savedCount} ${itemLabel}?`
  const [acknowledgedSecretFindingKeys, setAcknowledgedSecretFindingKeys] = useState<string[]>([])
  const secretBlockersAcknowledged = preview.secret_findings.length > 0 && preview.secret_findings.every((finding) => acknowledgedSecretFindingKeys.includes(finding.acknowledgement_key))
  const savingBlocked = preview.has_blockers && !(preview.secret_findings.length > 0 && secretBlockersAcknowledged)
  return <div className="modal-shell modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4">
    <button type="button" className="absolute inset-0 cursor-default" aria-label="Close save confirmation" onClick={onClose} disabled={busy} />
    <section role="dialog" aria-modal="true" aria-labelledby="save-selection-title" className="modal-panel relative z-10 w-[min(34rem,calc(100vw-2rem))] overflow-hidden rounded-2xl outline-none animate-modal-in glass-elevated">
      <header className="px-6 pb-2 pt-6">
        <h2 id="save-selection-title" className="text-lg font-semibold tracking-[-0.025em]">{title}</h2>
        <p className="mt-2 text-sm leading-5 text-muted-foreground">It will be saved to {destinationUrl ? <button type="button" onClick={() => openUrl(destinationUrl)} className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">{destination}</button> : <span className="font-medium text-foreground">{destination}</span>} and synced right away.</p>
      </header>
      <div className="flex items-center gap-2 border-y border-border/70 px-6 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{isUpdate ? 'Changes to save' : 'Skills to add'}</p>
        <span className="text-muted-foreground/60" aria-hidden="true">·</span>
        <p className="text-sm font-medium">{savedCount} {itemLabel} · {copiedFiles} {copiedFiles === 1 ? 'file' : 'files'}</p>
      </div>
      {preview.secret_findings.length > 0 && <section className="border-b border-destructive/25 bg-destructive/[0.045] px-6 py-3" aria-live="polite"><p className="text-sm font-medium text-destructive">Review {preview.secret_findings.length} possible {preview.secret_findings.length === 1 ? 'secret' : 'secrets'} before saving</p><p className="mt-1 text-xs leading-5 text-muted-foreground">If this is an intentional example, confirm it below. The approval applies only to this exact version of the skill; changing it brings the check back.</p><ul className="mt-2 space-y-2 text-xs text-foreground">{preview.secret_findings.slice(0, 3).map((finding) => { const checked = acknowledgedSecretFindingKeys.includes(finding.acknowledgement_key); return <li key={finding.acknowledgement_key} className="flex items-center gap-2"><Checkbox checked={checked} onCheckedChange={(next) => setAcknowledgedSecretFindingKeys((current) => next ? [...new Set([...current, finding.acknowledgement_key])] : current.filter((key) => key !== finding.acknowledgement_key))} aria-label={`Confirm ${finding.skill_id} ${finding.file} line ${finding.line}`} /><span className="min-w-0 flex-1 truncate"><span className="font-medium">{finding.skill_id}</span> <span className="font-mono text-muted-foreground">· {finding.file}:{finding.line}</span></span><Button size="xs" variant="outline" className="h-7 shrink-0 px-2 text-[11px]" onClick={() => onOpenSecretFinding(finding.skill_id, finding.file, finding.line, finding.column)}>Open file</Button></li>})}{preview.secret_findings.length > 3 && <li className="text-muted-foreground">+{preview.secret_findings.length - 3} more affected files</li>}</ul></section>}
      <div className="max-h-[min(52dvh,28rem)] space-y-5 overflow-y-auto px-6 py-5">
        {preview.skills.length > 0 && <section><ul className="overflow-hidden rounded-xl border border-border/70 bg-background/35 divide-y divide-border/60">{preview.skills.map((skill) => <li key={skill.id} className="flex items-center gap-3 px-4 py-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/65 text-muted-foreground"><FileText className="size-4" /></span><span className="min-w-0 flex-1 truncate text-sm font-medium">{skill.display_name}</span><span className="shrink-0 text-xs text-muted-foreground">{skill.files} {skill.files === 1 ? 'file' : 'files'}</span></li>)}</ul></section>}
        {preview.linked_skills.length > 0 && <section><p className="px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Kept linked to source</p><ul className="mt-2 overflow-hidden rounded-xl border border-border/70 bg-background/35 divide-y divide-border/60">{preview.linked_skills.map((skill) => <li key={skill.id} className="flex items-center gap-3 px-4 py-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/65 text-muted-foreground"><FileText className="size-4" /></span><span className="min-w-0 flex-1 truncate text-sm font-medium">{skill.display_name}</span><span className="shrink-0 text-xs text-muted-foreground">{skill.source}</span></li>)}</ul></section>}
        {preview.skipped_skills.length > 0 && <section className="rounded-xl border border-amber-500/25 bg-amber-500/[0.055] px-4 py-3"><p className="text-sm font-medium text-amber-800 dark:text-amber-200">{preview.skipped_skills.length} {preview.skipped_skills.length === 1 ? 'skill needs attention' : 'skills need attention'}</p><ul className="mt-2 space-y-1.5 text-xs leading-5 text-amber-800/85 dark:text-amber-100/85">{preview.skipped_skills.map((skill) => <li key={skill.id}><span className="font-medium">{skill.display_name}</span> · {skill.reason}</li>)}</ul></section>}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-6 py-4"><p className={cn('text-xs', savingBlocked ? 'font-medium text-destructive' : 'text-muted-foreground')}>{savingBlocked ? 'Review and confirm every finding above before saving.' : 'Nothing is saved until you confirm.'}</p><div className="flex items-center gap-2"><Button size="sm" variant="outline" className="min-w-[5.5rem]" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={() => onConfirm(acknowledgedSecretFindingKeys)} disabled={busy || savingBlocked || savedCount === 0}>{busy ? <><Loader2 className="size-3.5 animate-spin" />Saving and syncing…</> : <><Cloud className="size-3.5" />Save and sync</>}</Button></div></footer>
    </section>
  </div>
}

function RemoveSkillDialog({
  preview,
  busy,
  onClose,
  onConfirm,
}: {
  preview: DotagentsLibraryRemovalPreviewJson | null
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  if (!preview) return null
  return <div className="modal-shell modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4">
    <button type="button" className="absolute inset-0 cursor-default" aria-label="Close removal confirmation" onClick={onClose} disabled={busy} />
    <section role="dialog" aria-modal="true" aria-labelledby="remove-skill-title" className="modal-panel relative z-10 w-[min(30rem,calc(100vw-2rem))] overflow-hidden rounded-2xl outline-none animate-modal-in glass-elevated">
      <header className="px-6 pb-3 pt-6">
        <h2 id="remove-skill-title" className="text-lg font-semibold tracking-[-0.025em]">Remove {preview.skill_name} from this library?</h2>
        <p className="mt-2 text-sm leading-5 text-muted-foreground">This removes the skill from the connected repository and syncs that change. Its copy on this computer and in your agents stays installed.</p>
      </header>
      <footer className="mt-4 flex items-center justify-end gap-2 border-t border-border/70 px-6 py-4">
        <Button size="sm" variant="outline" className="min-w-[5.5rem]" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="outline" className="border-destructive/35 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onConfirm} disabled={busy}>
          {busy ? <><Loader2 className="size-3.5 animate-spin" />Removing…</> : <><Trash2 className="size-3.5" />Remove and sync</>}
        </Button>
      </footer>
    </section>
  </div>
}

export default function ResourceLibrary() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const navigate = useNavigate()
  // Reuse the active profile immediately when Agent Library is reopened. This
  // avoids briefly rendering the empty state while the same cached profile is
  // being read again in the background.
  const [profileId, setProfileId] = useState<string | null>(() =>
    queryClient.getQueryData<SyncProfileStatusJson[]>(['sync-profiles'])?.[0]?.profile_id ?? null,
  )
  const [addingLibrary, setAddingLibrary] = useState(false)
  const [managingLibraries, setManagingLibraries] = useState(false)
  const [disconnectPreview, setDisconnectPreview] = useState<SyncDisconnectPreviewJson | null>(null)
  const [disconnectBusy, setDisconnectBusy] = useState(false)
  const [selectedNewLocalIds, setSelectedNewLocalIds] = useState<string[]>([])
  const [collapsedSections, setCollapsedSections] = useState<Set<'changes' | 'new'>>(() => new Set())
  const [sectionAnimation, setSectionAnimation] = useState<{ section: 'changes' | 'new'; phase: 'collapsing' | 'expanding' } | null>(null)
  const [newLocalPreview, setNewLocalPreview] = useState<DotagentsLibraryNewLocalPreviewJson | null>(null)
  const [removalPreview, setRemovalPreview] = useState<DotagentsLibraryRemovalPreviewJson | null>(null)
	const [search, setSearch] = useTransientViewState('agent-library-search', '')
	const [selectedResourceKey, setSelectedResourceKey] = useState<string | null>(null)
	const [selectedChangeKey, setSelectedChangeKey] = useState<string | null>(null)
	const [selectedResourceFile, setSelectedResourceFile] = useState<string | null>(null)
	const [filesByResourceKey, setFilesByResourceKey] = useState<Record<string, string[]>>({})
	const resourceListScrollRef = useRef<HTMLDivElement>(null)
	const [stickySectionHeaderIndex, setStickySectionHeaderIndex] = useState<number | null>(null)
  const [repairPreview, setRepairPreview] = useState<DotagentsLibraryRepairPreviewJson | null>(null)
  const [repairBusy, setRepairBusy] = useState<'idle' | 'reviewing' | 'applying'>('idle')
  const [repairError, setRepairError] = useState<string | null>(null)
  const [syncBusy, setSyncBusy] = useState<'idle' | 'reviewing' | 'saving'>('idle')
  const [remoteReview, setRemoteReview] = useState<SyncThreeWayReviewJson | null>(null)
  const [providerCredentialDisclosure, setProviderCredentialDisclosure] = useState<{ provider: CredentialProvider; action: ResourceLibraryCredentialAction; acknowledgedSecretFindingKeys?: string[] } | null>(null)
  const [providerReconnect, setProviderReconnect] = useState<ProviderReconnectState | null>(null)
  const [remoteTrustPreview, setRemoteTrustPreview] = useState<SyncRemoteTrustPreviewJson | null>(null)
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [statusRefreshBusy, setStatusRefreshBusy] = useState(false)
  const listPane = useResizable(SKILL_LIST_PANE)
  const remoteReviewRequestRef = useRef<string | null>(null)
  const providerReconnectRequestRef = useRef<string | null>(null)
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
      if (!isAbortError(cause)) {
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

  function markRecentlyAddedSkillSeen(resource: LibraryResource | undefined) {
    if (!profileId || !resource?.recently_added_at) return
    queryClient.setQueryData<DotagentsResourceOverviewJson>(['dotagents-resource-overview', profileId], (current) => current
      ? { ...current, resources: current.resources.map((item) => item.id === resource.id ? { ...item, recently_added_at: undefined } : item) }
      : current)
    void invoke('dotagents_library_mark_seen', { profileId, skillId: resource.id })
      .catch(() => queryClient.invalidateQueries({ queryKey: ['dotagents-resource-overview', profileId] }))
  }

	const profile = profiles.data?.find((candidate) => candidate.profile_id === profileId) ?? profiles.data?.[0] ?? null
	const providerReconnectRequired = Boolean(profile?.provider_connection_required)
	const reconnectInstruction = `Reconnect ${providerForRemote(profile?.remote_url) === 'gitlab' ? 'GitLab' : 'GitHub'} above to save, remove, or sync library changes.`
	function ReconnectRequiredTooltip({ children }: { children: ReactNode }) {
		return <Tooltip content={reconnectInstruction}><span className="inline-flex">{children}</span></Tooltip>
	}
	const visible = useMemo<LibraryListEntry[]>(() => {
		const normalizedSearch = search.trim().toLocaleLowerCase()
    const changesById = new Map((localChanges.data?.changes ?? []).map((change) => [change.id, change]))
    const resources = overview.data?.resources ?? []
    const knownIds = new Set(resources.map((resource) => resource.id))
    const resourceRows = resources.map((resource) => ({ key: resource.key, resource, change: changesById.get(resource.id) }))
    // Git clients put actionable work before the clean tree. Keep that order
    // even in the all-items view so no separate "show changes" mode is needed.
    const detachedLocalRows = (localChanges.data?.changes ?? [])
      .filter((change) => change.kind === 'kept-local' && !knownIds.has(change.id))
      .map((change) => ({ key: `local-change:${change.kind}:${change.id}`, change }))
    const rows: LibraryListEntry[] = [
      ...resourceRows.filter((entry) => entry.change),
      ...(localChanges.data?.changes ?? [])
        .filter((change) => change.kind !== 'kept-local' && !knownIds.has(change.id))
        .map((change) => ({ key: `local-change:${change.kind}:${change.id}`, change })),
      ...resourceRows.filter((entry) => !entry.change),
      // This remains part of the same virtualized list, but it is not pending
      // work. Keep it after the library contents instead of mixing it with new
      // skills that actually need a decision.
      ...detachedLocalRows,
    ]

    // A dependency package is one lifecycle unit. Keeping its skills as 45
    // unrelated rows would invite a misleading per-skill sync decision.
    const groupedRows: LibraryListEntry[] = []
    const emittedPackages = new Set<string>()
    for (const row of rows) {
      const packageId = row.resource?.package_id
      if (!packageId) {
        groupedRows.push(row)
        continue
      }
      if (emittedPackages.has(packageId)) continue
      const packageResources = rows.flatMap((candidate) => candidate.resource?.package_id === packageId && candidate.resource ? [candidate.resource] : [])
      if (packageResources.length < 2) {
        groupedRows.push(row)
        continue
      }
      emittedPackages.add(packageId)
      groupedRows.push({ key: `package:${packageId}`, package: { id: packageId, resources: packageResources } })
    }

    const matchedRows = groupedRows.filter((entry) => {
      const resource = entry.resource
      const change = entry.change
      const searchable = resource
        ? `${resource.id} ${resource.path} ${resource.kind} ${change?.kind ?? ''}`
        : entry.package
          ? `${entry.package.id} ${entry.package.resources.map((item) => `${item.id} ${item.description ?? ''}`).join(' ')}`
          : `${change?.display_name ?? ''} ${change?.detail ?? ''} ${change?.kind ?? ''}`
			return !normalizedSearch || searchable.toLocaleLowerCase().includes(normalizedSearch)
    })
    const orderedSections: LibrarySection[] = ['changes', 'new', 'library', 'kept']
    const sectioned: LibraryListEntry[] = []
    for (const section of orderedSections) {
      const entries = matchedRows.filter((entry) => librarySectionFor(entry) === section)
      if (entries.length === 0) continue
      const selectableIds = entries.flatMap((entry) => {
        const change = entry.change
        const selectable = change && (change.kind === 'new-local' || change.kind === 'kept-local' || (profile?.mode === 'private' && change.kind === 'changed-local'))
        return selectable ? [change.id] : []
      })
      sectioned.push({ key: `section:${section}`, sectionHeader: { section, total: entries.length, selectableIds } })
      if ((section !== 'changes' && section !== 'new') || !collapsedSections.has(section)) sectioned.push(...entries)
    }
    return sectioned
	}, [collapsedSections, localChanges.data?.changes, overview.data?.resources, profile?.mode, search])
	const resourceListVirtualizer = useVirtualizer({
		count: visible.length,
		getScrollElement: () => resourceListScrollRef.current,
		// These rows are deliberately compact and have bounded content: the title,
		// one clamped description and one metadata line. Accurate estimates keep
		// unmeasured rows from opening visual gaps; ResizeObserver still corrects
		// an exceptional row after it renders.
		estimateSize: (index) => {
			const entry = visible[index]
			if (entry?.sectionHeader) return 41
			if (entry?.package) return 69
			return entry?.resource?.description ? 82 : 64
		},
		paddingStart: 8,
		paddingEnd: 8,
		overscan: 12,
		getItemKey: (index) => visible[index]?.key ?? String(index),
	})
	const sectionHeaderIndices = useMemo(
		() => visible.flatMap((entry, index) => entry.sectionHeader ? [index] : []),
		[visible],
	)
	const updateStickySectionHeader = useCallback((scrollTop: number) => {
		const currentItem = resourceListVirtualizer.getVirtualItemForOffset(scrollTop + 1)
		if (!currentItem) return setStickySectionHeaderIndex(null)
		let activeHeaderIndex: number | null = null
		for (const index of sectionHeaderIndices) {
			if (index > currentItem.index) break
			activeHeaderIndex = index
		}
		if (activeHeaderIndex === null) return setStickySectionHeaderIndex(null)
		const headerStart = resourceListVirtualizer.getOffsetForIndex(activeHeaderIndex, 'start')?.[0] ?? 0
		setStickySectionHeaderIndex((current) => current === (scrollTop > headerStart ? activeHeaderIndex : null)
			? current
			: scrollTop > headerStart ? activeHeaderIndex : null)
	}, [resourceListVirtualizer, sectionHeaderIndices])
	useEffect(() => {
		resourceListScrollRef.current?.scrollTo({ top: 0 })
		// `measure` is the virtualizer's documented full-layout invalidation. It
		// is needed when a collapsed section removes items and changes every
		// following index; relying on scroll-time measurements caused stale gaps.
		resourceListVirtualizer.measure()
		updateStickySectionHeader(resourceListScrollRef.current?.scrollTop ?? 0)
	}, [resourceListVirtualizer, updateStickySectionHeader, visible])
	const stickySectionHeader = stickySectionHeaderIndex === null ? null : visible[stickySectionHeaderIndex]?.sectionHeader ?? null
	const firstKeptLocalIndex = visible.findIndex((entry) => entry.change?.kind === 'kept-local')
	const virtualListItems = resourceListVirtualizer.getVirtualItems()
	const keptLocalVirtualItem = firstKeptLocalIndex >= 0
		? virtualListItems.find((item) => item.index === firstKeptLocalIndex)
		: undefined
	const resourceListViewport = resourceListScrollRef.current
	// The kept-local section stays in the same virtualized list. Offer a compact
	// way to reach it only while it is actually below the visible viewport.
	const keptSkillsBelowViewport = Boolean(
		resourceListViewport
		&& firstKeptLocalIndex >= 0
		&& (keptLocalVirtualItem
			? keptLocalVirtualItem.start > resourceListViewport.scrollTop + resourceListViewport.clientHeight - 4
			: (virtualListItems[virtualListItems.length - 1]?.index ?? -1) < firstKeptLocalIndex),
	)
	useEffect(() => {
		// Selecting a row also begins its content-preview work. Wait for the full
		// first library snapshot (including local-change classification) so a
		// transient first item such as “Kept on this computer” is never selected.
		if (profiles.isLoading || (!profileId && !profiles.isError) || overview.isLoading || (profileId && localChanges.isLoading && !localChanges.data)) return
		const selected = visible.find((entry) => !entry.sectionHeader && (entry.resource?.key === selectedResourceKey || entry.key === selectedChangeKey))
		if (selected) return
		const first = visible.find((entry) => !entry.sectionHeader)
		setSelectedResourceKey(first?.resource?.key ?? null)
		setSelectedChangeKey(first?.change ? first.key : first?.resource ? null : first?.key ?? null)
		setSelectedResourceFile(first?.resource?.kind === 'skill' && !first.change ? 'SKILL.md' : null)
	}, [localChanges.data, localChanges.isLoading, overview.isLoading, profileId, profiles.isError, profiles.isLoading, selectedChangeKey, selectedResourceKey, visible])
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
	// Do not warm previews for a batch of changed skills on first entry. Each
	// preview can read and compare a whole directory; even sequential IPC work
	// competes with pointer and scroll events on a large library. The selected
	// item still loads immediately above, and subsequent items are cached once
	// the user explicitly opens them.
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
  const libraryEmpty = overview.isSuccess && overview.data.resources.length === 0
  // A skill deliberately kept outside this library is visible for management,
  // but it is not outstanding work and must not turn the whole library amber.
  const localChangeCount = (localChanges.data?.changes ?? []).filter((change) => change.kind !== 'kept-local').length
  const selectedReviewableChange = selectedLocalChange
    && (selectedLocalChange.kind === 'new-local' || selectedLocalChange.kind === 'kept-local' || (profile?.mode === 'private' && selectedLocalChange.kind === 'changed-local'))
    ? selectedLocalChange
    : null
  const selectedChangeIsIncluded = Boolean(selectedReviewableChange && selectedNewLocalIds.includes(selectedReviewableChange.id))
  const remoteLibraryUrl = repositoryBrowserUrl(profile?.remote_identity)
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
		if (providerReconnectRequired) {
			openProviderReconnect()
			return
		}
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

  function openSecretFinding(skillId: string, relativePath: string, line: number, column: number) {
    void invoke('open_sync_secret_finding', { skillId, relativePath, line, column }).then(({ openedAtLine }) => {
      if (!openedAtLine) toast('Opened the file. Install Cursor or VS Code to jump directly to the flagged line.', 'default')
    }).catch((cause) => {
      toast(cause instanceof Error ? cause.message : String(cause), 'destructive')
    })
  }

  function toggleChangeForSave(skillId: string) {
		if (providerReconnectRequired) return
    setSelectedNewLocalIds((current) => current.includes(skillId)
      ? current.filter((id) => id !== skillId)
      : [...current, skillId])
  }

  function collapseSection(section: 'changes' | 'new') {
    setSectionAnimation({ section, phase: 'collapsing' })
    window.setTimeout(() => {
      setCollapsedSections((current) => new Set(current).add(section))
      setSectionAnimation(null)
    }, 140)
  }

  function toggleSectionSelection(section: 'changes' | 'new', ids: string[]) {
		if (providerReconnectRequired) return
    const allSelected = ids.length > 0 && ids.every((id) => selectedNewLocalIds.includes(id))
    if (!allSelected) collapseSection(section)
    setSelectedNewLocalIds((current) => {
      return allSelected
        ? current.filter((id) => !ids.includes(id))
        : [...new Set([...current, ...ids])]
    })
  }

  function toggleSectionCollapsed(section: 'changes' | 'new') {
    if (!collapsedSections.has(section)) return collapseSection(section)
    setCollapsedSections((current) => {
      const next = new Set(current)
      next.delete(section)
      return next
    })
    setSectionAnimation({ section, phase: 'expanding' })
    window.setTimeout(() => setSectionAnimation(null), 140)
  }

  function renderSectionHeader(sectionHeader: NonNullable<LibraryListEntry['sectionHeader']>, sticky = false) {
    const collapsible = sectionHeader.section === 'changes' || sectionHeader.section === 'new'
    const collapsed = collapsible && collapsedSections.has(sectionHeader.section as 'changes' | 'new')
    const selected = sectionHeader.selectableIds.filter((id) => selectedNewLocalIds.includes(id)).length
    const label = sectionHeader.section === 'changes' ? 'Changes'
      : sectionHeader.section === 'new' ? 'New'
        : sectionHeader.section === 'kept' ? 'Kept on this computer' : 'Library'
    const Icon = sectionHeader.section === 'changes' ? FileDiff
      : sectionHeader.section === 'new' ? FileText : CheckCircle2
    return <div className={cn(
      'flex min-h-10 items-center gap-2 border-b border-border/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground',
      sticky ? 'bg-card shadow-[0_5px_10px_-8px_rgb(0_0_0_/_0.55)]' : 'bg-muted/[0.18]',
    )}>
      {collapsible ? <button type="button" onClick={() => toggleSectionCollapsed(sectionHeader.section as 'changes' | 'new')} className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"><Icon className="size-3 shrink-0" /><span className="truncate">{label} ({sectionHeader.total}{sectionHeader.selectableIds.length > 0 && <><span className="text-muted-foreground/60"> · </span><span className={cn(selected > 0 && 'text-primary')}>{selected} selected</span></>})</span><ChevronDown className={cn('ml-auto size-3.5 shrink-0 transition-transform', collapsed && '-rotate-90')} /></button> : <span className="flex min-w-0 flex-1 items-center gap-2"><Icon className="size-3 shrink-0" /><span className="truncate">{label} ({sectionHeader.total})</span></span>}
      {sectionHeader.selectableIds.length > 0 && (providerReconnectRequired ? <ReconnectRequiredTooltip><Button size="xs" variant={selected === sectionHeader.selectableIds.length ? 'outline' : 'default'} className="h-6 shrink-0 px-2 text-[10px] normal-case tracking-normal" onClick={() => toggleSectionSelection(sectionHeader.section as 'changes' | 'new', sectionHeader.selectableIds)} disabled>{selected === sectionHeader.selectableIds.length ? 'Clear' : 'Select all'}</Button></ReconnectRequiredTooltip> : <Button size="xs" variant={selected === sectionHeader.selectableIds.length ? 'outline' : 'default'} className="h-6 shrink-0 px-2 text-[10px] normal-case tracking-normal" onClick={() => toggleSectionSelection(sectionHeader.section as 'changes' | 'new', sectionHeader.selectableIds)} disabled={syncBusy !== 'idle'}>{selected === sectionHeader.selectableIds.length ? 'Clear' : 'Select all'}</Button>)}
    </div>
  }

  function requestProviderCredentialAccess(action: ResourceLibraryCredentialAction, acknowledgedSecretFindingKeys?: string[]): boolean {
    const provider = providerForRemote(profile?.remote_url)
    if (!provider || hasAcknowledgedProviderCredentialDisclosure(provider)) return true
    setProviderCredentialDisclosure({ provider, action, acknowledgedSecretFindingKeys })
    return false
  }

  async function saveReviewedNewLocalChanges(acknowledgedSecretFindingKeys: string[] = [], skipCredentialDisclosure = false) {
    if (!profileId || !newLocalPreview) return
		if (providerReconnectRequired) {
			openProviderReconnect()
			return
		}
    if (!skipCredentialDisclosure && !requestProviderCredentialAccess('save-new', acknowledgedSecretFindingKeys)) return
    setSyncBusy('saving')
    try {
      const result = await invoke('dotagents_library_new_local_apply', { profileId, planId: newLocalPreview.plan_id, acknowledgedSecretFindingKeys })
      const changedCount = newLocalPreview.updated_skill_ids.length
      const savedSummary = [
        newLocalPreview.skills.length > 0 && `${newLocalPreview.skills.length} ${newLocalPreview.skills.length === 1 ? 'skill' : 'skills'} saved as ${newLocalPreview.skills.length === 1 ? 'a copy' : 'copies'}`,
        newLocalPreview.linked_skills.length > 0 && `${newLocalPreview.linked_skills.length} ${newLocalPreview.linked_skills.length === 1 ? 'skill' : 'skills'} linked to the original source`,
      ].filter(Boolean).join(' · ')
      toast({
        title: changedCount > 0 ? 'Library updated' : 'Added to library',
        description: `${savedSummary}${result.pushed ? '.' : ' saved locally.'}`,
      }, 'default', remoteLibraryUrl ? { label: 'Open repository', onClick: () => openUrl(remoteLibraryUrl) } : undefined)
      setNewLocalPreview(null)
      setSelectedNewLocalIds([])
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

  async function reviewLibrarySkillRemoval(skillId: string) {
    if (!profileId) return
		if (providerReconnectRequired) {
			openProviderReconnect()
			return
		}
    setSyncBusy('reviewing')
    try {
      setRemovalPreview(await invoke('dotagents_library_removal_preview', { profileId, skillId }))
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : String(cause), 'destructive')
    } finally {
      setSyncBusy('idle')
    }
  }

  async function applyLibrarySkillRemoval(skipCredentialDisclosure = false) {
    if (!profileId || !removalPreview) return
		if (providerReconnectRequired) {
			openProviderReconnect()
			return
		}
    if (!skipCredentialDisclosure && !requestProviderCredentialAccess('remove')) return
    setSyncBusy('saving')
    try {
      await invoke('dotagents_library_removal_apply', { profileId, planId: removalPreview.plan_id })
      toast(`${removalPreview.skill_name} was removed from the library and synced.`, 'default', remoteLibraryUrl ? { label: 'Open repository', onClick: () => openUrl(remoteLibraryUrl) } : undefined)
      setRemovalPreview(null)
      setSelectedResourceKey(null)
      setSelectedChangeKey(null)
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

  async function reviewRemoteChanges(skipCredentialDisclosure = false) {
    if (!profileId) return
		if (providerReconnectRequired) {
			openProviderReconnect()
			return
		}
    if (!skipCredentialDisclosure && !requestProviderCredentialAccess('review')) return
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
        toast('Your library and this computer are already in sync.', 'default', remoteLibraryUrl ? { label: 'Open repository', onClick: () => openUrl(remoteLibraryUrl) } : undefined)
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

  function openProviderReconnect() {
    const provider = providerForRemote(profile?.remote_url)
    if (provider) setProviderReconnect({ provider })
  }

  async function reconnectProvider() {
    const reconnect = providerReconnect
    if (!reconnect) return
    const requestId = crypto.randomUUID()
    providerReconnectRequestRef.current = requestId
    setProviderReconnect({ provider: reconnect.provider, requestId })
    try {
      const started = await invoke('sync_provider_sign_in_start', { provider: reconnect.provider, requestId })
      if (providerReconnectRequestRef.current !== requestId) return
      if (!started.started) {
        setProviderReconnect({ provider: reconnect.provider, error: 'Could not start the sign-in. Try again.' })
        return
      }
      setProviderReconnect({ provider: reconnect.provider, requestId, userCode: started.user_code })
      const result = await invoke('sync_provider_sign_in_finish', { provider: reconnect.provider, requestId })
      if (providerReconnectRequestRef.current !== requestId) return
      if (!result.connected) {
        setProviderReconnect({ provider: reconnect.provider, error: 'The sign-in was not completed. Try again when you are ready.' })
        return
      }
      acknowledgeProviderCredentialDisclosure(reconnect.provider)
      providerReconnectRequestRef.current = null
      setProviderReconnect(null)
      toast(`${reconnect.provider === 'github' ? 'GitHub' : 'GitLab'} reconnected. Checking this library now.`)
      await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
      await reviewRemoteChanges(true)
    } catch (cause) {
      if (providerReconnectRequestRef.current !== requestId) return
      setProviderReconnect({ provider: reconnect.provider, error: cause instanceof Error ? cause.message : 'The sign-in could not be completed. Try again.' })
    } finally {
      if (providerReconnectRequestRef.current === requestId) providerReconnectRequestRef.current = null
    }
  }

  function cancelProviderReconnect() {
    const requestId = providerReconnectRequestRef.current
    providerReconnectRequestRef.current = null
    setProviderReconnect(null)
    if (requestId) void invoke('sync_provider_libraries_cancel', { requestId }).catch(() => undefined)
  }

  function copyProviderReconnectCode() {
    if (!providerReconnect?.userCode) return
    void navigator.clipboard.writeText(providerReconnect.userCode).then(
      () => toast('Code copied.'),
      () => toast('Select the code and copy it manually.', 'destructive'),
    )
  }

  function continueRemoteReviewWithCredentials() {
    const disclosure = providerCredentialDisclosure
    if (!disclosure) return
    acknowledgeProviderCredentialDisclosure(disclosure.provider)
    setProviderCredentialDisclosure(null)
    if (disclosure.action === 'review') {
      void reviewRemoteChanges(true)
    } else if (disclosure.action === 'save-new') {
      void saveReviewedNewLocalChanges(disclosure.acknowledgedSecretFindingKeys ?? [], true)
    } else {
      void applyLibrarySkillRemoval(true)
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
    if (!actionable) toast('Your library and this computer are now in sync.', 'default', remoteLibraryUrl ? { label: 'Open repository', onClick: () => openUrl(remoteLibraryUrl) } : undefined)
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
  // Do not present a conclusion before the profile and its first library
  // snapshot exist. Cached data renders immediately; cold loads get a
  // skeleton, and the empty state is reserved for a confirmed empty library.
  const libraryListPending = profiles.isLoading
    || (!profileId && !profiles.isError)
    || overview.isLoading
    || initialLocalCheckPending
  const syncStatus = useMemo(() => {
    if (initialLocalCheckPending) return { label: 'Checking changes on this computer', tone: 'text-muted-foreground', kind: 'checking' as const }
    if (localChangeCount > 0) return { label: `${localChangeCount} ${localChangeCount === 1 ? 'change needs' : 'changes need'} review`, tone: 'text-primary', kind: 'local' as const }
    if (profile?.provider_connection_required) return { label: `Reconnect ${providerForRemote(profile.remote_url) === 'github' ? 'GitHub' : 'GitLab'} to sync`, tone: 'text-primary', kind: 'reconnect' as const }
    if (profile?.remote_trust_required) return { label: 'Review remote access', tone: 'text-amber-700 dark:text-amber-300', kind: 'remote' as const }
    if (profile?.check_error) return { label: 'Could not check for updates', tone: 'text-amber-700 dark:text-amber-300', kind: 'check-error' as const }
    if (overview.data?.changed || profile?.changed) return { label: 'Local changes found', tone: 'text-amber-700 dark:text-amber-300', kind: 'local' as const }
    if ((profile?.ahead ?? 0) > 0) return { label: `${profile!.ahead} ${profile!.ahead === 1 ? 'change is' : 'changes are'} waiting to upload`, tone: 'text-amber-700 dark:text-amber-300', kind: 'local' as const }
    if ((profile?.behind ?? 0) > 0) return { label: `${profile!.behind} ${profile!.behind === 1 ? 'update is' : 'updates are'} ready to review`, tone: 'text-primary', kind: 'remote' as const }
    return { label: 'Up to date', tone: 'text-emerald-700 dark:text-emerald-300', kind: 'fresh' as const }
  }, [initialLocalCheckPending, localChangeCount, overview.data?.changed, profile])
  const syncActionLabel = statusRefreshBusy
    ? 'Stop checking'
    : syncBusy === 'reviewing' && remoteReviewRequestRef.current
      ? 'Stop checking'
      : syncBusy === 'reviewing'
        ? 'Reviewing…'
        : profile?.provider_connection_required
          ? 'Reconnect'
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
      {providerCredentialDisclosure && <ProviderCredentialDisclosure
        provider={providerCredentialDisclosure.provider}
        onCancel={() => setProviderCredentialDisclosure(null)}
        onContinue={continueRemoteReviewWithCredentials}
      />}
      {providerReconnect && <ProviderReconnectDialog
        state={providerReconnect}
        onClose={cancelProviderReconnect}
        onStart={() => void reconnectProvider()}
        onCopyCode={copyProviderReconnectCode}
      />}
      <header className="shrink-0 border-b border-border/70 px-6 pb-5 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-lg font-semibold tracking-[-0.03em] text-foreground">Agent Library</h1>
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
            {libraryListPending ? <>
              <span className="h-3 w-14 animate-skeleton" aria-label="Loading item count" />
              <span aria-hidden="true">·</span>
              <span className="h-3 w-24 animate-skeleton" aria-label="Loading library status" />
            </> : <>
              <span>{overview.data!.resources.length} items</span>
              <span aria-hidden="true">·</span>
              <span className={cn('inline-flex items-center gap-1.5 font-medium', statusRefreshBusy ? 'text-muted-foreground' : syncStatus.tone)}>{statusRefreshBusy || syncStatus.kind === 'checking' ? <Loader2 className="size-3.5 animate-spin" /> : syncStatus.kind === 'fresh' ? <CheckCircle2 className="size-3.5" /> : <span className="size-1.5 rounded-full bg-current" />}{statusRefreshBusy ? 'Checking saved library' : syncStatus.label}</span>
              {selectedNewLocalIds.length > 0 && !statusRefreshBusy && <><span aria-hidden="true">·</span><span className="font-medium text-primary">{selectedNewLocalIds.length} selected</span></>}
            </>}
            {!libraryListPending && showSyncAction && (
              <button
                type="button"
                onClick={() => statusRefreshBusy ? cancelStatusRefresh() : syncBusy === 'reviewing' && remoteReviewRequestRef.current ? cancelRemoteReview() : profile?.provider_connection_required ? openProviderReconnect() : profile?.remote_trust_required ? void reviewRemoteAccess() : syncStatus.kind === 'remote' ? void reviewRemoteChanges() : void refreshLibraryState({ foreground: true })}
                disabled={syncBusy !== 'idle' && !remoteReviewRequestRef.current && !statusRefreshBusy}
                className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {statusRefreshBusy ? <Loader2 className="size-3 animate-spin" /> : <Cloud className="size-3" />}
                {syncActionLabel}
              </button>
            )}
          </div>
        </div>
      </header>

      {profile?.provider_connection_required && (
        <section className="shrink-0 border-b border-primary/25 bg-primary/[0.055] px-6 py-3" aria-label="Reconnect library provider">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex min-w-0 items-center gap-2 text-foreground"><Cloud className="size-3.5 shrink-0 text-primary" /><span><strong>Reconnect {providerForRemote(profile.remote_url) === 'github' ? 'GitHub' : 'GitLab'} to keep this library in sync.</strong> Your library and installed skills will stay unchanged.</span></div>
            <Button size="xs" className="shrink-0" onClick={openProviderReconnect}>Reconnect</Button>
          </div>
        </section>
      )}
      {profile?.check_error && !statusRefreshBusy && !profile.provider_connection_required && (
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
                <div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" className="min-w-[5.5rem]" onClick={() => { setRepairPreview(null); setRepairError(null) }} disabled={repairBusy !== 'idle'}>Cancel</Button><Button size="sm" onClick={() => void applyRepair()} disabled={repairBusy !== 'idle' || repairPreview.has_blockers || repairPreview.actions.length === 0}>{repairBusy === 'applying' ? <><Loader2 className="size-3.5 animate-spin" />Repairing…</> : <><ShieldCheck className="size-3.5" />Apply reviewed repair</>}</Button></div>
              </div>
            </div>
          )}
          {repairError && <p className="mt-3 text-xs text-red-700 dark:text-red-300">{repairError}</p>}
        </section>
      )}

		<div className="flex min-h-0 flex-1 flex-col">
				{selectedNewLocalIds.length > 0 && !newLocalPreview && <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-muted/20 px-6 py-2.5 text-xs">
          <p className="min-w-0 truncate text-muted-foreground">{selectedNewLocalIds.length} {selectedNewLocalIds.length === 1 ? 'skill is' : 'skills are'} ready to save. Review the plan before anything changes.</p>
          <div className="flex shrink-0 items-center gap-2">
                <Button size="xs" variant="outline" className="min-w-16" onClick={() => setSelectedNewLocalIds([])} disabled={syncBusy !== 'idle'}>Cancel</Button>
            {providerReconnectRequired ? <ReconnectRequiredTooltip><Button size="xs" disabled>Review and save</Button></ReconnectRequiredTooltip> : <Button size="xs" onClick={() => void reviewNewLocalChanges()} disabled={syncBusy !== 'idle'}>{syncBusy === 'reviewing' ? <><Loader2 className="size-3.5 animate-spin" />Preparing…</> : <>Review and save</>}</Button>}
          </div>
        </div>}
				<div className="flex min-h-0 flex-1 flex-col lg:flex-row">
					<div className="relative flex min-h-0 min-w-0 flex-1 flex-col max-lg:!w-full max-lg:max-h-[44%] max-lg:flex-none lg:flex-none" style={{ width: listPane.width }}>
            <div className="shrink-0 border-b border-border/70 p-3">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search library"
                debounce={0}
              />
            </div>
						<div className="relative flex min-h-0 flex-1 flex-col">
							<div ref={resourceListScrollRef} onScroll={(event) => updateStickySectionHeader(event.currentTarget.scrollTop)} className="min-h-0 flex-1 overflow-y-auto">
          {overview.isError ? (
            <div className="grid min-h-72 place-items-center text-center"><div><AlertTriangle className="mx-auto size-7 text-red-500" /><p className="mt-3 text-sm font-medium">Agent Library could not be loaded</p><p className="mt-1 text-xs text-muted-foreground">Nothing changed. Retry the local library review.</p><Button size="sm" variant="outline" className="mt-4" onClick={() => overview.refetch()}>Try again</Button></div></div>
						) : libraryListPending ? Array.from({ length: 7 }).map((_, index) => <div key={index} className="flex items-center gap-3 border-b border-border/60 px-4 py-3.5"><div className="size-9 animate-skeleton" /><div className="space-y-2"><div className="h-3 w-36 animate-skeleton" /><div className="h-2.5 w-52 animate-skeleton" /></div></div>) : visible.length === 0 ? (
							<div className="grid min-h-72 place-items-center text-center"><div><LibraryBig className="mx-auto size-7 text-muted-foreground/50" /><p className="mt-3 text-sm font-medium">No library items here yet</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{libraryEmpty ? 'Skiller will show agent content here after you review and save changes found on this computer.' : 'No library items match your search.'}</p></div></div>
						) : <div className="relative w-full" style={{ height: resourceListVirtualizer.getTotalSize() }}>{resourceListVirtualizer.getVirtualItems().map((virtualRow) => {
              const entry = visible[virtualRow.index]
              if (!entry) return null
              const sectionHeader = entry.sectionHeader
              if (sectionHeader) {
				return <div key={virtualRow.key} data-index={virtualRow.index} ref={resourceListVirtualizer.measureElement} className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${virtualRow.start}px)` }}>
					{renderSectionHeader(sectionHeader)}
                </div>
              }
              const resource = entry.resource
              const change = entry.change
              const packageGroup = entry.package
              const selected = resource ? resource.key === selectedResourceKey : entry.key === selectedChangeKey
              const sectionAnimationClass = sectionAnimation && librarySectionFor(entry) === sectionAnimation.section
                ? sectionAnimation.phase === 'collapsing' ? 'animate-library-section-collapse' : 'animate-library-section-expand'
                : null
              // Like GitHub's Files changed view, review controls live beside the
              // changed item in the main list. Changes always stay at the top.
              const reviewableChange = change && (change.kind === 'new-local' || change.kind === 'kept-local' || (profile?.mode === 'private' && change.kind === 'changed-local')) ? change : null
              const statusCode = change?.kind === 'new-local' ? '??' : change?.kind === 'kept-local' ? 'Local' : change?.kind === 'changed-local' ? 'M' : change?.kind === 'missing-local' ? 'D' : null
              const statusLabel = change?.kind === 'new-local' ? 'New' : statusCode
							return <div key={virtualRow.key} data-index={virtualRow.index} ref={resourceListVirtualizer.measureElement} className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${virtualRow.start}px)` }}>
					<div className={cn('px-2 pb-1', sectionAnimationClass)}>
						{packageGroup ? <button type="button" className="w-full rounded-xl border-[0.5px] border-primary/15 bg-primary/[0.04] px-3 py-3 text-left transition-colors hover:bg-primary/[0.08]" onClick={() => navigate(`/skills?skill=${encodeURIComponent(packageGroup.id)}`)}>
							<div className="flex items-center justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-medium">{packageGroup.id}</p><span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Package</span></div><p className="mt-0.5 text-xs text-muted-foreground">{packageGroup.resources.length} skills · Managed from All Skills</p></div><ChevronDown className="size-4 shrink-0 -rotate-90 text-muted-foreground" /></div>
						</button> :
						<button
							type="button"
							onClick={() => {
								markRecentlyAddedSkillSeen(resource);
								setSelectedResourceKey(resource?.key ?? null);
								setSelectedChangeKey(change ? entry.key : null);
								setSelectedResourceFile(resource?.kind === 'skill' && !change ? 'SKILL.md' : null);
								resourceListVirtualizer.scrollToIndex(virtualRow.index, { align: 'start' });
							}}
							className={cn(
								'w-full rounded-xl border-[0.5px] px-3 py-2.5 text-left transition-all duration-200',
								selected
									? 'glass'
									: resource?.recently_added_at
										? 'border-transparent bg-emerald-500/[0.045] hover:bg-emerald-500/[0.075]'
										: 'border-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.04]',
							)}
						>
							<div className="flex min-w-0 items-start gap-2">
								{reviewableChange && <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-muted/50" onClick={(event) => event.stopPropagation()}>{providerReconnectRequired ? <ReconnectRequiredTooltip><Checkbox checked={selectedNewLocalIds.includes(reviewableChange.id)} disabled aria-label={`Include ${reviewableChange.display_name} in save`} /></ReconnectRequiredTooltip> : <Checkbox checked={selectedNewLocalIds.includes(reviewableChange.id)} onCheckedChange={() => toggleChangeForSave(reviewableChange.id)} aria-label={`Include ${reviewableChange.display_name} in save`} />}</span>}
								<div className="min-w-0 flex-1">
									<div className="flex min-w-0 items-start justify-between gap-2">
										<div className="min-w-0 flex-1">
									<div className="flex min-w-0 items-center gap-1.5">
										<Tooltip content={resource?.id ?? change?.display_name ?? ''}><p className="min-w-0 flex-1 truncate text-sm font-medium">{resource?.id ?? change?.display_name}</p></Tooltip>
										{resource?.recently_added_at && <span className="shrink-0 rounded-full bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">New</span>}
									</div>
									{resource?.description && <Tooltip content={resource.description}><p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{resource.description}</p></Tooltip>}
										</div>
										{statusCode && <Tooltip content={change?.kind === 'new-local' ? 'New on this computer' : change?.kind === 'kept-local' ? 'Kept on this computer, outside this library' : change?.kind === 'changed-local' ? 'Changed on this computer' : 'No longer on this computer'}><span className={cn('grid min-w-6 shrink-0 place-items-center rounded-md px-1.5 py-1 font-mono text-[10px] font-semibold', statusCode === '??' ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' : statusCode === 'Local' ? 'bg-muted text-muted-foreground' : statusCode === 'D' ? 'bg-destructive/12 text-destructive' : 'bg-amber-500/15 text-amber-800 dark:text-amber-200')}>{statusLabel}</span></Tooltip>}
									</div>
									<div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] font-medium text-muted-foreground">
										<Tooltip content={resource?.path ?? 'skills/' + (change?.id ?? '')}><span className="min-w-0 flex-1 truncate font-mono">{resource?.path ?? 'skills/' + (change?.id ?? '')}</span></Tooltip>
										<span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-secondary-foreground">Skill</span>
										{resource?.package_id && <Tooltip content={`${resource.package_id} is updated as one package from All Skills`}><button type="button" className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-primary" onClick={(event) => { event.stopPropagation(); navigate(`/skills?skill=${encodeURIComponent(resource.package_id!)}`) }}>Managed from All Skills</button></Tooltip>}
									</div>
								</div>
							</div>
						</button>
						}
					</div>
                </div>
							})}</div>}
						</div>
							{stickySectionHeader && <div className="pointer-events-none absolute inset-x-0 top-0 z-20"><div className="pointer-events-auto">{renderSectionHeader(stickySectionHeader, true)}</div></div>}
							<ScrollFade viewportRef={resourceListScrollRef} />
							{keptSkillsBelowViewport && (
								<button
									type="button"
									onClick={() => resourceListVirtualizer.scrollToIndex(firstKeptLocalIndex, { align: 'start' })}
									className="z-20 flex h-9 shrink-0 w-full items-center justify-between gap-3 border-t border-border/70 bg-card px-4 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
								>
									<span className="truncate">Scroll to kept skills</span>
									<ArrowDown className="size-3.5 shrink-0" aria-hidden="true" />
								</button>
							)}
						</div>
						<ResizeHandle
							className="linear-resize-handle--flush-right hidden lg:block"
							onPointerDown={listPane.onPointerDown}
							onMouseDown={listPane.onMouseDown}
							isResizing={listPane.isResizing}
						/>
					</div>
					<aside className="flex min-h-0 flex-1 flex-col border-t border-border/70 lg:border-l lg:border-t-0">
              {libraryListPending ? <LibraryDetailSkeleton /> : (selectedResource || selectedLocalChange) ? <>
                <div className="shrink-0 border-b border-border/70 px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{selectedResource?.id ?? selectedLocalChange?.display_name}</p>
                      {selectedResource?.description && <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{selectedResource.description}</p>}
                      <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{selectedResource?.path ?? selectedLocalChange?.detail}</p>
                      {selectedResource && <p className="mt-1 text-[10px] text-muted-foreground">Source: {selectedResource.source_url ? <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => openUrl(selectedResource.source_url!)}>{selectedResource.source_label}</button> : selectedResource.source_label}</p>}
                      {selectedResource?.package_id && <button type="button" className="mt-1 text-[10px] text-primary underline-offset-2 hover:underline" onClick={() => navigate(`/skills?skill=${encodeURIComponent(selectedResource.package_id!)}`)}>Managed from All Skills · {selectedResource.package_id}</button>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {selectedResource && !selectedLocalChange && (providerReconnectRequired ? <ReconnectRequiredTooltip><Button
                          size="xs"
                          variant="ghost"
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          disabled
                        >
                          <Trash2 className="size-3.5" />Remove from library
                        </Button></ReconnectRequiredTooltip> : <Button
                          size="xs"
                          variant="ghost"
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void reviewLibrarySkillRemoval(selectedResource.id)}
                          disabled={syncBusy !== 'idle'}
                        >
                          <Trash2 className="size-3.5" />Remove from library
	                        </Button>)}
                      {selectedReviewableChange && (providerReconnectRequired ? <ReconnectRequiredTooltip><Button
                          size="xs"
                          variant={selectedChangeIsIncluded ? 'outline' : 'default'}
                          disabled
                        >
                          {selectedChangeIsIncluded ? <><CheckCircle2 className="size-3.5" />Included in save</> : <><Cloud className="size-3.5" />Add to library</>}
                        </Button></ReconnectRequiredTooltip> : <Button
                          size="xs"
                          variant={selectedChangeIsIncluded ? 'outline' : 'default'}
                          onClick={() => toggleChangeForSave(selectedReviewableChange.id)}
                          disabled={syncBusy !== 'idle'}
                        >
                          {selectedChangeIsIncluded ? <><CheckCircle2 className="size-3.5" />Included in save</> : <><Cloud className="size-3.5" />Add to library</>}
	                        </Button>)}
                      {selectedLocalChange ? <Tooltip content={selectedLocalChange.kind === 'new-local' ? 'New on this computer' : selectedLocalChange.kind === 'kept-local' ? 'Kept on this computer, outside this library' : selectedLocalChange.kind === 'changed-local' ? 'Changed on this computer' : 'No longer on this computer'}><span className="rounded-md bg-muted/60 px-2 py-1 font-mono text-[10px] font-semibold text-muted-foreground">{selectedLocalChange.kind === 'new-local' ? 'New' : selectedLocalChange.kind === 'kept-local' ? 'Local' : selectedLocalChange.kind === 'changed-local' ? 'M' : 'D'}</span></Tooltip> : <span className="rounded-md bg-muted/60 px-2 py-1 text-[10px] font-medium text-muted-foreground">Skill</span>}
                    </div>
                  </div>
                </div>
					<SkillContentBrowser
						files={selectedFiles}
						selectedFile={selectedResourceFile}
						onSelectFile={setSelectedResourceFile}
						loading={selectedFiles.length === 0 && (selectedLocalChange ? localChangeSummary.isLoading : resourceContent.isLoading)}
						emptyFiles={<p className="px-3 py-2 text-[11px] text-muted-foreground">No changed files to preview</p>}
						ariaLabel="Files in selected library item"
						className="rounded-none border-0"
						previewClassName="px-5 py-5"
					>
					{(selectedLocalChange ? localChangeSummary.isLoading || !selectedResourceFile || localChangeFilePreview.isLoading : resourceContent.isLoading || resourceContentIsStale) ? <div className="space-y-3"><div className="h-4 w-40 animate-skeleton" /><div className="h-3 w-full animate-skeleton" /><div className="h-3 w-5/6 animate-skeleton" /></div> : localChangeFilePreview.data?.file_preview ? <div>{localChangeFilePreview.data.file_preview.image_data_url ? <ImagePreview source={localChangeFilePreview.data.file_preview.image_data_url} alt={localChangeFilePreview.data.file_preview.path} /> : localChangeFilePreview.data.file_preview.diff ? <><div className="mb-3 flex items-center gap-2 text-xs font-medium"><FileDiff className="size-3.5 text-primary" />Changes in this file</div><FileChangePreview diff={localChangeFilePreview.data.file_preview.diff} /></> : <p className="rounded-lg border border-border/70 bg-muted/25 p-4 text-xs text-muted-foreground">{localChangeFilePreview.data.file_preview.unavailable_reason}</p>}</div> : resourceContent.isError ? <div className="grid min-h-48 place-items-center text-center"><div><AlertTriangle className="mx-auto size-6 text-amber-600" /><p className="mt-3 text-sm font-medium">Preview is unavailable</p><p className="mt-1 text-xs text-muted-foreground">{resourceContent.error instanceof Error ? resourceContent.error.message : 'Refresh the library and try again.'}</p></div></div> : deferredResourceContent?.image_data_url ? <ImagePreview source={deferredResourceContent.image_data_url} alt={selectedResourceFile ?? selectedResource?.id ?? 'Library image'} /> : deferredResourceContent ? <MarkdownContent content={deferredResourceContent.content} /> : <div className="grid min-h-48 place-items-center text-center text-xs text-muted-foreground">Choose a file to inspect its change.</div>}
					</SkillContentBrowser>
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
        destination={profile ? libraryDisplayName(profile) : 'your connected library'}
        destinationUrl={remoteLibraryUrl}
        busy={syncBusy === 'saving'}
        onClose={() => setNewLocalPreview(null)}
        onConfirm={(acknowledgedSecretFindingKeys) => void saveReviewedNewLocalChanges(acknowledgedSecretFindingKeys)}
        onOpenSecretFinding={openSecretFinding}
      />
      <RemoveSkillDialog
        preview={removalPreview}
        busy={syncBusy === 'saving'}
        onClose={() => setRemovalPreview(null)}
        onConfirm={() => void applyLibrarySkillRemoval()}
      />
    </div>
  )
}
