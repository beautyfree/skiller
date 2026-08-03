import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Cloud, FolderOpen, Github, Info, Loader2, Server, X } from 'lucide-react'
import { invoke } from '@/mainview/lib/native'
import type { SyncInventoryJson, SyncProfileStatusJson, SyncPublishPreviewJson, SyncThreeWayReviewJson } from '@/shared/rpc-schema'
import { Button } from '@/mainview/components/ui/button'
import { useToast } from '@/mainview/components/ToastProvider'
import { AgentIcon } from '@/mainview/components/AgentIcon'
import MarkdownContent from '@/mainview/components/MarkdownContent'

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function secretRuleLabel(rule: SyncPublishPreviewJson['secret_findings'][number]['rule']): string {
  return ({
    'private-key': 'private key',
    'github-token': 'GitHub token',
    'provider-token': 'provider token',
    'aws-access-key': 'AWS access key',
    'connection-string': 'database connection',
    'credential-assignment': 'credential-like assignment',
  } as const)[rule] ?? 'sensitive value'
}

function groupSecretFindings(findings: SyncPublishPreviewJson['secret_findings']) {
  const groups = new Map<string, { skillId: string; relativePath: string; findings: typeof findings }>()
  for (const finding of findings) {
    const key = `${finding.skill_id}\u0000${finding.relative_path}`
    const group = groups.get(key)
    if (group) group.findings.push(finding)
    else groups.set(key, { skillId: finding.skill_id, relativePath: finding.relative_path, findings: [finding] })
  }
  return [...groups.values()]
}

type InventoryItem = SyncInventoryJson['items'][number]

const InventorySkillRow = memo(function InventorySkillRow({ item, selected, inspected, onToggle, onInspect }: { item: InventoryItem; selected: boolean; inspected: boolean; onToggle: (key: string) => void; onInspect: (key: string) => void }) {
	const agentSlugs = useMemo(() => [...new Set(item.locations.flatMap((location) => location.agent_slug ? [location.agent_slug] : []))], [item.locations])
	const isShared = item.locations.some((location) => location.kind === 'shared')
	return <div className={`flex min-h-12 items-center gap-2 px-2 py-2 text-xs ${inspected ? 'bg-primary/8' : 'hover:bg-muted/30'}`}>
		<label className="flex shrink-0 cursor-pointer items-center py-0.5" aria-label={`Select ${item.display_name}`}>
			<input className="cursor-pointer" type="checkbox" checked={selected} onChange={() => onToggle(item.candidate_key)} />
		</label>
		<button type="button" className="min-w-0 flex-1 break-words text-left font-medium text-foreground outline-none hover:text-primary focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring/60" onClick={() => onInspect(item.candidate_key)}><span>{item.display_name}</span>{item.source.kind === 'skills_sh' && <span className="ml-1.5 inline-flex rounded-sm bg-muted px-1.5 py-0.5 align-middle text-[9px] font-semibold tracking-[0.08em] text-muted-foreground">skills.sh</span>}{item.source.kind === 'git_reference' && <span className="ml-1.5 inline-flex rounded-sm bg-muted px-1.5 py-0.5 align-middle text-[9px] font-semibold tracking-[0.08em] text-muted-foreground">Git</span>}</button>
		<span className="flex shrink-0 items-center gap-1.5" aria-label={agentSlugs.length ? `Linked to ${agentSlugs.join(', ')}` : isShared ? 'Shared skills library' : undefined}>
			{isShared && <span className="text-[10px] font-medium text-muted-foreground">Shared</span>}
			{agentSlugs.map((slug) => <span key={slug} title={slug}><AgentIcon slug={slug} className="size-4" /></span>)}
		</span>
	</div>
})

