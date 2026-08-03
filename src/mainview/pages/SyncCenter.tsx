import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Cloud, FolderOpen, Github, Info, Loader2, Server, X } from 'lucide-react'
import { invoke } from '@/mainview/lib/native'
import type { AgentConfigJson, SyncInventoryJson, SyncLibraryDecisionJson, SyncProfileStatusJson, SyncPublishPreviewJson, SyncThreeWayReviewJson } from '@/shared/rpc-schema'
import { Button } from '@/mainview/components/ui/button'
import { useToast } from '@/mainview/components/ToastProvider'
import { AgentIcon } from '@/mainview/components/AgentIcon'
import MarkdownContent from '@/mainview/components/MarkdownContent'

function plural(count: number, word: string): string {
	const pluralWord = word.endsWith('y') ? `${word.slice(0, -1)}ies` : `${word}s`
	return `${count} ${count === 1 ? word : pluralWord}`
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

function defaultLibraryDecision(item: InventoryItem): SyncLibraryDecisionJson {
	return { candidateKey: item.candidate_key, disposition: item.source.kind === 'local' ? 'owned' : 'dependency' }
}

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

function ReviewSkillDetail({ item, decision, onDecision, onClose }: { item: InventoryItem; decision: SyncLibraryDecisionJson; onDecision: (decision: SyncLibraryDecisionJson) => void; onClose: () => void }) {
	const agentSlugs = [...new Set(item.locations.flatMap((location) => location.agent_slug ? [location.agent_slug] : []))]
	const isShared = item.locations.some((location) => location.kind === 'shared')
	const external = item.source.kind !== 'local'
	const choices = external ? [
		{ disposition: 'dependency' as const, title: 'Pin its source', detail: 'Recommended. Save the exact Git commit without uploading another copy.' },
		{ disposition: 'vendored' as const, title: 'Keep a reviewed copy', detail: 'Publish these files with their upstream commit, integrity, and license.' },
		{ disposition: 'owned' as const, title: 'Make it mine', detail: 'Publish the current files as your own skill without an upstream update link.' },
		{ disposition: 'local-only' as const, title: 'This computer only', detail: 'Leave it untouched and out of the repository.' },
	] : [
		{ disposition: 'owned' as const, title: 'Save in my library', detail: 'Publish the reviewed files under skills/ so they travel with your library.' },
		{ disposition: 'local-only' as const, title: 'This computer only', detail: 'Leave it untouched and out of the repository.' },
	]
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
			<div className="mt-4 border-y border-border/60 py-3 text-[11px] text-muted-foreground">{item.source.kind === 'skills_sh' ? <><p className="font-medium text-foreground">Installed through skills.sh</p><p className="mt-1 leading-relaxed">Skiller can pin its exact source, keep a licensed copy, or leave it only on this computer.</p></> : item.source.kind === 'git_reference' ? <><p className="font-medium text-foreground">Installed from a Git source</p><p className="mt-1 leading-relaxed">Skiller can pin its exact source, keep a licensed copy, or leave it only on this computer.</p></> : <><p className="font-medium text-foreground">Local skill</p><p className="mt-1 leading-relaxed">This skill has no verified upstream source. Save it as part of your library or keep it only here.</p></>}</div>
			<fieldset className="border-b border-border/60 py-3"><legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Library outcome</legend><div className="grid gap-0.5">{choices.map((choice) => <label key={choice.disposition} className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 transition-colors ${decision.disposition === choice.disposition ? 'bg-primary/[0.08] text-foreground' : 'text-muted-foreground hover:bg-muted/45 hover:text-foreground'}`}><input type="radio" name={`library-outcome-${item.candidate_key}`} value={choice.disposition} checked={decision.disposition === choice.disposition} onChange={() => onDecision({ candidateKey: item.candidate_key, disposition: choice.disposition })} className="mt-0.5 cursor-pointer" /><span><span className="block text-xs font-medium">{choice.title}</span><span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">{choice.detail}</span></span></label>)}</div>{decision.disposition === 'vendored' && <label className="mt-2 grid gap-1 px-2 text-[10px] font-medium text-foreground">Upstream license<input value={decision.license ?? ''} onChange={(event) => onDecision({ candidateKey: item.candidate_key, disposition: 'vendored', license: event.target.value })} placeholder="SPDX ID, for example MIT" className="h-8 rounded-md border border-border bg-background px-2 text-xs font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-describedby={`vendored-license-${item.candidate_key}`} /><span id={`vendored-license-${item.candidate_key}`} className="font-normal leading-relaxed text-muted-foreground">Required because your public or private repository will redistribute these files.</span></label>}</fieldset>
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
  const [showConnect, setShowConnect] = useState(false)
  const [connectRemoteUrl, setConnectRemoteUrl] = useState('')
  const [connectAgentSlugs, setConnectAgentSlugs] = useState<string[]>([])
  const [connectSelectionReady, setConnectSelectionReady] = useState(false)
  const [inspectedSkillKey, setInspectedSkillKey] = useState<string | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [libraryDecisions, setLibraryDecisions] = useState<Record<string, SyncLibraryDecisionJson>>({})
  const [selectionReady, setSelectionReady] = useState(false)
  const [setupMode, setSetupMode] = useState<'github' | 'custom' | null>(null)
  const [repositoryName, setRepositoryName] = useState('skiller-agent-library')
  const [libraryMode, setLibraryMode] = useState<'private' | 'public'>('private')
  const [libraryLicense, setLibraryLicense] = useState<'' | 'MIT' | 'Apache-2.0' | 'CC0-1.0'>('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [preview, setPreview] = useState<SyncPublishPreviewJson | null>(null)
  const [showDestination, setShowDestination] = useState(false)
  const [remoteReview, setRemoteReview] = useState<SyncThreeWayReviewJson | null>(null)
	const [remoteSelections, setRemoteSelections] = useState<string[]>([])
	const [localSelections, setLocalSelections] = useState<string[]>([])
  const [busy, setBusy] = useState<'idle' | 'reviewing' | 'creating' | 'connecting' | 'publishing'>('idle')
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
  const { data: agents } = useQuery<AgentConfigJson[]>({
    queryKey: ['sync-agents'],
    queryFn: () => invoke('list_agents'),
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
	const reviewedDecisions = useMemo(() => inventoryItems.map((item) => libraryDecisions[item.candidate_key] ?? defaultLibraryDecision(item)), [inventoryItems, libraryDecisions])
	const missingVendoredLicenses = reviewedDecisions.filter((decision) => decision.disposition === 'vendored' && !decision.license?.trim())
	const previewOwnedCount = preview?.decisions.filter((decision) => decision.disposition === 'owned').length ?? 0
	const previewVendoredCount = preview?.decisions.filter((decision) => decision.disposition === 'vendored').length ?? 0
	const previewLocalCount = preview?.decisions.filter((decision) => decision.disposition === 'local-only' || decision.disposition === 'excluded').length ?? 0
	const externalConflicts = useMemo(() => remoteReview?.skills.filter((skill) => skill.kind !== 'bundled' && skill.action === 'conflict') ?? [], [remoteReview])
	const toggleSelectedKey = useCallback((key: string) => {
	  const selected = selectedKeySet.has(key)
	  const item = inventoryItems.find((candidate) => candidate.candidate_key === key)
	  if (!item) return
	  setLibraryDecisions((decisions) => ({ ...decisions, [key]: selected ? { candidateKey: key, disposition: 'local-only' } : defaultLibraryDecision(item) }))
	  setSelectedKeys((current) => selected ? current.filter((item) => item !== key) : [...current, key])
	}, [inventoryItems, selectedKeySet])
	const chooseLibraryOutcome = useCallback((decision: SyncLibraryDecisionJson) => {
	  setLibraryDecisions((current) => ({ ...current, [decision.candidateKey]: decision }))
	  setSelectedKeys((current) => {
		const included = decision.disposition === 'owned' || decision.disposition === 'dependency' || decision.disposition === 'vendored' || decision.disposition === 'suggested'
		return included ? current.includes(decision.candidateKey) ? current : [...current, decision.candidateKey] : current.filter((key) => key !== decision.candidateKey)
	  })
	}, [])
  const { data: recovery } = useQuery<{ pending: boolean }>({
    queryKey: ['sync-recovery', profile?.profile_id],
    queryFn: () => invoke('sync_recovery_status', { profileId: profile!.profile_id }),
    enabled: Boolean(profile),
  })
	const librarySkillCount = inventory?.items.length ?? 0
	const detectedAgents = agents?.filter((agent) => agent.detected) ?? []
	const agentCount = new Set(inventory?.items.flatMap((item) => item.locations.flatMap((location) => location.agent_slug ? [location.agent_slug] : [])) ?? []).size
	const isLanding = !profile && !profilesLoading && !showInventory

  useEffect(() => {
    if (!inventory || selectionReady) return
    setSelectedKeys(inventory.items.map((item) => item.candidate_key))
	setLibraryDecisions(Object.fromEntries(inventory.items.map((item) => [item.candidate_key, defaultLibraryDecision(item)])))
    setSelectionReady(true)
  }, [inventory, selectionReady])

  useEffect(() => {
    if (!agents || connectSelectionReady) return
    setConnectAgentSlugs(agents.filter((agent) => agent.detected).map((agent) => agent.slug))
    setConnectSelectionReady(true)
  }, [agents, connectSelectionReady])

  async function prepareStorageChoice() {
    setBusy('reviewing')
    try {
      const result = await invoke('sync_center_publish_preview', { selectedKeys, decisions: reviewedDecisions, mode: libraryMode })
      setPreview(result)
      setShowDestination(false)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    } finally {
      setBusy('idle')
    }
  }

  async function changeLibraryMode(mode: 'private' | 'public') {
    if (mode === libraryMode) return
    setLibraryMode(mode)
    if (!preview) return
    setBusy('reviewing')
    try {
      setPreview(await invoke('sync_center_publish_preview', { selectedKeys, decisions: reviewedDecisions, mode }))
    } catch (error) {
      setPreview(null)
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
		setShowConnect(false)
		setInspectedSkillKey(null)
		setPreview(null)
		setShowDestination(false)
		setSetupMode(null)
		setRemoteUrl('')
	  }
	  window.addEventListener('skiller:sync-home', returnHome)
	  return () => window.removeEventListener('skiller:sync-home', returnHome)
	}, [])

  function showThreeWayReview(result: SyncThreeWayReviewJson) {
    setRemoteReview(result)
    setRemoteSelections(result.skills.filter((skill) => skill.action === 'take-remote').map((skill) => skill.id))
    setLocalSelections(result.skills.filter((skill) => skill.action === 'publish-local').map((skill) => skill.id))
  }

  async function connectExistingLibrary() {
    if (!connectRemoteUrl.trim()) return
    setBusy('connecting')
    try {
      const connected = await invoke('sync_center_connect', {
        remoteUrl: connectRemoteUrl,
        agentSlugs: connectAgentSlugs,
      })
      await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
      const review = await invoke('sync_three_way_review', { profileId: connected.profile_id })
      showThreeWayReview(review)
      setShowConnect(false)
      setShowInventory(true)
      toast('Library connected locally. Review the skills before restoring anything.')
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    } finally {
      setBusy('idle')
    }
  }

  async function createGitHubRepository() {
    setBusy('creating')
    try {
      const result = await invoke('sync_github_create_repo', { repository: repositoryName, visibility: libraryMode })
      setRemoteUrl(result.remoteUrl)
		toast(`${libraryMode === 'private' ? 'Private' : 'Public'} GitHub repository created. Your library is ready to create.`)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    } finally {
      setBusy('idle')
    }
  }

  async function publishBackup() {
    if (!remoteUrl || !preview) return
    setBusy('publishing')
    try {
      await invoke('sync_center_publish', {
        remoteUrl,
        selectedKeys,
        decisions: reviewedDecisions,
        mode: libraryMode,
        license: libraryMode === 'public' ? libraryLicense || undefined : undefined,
        planId: preview.plan_id,
      })
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
      showThreeWayReview(result)
      setShowInventory(true)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    } finally {
      setBusy('idle')
    }
  }

	async function publishSelectedLocalChanges() {
	  if (!profile || !remoteReview || localSelections.length === 0) return
	  setBusy('publishing')
	  try {
		await invoke('sync_publish_local_changes', { profileId: profile.profile_id, skillIds: localSelections, reconciliationPlanId: remoteReview.reconciliation_plan_id })
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
    if (!profile || !remoteReview || remoteSelections.length === 0) return
    setBusy('publishing')
    try {
      const result = await invoke('sync_apply_remote_changes', { profileId: profile.profile_id, skillIds: remoteSelections, reconciliationPlanId: remoteReview.reconciliation_plan_id })
      toast(`Restored ${result.restored.length} remote change${result.restored.length === 1 ? '' : 's'}.`)
      setRemoteReview(null)
      setRemoteSelections([])
	  setShowInventory(false)
      await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
      await queryClient.invalidateQueries({ queryKey: ['sync-center-inventory'] })
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    } finally {
      setBusy('idle')
    }
  }

	async function useRemoteForConflict(skillId: string) {
	  if (!profile || !remoteReview) return
	  setBusy('publishing')
	  try {
		const result = await invoke('sync_apply_conflicting_remote_changes', { profileId: profile.profile_id, skillIds: [skillId], reconciliationPlanId: remoteReview.reconciliation_plan_id })
		toast(`Replaced the local copy of ${result.restored[0]} with the reviewed remote version.`)
		setRemoteReview(await invoke('sync_three_way_review', { profileId: profile.profile_id }))
		await queryClient.invalidateQueries({ queryKey: ['sync-center-inventory'] })
	  } catch (error) {
		toast(error instanceof Error ? error.message : String(error), 'destructive')
	  } finally {
		setBusy('idle')
	  }
	}

	async function adoptLocalVersion(skillId: string) {
	  if (!profile || !remoteReview) return
	  setBusy('publishing')
	  try {
		await invoke('sync_adopt_local_changes', { profileId: profile.profile_id, skillIds: [skillId], reconciliationPlanId: remoteReview.reconciliation_plan_id })
		toast(`Published the local ${skillId} as the library version.`)
		showThreeWayReview(await invoke('sync_three_way_review', { profileId: profile.profile_id }))
		await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
	  } catch (error) {
		toast(error instanceof Error ? error.message : String(error), 'destructive')
	  } finally {
		setBusy('idle')
	  }
	}

	async function keepConflictLocal(skillId: string, external: boolean) {
	  if (!profile || !remoteReview) return
	  setBusy('publishing')
	  try {
		await invoke(external ? 'sync_keep_external_local_changes' : 'sync_keep_local_changes', { profileId: profile.profile_id, skillIds: [skillId], reconciliationPlanId: remoteReview.reconciliation_plan_id })
		toast(`Kept ${skillId} only on this computer.`)
		showThreeWayReview(await invoke('sync_three_way_review', { profileId: profile.profile_id }))
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
          {!showConnect ? <div className="relative max-w-2xl">
			<div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-white"><Cloud className="size-3.5" /> Sync Center</div>
			<h1 className="mt-6 text-balance text-4xl font-semibold tracking-[-0.055em] text-white sm:text-5xl">Keep your agent skills<br />ready for anything.</h1>
			<p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-primary-foreground/82 sm:text-base">Your hard-won skills, collected in one library you can carry to a new computer or share when you choose.</p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
			  <Button size="lg" className="sync-library-cta h-11 px-5" onClick={() => setShowInventory(true)}>
				<span className="text-[13px] font-semibold">Create my library</span>
                <ChevronRight className="ml-0.5 size-4" />
              </Button>
              <Button size="lg" variant="outline" className="h-11 border-white/25 bg-white/8 px-5 text-white hover:border-white/40 hover:bg-white/14 hover:text-white" onClick={() => setShowConnect(true)}>
                Use an existing library
              </Button>
            </div>
			<p className="mt-2 text-[11px] text-primary-foreground/68">Nothing is created or uploaded until you choose a destination.</p>
            <div className="mt-9 flex flex-wrap justify-center gap-x-7 gap-y-2 text-xs text-primary-foreground/76">
			  <span>{inventoryLoading ? 'Scanning your setup…' : `${plural(librarySkillCount, 'skill')} ready for your library`}</span>
			  {agentCount > 0 && <span>{inventoryLoading ? '' : `${plural(agentCount, 'agent')} linked`}</span>}
			  <span>Private by default · share when ready</span>
            </div>
          </div> : <div className="relative w-full max-w-2xl rounded-2xl border border-white/20 bg-background/95 p-5 text-left text-foreground shadow-2xl backdrop-blur-xl sm:p-6">
            <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => setShowConnect(false)}><ChevronLeft className="size-3.5" />Back</button>
            <div className="mt-4 flex items-start gap-3">
              <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Cloud className="size-5" /></div>
              <div><h1 className="text-xl font-semibold tracking-[-0.025em]">Use an existing library</h1><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Connect a public or private dotagent Git repository. Skiller downloads a managed local workspace first; it does not touch any agent folder until the next review is confirmed.</p></div>
            </div>
            <label className="mt-5 grid gap-1.5 text-xs font-medium">Git repository
              <input value={connectRemoteUrl} onChange={(event) => setConnectRemoteUrl(event.target.value)} placeholder="https://github.com/you/agent-library.git" spellCheck={false} className="h-10 rounded-lg border border-border bg-background px-3 text-xs font-normal text-foreground outline-none focus:ring-2 focus:ring-ring/40" />
            </label>
            <div className="mt-5 border-t border-border/60 pt-4">
              <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold">Use this library with</p><p className="mt-0.5 text-[11px] text-muted-foreground">This choice stays private in dotagent.local.yaml on this computer.</p></div>{detectedAgents.length > 0 && <button type="button" className="text-[11px] font-medium text-primary hover:underline" onClick={() => setConnectAgentSlugs(detectedAgents.map((agent) => agent.slug))}>All detected</button>}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {detectedAgents.map((agent) => { const checked = connectAgentSlugs.includes(agent.slug); return <label key={agent.slug} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors ${checked ? 'border-primary/45 bg-primary/[0.07]' : 'border-border hover:bg-muted/40'}`}><input type="checkbox" className="cursor-pointer" checked={checked} onChange={() => setConnectAgentSlugs((current) => checked ? current.filter((slug) => slug !== agent.slug) : [...current, agent.slug])} /><AgentIcon slug={agent.slug} className="size-4" /><span>{agent.name}</span></label> })}
                {agents && detectedAgents.length === 0 && <p className="text-xs text-muted-foreground">No agents are detected yet. You can still review the library and connect agents later.</p>}
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between gap-4 border-t border-border/60 pt-4"><p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">Private repositories use your existing Git or SSH credentials. Skiller does not receive or store them.</p><Button size="sm" className="h-9 shrink-0 px-4" onClick={connectExistingLibrary} disabled={busy !== 'idle' || !connectRemoteUrl.trim() || (detectedAgents.length > 0 && connectAgentSlugs.length === 0)}>{busy === 'connecting' ? <><Loader2 className="size-3.5 animate-spin" />Connecting…</> : <>Connect & review <ChevronRight className="size-3.5" /></>}</Button></div>
          </div>}
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
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{remoteReview ? 'Restore review' : 'Step 1 of 3'}</p>
              <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em]">{remoteReview ? 'Choose what comes to this computer' : 'Review your library'}</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {remoteReview ? 'Nothing below has been installed yet. Remote-only skills are selected; existing local skills stay untouched unless you explicitly choose otherwise.' : 'Identical skills are grouped once. A skill in an individual agent folder is not automatically moved or overwritten.'}
              </p>
            </div>
          </div>}
		  {!profile && !preview && (
			<div className="order-4 mt-4 flex w-full shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border/60 px-1 pt-3">
			  <p className="text-xs font-semibold">{selectedKeys.length} skills included <span className="ml-1 font-normal text-muted-foreground">{librarySkillCount > selectedKeys.length ? `${librarySkillCount - selectedKeys.length} stay only on this computer` : 'Ready for the next step'}</span>{missingVendoredLicenses.length > 0 && <span className="mt-1 block font-normal text-amber-700 dark:text-amber-300">Add an upstream license for {plural(missingVendoredLicenses.length, 'vendored skill')} in Skill details.</span>}</p>
			  <div className="flex gap-2">
				<Button size="lg" onClick={prepareStorageChoice} disabled={busy !== 'idle' || selectedKeys.length === 0 || missingVendoredLicenses.length > 0}>{busy === 'reviewing' ? <><Loader2 className="size-3.5 animate-spin" />Preparing your library…</> : <>Choose a home <ChevronRight className="size-3.5" /></>}</Button>
			</div>
			</div>
		  )}

		  {!preview && !remoteReview && <div className="order-2 mt-4 flex min-h-0 flex-1 overflow-hidden">
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
			{inspectedSkill && <ReviewSkillDetail item={inspectedSkill} decision={libraryDecisions[inspectedSkill.candidate_key] ?? defaultLibraryDecision(inspectedSkill)} onDecision={chooseLibraryOutcome} onClose={() => setInspectedSkillKey(null)} />}
		  </div>}
		  {!profile && !preview && (inventory?.invalid_paths || inventory?.collisions.length || inventory?.linked_aliases) ? <div className="order-3 mt-3 shrink-0 space-y-2 border-t border-border/60 px-1 pt-3 text-xs">
		  {inventory?.invalid_paths ? <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /><div><p><span className="font-semibold">{plural(inventory.invalid_paths, 'folder')} wasn’t included.</span> It stays unchanged on this computer.</p><details className="mt-1.5"><summary className="cursor-pointer font-medium text-amber-900 underline-offset-2 hover:underline dark:text-amber-100">Why?</summary><ul className="mt-1.5 space-y-1 border-l border-amber-500/30 pl-2.5">{(inventory.invalid_entries ?? []).map((entry) => <li key={`${entry.display_name}-${entry.reason}`}><span className="font-medium">{entry.display_name}</span><span className="text-amber-800/80 dark:text-amber-200/80"> has a linked file. Skiller leaves it local rather than following it outside this folder.</span></li>)}</ul><p className="mt-2 leading-relaxed text-amber-800/80 dark:text-amber-200/80">To include it later, replace the linked file with a regular file inside the skill folder.</p></details></div></div> : null}
			{(inventory?.collisions.length ?? 0) > 0 && <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /><p>{plural(inventory?.collisions.length ?? 0, 'skill')} have the same name but different contents. Choose the version to include; Skiller will not decide by filename.</p></div>}
			{(inventory?.linked_aliases ?? 0) > 0 && <div className="flex items-start gap-2 text-muted-foreground"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" /><p>{plural(inventory?.linked_aliases ?? 0, 'agent link')} already use this library.</p></div>}
		  </div> : null}
          {remoteReview && (
            <div className="mt-4 rounded-xl border border-border bg-muted/25 p-3 text-xs">
			  <p className="font-semibold">Change review</p>
			  {remoteReview.dependency_changes.length > 0 && <div className="mt-3 overflow-hidden rounded-lg border border-primary/20 bg-background/55"><div className="border-b border-border/60 px-3 py-2"><p className="font-semibold">Immutable dependency updates</p><p className="mt-0.5 text-[11px] text-muted-foreground">Commit, license, and exported-skill changes from the fetched lockfile. Nothing is installed until you apply the selected skills below.</p></div><div className="divide-y divide-border/60">{remoteReview.dependency_changes.map((change) => <div key={change.dependency} className="px-3 py-2.5"><div className="flex items-center justify-between gap-3"><span className="font-medium">{change.dependency}</span><span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{change.action}</span></div><p className="mt-1 font-mono text-[10px] text-muted-foreground">{change.from_commit?.slice(0, 8) ?? 'new'} → {change.to_commit?.slice(0, 8) ?? 'removed'}</p>{change.from_license !== change.to_license && <p className="mt-1 text-[11px] text-muted-foreground">License: {change.from_license ?? 'none'} → {change.to_license ?? 'none'}</p>}{(change.skills_added.length > 0 || change.skills_removed.length > 0) && <p className="mt-1 text-[11px] text-muted-foreground">{change.skills_added.length > 0 ? `Adds ${change.skills_added.join(', ')}` : ''}{change.skills_added.length > 0 && change.skills_removed.length > 0 ? ' · ' : ''}{change.skills_removed.length > 0 ? `Removes ${change.skills_removed.join(', ')}` : ''}</p>}</div>)}</div></div>}
			  <div className="mt-2 space-y-1 text-muted-foreground">
				{remoteReview.skills.map((skill) => {
				  const isExternalConflict = skill.kind !== 'bundled' && skill.action === 'conflict'
				  const isConflict = skill.action === 'conflict' || skill.action === 'unmanaged'
				  if (isConflict) return <div key={skill.id} className="border-t border-border/60 px-1 py-2.5 first:border-t-0"><div className="flex items-start justify-between gap-3"><span className="min-w-0 flex-1"><span className="block font-medium text-foreground">{skill.id}</span>{skill.source && <span className="mt-0.5 block truncate text-[10px] text-muted-foreground" title={`${skill.source.repository} @ ${skill.source.ref}`}>{skill.kind === 'skills_sh' ? 'skills.sh' : 'Git'} · {skill.source.ref.slice(0, 8)}</span>}<span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">Both the library and this computer have a different version. Nothing changes until you choose below.</span></span><span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-200">Decision needed</span></div><div className="mt-2 flex flex-wrap gap-1.5">{skill.kind === 'bundled' && <Button size="xs" className="h-7 px-2.5 text-[10px]" onClick={() => void useRemoteForConflict(skill.id)} disabled={busy !== 'idle'}>Use library version</Button>}<Button size="xs" variant="outline" className="h-7 px-2.5 text-[10px]" onClick={() => void adoptLocalVersion(skill.id)} disabled={busy !== 'idle'}>{isExternalConflict ? 'Save local copy as owned' : 'Publish local version'}</Button><Button size="xs" variant="ghost" className="h-7 px-2.5 text-[10px]" onClick={() => void keepConflictLocal(skill.id, isExternalConflict)} disabled={busy !== 'idle'}>Keep only on this computer</Button></div></div>
				  const selectable = skill.action === 'take-remote' || skill.action === 'publish-local'
				  const selected = skill.action === 'take-remote' ? remoteSelections : localSelections
				  const setSelected = skill.action === 'take-remote' ? setRemoteSelections : setLocalSelections
				  return <label key={skill.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-background/60">
					<input type="checkbox" disabled={!selectable} checked={selectable && selected.includes(skill.id)} onChange={() => setSelected((current) => current.includes(skill.id) ? current.filter((id) => id !== skill.id) : [...current, skill.id])} />
					<span className="min-w-0 flex-1"><span className="block truncate">{skill.id}</span>{skill.source && <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/80" title={`${skill.source.repository} @ ${skill.source.ref}`}>{skill.kind === 'skills_sh' ? 'skills.sh' : 'Git'} · {skill.source.ref.slice(0, 8)}</span>}</span>
					<span>{skill.action.replace('-', ' ')}</span>
				  </label>
				})}
			  </div>
			  {externalConflicts.length > 0 && <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2.5 text-amber-950 dark:text-amber-100"><p className="font-medium">{plural(externalConflicts.length, 'external skill')} need{externalConflicts.length === 1 ? 's' : ''} your decision</p><p className="mt-1 leading-relaxed text-amber-900/80 dark:text-amber-200/80">Their local files differ from the pinned source. You can publish the local copy as an owned skill, keep it only here, or leave this review without changing anything.</p></div>}
			  <p className="mt-2 text-muted-foreground">Checked remote-only changes will come to this computer. Checked local-only changes will be published. Conflicts always require one explicit choice.</p>
              {remoteSelections.length > 0 && <Button size="sm" className="mt-3" onClick={applySelectedRemoteChanges} disabled={busy !== 'idle'}>Apply selected remote changes</Button>}
			  {localSelections.length > 0 && <Button size="sm" variant="outline" className="mt-3 ml-2" onClick={publishSelectedLocalChanges} disabled={busy !== 'idle'}>Publish selected local changes</Button>}
            </div>
          )}
          {preview && (
            <div className="mt-0 flex min-h-0 flex-1 flex-col text-xs">
			  <div className="shrink-0"><Button variant="outline" size="sm" className="mb-3 h-8 px-2.5" onClick={() => showDestination ? setShowDestination(false) : (() => { setPreview(null); setSetupMode(null); setRemoteUrl('') })()}><ChevronLeft className="size-3.5" />{showDestination ? 'Back to plan' : 'Back to skills'}</Button><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Step {showDestination ? '3' : '2'} of 3</p><h2 className="mt-1 text-lg font-semibold tracking-[-0.02em]">{showDestination ? 'Choose a home for your library' : 'Review your library plan'}</h2><p className="mt-1 leading-relaxed text-muted-foreground">{showDestination ? 'Pick where Skiller should create your library. You will set its repository name before anything is created.' : 'See exactly what will be saved, linked, or left alone before choosing where it lives.'}</p></div>
			  {!showDestination && <><div className="min-h-0 flex-1 overflow-y-auto pr-1"><section className="mt-5 overflow-hidden rounded-xl border border-border/70 bg-background/35"><div className="border-b border-border/60 bg-primary/[0.06] px-4 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Your new repository will contain</p><p className="mt-1 text-muted-foreground">A standard dotagent library: <span className="font-medium text-foreground">skills.json, skills.lock, dotagent.yaml</span>, a README, and only the reviewed outcomes below. Machine paths, tokens, and local-only decisions stay on this computer.</p></div><div className="divide-y divide-border/60"><div className="flex gap-3 px-4 py-3"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /><div><p className="font-semibold text-foreground">{plural(previewOwnedCount, 'owned skill')} saved with {plural(previewVendoredCount, 'licensed copy')}</p><p className="mt-0.5 text-muted-foreground">{preview.skills.reduce((total, skill) => total + skill.file_count, 0)} reviewed files will live under skills/. Vendored copies retain their upstream commit, integrity, and license in dotagent.yaml.</p></div></div><div className="flex gap-3 px-4 py-3"><Info className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="font-semibold text-foreground">{preview.skills_sh.length + preview.references.length} skills recorded as immutable dependencies</p><p className="mt-0.5 text-muted-foreground">{preview.skills_sh.length} from skills.sh · {preview.references.length} from Git. Their exact commits and integrity go into skills.lock; their files are not duplicated.</p></div></div><div className={`flex gap-3 px-4 py-3 ${preview.unresolved_sources?.length ? 'bg-amber-500/[0.05]' : ''}`}><AlertTriangle className={`mt-0.5 size-4 shrink-0 ${preview.unresolved_sources?.length ? 'text-amber-600 dark:text-amber-300' : 'text-muted-foreground'}`} /><div><p className="font-semibold text-foreground">{preview.unresolved_sources?.length ? `${plural(preview.unresolved_sources.length, 'external skill')} not included yet` : `${plural(previewLocalCount, 'skill')} stay on this computer`}</p><p className="mt-0.5 text-muted-foreground">{preview.unresolved_sources?.length ? 'Their source could not be pinned, so they will not appear in this repository and remain unchanged locally.' : previewLocalCount ? 'They remain unchanged and are not written to the repository.' : 'Every reviewed skill can be included.'}</p></div></div></div></section>
			  {preview.unresolved_sources && preview.unresolved_sources.length > 0 && <section className="mt-4 rounded-xl border border-amber-400/35 bg-amber-500/[0.07] px-4 py-3.5 text-amber-950 dark:text-amber-100"><div className="flex gap-3"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" /><div className="min-w-0"><p className="font-semibold">{plural(preview.unresolved_sources.length, 'external skill')} will stay on this computer</p><p className="mt-1 leading-relaxed text-amber-900/80 dark:text-amber-200/80">Skiller could not verify the source, so it will neither upload nor change these skills. Reconnect or authenticate their Git source, then refresh this review when you want to include them.</p><details className="mt-3"><summary className="cursor-pointer font-medium text-amber-900 underline-offset-2 hover:underline dark:text-amber-100">View affected skills ({preview.unresolved_sources.length})</summary><div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-amber-900/80 dark:text-amber-200/80">{preview.unresolved_sources.map((source) => <span key={`${source.kind}-${source.id}`}>{source.id}</span>)}</div></details></div></div></section>}
			  {preview.secret_findings.length > 0 ? <section className="mt-4 border-y border-destructive/25 py-3"><p className="font-medium text-destructive">Backup is paused: review {preview.secret_findings.length} possible secret{preview.secret_findings.length === 1 ? '' : 's'} in {groupSecretFindings(preview.secret_findings).length} file{groupSecretFindings(preview.secret_findings).length === 1 ? '' : 's'} first.</p><p className="mt-1 text-muted-foreground">Skiller never shows the matched value. Lines below identify what needs your decision.</p><div className="mt-2 max-h-40 divide-y divide-destructive/10 overflow-y-auto rounded-lg border border-destructive/15 bg-background/45">{groupSecretFindings(preview.secret_findings).map((group) => <div key={`${group.skillId}-${group.relativePath}`} className="px-2.5 py-2"><div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate font-medium text-foreground">{group.skillId} <span className="font-normal text-muted-foreground">· {group.relativePath}</span></p><Button size="xs" variant="ghost" className="h-6 shrink-0 px-1.5 text-[11px]" onClick={() => void revealSecretFinding(group.skillId, group.relativePath)}><FolderOpen className="size-3" />Show file</Button></div><div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">{group.findings.map((finding) => <p key={`${finding.line}-${finding.column}-${finding.rule}`}>Line {finding.line} · Possible {secretRuleLabel(finding.rule)}</p>)}</div></div>)}</div></section> : <p className="mt-3 flex items-center gap-1.5 text-muted-foreground"><CheckCircle2 className="size-3.5 text-emerald-500" />No secret patterns found. This review is rebuilt immediately before commit.</p>}</div><div className="mt-3 flex shrink-0 items-center justify-end border-t border-border/60 pt-3"><Button size="sm" className="h-9 px-4" onClick={() => setShowDestination(true)} disabled={preview.secret_findings.length > 0}>Choose a Git home <ChevronRight className="size-3.5" /></Button></div></>}
			  {showDestination && <div className="min-h-0 flex-1 overflow-y-auto pr-1"><section className="mt-5 rounded-xl border border-border/70 p-3.5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">Who can use this repository?</p><p className="mt-0.5 text-muted-foreground">This controls the library policy; GitHub can also apply the repository visibility for you.</p></div><div className="flex rounded-lg border border-border bg-muted/25 p-0.5"><button type="button" className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors ${libraryMode === 'private' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => void changeLibraryMode('private')}>Private</button><button type="button" className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors ${libraryMode === 'public' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => void changeLibraryMode('public')}>Public</button></div></div>{libraryMode === 'public' && <label className="mt-3 grid max-w-xs gap-1 text-[11px] font-medium">License for your library<span className="relative"><select value={libraryLicense} onChange={(event) => setLibraryLicense(event.target.value as typeof libraryLicense)} className="h-9 w-full appearance-none rounded-lg border border-border bg-background px-2.5 pr-9 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"><option value="">Choose a license…</option><option value="MIT">MIT</option><option value="Apache-2.0">Apache 2.0</option><option value="CC0-1.0">CC0 1.0</option></select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /></span><span className="font-normal leading-relaxed text-muted-foreground">Public libraries require an explicit license; Skiller never chooses one for your work.</span></label>}</section><section className="mt-3 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => { setSetupMode('github'); setRemoteUrl('') }} className={`rounded-xl border p-4 text-left transition-colors ${setupMode === 'github' ? 'border-primary bg-primary/[0.07] ring-1 ring-primary/30' : 'border-border/70 hover:border-primary/45 hover:bg-muted/30'}`}><div className="flex items-center justify-between"><span className="flex items-center gap-2 font-semibold"><Github className="size-4" />GitHub</span><span className="text-[10px] font-medium text-primary">{libraryMode === 'private' ? 'Private by default' : 'Public repository'}</span></div><p className="mt-1.5 leading-relaxed text-muted-foreground">Create a new {libraryMode} repository with your existing GitHub sign-in.</p></button><button type="button" onClick={() => setSetupMode('custom')} className={`rounded-xl border p-4 text-left transition-colors ${setupMode === 'custom' ? 'border-primary bg-primary/[0.07] ring-1 ring-primary/30' : 'border-border/70 hover:border-primary/45 hover:bg-muted/30'}`}><span className="flex items-center gap-2 font-semibold"><Server className="size-4" />Another Git server</span><p className="mt-1.5 leading-relaxed text-muted-foreground">Use GitLab, a self-hosted server, or another remote you control.</p></button></section>
			  {setupMode === 'github' ? (
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border/60 pt-4">
                  {!remoteUrl ? <>
                    <label className="grid gap-1 text-[11px] text-muted-foreground">Repository name
                      <input value={repositoryName} onChange={(event) => setRepositoryName(event.target.value)} className="h-8 w-52 rounded-lg border border-border bg-background px-2 text-xs text-foreground" />
					  <span className="max-w-52 leading-relaxed">Uses your existing GitHub CLI sign-in. Skiller never receives or stores a GitHub token.</span></label>
                    <Button size="sm" onClick={createGitHubRepository} disabled={busy !== 'idle' || preview.secret_findings.length > 0 || (libraryMode === 'public' && !libraryLicense)}>Create {libraryMode} GitHub repo</Button>
				  </> : <Button size="sm" onClick={publishBackup} disabled={busy !== 'idle' || preview.secret_findings.length > 0 || (libraryMode === 'public' && !libraryLicense)}>Create library</Button>}
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-end gap-2">
				  <label className="grid gap-1 text-[11px] text-muted-foreground">Git remote <span className="font-normal">Visibility is controlled by this server.</span>
                    <input value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="git@git.example.com:team/agent-library.git" className="h-8 w-72 rounded-lg border border-border bg-background px-2 text-xs text-foreground" />
                  </label>
				  <Button size="sm" onClick={publishBackup} disabled={busy !== 'idle' || !remoteUrl || preview.secret_findings.length > 0 || (libraryMode === 'public' && !libraryLicense)}>Create library</Button>
                </div>
			  )}</div>}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