function ReviewSkillDetail({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
	const agentSlugs = [...new Set(item.locations.flatMap((location) => location.agent_slug ? [location.agent_slug] : []))]
	const isShared = item.locations.some((location) => location.kind === 'shared')
	const { data: preview, isLoading, error } = useQuery<{ skill_id: string; body: string }>({
		queryKey: ['sync-skill-preview', item.candidate_key],
		queryFn: () => invoke('get_sync_skill_preview', { skillId: item.candidate_key }),
		staleTime: Infinity,
		retry: false,
	})
	return <aside className="flex min-h-0 w-[min(26rem,46%)] shrink-0 flex-col border-l border-border/60 bg-muted/10">
		<div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3"><div className="flex items-center gap-2"><Info className="size-4 text-muted-foreground" /><p className="text-sm font-medium">Skill details</p></div><button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onClose} aria-label="Close skill details"><X className="size-4" /></button></div>
		<div className="min-h-0 flex-1 overflow-y-auto p-4">
			<h3 className="text-base font-semibold leading-tight">{item.display_name}</h3>
			{item.description && <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.description}</p>}
			{item.when_to_use && <p className="mt-3 text-xs leading-relaxed text-muted-foreground"><span className="font-medium text-foreground">Use it for:</span> {item.when_to_use}</p>}
			<div className="mt-4 border-y border-border/60 py-3 text-[11px] text-muted-foreground">{item.source.kind === 'skills_sh' ? <><p className="font-medium text-foreground">Installed through skills.sh</p><p className="mt-1 leading-relaxed">Skiller will record this skill’s source and pin it to one Git commit before publishing. It will not upload a duplicate copy.</p></> : item.source.kind === 'git_reference' ? <><p className="font-medium text-foreground">Installed from a Git source</p><p className="mt-1 leading-relaxed">Skiller will save its pinned repository reference instead of flattening this skill into a duplicate folder.</p></> : <><p className="font-medium text-foreground">Local skill</p><p className="mt-1 leading-relaxed">This skill is not linked to a known external source, so its reviewed files can be stored in your personal library.</p></>}</div>
			<div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 py-3 text-[11px] text-muted-foreground"><span>{isShared ? 'Shared library' : 'Agent-specific'}</span>{agentSlugs.map((slug) => <span key={slug} className="inline-flex items-center gap-1"><AgentIcon slug={slug} className="size-3.5" />{slug}</span>)}</div>
			<div className="mt-5"><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">SKILL.md</p>{isLoading ? <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Loading local skill…</div> : error ? <p className="text-xs text-destructive">Could not load this local SKILL.md. Refresh the library review and try again.</p> : preview?.body.trim() ? <MarkdownContent content={preview.body} /> : <p className="text-xs italic text-muted-foreground">This SKILL.md does not contain instructions after its metadata.</p>}</div>
		</div>
	</aside>
}

/**
 * Sync has its own product surface because it describes an evolving personal
 * state, not an application preference. Setup actions are deliberately kept
 * out of the first view until their reviewed plan is ready to apply.
 */
export default function SyncCenter() {
  const [showInventory, setShowInventory] = useState(false)
  const [inspectedSkillKey, setInspectedSkillKey] = useState<string | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [selectionReady, setSelectionReady] = useState(false)
  const [setupMode, setSetupMode] = useState<'github' | 'custom' | null>(null)
  const [repositoryName, setRepositoryName] = useState('skiller-agent-library')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [preview, setPreview] = useState<SyncPublishPreviewJson | null>(null)
  const [showDestination, setShowDestination] = useState(false)
  const [remoteReview, setRemoteReview] = useState<SyncThreeWayReviewJson | null>(null)
	const [remoteSelections, setRemoteSelections] = useState<string[]>([])
	const [localSelections, setLocalSelections] = useState<string[]>([])
	const [keepLocalSelections, setKeepLocalSelections] = useState<string[]>([])
	const [keepExternalSelections, setKeepExternalSelections] = useState<string[]>([])
  const [busy, setBusy] = useState<'idle' | 'reviewing' | 'creating' | 'publishing'>('idle')
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: inventory, isLoading: inventoryLoading } = useQuery<SyncInventoryJson>({
    queryKey: ['sync-center-inventory'],
    queryFn: () => invoke('scan_sync_inventory'),
  })
  const { data: profiles, isLoading: profilesLoading } = useQuery<SyncProfileStatusJson[]>({
    queryKey: ['sync-profiles'],
    queryFn: () => invoke('list_sync_profiles'),
  })

  const profile = profiles?.[0]
	const inventoryItems = inventory?.items ?? []
	const inventoryScrollRef = useRef<HTMLDivElement>(null)
	const inventoryVirtualizer = useVirtualizer({
	  count: inventoryItems.length,
	  getScrollElement: () => inventoryScrollRef.current,
	  estimateSize: () => 46,
	  overscan: 24,
	  getItemKey: (index) => inventoryItems[index]?.candidate_key ?? String(index),
	})
	const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys])
	const inspectedSkill = useMemo(() => inventoryItems.find((item) => item.candidate_key === inspectedSkillKey) ?? null, [inventoryItems, inspectedSkillKey])
	const externalConflicts = useMemo(() => remoteReview?.skills.filter((skill) => skill.kind !== 'bundled' && skill.action === 'conflict') ?? [], [remoteReview])
	const toggleSelectedKey = useCallback((key: string) => {
	  setSelectedKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])
	}, [])
  const { data: recovery } = useQuery<{ pending: boolean }>({
    queryKey: ['sync-recovery', profile?.profile_id],
    queryFn: () => invoke('sync_recovery_status', { profileId: profile!.profile_id }),
    enabled: Boolean(profile),
  })
	const librarySkillCount = inventory?.items.length ?? 0
	const agentCount = new Set(inventory?.items.flatMap((item) => item.locations.flatMap((location) => location.agent_slug ? [location.agent_slug] : [])) ?? []).size
	const isLanding = !profile && !profilesLoading && !showInventory

  useEffect(() => {
    if (!inventory || selectionReady) return
    setSelectedKeys(inventory.items.map((item) => item.candidate_key))
    setSelectionReady(true)
  }, [inventory, selectionReady])

  async function prepareStorageChoice() {
    setBusy('reviewing')
    try {
      const result = await invoke('sync_center_publish_preview', { selectedKeys })
      setPreview(result)
      setShowDestination(false)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    } finally {
      setBusy('idle')
    }
  }

  async function revealSecretFinding(skillId: string, relativePath: string) {
    try {
      await invoke('reveal_sync_secret_finding', { skillId, relativePath })
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    }
  }

	useEffect(() => {
	  const returnHome = () => {
		setShowInventory(false)
		setInspectedSkillKey(null)
		setPreview(null)
		setShowDestination(false)
		setSetupMode(null)
		setRemoteUrl('')
	  }
	  window.addEventListener('skiller:sync-home', returnHome)
	  return () => window.removeEventListener('skiller:sync-home', returnHome)
	}, [])

  async function createGitHubRepository() {
    setBusy('creating')
    try {
      const result = await invoke('sync_github_create_repo', { repository: repositoryName, visibility: 'private' })
      setRemoteUrl(result.remoteUrl)
		toast('Private GitHub repository created. Your library is ready to create.')
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    } finally {
      setBusy('idle')
    }
  }

  async function publishBackup() {
    if (!remoteUrl) return
    setBusy('publishing')
    try {
      await invoke('sync_center_publish', { remoteUrl, selectedKeys })
		toast('Your skill library is ready.')
      setPreview(null)
      setSetupMode(null)
      await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
      await queryClient.invalidateQueries({ queryKey: ['sync-center-inventory'] })
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    } finally {
      setBusy('idle')
    }
  }

  async function reviewRemoteChanges() {
    if (!profile) return
    setBusy('reviewing')
    try {
      const result = await invoke('sync_three_way_review', { profileId: profile.profile_id })
      setRemoteReview(result)
	  setRemoteSelections(result.skills.filter((skill) => skill.action === 'take-remote').map((skill) => skill.id))
	  setLocalSelections(result.skills.filter((skill) => skill.action === 'publish-local').map((skill) => skill.id))
	  setKeepLocalSelections(result.skills.filter((skill) => skill.kind === 'bundled' && (skill.action === 'conflict' || skill.action === 'unmanaged')).map((skill) => skill.id))
	  setKeepExternalSelections(result.skills.filter((skill) => skill.kind !== 'bundled' && skill.action === 'conflict').map((skill) => skill.id))
      setShowInventory(true)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    } finally {
      setBusy('idle')
    }
  }

	async function publishSelectedLocalChanges() {
	  if (!profile || localSelections.length === 0) return
	  setBusy('publishing')
	  try {
		await invoke('sync_publish_local_changes', { profileId: profile.profile_id, skillIds: localSelections })
		toast(`Published ${localSelections.length} reviewed local change${localSelections.length === 1 ? '' : 's'}.`)
		setRemoteReview(null)
		setLocalSelections([])
		await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
	  } catch (error) {
		toast(error instanceof Error ? error.message : String(error), 'destructive')
	  } finally {
		setBusy('idle')
	  }
	}

	async function keepSelectedLocalChanges() {
	  if (!profile || keepLocalSelections.length === 0) return
	  setBusy('publishing')
	  try {
		const result = await invoke('sync_keep_local_changes', { profileId: profile.profile_id, skillIds: keepLocalSelections })
		toast(`Kept ${result.kept.length} local change${result.kept.length === 1 ? '' : 's'} without modifying the remote.`)
		setRemoteReview(await invoke('sync_three_way_review', { profileId: profile.profile_id }))
		setKeepLocalSelections([])
	  } catch (error) {
		toast(error instanceof Error ? error.message : String(error), 'destructive')
	  } finally {
		setBusy('idle')
	  }
	}

	async function keepSelectedExternalChanges() {
	  if (!profile || keepExternalSelections.length === 0) return
	  setBusy('publishing')
	  try {
		const result = await invoke('sync_keep_external_local_changes', { profileId: profile.profile_id, skillIds: keepExternalSelections })
		toast(`Kept ${result.kept.length} external local change${result.kept.length === 1 ? '' : 's'} on this computer.`)
		setRemoteReview(await invoke('sync_three_way_review', { profileId: profile.profile_id }))
		setKeepExternalSelections([])
	  } catch (error) {
		toast(error instanceof Error ? error.message : String(error), 'destructive')
	  } finally {
		setBusy('idle')
	  }
	}

  async function refreshRemoteStatus() {
    setBusy('reviewing')
    try {
      const refreshed = await invoke('refresh_sync_profiles')
      queryClient.setQueryData(['sync-profiles'], refreshed)
      const current = refreshed.find((item) => item.profile_id === profile?.profile_id)
      if (current?.check_error) toast(current.check_error, 'destructive')
      else toast(current?.behind ? `${current.behind} remote change${current.behind === 1 ? '' : 's'} ready to review.` : 'Your remote library is up to date.')
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    } finally {
      setBusy('idle')
    }
  }

  async function applySelectedRemoteChanges() {
    if (!profile || remoteSelections.length === 0) return
    setBusy('publishing')
    try {
      const result = await invoke('sync_apply_remote_changes', { profileId: profile.profile_id, skillIds: remoteSelections })
      toast(`Restored ${result.restored.length} remote change${result.restored.length === 1 ? '' : 's'}.`)
      setRemoteReview(null)
      setRemoteSelections([])
      await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
      await queryClient.invalidateQueries({ queryKey: ['sync-center-inventory'] })
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    } finally {
      setBusy('idle')
    }
  }

	async function useRemoteForConflict(skillId: string) {
	  if (!profile) return
	  setBusy('publishing')
	  try {
		const result = await invoke('sync_apply_conflicting_remote_changes', { profileId: profile.profile_id, skillIds: [skillId] })
		toast(`Replaced the local copy of ${result.restored[0]} with the reviewed remote version.`)
		setRemoteReview(await invoke('sync_three_way_review', { profileId: profile.profile_id }))
		await queryClient.invalidateQueries({ queryKey: ['sync-center-inventory'] })
	  } catch (error) {
		toast(error instanceof Error ? error.message : String(error), 'destructive')
	  } finally {
		setBusy('idle')
	  }
	}

  async function recoverInterruptedRestore() {
    if (!profile) return
    setBusy('reviewing')
    try {
      const result = await invoke('sync_recovery_rollback', { profileId: profile.profile_id })
      toast(result.recovered ? 'Interrupted restore was rolled back safely.' : 'No interrupted restore was found.')
      await queryClient.invalidateQueries({ queryKey: ['sync-recovery', profile.profile_id] })
      await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
      await queryClient.invalidateQueries({ queryKey: ['sync-center-inventory'] })
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    } finally {
      setBusy('idle')
    }
  }

  return (
    <div className={isLanding ? 'h-full w-full animate-fade-in-up' : `mx-auto w-full max-w-4xl px-6 py-8 animate-fade-in-up ${showInventory ? 'flex h-full min-h-0 flex-col overflow-hidden pb-3' : 'min-h-full pb-12'}`}>
      {isLanding && (
        <section className="sync-center-hero relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden px-6 py-10 text-center text-primary-foreground">
          <div className="absolute -left-28 -top-24 size-80 rounded-full border border-white/15" />
          <div className="absolute -bottom-36 -right-20 size-[28rem] rounded-full border border-white/12" />
          <div className="relative max-w-2xl">
			<div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-white"><Cloud className="size-3.5" /> Sync Center</div>
			<h1 className="mt-6 text-balance text-4xl font-semibold tracking-[-0.055em] text-white sm:text-5xl">Keep your agent skills<br />ready for anything.</h1>
			<p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-primary-foreground/82 sm:text-base">Your hard-won skills, collected in one library you can carry to a new computer or share when you choose.</p>
            <div className="mt-8 flex flex-col items-center">
			  <Button size="lg" className="sync-library-cta h-11 px-5" onClick={() => setShowInventory(true)}>
				<span className="text-[13px] font-semibold">Create my library</span>
                <ChevronRight className="ml-0.5 size-4" />
              </Button>
			  <p className="mt-2 text-[11px] text-primary-foreground/68">Nothing is created or uploaded until you choose a destination.</p>
            </div>
            <div className="mt-9 flex flex-wrap justify-center gap-x-7 gap-y-2 text-xs text-primary-foreground/76">
			  <span>{inventoryLoading ? 'Scanning your setup…' : `${plural(librarySkillCount, 'skill')} ready for your library`}</span>
			  {agentCount > 0 && <span>{inventoryLoading ? '' : `${plural(agentCount, 'agent')} linked`}</span>}
			  <span>Private by default · share when ready</span>
            </div>
          </div>
        </section>
      )}

      {profile && (
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">Sync Center</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-foreground">Your skill library</h1>
          </div>
		  <div className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-3.5" /> In sync</div>
        </header>
      )}

      {profile && (
        <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-(--ds-shadow-layered-subtle)">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
			  <h2 className="text-sm font-semibold">{profile.skill_count} skills in your library</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {profile.changed ? 'Your library has local changes to review.' : 'Your local library is clean.'}
                {profile.behind > 0 ? ` ${profile.behind} remote change${profile.behind === 1 ? '' : 's'} available.` : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={refreshRemoteStatus} disabled={busy !== 'idle'}>Check now</Button>
              <Button size="sm" onClick={reviewRemoteChanges} disabled={busy !== 'idle'}>Review changes <ChevronRight className="size-3.5" /></Button>
            </div>
          </div>
		  {profile.check_error && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{profile.check_error}</p>}
        </section>
      )}

      {profile && recovery?.pending && (
        <section className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
            <div>
              <h2 className="text-sm font-semibold text-amber-950 dark:text-amber-100">An interrupted restore needs recovery</h2>
              <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">Skiller kept backups before the operation. Restore the pre-change state before reviewing anything else.</p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={recoverInterruptedRestore} disabled={busy !== 'idle'}>Restore pre-change state</Button>
        </section>
      )}

      {showInventory && (
        <section className={`${!profile ? 'mt-0 flex min-h-0 flex-1 flex-col overflow-hidden' : 'mt-5'} px-1`}>
          {!preview && <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Step 1 of 2</p>
              <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em]">Review your library</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Identical skills are grouped once. A skill in an individual agent folder is not automatically moved or overwritten.
              </p>
            </div>
          </div>}
		  {!profile && !preview && (
			<div className="order-4 mt-4 flex w-full shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border/60 px-1 pt-3">
			  <p className="text-xs font-semibold">{selectedKeys.length} skills selected <span className="ml-1 font-normal text-muted-foreground">{librarySkillCount > selectedKeys.length ? `${librarySkillCount - selectedKeys.length} stay only on this computer` : 'Ready for the next step'}</span></p>
			  <div className="flex gap-2">
				<Button size="lg" onClick={prepareStorageChoice} disabled={busy !== 'idle' || selectedKeys.length === 0}>{busy === 'reviewing' ? <><Loader2 className="size-3.5 animate-spin" />Preparing your library…</> : <>Choose a home <ChevronRight className="size-3.5" /></>}</Button>
			</div>
			</div>
		  )}

		  {!preview && <div className="order-2 mt-4 flex min-h-0 flex-1 overflow-hidden">
			<div ref={inventoryScrollRef} className="min-w-0 flex-1 overflow-y-auto pr-1"><div className="relative w-full" style={{ height: inventoryVirtualizer.getTotalSize() }}>
			{inventoryVirtualizer.getVirtualItems().map((virtualItem) => {
			  const item = inventoryItems[virtualItem.index]
			  if (!item) return null
			  return <div key={virtualItem.key} className="absolute left-0 top-0 w-full border-b border-border/60" style={{ transform: `translateY(${virtualItem.start}px)` }}>
				<InventorySkillRow item={item} selected={selectedKeySet.has(item.candidate_key)} inspected={item.candidate_key === inspectedSkillKey} onToggle={toggleSelectedKey} onInspect={setInspectedSkillKey} />
			  </div>
			})}
			{!inventoryLoading && librarySkillCount === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">No valid skills were found yet.</p>}
			</div></div>
			{inspectedSkill && <ReviewSkillDetail item={inspectedSkill} onClose={() => setInspectedSkillKey(null)} />}
		  </div>}
		  {!profile && !preview && (inventory?.invalid_paths || inventory?.collisions.length || inventory?.linked_aliases) ? <div className="order-3 mt-3 shrink-0 space-y-2 border-t border-border/60 px-1 pt-3 text-xs">
		  {inventory?.invalid_paths ? <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /><div><p><span className="font-semibold">{plural(inventory.invalid_paths, 'folder')} wasn’t included.</span> It stays unchanged on this computer.</p><details className="mt-1.5"><summary className="cursor-pointer font-medium text-amber-900 underline-offset-2 hover:underline dark:text-amber-100">Why?</summary><ul className="mt-1.5 space-y-1 border-l border-amber-500/30 pl-2.5">{(inventory.invalid_entries ?? []).map((entry) => <li key={`${entry.display_name}-${entry.reason}`}><span className="font-medium">{entry.display_name}</span><span className="text-amber-800/80 dark:text-amber-200/80"> has a linked file. Skiller leaves it local rather than following it outside this folder.</span></li>)}</ul><p className="mt-2 leading-relaxed text-amber-800/80 dark:text-amber-200/80">To include it later, replace the linked file with a regular file inside the skill folder.</p></details></div></div> : null}
			{(inventory?.collisions.length ?? 0) > 0 && <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /><p>{plural(inventory?.collisions.length ?? 0, 'skill')} have the same name but different contents. Choose the version to include; Skiller will not decide by filename.</p></div>}
			{(inventory?.linked_aliases ?? 0) > 0 && <div className="flex items-start gap-2 text-muted-foreground"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" /><p>{plural(inventory?.linked_aliases ?? 0, 'agent link')} already use this library.</p></div>}
		  </div> : null}
          {remoteReview && (
            <div className="mt-4 rounded-xl border border-border bg-muted/25 p-3 text-xs">
			  <p className="font-semibold">Change review</p>
			  <div className="mt-2 space-y-1 text-muted-foreground">
				{remoteReview.skills.map((skill) => {
				  const isExternalConflict = skill.kind !== 'bundled' && skill.action === 'conflict'
				  const selectable = skill.action === 'take-remote' || skill.action === 'publish-local' || ((skill.action === 'conflict' || skill.action === 'unmanaged') && skill.kind === 'bundled') || isExternalConflict
				  const selected = skill.action === 'take-remote' ? remoteSelections : skill.action === 'publish-local' ? localSelections : isExternalConflict ? keepExternalSelections : keepLocalSelections
				  const setSelected = skill.action === 'take-remote' ? setRemoteSelections : skill.action === 'publish-local' ? setLocalSelections : isExternalConflict ? setKeepExternalSelections : setKeepLocalSelections
				  return <label key={skill.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-background/60">
					<input type="checkbox" disabled={!selectable} checked={selectable && selected.includes(skill.id)} onChange={() => setSelected((current) => current.includes(skill.id) ? current.filter((id) => id !== skill.id) : [...current, skill.id])} />
					<span className="min-w-0 flex-1"><span className="block truncate">{skill.id}</span>{skill.source && <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/80" title={`${skill.source.repository} @ ${skill.source.ref}`}>{skill.kind === 'skills_sh' ? 'skills.sh' : 'Git'} · {skill.source.ref.slice(0, 8)}</span>}</span>
					<span>{skill.action.replace('-', ' ')}</span>
					{skill.action === 'conflict' && skill.kind === 'bundled' && <Button size="xs" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={(event) => { event.preventDefault(); void useRemoteForConflict(skill.id) }} disabled={busy !== 'idle'}>Use remote</Button>}
				  </label>
				})}
			  </div>
			  {externalConflicts.length > 0 && <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2.5 text-amber-950 dark:text-amber-100"><p className="font-medium">{plural(externalConflicts.length, 'external skill')} need{externalConflicts.length === 1 ? 's' : ''} your decision</p><p className="mt-1 leading-relaxed text-amber-900/80 dark:text-amber-200/80">Their local folders differ from the pinned Git source above. Skiller has not changed them. Inspect the local copy, then either keep it as your own skill or move it aside before reviewing again to install the pinned source.</p></div>}
			  <p className="mt-2 text-muted-foreground">Remote-only changes can be applied; local-only changes can be published. A bundled-skill conflict can use the reviewed remote copy. External-source conflicts stay untouched.</p>
              {remoteSelections.length > 0 && <Button size="sm" className="mt-3" onClick={applySelectedRemoteChanges} disabled={busy !== 'idle'}>Apply selected remote changes</Button>}
			  {localSelections.length > 0 && <Button size="sm" variant="outline" className="mt-3 ml-2" onClick={publishSelectedLocalChanges} disabled={busy !== 'idle'}>Publish selected local changes</Button>}
			  {keepLocalSelections.length > 0 && <Button size="sm" variant="outline" className="mt-3 ml-2" onClick={keepSelectedLocalChanges} disabled={busy !== 'idle'}>Keep selected local changes</Button>}
			  {keepExternalSelections.length > 0 && <Button size="sm" variant="outline" className="mt-3 ml-2" onClick={keepSelectedExternalChanges} disabled={busy !== 'idle'}>Keep selected external local skills</Button>}
            </div>
          )}
          {preview && (
            <div className="mt-0 flex min-h-0 flex-1 flex-col text-xs">
			  <div className="shrink-0"><Button variant="outline" size="sm" className="mb-3 h-8 px-2.5" onClick={() => showDestination ? setShowDestination(false) : (() => { setPreview(null); setSetupMode(null); setRemoteUrl('') })()}><ChevronLeft className="size-3.5" />{showDestination ? 'Back to plan' : 'Back to skills'}</Button><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Step {showDestination ? '3' : '2'} of 3</p><h2 className="mt-1 text-lg font-semibold tracking-[-0.02em]">{showDestination ? 'Choose a home for your library' : 'Review your library plan'}</h2><p className="mt-1 leading-relaxed text-muted-foreground">{showDestination ? 'Pick where Skiller should create your library. You will set its repository name before anything is created.' : 'See exactly what will be saved, linked, or left alone before choosing where it lives.'}</p></div>
			  {!showDestination && <><div className="min-h-0 flex-1 overflow-y-auto pr-1"><section className="mt-5 overflow-hidden rounded-xl border border-border/70 bg-background/35"><div className="border-b border-border/60 bg-primary/[0.06] px-4 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Your new repository will contain</p><p className="mt-1 text-muted-foreground">A standard dotagent library: <span className="font-medium text-foreground">skills.json, skills.lock, dotagent.yaml</span>, a README, and the owned skill folders below. Machine paths, tokens, and local decisions stay on this computer.</p></div><div className="divide-y divide-border/60"><div className="flex gap-3 px-4 py-3"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /><div><p className="font-semibold text-foreground">{plural(preview.skills.length, 'local skill')} copied into the repository</p><p className="mt-0.5 text-muted-foreground">{preview.skills.reduce((total, skill) => total + skill.file_count, 0)} reviewed files will live under skills/. Nothing is changed on this computer until you confirm.</p></div></div><div className="flex gap-3 px-4 py-3"><Info className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="font-semibold text-foreground">{preview.skills_sh.length + preview.references.length} skills recorded as immutable dependencies</p><p className="mt-0.5 text-muted-foreground">{preview.skills_sh.length} from skills.sh · {preview.references.length} from Git. Their exact commits and integrity go into skills.lock; their files are not duplicated.</p></div></div><div className={`flex gap-3 px-4 py-3 ${preview.unresolved_sources?.length ? 'bg-amber-500/[0.05]' : ''}`}><AlertTriangle className={`mt-0.5 size-4 shrink-0 ${preview.unresolved_sources?.length ? 'text-amber-600 dark:text-amber-300' : 'text-muted-foreground'}`} /><div><p className="font-semibold text-foreground">{preview.unresolved_sources?.length ? `${plural(preview.unresolved_sources.length, 'external skill')} not included yet` : 'No skills are excluded'}</p><p className="mt-0.5 text-muted-foreground">{preview.unresolved_sources?.length ? 'They will not appear in this repository. They remain unchanged on this computer.' : 'Every selected skill can be included.'}</p></div></div></div></section>
			  {preview.unresolved_sources && preview.unresolved_sources.length > 0 && <section className="mt-4 rounded-xl border border-amber-400/35 bg-amber-500/[0.07] px-4 py-3.5 text-amber-950 dark:text-amber-100"><div className="flex gap-3"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" /><div className="min-w-0"><p className="font-semibold">{plural(preview.unresolved_sources.length, 'external skill')} will stay on this computer</p><p className="mt-1 leading-relaxed text-amber-900/80 dark:text-amber-200/80">Skiller could not verify the source, so it will neither upload nor change these skills. Reconnect or authenticate their Git source, then refresh this review when you want to include them.</p><details className="mt-3"><summary className="cursor-pointer font-medium text-amber-900 underline-offset-2 hover:underline dark:text-amber-100">View affected skills ({preview.unresolved_sources.length})</summary><div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-amber-900/80 dark:text-amber-200/80">{preview.unresolved_sources.map((source) => <span key={`${source.kind}-${source.id}`}>{source.id}</span>)}</div></details></div></div></section>}
			  {preview.secret_findings.length > 0 ? <section className="mt-4 border-y border-destructive/25 py-3"><p className="font-medium text-destructive">Backup is paused: review {preview.secret_findings.length} possible secret{preview.secret_findings.length === 1 ? '' : 's'} in {groupSecretFindings(preview.secret_findings).length} file{groupSecretFindings(preview.secret_findings).length === 1 ? '' : 's'} first.</p><p className="mt-1 text-muted-foreground">Skiller never shows the matched value. Lines below identify what needs your decision.</p><div className="mt-2 max-h-40 divide-y divide-destructive/10 overflow-y-auto rounded-lg border border-destructive/15 bg-background/45">{groupSecretFindings(preview.secret_findings).map((group) => <div key={`${group.skillId}-${group.relativePath}`} className="px-2.5 py-2"><div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate font-medium text-foreground">{group.skillId} <span className="font-normal text-muted-foreground">· {group.relativePath}</span></p><Button size="xs" variant="ghost" className="h-6 shrink-0 px-1.5 text-[11px]" onClick={() => void revealSecretFinding(group.skillId, group.relativePath)}><FolderOpen className="size-3" />Show file</Button></div><div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">{group.findings.map((finding) => <p key={`${finding.line}-${finding.column}-${finding.rule}`}>Line {finding.line} · Possible {secretRuleLabel(finding.rule)}</p>)}</div></div>)}</div></section> : <p className="mt-3 flex items-center gap-1.5 text-muted-foreground"><CheckCircle2 className="size-3.5 text-emerald-500" />No secret patterns found. This review is rebuilt immediately before commit.</p>}</div><div className="mt-3 flex shrink-0 items-center justify-end border-t border-border/60 pt-3"><Button size="sm" className="h-9 px-4" onClick={() => setShowDestination(true)} disabled={preview.secret_findings.length > 0}>Choose a Git home <ChevronRight className="size-3.5" /></Button></div></>}
			  {showDestination && <div className="min-h-0 flex-1 overflow-y-auto pr-1"><section className="mt-5 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => { setSetupMode('github'); setRemoteUrl('') }} className={`rounded-xl border p-4 text-left transition-colors ${setupMode === 'github' ? 'border-primary bg-primary/[0.07] ring-1 ring-primary/30' : 'border-border/70 hover:border-primary/45 hover:bg-muted/30'}`}><div className="flex items-center justify-between"><span className="flex items-center gap-2 font-semibold"><Github className="size-4" />GitHub</span><span className="text-[10px] font-medium text-primary">Private by default</span></div><p className="mt-1.5 leading-relaxed text-muted-foreground">Create a new private repository with your existing GitHub sign-in.</p></button><button type="button" onClick={() => setSetupMode('custom')} className={`rounded-xl border p-4 text-left transition-colors ${setupMode === 'custom' ? 'border-primary bg-primary/[0.07] ring-1 ring-primary/30' : 'border-border/70 hover:border-primary/45 hover:bg-muted/30'}`}><span className="flex items-center gap-2 font-semibold"><Server className="size-4" />Another Git server</span><p className="mt-1.5 leading-relaxed text-muted-foreground">Use GitLab, a self-hosted server, or another remote you control.</p></button></section>
			  {setupMode === 'github' ? (
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border/60 pt-4">
                  {!remoteUrl ? <>
                    <label className="grid gap-1 text-[11px] text-muted-foreground">Repository name
                      <input value={repositoryName} onChange={(event) => setRepositoryName(event.target.value)} className="h-8 w-52 rounded-lg border border-border bg-background px-2 text-xs text-foreground" />
					  <span className="max-w-52 leading-relaxed">Uses your existing GitHub CLI sign-in. Skiller never receives or stores a GitHub token.</span></label>
                    <Button size="sm" onClick={createGitHubRepository} disabled={busy !== 'idle' || preview.secret_findings.length > 0}>Create private GitHub repo</Button>
				  </> : <Button size="sm" onClick={publishBackup} disabled={busy !== 'idle' || preview.secret_findings.length > 0}>Create library</Button>}
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-end gap-2">
				  <label className="grid gap-1 text-[11px] text-muted-foreground">Git remote <span className="font-normal">Visibility is controlled by this server.</span>
                    <input value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="git@git.example.com:team/agent-library.git" className="h-8 w-72 rounded-lg border border-border bg-background px-2 text-xs text-foreground" />
                  </label>
				  <Button size="sm" onClick={publishBackup} disabled={busy !== 'idle' || !remoteUrl || preview.secret_findings.length > 0}>Create library</Button>
                </div>
			  )}</div>}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
