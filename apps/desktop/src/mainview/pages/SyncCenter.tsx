import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Cloud, Copy, FolderOpen, Github, Gitlab, Globe2, History, Info, Loader2, MonitorCog, RotateCcw, Server, Share2, Trash2, UserRound, UsersRound, X } from 'lucide-react'
import { invoke, isAbortError, listen, openUrl } from '@/mainview/lib/native'
import type { AgentConfigJson, SyncConnectPreviewJson, SyncDisconnectPreviewJson, SyncGitDestinationPreviewJson, SyncGitHubRepositoryPreviewJson, SyncGitLabProjectPreviewJson, SyncHistoryEntryJson, SyncInventoryJson, SyncLibraryDecisionJson, SyncLocalPublishPreviewJson, SyncProfileStatusJson, SyncProviderLibraryJson, SyncProviderProblemJson, SyncPublishPreviewJson, SyncRemoteTrustPreviewJson, SyncSourceReviewProgressJson, SyncThreeWayReviewJson, SyncUndoPreviewJson } from '@/shared/rpc-schema'
import { Button, buttonVariants } from '@/mainview/components/ui/button'
import { Tooltip } from '@/mainview/components/ui/tooltip'
import { useToast } from '@/mainview/components/ToastProvider'
import { AgentIcon } from '@/mainview/components/AgentIcon'
import MarkdownContent from '@/mainview/components/MarkdownContent'
import { providerProblemPresentation } from '@/mainview/lib/sync-provider-problem'
import { libraryDisplayName, repositoryBrowserUrl, sourceDisplayName } from '@/mainview/lib/sync-library-name'
import { ScrollFade } from '@/mainview/components/ScrollFade'

function plural(count: number, word: string): string {
	const pluralWord = word.endsWith('y') ? `${word.slice(0, -1)}ies` : `${word}s`
	return `${count} ${count === 1 ? word : pluralWord}`
}

function coolingOffLabel(minutes: number): string {
	if (minutes === 0) return 'Off'
	if (minutes === 1440) return '24 hours'
	if (minutes === 10080) return '7 days'
	if (minutes === 43200) return '30 days'
	return `${minutes} minutes`
}

function unresolvedSourceLabel(reason: NonNullable<SyncPublishPreviewJson['unresolved_sources']>[number]['reason']): string {
	return {
		authentication: 'needs a sign-in before it can be confirmed',
		timeout: 'did not respond before the check timed out',
		'invalid-source': 'the exact saved version is no longer available',
		'missing-skill': 'this skill is no longer at its saved location',
		unavailable: 'could not be reached while this plan was prepared',
		'too-new': 'is newer than the current safety setting',
	}[reason]
}

function secretRuleLabel(rule: SyncPublishPreviewJson['secret_findings'][number]['rule']): string {
	return (
		(
			{
    'private-key': 'private key',
    'github-token': 'GitHub token',
    'provider-token': 'provider token',
    'aws-access-key': 'AWS access key',
    'connection-string': 'database connection',
    'credential-assignment': 'credential-like assignment',
			} as const
		)[rule] ?? 'sensitive value'
	)
}

function groupSecretFindings(findings: SyncPublishPreviewJson['secret_findings']) {
  const groups = new Map<string, { skillId: string; relativePath: string; findings: typeof findings }>()
  for (const finding of findings) {
    const key = `${finding.skill_id}\u0000${finding.relative_path}`
    const group = groups.get(key)
    if (group) group.findings.push(finding)
		else
			groups.set(key, {
				skillId: finding.skill_id,
				relativePath: finding.relative_path,
				findings: [finding],
			})
  }
  return [...groups.values()]
}

function hasActionableRemoteReview(review: SyncThreeWayReviewJson): boolean {
	return review.dependency_changes.length > 0 || review.skills.some((skill) => ['take-remote', 'publish-local', 'conflict', 'unmanaged'].includes(skill.action))
}

function hasVisibleRemoteReview(review: SyncThreeWayReviewJson, includeDeviceChoices: boolean): boolean {
	return hasActionableRemoteReview(review) || (includeDeviceChoices && review.skills.some((skill) => skill.action === 'kept-local'))
}

type InventoryItem = SyncInventoryJson['items'][number]
type UnresolvedSourceItem = NonNullable<SyncPublishPreviewJson['unresolved_sources']>[number]

function defaultLibraryDecision(item: InventoryItem, _purpose: 'personal' | 'public' | 'team'): SyncLibraryDecisionJson {
	// Keep an already verified external source as a dependency by default. It
	// preserves the complete package (including legitimate internal file links)
	// without silently copying a large Git checkout into a personal library.
	// Local-only skills remain portable copies.
	return {
		candidateKey: item.candidate_key,
		disposition: item.source.kind === 'local' ? 'owned' : 'dependency',
	}
}

function inventorySourceLabel(item: InventoryItem): string {
	if (item.source.kind === 'skills_sh') return 'skills.sh'
	if (item.source.kind === 'git_reference') return 'Git'
	if (item.locations.some((location) => location.kind === 'shared')) return '.agents'
	if (item.locations.some((location) => location.kind === 'agent-local')) return 'Agent folder'
	return 'Linked folder'
}

const InventorySkillRow = memo(function InventorySkillRow({ item, selected, inspected, reviewReason, agentNames, onToggle, onInspect }: { item: InventoryItem; selected: boolean; inspected: boolean; reviewReason?: UnresolvedSourceItem['reason']; agentNames: Map<string, string>; onToggle: (key: string) => void; onInspect: (key: string) => void }) {
	const agentSlugs = useMemo(() => [...new Set(item.locations.flatMap((location) => (location.agent_slug ? [location.agent_slug] : [])))], [item.locations])
	const visibleAgentSlugs = agentSlugs.slice(0, 5)
	const hiddenAgentNames = agentSlugs.slice(5).map((slug) => agentNames.get(slug) ?? slug).join(', ')
	const isShared = item.locations.some((location) => location.kind === 'shared')
	const sourceLabel = inventorySourceLabel(item)
	return (
		<div className={`flex min-h-12 items-center gap-2 px-2 py-2 text-xs ${inspected ? 'bg-primary/8' : 'hover:bg-muted/30'}`}>
		{reviewReason ? (
			<span className="flex size-7 shrink-0 items-center justify-center text-amber-600 dark:text-amber-300" aria-hidden="true">
				<AlertTriangle className="size-4" />
			</span>
		) : (
			<label className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-muted/50" aria-label={`Select ${item.display_name}`}>
				<input className="cursor-pointer" type="checkbox" checked={selected} onChange={() => onToggle(item.candidate_key)} />
			</label>
		)}
			<button type="button" className="min-w-0 flex-1 break-words text-left font-medium text-foreground outline-none hover:text-primary focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring/60" onClick={() => onInspect(item.candidate_key)}>
				<span className="block">{item.display_name}</span>
				{reviewReason && <span className="mt-0.5 block text-[10px] font-normal text-amber-700 dark:text-amber-300">{unresolvedSourceLabel(reviewReason)}</span>}
				<span className="mt-1 inline-flex rounded-sm bg-muted px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.08em] text-muted-foreground">{sourceLabel}</span>
			</button>
		<span className="flex shrink-0 items-center gap-1.5" aria-label={agentSlugs.length ? `Linked to ${agentSlugs.map((slug) => agentNames.get(slug) ?? slug).join(', ')}` : isShared ? '.agents skills library' : undefined}>
			{isShared && <Tooltip content="Stored in ~/.agents/skills"><span className="text-[10px] font-medium text-muted-foreground">.agents</span></Tooltip>}
				{visibleAgentSlugs.map((slug) => (
					<Tooltip key={slug} content={agentNames.get(slug) ?? slug}><span>
						<AgentIcon slug={slug} className="size-4" />
					</span></Tooltip>
				))}
				{agentSlugs.length > visibleAgentSlugs.length && <Tooltip content={hiddenAgentNames}><span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border bg-secondary px-1 text-[9px] font-medium tabular-nums text-secondary-foreground">+{agentSlugs.length - visibleAgentSlugs.length}</span></Tooltip>}
		</span>
	</div>
	)
})

function ReviewSkillDetail({ item, decision, purpose, sourceIssue, reviewPosition, sourceGroup, onDecision, onClose, onPrevious, onNext }: { item: InventoryItem; decision: SyncLibraryDecisionJson; purpose: 'personal' | 'public' | 'team'; sourceIssue?: UnresolvedSourceItem; reviewPosition?: { current: number; total: number }; sourceGroup?: { label: string; count: number; onApply: (disposition: 'owned' | 'local-only') => void }; onDecision: (decision: SyncLibraryDecisionJson) => void; onClose: () => void; onPrevious?: () => void; onNext?: () => void }) {
	const agentSlugs = [...new Set(item.locations.flatMap((location) => (location.agent_slug ? [location.agent_slug] : [])))]
	const isShared = item.locations.some((location) => location.kind === 'shared')
	const external = item.source.kind !== 'local'
	const externalSource = item.source.kind === 'skills_sh' ? item.source.source_url : item.source.kind === 'git_reference' ? item.source.repository : null
	const choices = sourceIssue
		? [
				{
					disposition: 'owned' as const,
					title: purpose === 'public' ? 'Publish as my own skill' : 'Save the current copy',
					detail:
						purpose === 'public'
							? 'Choose this only if you own these files and have the right to publish them.'
							: 'Store the files already on this computer so the skill can be restored without its source.',
				},
				{
					disposition: 'local-only' as const,
					title: 'Keep only on this computer',
					detail: 'Leave it untouched and out of this library.',
				},
			]
		: external
		? [
				{
					disposition: 'owned' as const,
					title: 'Save the current copy',
					detail: purpose === 'personal' ? 'Recommended for a private backup. This exact working copy travels with your library.' : 'Store these files in the library instead of relying on the source.',
				},
				{
					disposition: 'dependency' as const,
					title: 'Keep it linked',
					detail: 'Restore the exact Git version from its original source without copying the files.',
				},
				...(purpose === 'personal'
					? []
					: [
						{
					disposition: 'vendored' as const,
					title: 'Share a licensed copy',
					detail: 'Store the files with their upstream commit, integrity, and license.',
						},
					]),
				{
					disposition: 'local-only' as const,
					title: 'Keep only on this computer',
					detail: 'Leave it untouched and out of the repository.',
				},
			]
		: [
				{
					disposition: 'owned' as const,
					title: 'Save in my library',
					detail: 'Publish the reviewed files under skills/ so they travel with your library.',
				},
				{
					disposition: 'local-only' as const,
					title: 'Keep only on this computer',
					detail: 'Leave it untouched and out of the repository.',
				},
	]
	const {
		data: preview,
		isLoading,
		error,
	} = useQuery<{ skill_id: string; body: string }>({
		queryKey: ['sync-skill-preview', item.candidate_key],
		queryFn: () => invoke('get_sync_skill_preview', { skillId: item.candidate_key }),
		staleTime: Infinity,
		retry: false,
	})
	const outcomeFieldset = (
		<fieldset className="border-b border-border/60 py-3">
			<legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Library outcome</legend>
			<div className="grid gap-0.5">
				{choices.map((choice) => (
					<label key={choice.disposition} className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 transition-colors ${decision.disposition === choice.disposition ? 'bg-primary/[0.08] text-foreground' : 'text-muted-foreground hover:bg-muted/45 hover:text-foreground'}`}>
						<input
							type="radio"
							name={`library-outcome-${item.candidate_key}`}
							value={choice.disposition}
							checked={decision.disposition === choice.disposition}
							onChange={() =>
								onDecision({
									candidateKey: item.candidate_key,
									disposition: choice.disposition,
								})
							}
							className="mt-0.5 cursor-pointer"
						/>
						<span>
							<span className="block text-xs font-medium">{choice.title}</span>
							<span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">{choice.detail}</span>
						</span>
					</label>
				))}
			</div>
			{decision.disposition === 'vendored' && (
				<label className="mt-2 grid gap-1 px-2 text-[10px] font-medium text-foreground">
					Upstream license
					<input
						value={decision.license ?? ''}
						onChange={(event) =>
							onDecision({
								candidateKey: item.candidate_key,
								disposition: 'vendored',
								license: event.target.value,
							})
						}
						placeholder="SPDX ID, for example MIT"
						className="h-8 rounded-md border border-border bg-background px-2 text-xs font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
						aria-describedby={`vendored-license-${item.candidate_key}`}
					/>
					<span id={`vendored-license-${item.candidate_key}`} className="font-normal leading-relaxed text-muted-foreground">
						Required because your public or private repository will redistribute these files.
					</span>
				</label>
			)}
		</fieldset>
	)
	return (
		<aside className="sync-library-review-detail flex min-h-0 w-[min(26rem,46%)] shrink-0 flex-col border-l border-border/60 bg-muted/10">
			<div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
				<div className="flex items-center gap-2">
					<Info className="size-4 text-muted-foreground" />
					<p className="text-sm font-medium">{reviewPosition ? `Skill ${reviewPosition.current} of ${reviewPosition.total}` : 'Skill details'}</p>
				</div>
				<button type="button" className="inline-flex min-h-7 items-center gap-1 rounded px-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onClose} aria-label={sourceIssue ? 'Close details' : 'Back to skills'}>
					<ChevronLeft className="size-3.5" />
					{sourceIssue ? 'Close details' : 'Back to skills'}
				</button>
			</div>
		<div className="min-h-0 flex-1 overflow-y-auto p-4">
			<h3 className="text-base font-semibold leading-tight">{item.display_name}</h3>
			{sourceIssue && (
				<div className="mt-3 rounded-lg border border-amber-400/35 bg-amber-500/[0.07] px-3 py-2.5 text-[11px] text-amber-950 dark:text-amber-100">
					<p className="font-semibold">The original source could not be used</p>
					<p className="mt-1 leading-relaxed">{unresolvedSourceLabel(sourceIssue.reason)}. Choose a valid outcome below. To keep it linked, fix the source and prepare the library again.</p>
					{sourceGroup && (
						<details className="mt-2 text-[10px] text-amber-900/75 dark:text-amber-200/75">
							<summary className="cursor-pointer font-medium text-amber-950 dark:text-amber-100">Source details · {plural(sourceGroup.count, 'affected skill')}</summary>
							<p className="mt-1 break-all font-mono">{sourceGroup.label}</p>
						</details>
					)}
				</div>
			)}
			{sourceIssue && outcomeFieldset}
			{sourceGroup && sourceGroup.count > 1 && (decision.disposition === 'owned' || decision.disposition === 'local-only') && (
				<Button size="xs" variant="outline" className="mt-2 h-auto min-h-8 w-full whitespace-normal px-2.5 py-1.5 text-[11px]" onClick={() => sourceGroup.onApply(decision.disposition as 'owned' | 'local-only')}>
					Apply this choice to all {sourceGroup.count} skills from this source
				</Button>
			)}
			{item.description && <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.description}</p>}
				{item.when_to_use && (
					<p className="mt-3 text-xs leading-relaxed text-muted-foreground">
						<span className="font-medium text-foreground">Use it for:</span> {item.when_to_use}
					</p>
				)}
				<details className="mt-4 border-y border-border/60 py-3 text-[11px] text-muted-foreground">
					<summary className="cursor-pointer font-medium text-foreground">About this skill source</summary>
					<div className="mt-2">
					{item.source.kind === 'skills_sh' ? (
						<>
							<p className="font-medium text-foreground">Installed through skills.sh</p>
							<p className="mt-1 leading-relaxed">{purpose === 'personal' ? 'Skiller can keep the exact source linked, save your working copy, or leave it only on this computer.' : 'Skiller can pin its exact source, keep a licensed copy, or leave it only on this computer.'}</p>
						</>
					) : item.source.kind === 'git_reference' ? (
						<>
							<p className="font-medium text-foreground">Installed from a Git source</p>
							<p className="mt-1 leading-relaxed">{purpose === 'personal' ? 'Skiller can keep the exact source linked, save your working copy, or leave it only on this computer.' : 'Skiller can pin its exact source, keep a licensed copy, or leave it only on this computer.'}</p>
						</>
					) : (
						<>
							<p className="font-medium text-foreground">Local skill</p>
							<p className="mt-1 leading-relaxed">This skill has no verified upstream source. Save it as part of your library or keep it only here.</p>
						</>
					)}
					{externalSource && (
						<>
							<p className="mt-2 break-all font-mono text-[10px] text-foreground/80">{externalSource}</p>
							<p className="mt-1 leading-relaxed">Including this skill authorizes Skiller to contact this exact source to resolve and verify its immutable commit. Other repositories remain blocked.</p>
						</>
					)}
				</div>
				</details>
				{!sourceIssue && outcomeFieldset}
				{reviewPosition && (
					<div className="flex items-center justify-between gap-2 border-b border-border/60 py-3">
						<Button size="xs" variant="outline" className="h-7 px-2.5" onClick={onPrevious} disabled={!onPrevious}>
							<ChevronLeft className="size-3" /> Previous
						</Button>
						<Button size="xs" variant="outline" className="h-7 px-2.5" onClick={onNext} disabled={!onNext}>
							Next <ChevronRight className="size-3" />
						</Button>
					</div>
				)}
				<div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 py-3 text-[11px] text-muted-foreground">
					{isShared ? <Tooltip content="Stored in ~/.agents/skills"><span>.agents</span></Tooltip> : <span>Agent-specific</span>}
					{agentSlugs.map((slug) => (
						<span key={slug} className="inline-flex items-center gap-1">
							<AgentIcon slug={slug} className="size-3.5" />
							{slug}
						</span>
					))}
				</div>
				<div className="mt-5">
					<p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">SKILL.md</p>
					{isLoading ? (
						<div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
							<Loader2 className="size-3.5 animate-spin" />
							Loading local skill…
						</div>
					) : error ? (
						<p className="text-xs text-destructive">Could not load this local SKILL.md. Refresh the library review and try again.</p>
					) : preview?.body.trim() ? (
						<MarkdownContent content={preview.body} />
					) : (
						<p className="text-xs italic text-muted-foreground">This SKILL.md does not contain instructions after its metadata.</p>
					)}
				</div>
		</div>
	</aside>
	)
}

/**
 * This is the first-library flow rendered inside Agent Library when no library
 * exists yet. It is intentionally not a separate application destination:
 * once a library is connected, ResourceLibrary is the sole place to browse it,
 * see sync status, and review changes. Setup actions stay behind their reviewed
 * plan so opening Agent Library never uploads or changes anything.
 */
export default function SyncCenter({ embedded = false, allowExisting = false, onComplete, onClose }: {
  embedded?: boolean
  allowExisting?: boolean
  /** The exact profile that was just created or connected. */
  onComplete?: (profileId: string) => void
  onClose?: () => void
}) {
	const navigate = useNavigate()
  const [showInventory, setShowInventory] = useState(false)
  const [showConnect, setShowConnect] = useState(false)
	const [createFlow, setCreateFlow] = useState(false)
	const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [connectRemoteUrl, setConnectRemoteUrl] = useState('')
  const [showConnectRemoteInput, setShowConnectRemoteInput] = useState(false)
	const connectRemoteInputRef = useRef<HTMLInputElement>(null)
  const [selectedConnectLibraryLabel, setSelectedConnectLibraryLabel] = useState<string | null>(null)
  const [connectAgentSlugs, setConnectAgentSlugs] = useState<string[]>([])
  const [connectSelectionReady, setConnectSelectionReady] = useState(false)
  const [connectPreview, setConnectPreview] = useState<SyncConnectPreviewJson | null>(null)
	const [connectMinimumReleaseAgeMinutes, setConnectMinimumReleaseAgeMinutes] = useState(0)
	const [connectReviewProblem, setConnectReviewProblem] = useState<string | null>(null)
  const [inspectedSkillKey, setInspectedSkillKey] = useState<string | null>(null)
	const [sourceDecisionReview, setSourceDecisionReview] = useState<UnresolvedSourceItem[] | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
	const [acknowledgedCollisions, setAcknowledgedCollisions] = useState<Set<string>>(() => new Set())
  const [libraryDecisions, setLibraryDecisions] = useState<Record<string, SyncLibraryDecisionJson>>({})
  const [selectionReady, setSelectionReady] = useState(false)
  const [setupMode, setSetupMode] = useState<'github' | 'gitlab' | 'custom' | null>(null)
	const [repositoryName, setRepositoryName] = useState('agent-library')
  const [githubRepositoryPreview, setGitHubRepositoryPreview] = useState<SyncGitHubRepositoryPreviewJson | null>(null)
	const [gitLabProjectName, setGitLabProjectName] = useState('agent-library')
  const [gitLabProjectPreview, setGitLabProjectPreview] = useState<SyncGitLabProjectPreviewJson | null>(null)
	const [providerIdentity, setProviderIdentity] = useState<{ provider: 'github' | 'gitlab'; account: string } | null>(null)
	const [customDestinationPreview, setCustomDestinationPreview] = useState<SyncGitDestinationPreviewJson | null>(null)
	const [destinationSetupError, setDestinationSetupError] = useState<string | null>(null)
	const [connectProviderLibraries, setConnectProviderLibraries] = useState<{
		provider: 'github' | 'gitlab'
		libraries: SyncProviderLibraryJson[]
	} | null>(null)
  const [browsingProvider, setBrowsingProvider] = useState<'github' | 'gitlab' | null>(null)
	const providerBrowseRequestRef = useRef<string | null>(null)
	const [providerProblem, setProviderProblem] = useState<{
		provider: 'github' | 'gitlab'
		target: 'create' | 'connect'
		problem: SyncProviderProblemJson
	} | null>(null)
	const [providerAuthorization, setProviderAuthorization] = useState<{ provider: 'github' | 'gitlab'; userCode: string } | null>(null)
	const [libraryMode, setLibraryMode] = useState<'private' | 'public'>('private')
	const [libraryPurpose, setLibraryPurpose] = useState<'personal' | 'public' | 'team'>('personal')
	const [showPurposeChoice, setShowPurposeChoice] = useState(false)
  const [libraryLicense, setLibraryLicense] = useState<'' | 'MIT' | 'Apache-2.0' | 'CC0-1.0'>('')
	// Creating a library records versions that are already installed on this
	// computer. Cooling-off belongs to future remote updates, not to backup:
	// enabling it here silently leaves freshly installed skills out of the first library.
	const [minimumReleaseAgeMinutes, setMinimumReleaseAgeMinutes] = useState(0)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [preview, setPreview] = useState<SyncPublishPreviewJson | null>(null)
	const [localPublishPreview, setLocalPublishPreview] = useState<SyncLocalPublishPreviewJson | null>(null)
  const [sourceReviewProgress, setSourceReviewProgress] = useState<SyncSourceReviewProgressJson | null>(null)
	const sourceReviewRequestRef = useRef<string | null>(null)
	const libraryCheckTokenRef = useRef(0)
	const libraryCheckRequestRef = useRef<string | null>(null)
	const [activeLibraryCheck, setActiveLibraryCheck] = useState<'connect' | 'connecting' | 'changes' | 'destination' | null>(null)
	const conflictCompareRequestRef = useRef<string | null>(null)
	const [activeConflictComparisonId, setActiveConflictComparisonId] = useState<string | null>(null)
  const [showDestination, setShowDestination] = useState(false)
	const [destinationStage, setDestinationStage] = useState<'provider' | 'setup'>('provider')
	const [publishConfirmationOpen, setPublishConfirmationOpen] = useState(false)
  const [remoteReview, setRemoteReview] = useState<SyncThreeWayReviewJson | null>(null)
	const [reviewingDeviceChoices, setReviewingDeviceChoices] = useState(false)
	const [undoPreview, setUndoPreview] = useState<SyncUndoPreviewJson | null>(null)
	const [disconnectPreview, setDisconnectPreview] = useState<SyncDisconnectPreviewJson | null>(null)
	const [remoteTrustPreview, setRemoteTrustPreview] = useState<SyncRemoteTrustPreviewJson | null>(null)
	const [remoteTrustMinimumReleaseAgeMinutes, setRemoteTrustMinimumReleaseAgeMinutes] = useState(7 * 24 * 60)
	const [remoteSelections, setRemoteSelections] = useState<string[]>([])
	const [localSelections, setLocalSelections] = useState<string[]>([])
	const [activeSyncAction, setActiveSyncAction] = useState<'metadata' | 'local' | 'remote' | null>(null)
	const [busy, setBusy] = useState<'idle' | 'reviewing' | 'creating' | 'browsing' | 'authenticating' | 'connecting' | 'publishing' | 'undoing' | 'disconnecting'>('idle')
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

	const profile = profiles?.find((item) => item.profile_id === activeProfileId) ?? profiles?.[0]
	const { data: history = [] } = useQuery<SyncHistoryEntryJson[]>({
		queryKey: ['sync-history', profile?.profile_id],
		queryFn: () => invoke('sync_history', { profileId: profile!.profile_id }),
		enabled: Boolean(profile),
	})
	const inventoryItems = inventory?.items ?? []
	const agentNames = useMemo(() => new Map((agents ?? []).map((agent) => [agent.slug, agent.name])), [agents])
	const sourceDecisionByKey = useMemo(() => new Map((sourceDecisionReview ?? []).map((source) => [source.id, source])), [sourceDecisionReview])
	const sourceDecisionSourceCount = useMemo(() => new Set((sourceDecisionReview ?? []).map((source) => `${source.source}\u0000${source.requested_ref}`)).size, [sourceDecisionReview])
	const reviewInventoryItems = useMemo(
		() => (sourceDecisionReview ? sourceDecisionReview.map((source) => inventoryItems.find((item) => item.candidate_key === source.id)).filter((item): item is InventoryItem => Boolean(item)) : inventoryItems),
		[inventoryItems, sourceDecisionReview],
	)
	const inventoryScrollRef = useRef<HTMLDivElement>(null)
	const inventoryVirtualizer = useVirtualizer({
	  count: reviewInventoryItems.length,
	  getScrollElement: () => inventoryScrollRef.current,
	  estimateSize: () => 46,
	  overscan: 24,
	  getItemKey: (index) => reviewInventoryItems[index]?.candidate_key ?? String(index),
	})
	const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys])
	const unresolvedCollisionCount = useMemo(
		() => (inventory?.collisions ?? []).filter((collision) => collision.candidate_keys.filter((key) => selectedKeySet.has(key)).length > 1 && !acknowledgedCollisions.has(collision.display_name)).length,
		[inventory?.collisions, selectedKeySet, acknowledgedCollisions],
	)
	const inspectedSkill = useMemo(() => inventoryItems.find((item) => item.candidate_key === inspectedSkillKey) ?? null, [inventoryItems, inspectedSkillKey])
	const inspectedSourceReviewIndex = sourceDecisionReview && inspectedSkill ? sourceDecisionReview.findIndex((source) => source.id === inspectedSkill.candidate_key) : -1
	const reviewedDecisions = useMemo(() => inventoryItems.map((item) => libraryDecisions[item.candidate_key] ?? defaultLibraryDecision(item, libraryPurpose)), [inventoryItems, libraryDecisions, libraryPurpose])
	const unresolvedDecisionCount = useMemo(
		() =>
			(sourceDecisionReview ?? []).filter((source) => {
				const item = inventoryItems.find((candidate) => candidate.candidate_key === source.id)
				if (!item) return false
				const decision = libraryDecisions[source.id] ?? defaultLibraryDecision(item, libraryPurpose)
				return decision.disposition !== 'owned' && decision.disposition !== 'local-only'
			}).length,
		[sourceDecisionReview, inventoryItems, libraryDecisions, libraryPurpose],
	)
	const unresolvedDecisionSourceCount = useMemo(() => {
		const sources = new Set<string>()
		for (const source of sourceDecisionReview ?? []) {
			const item = inventoryItems.find((candidate) => candidate.candidate_key === source.id)
			if (!item) continue
			const decision = libraryDecisions[source.id] ?? defaultLibraryDecision(item, libraryPurpose)
			if (decision.disposition !== 'owned' && decision.disposition !== 'local-only') {
				sources.add(`${source.source}\u0000${source.requested_ref}`)
			}
		}
		return sources.size
	}, [sourceDecisionReview, inventoryItems, libraryDecisions, libraryPurpose])
	const syncLibraryMode = libraryPurpose === 'team' ? 'team' : libraryMode
	const reviewedExternalSkillCount = useMemo(
		() =>
			inventoryItems.filter((item) => {
				const decision = libraryDecisions[item.candidate_key] ?? defaultLibraryDecision(item, libraryPurpose)
	  return item.source.kind !== 'local' && (decision.disposition === 'dependency' || decision.disposition === 'vendored')
			}).length,
		[inventoryItems, libraryDecisions, libraryPurpose],
	)
	const missingVendoredLicenses = reviewedDecisions.filter((decision) => decision.disposition === 'vendored' && !decision.license?.trim())
	const previewOwnedCount = preview?.decisions.filter((decision) => decision.disposition === 'owned').length ?? 0
	const previewLocalCount = preview?.decisions.filter((decision) => selectedKeySet.has(decision.candidate_key) && (decision.disposition === 'local-only' || decision.disposition === 'excluded')).length ?? 0
	const previewStaysLocalCount = preview?.unresolved_sources?.length || previewLocalCount
	const previewUnresolvedSourceCount = useMemo(
		() => new Set((preview?.unresolved_sources ?? []).map((source) => `${source.source}\u0000${source.requested_ref}`)).size,
		[preview?.unresolved_sources],
	)
	const previewUnresolvedSourceGroups = useMemo(() => {
		const groups = new Map<string, { source: string; requestedRef?: string; reason: UnresolvedSourceItem['reason']; skillIds: string[] }>()
		for (const item of preview?.unresolved_sources ?? []) {
			const key = `${item.source}\u0000${item.requested_ref}\u0000${item.reason}`
			const group = groups.get(key)
			if (group) group.skillIds.push(item.id)
			else groups.set(key, { source: item.source, requestedRef: item.requested_ref, reason: item.reason, skillIds: [item.id] })
		}
		return [...groups.values()].sort((a, b) => b.skillIds.length - a.skillIds.length || a.source.localeCompare(b.source))
	}, [preview?.unresolved_sources])
	const previewIncludedCount = (preview?.skills.length ?? 0) + (preview?.references.length ?? 0) + (preview?.skills_sh.length ?? 0)
	const previewFileCount = preview?.skills.reduce((total, skill) => total + skill.file_count, 0) ?? 0
	const previewUnresolvedKeys = new Set(preview?.unresolved_sources?.map((source) => source.id) ?? [])
	const previewExcludedKeys = new Set(preview?.decisions.filter((decision) => (decision.disposition === 'local-only' || decision.disposition === 'excluded') && !previewUnresolvedKeys.has(decision.candidate_key)).map((decision) => decision.candidate_key) ?? [])
	const previewExcludedItems = inventoryItems.filter((item) => previewExcludedKeys.has(item.candidate_key))
	const remoteReviewMetadataOnly = Boolean(remoteReview && !reviewingDeviceChoices && remoteReview.dependency_changes.length > 0 && remoteReview.skills.every((skill) => skill.action === 'unchanged' || skill.action === 'kept-local'))
	const remoteReviewDecisionCount = remoteReview?.skills.filter((skill) => skill.action === 'conflict' || skill.action === 'unmanaged').length ?? 0
	const remoteTargetAgentSlugs = useMemo(
		() => [...new Set((remoteReview?.skills ?? []).filter((skill) => remoteSelections.includes(skill.id)).flatMap((skill) => skill.target_agents))],
		[remoteReview, remoteSelections],
	)
	const toggleSelectedKey = useCallback(
		(key: string) => {
	  const selected = selectedKeySet.has(key)
	  const item = inventoryItems.find((candidate) => candidate.candidate_key === key)
	  if (!item) return
			const collision = inventory?.collisions.find((candidate) => candidate.candidate_keys.includes(key))
			if (collision) {
				setAcknowledgedCollisions((current) => {
					const next = new Set(current)
					next.delete(collision.display_name)
					return next
				})
			}
			setLibraryDecisions((decisions) => ({
				...decisions,
				[key]: selected ? { candidateKey: key, disposition: 'local-only' } : defaultLibraryDecision(item, libraryPurpose),
			}))
			setSelectedKeys((current) => (selected ? current.filter((item) => item !== key) : [...current, key]))
		},
		[inventory?.collisions, inventoryItems, libraryPurpose, selectedKeySet],
	)
	const chooseLibraryOutcome = useCallback((decision: SyncLibraryDecisionJson) => {
		const collision = inventory?.collisions.find((candidate) => candidate.candidate_keys.includes(decision.candidateKey))
		if (collision) {
			setAcknowledgedCollisions((current) => {
				const next = new Set(current)
				next.delete(collision.display_name)
				return next
			})
		}
		setLibraryDecisions((current) => ({
			...current,
			[decision.candidateKey]: decision,
		}))
	  setSelectedKeys((current) => {
		const included = decision.disposition === 'owned' || decision.disposition === 'dependency' || decision.disposition === 'vendored' || decision.disposition === 'suggested'
			return included ? (current.includes(decision.candidateKey) ? current : [...current, decision.candidateKey]) : current.filter((key) => key !== decision.candidateKey)
	  })
	}, [inventory?.collisions])
  const { data: recovery } = useQuery<{
		pending: boolean
		operations: Array<{
			kind: 'restore' | 'library-update'
			item_count: number | null
			changed_item_count: number | null
		}>
	}>({
    queryKey: ['sync-recovery', profile?.profile_id],
    queryFn: () => invoke('sync_recovery_status', { profileId: profile!.profile_id }),
    enabled: Boolean(profile),
  })
	const librarySkillCount = inventory?.items.length ?? 0
	const detectedAgents = agents?.filter((agent) => agent.detected) ?? []
	const agentCount = new Set(inventory?.items.flatMap((item) => item.locations.flatMap((location) => (location.agent_slug ? [location.agent_slug] : []))) ?? []).size
	const creatingLibrary = !profile || createFlow
	const isLanding = !profilesLoading && !showInventory && (allowExisting || !profile || showConnect)
	const showLibraryDashboard = Boolean(profile && !allowExisting && !showInventory && !showConnect)
	const canCloseLanding = allowExisting && Boolean(profile) && Boolean(onClose)
	const libraryInteractionLocked = Boolean(recovery?.pending || activeLibraryCheck || busy !== 'idle')
	const libraryStatus = activeLibraryCheck === 'changes'
		? {
				label: 'Checking',
				tone: 'border-primary/25 bg-primary/10 text-primary',
				icon: Loader2,
			}
		: recovery?.pending
		? {
				label: 'Recovery needed',
				tone: 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300',
				icon: AlertTriangle,
			}
		: profile?.remote_trust_required
			? {
					label: 'Review remote',
					tone: 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300',
					icon: AlertTriangle,
				}
			: profile?.check_error
				? {
						label: 'Check failed',
						tone: 'border-destructive/25 bg-destructive/10 text-destructive',
						icon: AlertTriangle,
					}
			: profile?.changed
				? {
						label: 'Local changes',
						tone: 'border-primary/25 bg-primary/10 text-primary',
						icon: Info,
					}
				: profile && profile.ahead > 0
					? {
							label: 'Upload pending',
							tone: 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300',
							icon: Cloud,
						}
					: profile && profile.behind > 0
						? {
								label: `${plural(profile.behind, 'update')} ready`,
								tone: 'border-primary/25 bg-primary/10 text-primary',
								icon: Cloud,
							}
						: {
								label: 'In sync',
								tone: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
								icon: CheckCircle2,
							}
	const LibraryStatusIcon = libraryStatus.icon
	const recoveryItemCount = recovery?.operations.reduce((total, operation) => total + (operation.item_count ?? 0), 0) ?? 0
	const recoveryOperationLabel = recovery?.operations.some((operation) => operation.kind === 'restore')
		? recovery.operations.some((operation) => operation.kind === 'library-update')
			? 'library sync'
			: 'library restore'
		: 'library save'
	const providerProblemView = providerProblem
		? providerProblemPresentation(providerProblem.provider, providerProblem.target, providerProblem.problem)
		: null

  useEffect(() => {
    if (!inventory || selectionReady) return
    setSelectedKeys(inventory.items.map((item) => item.candidate_key))
		setAcknowledgedCollisions(new Set())
		setLibraryDecisions({})
    setSelectionReady(true)
  }, [inventory, selectionReady])

  useEffect(() => {
    if (!agents || connectSelectionReady) return
    setConnectAgentSlugs(agents.filter((agent) => agent.detected).map((agent) => agent.slug))
    setConnectSelectionReady(true)
  }, [agents, connectSelectionReady])

	useEffect(() => {
		if (!profiles?.length) {
			setActiveProfileId(null)
			return
		}
		if (!activeProfileId || !profiles.some((item) => item.profile_id === activeProfileId)) {
			setActiveProfileId(profiles[0]!.profile_id)
		}
	}, [activeProfileId, profiles])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    void listen<SyncSourceReviewProgressJson>('sync_source_review_progress', (event) => {
      if (busy === 'reviewing') setSourceReviewProgress(event.payload)
		}).then((cleanup) => {
			unlisten = cleanup
		})
    return () => unlisten?.()
  }, [busy])

	useEffect(() => () => {
		const sourceRequestId = sourceReviewRequestRef.current
		const providerRequestId = providerBrowseRequestRef.current
		const libraryRequestId = libraryCheckRequestRef.current
		const conflictRequestId = conflictCompareRequestRef.current
		if (sourceRequestId) void invoke('sync_center_publish_preview_cancel', { requestId: sourceRequestId })
		if (providerRequestId) void invoke('sync_provider_libraries_cancel', { requestId: providerRequestId })
		if (libraryRequestId) void invoke('sync_library_check_cancel', { requestId: libraryRequestId })
		if (conflictRequestId) void invoke('sync_library_check_cancel', { requestId: conflictRequestId })
	}, [])

	function chooseLibraryPurpose(purpose: 'personal' | 'public' | 'team') {
		setSourceDecisionReview(null)
		setInspectedSkillKey(null)
		setLibraryPurpose(purpose)
		setLibraryMode(purpose === 'public' ? 'public' : 'private')
		setLibraryLicense(purpose === 'public' ? libraryLicense : '')
		// Access changes the default distribution policy, never the skills the
		// person deliberately selected. Rebuild per-skill defaults only.
		setAcknowledgedCollisions(new Set())
		setLibraryDecisions({})
		setRepositoryName(purpose === 'team' ? '' : 'agent-library')
		setGitLabProjectName(purpose === 'team' ? '' : 'agent-library')
	}

	function startCreateLibrary() {
		setCreateFlow(true)
		setShowConnect(false)
		setShowInventory(true)
		setInspectedSkillKey(null)
		setSourceDecisionReview(null)
		setSelectedKeys(inventoryItems.map((item) => item.candidate_key))
		setAcknowledgedCollisions(new Set())
		setLibraryDecisions({})
		setLibraryPurpose('personal')
		setLibraryMode('private')
		setLibraryLicense('')
		setRepositoryName('agent-library')
		setGitLabProjectName('agent-library')
		setMinimumReleaseAgeMinutes(0)
		setPreview(null)
		setShowDestination(false)
		setDestinationStage('provider')
		setSetupMode(null)
		setProviderIdentity(null)
		setRemoteUrl('')
		setCustomDestinationPreview(null)
		setDestinationSetupError(null)
		setRemoteReview(null)
		setReviewingDeviceChoices(false)
		setLocalPublishPreview(null)
		setPublishConfirmationOpen(false)
		setShowPurposeChoice(true)
	}

  function leaveLibraryFlow() {
    const providerBrowseRequestId = providerBrowseRequestRef.current
    providerBrowseRequestRef.current = null
    if (providerBrowseRequestId) void invoke('sync_provider_libraries_cancel', { requestId: providerBrowseRequestId })
		const libraryCheckRequestId = libraryCheckRequestRef.current
		libraryCheckRequestRef.current = null
		libraryCheckTokenRef.current += 1
		if (libraryCheckRequestId) void invoke('sync_library_check_cancel', { requestId: libraryCheckRequestId })
		const conflictCompareRequestId = conflictCompareRequestRef.current
		conflictCompareRequestRef.current = null
		if (conflictCompareRequestId) void invoke('sync_library_check_cancel', { requestId: conflictCompareRequestId })
		setActiveConflictComparisonId(null)
    sourceReviewRequestRef.current = null
		setBusy('idle')
		setShowInventory(false)
		setCreateFlow(false)
		setShowConnectRemoteInput(false)
		setInspectedSkillKey(null)
		setSourceDecisionReview(null)
		setPreview(null)
		setShowDestination(false)
		setSetupMode(null)
		setProviderIdentity(null)
		setCustomDestinationPreview(null)
		setDestinationSetupError(null)
		setRemoteReview(null)
		setReviewingDeviceChoices(false)
		setLocalPublishPreview(null)
		setPublishConfirmationOpen(false)
		setShowPurposeChoice(false)
	}

	async function reviewPublishPlan(nextSelectedKeys: string[], nextDecisions: SyncLibraryDecisionJson[], nextMinimumReleaseAgeMinutes: number, mode: 'private' | 'team' | 'public' = syncLibraryMode) {
		const requestId = crypto.randomUUID()
		sourceReviewRequestRef.current = requestId
    setSourceReviewProgress(null)
		// Never leave an obsolete plan visible while a decision is being
		// recomputed. A stale warning beside an already-updated selection makes
		// the action look broken and can invite a second, conflicting click.
		setPreview(null)
		setShowDestination(false)
    setBusy('reviewing')
    try {
			const result = await invoke('sync_center_publish_preview', {
				requestId,
				selectedKeys: nextSelectedKeys,
				decisions: nextDecisions,
				mode,
				minimumReleaseAgeMinutes: nextMinimumReleaseAgeMinutes,
			})
			if (sourceReviewRequestRef.current !== requestId) return
      setPreview(result)
			setDestinationStage('provider')
    } catch (error) {
			if (sourceReviewRequestRef.current === requestId && !isAbortError(error)) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
			}
    } finally {
			if (sourceReviewRequestRef.current === requestId) {
				sourceReviewRequestRef.current = null
      setBusy('idle')
    }
  }
	}

	function continueToSkills() {
		setInspectedSkillKey(null)
		setShowPurposeChoice(false)
	}

	async function buildLibraryPlan() {
		setShowPurposeChoice(false)
		await reviewPublishPlan(selectedKeys, reviewedDecisions, minimumReleaseAgeMinutes)
	}

	async function cancelSourceReview() {
		const requestId = sourceReviewRequestRef.current
		sourceReviewRequestRef.current = null
		// The source process can finish in the same frame as the click. Clear any
		// just-delivered partial plan as well as invalidating the in-flight result,
		// so this action always honours its promise to return to skill choices.
		setPreview(null)
		setShowDestination(false)
		setBusy('idle')
    setSourceReviewProgress(null)
		if (!requestId) return
    try {
			await invoke('sync_center_publish_preview_cancel', { requestId })
		} catch {
			// The review may have completed between the click and the cancellation request.
    }
  }

  async function changeMinimumReleaseAge(minutes: number) {
    if (minutes === minimumReleaseAgeMinutes) return
    setMinimumReleaseAgeMinutes(minutes)
    if (!preview) return
		await reviewPublishPlan(selectedKeys, reviewedDecisions, minutes)
	}

	async function saveUnresolvedAsCopies() {
		if (!preview?.unresolved_sources?.length) return
		const unresolved = new Set(preview.unresolved_sources.map((source) => source.id))
		const decisions = reviewedDecisions.map((decision) => (unresolved.has(decision.candidateKey) ? { candidateKey: decision.candidateKey, disposition: 'owned' as const } : decision))
		setLibraryDecisions((current) => ({
			...current,
			...Object.fromEntries([...unresolved].map((candidateKey) => [candidateKey, { candidateKey, disposition: 'owned' as const }])),
      }))
		await reviewPublishPlan(selectedKeys, decisions, minimumReleaseAgeMinutes)
	}

	async function keepUnresolvedSkillsLocal() {
		if (!preview?.unresolved_sources?.length) return
		const unresolved = new Set(preview.unresolved_sources.map((source) => source.id))
		const nextKeys = selectedKeys.filter((key) => !unresolved.has(key))
		const nextDecisions = reviewedDecisions.map((decision) =>
			unresolved.has(decision.candidateKey)
				? {
						candidateKey: decision.candidateKey,
						disposition: 'local-only' as const,
    }
				: decision,
		)
		setSelectedKeys(nextKeys)
		setLibraryDecisions((current) => ({
			...current,
			...Object.fromEntries([...unresolved].map((candidateKey) => [candidateKey, { candidateKey, disposition: 'local-only' as const }])),
		}))
		await reviewPublishPlan(nextKeys, nextDecisions, minimumReleaseAgeMinutes)
  }

	function beginSourceDecisionReview(items: UnresolvedSourceItem[]) {
		if (!items.length) return
		const ordered = [...items].sort((left, right) => `${left.source}\u0000${left.requested_ref}\u0000${left.id}`.localeCompare(`${right.source}\u0000${right.requested_ref}\u0000${right.id}`, 'en'))
		setSourceDecisionReview(ordered)
		setInspectedSkillKey(ordered[0]!.id)
		setPreview(null)
		setShowDestination(false)
		requestAnimationFrame(() => inventoryScrollRef.current?.scrollTo({ top: 0 }))
	}

	async function returnToLibraryReview() {
		setSourceDecisionReview(null)
		setInspectedSkillKey(null)
		await reviewPublishPlan(selectedKeys, reviewedDecisions, minimumReleaseAgeMinutes)
	}

	async function finishSourceDecisionReview() {
		if (unresolvedDecisionCount > 0) return
		await returnToLibraryReview()
	}

	async function keepRemainingSourceDecisionsLocal() {
		if (!sourceDecisionReview?.length) return
		const remaining = new Set(
			sourceDecisionReview
				.filter((source) => {
					const item = inventoryItems.find((candidate) => candidate.candidate_key === source.id)
					if (!item) return false
					const decision = libraryDecisions[source.id] ?? defaultLibraryDecision(item, libraryPurpose)
					return decision.disposition !== 'owned' && decision.disposition !== 'local-only'
				})
				.map((source) => source.id),
		)
		const nextKeys = selectedKeys.filter((key) => !remaining.has(key))
		const nextDecisions = reviewedDecisions.map((decision) => (remaining.has(decision.candidateKey) ? { candidateKey: decision.candidateKey, disposition: 'local-only' as const } : decision))
		setSelectedKeys(nextKeys)
		setLibraryDecisions((current) => ({
			...current,
			...Object.fromEntries([...remaining].map((candidateKey) => [candidateKey, { candidateKey, disposition: 'local-only' as const }])),
		}))
		setSourceDecisionReview(null)
		setInspectedSkillKey(null)
		await reviewPublishPlan(nextKeys, nextDecisions, minimumReleaseAgeMinutes)
	}

	function applyDecisionToSource(source: UnresolvedSourceItem, disposition: 'owned' | 'local-only') {
		if (!sourceDecisionReview) return
		const groupKeys = new Set(sourceDecisionReview.filter((candidate) => candidate.source === source.source && candidate.requested_ref === source.requested_ref).map((candidate) => candidate.id))
		setLibraryDecisions((current) => ({
			...current,
			...Object.fromEntries([...groupKeys].map((candidateKey) => [candidateKey, { candidateKey, disposition }])),
		}))
		setSelectedKeys((current) => (disposition === 'owned' ? [...new Set([...current, ...groupKeys])] : current.filter((key) => !groupKeys.has(key))))
	}

  async function revealSecretFinding(skillId: string, relativePath: string) {
    try {
      await invoke('reveal_sync_secret_finding', { skillId, relativePath })
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    }
  }

	async function revealInvalidEntry(invalidId: string) {
		try {
			await invoke('reveal_sync_invalid_entry', { invalidId })
		} catch (error) {
			toast(error instanceof Error ? error.message : String(error), 'destructive')
		}
	}

	async function leaveSecretSkillLocal(skillId: string) {
		if (!preview) return
		const nextKeys = selectedKeys.filter((key) => key !== skillId)
		const nextDecisions = reviewedDecisions.map((decision) => (decision.candidateKey === skillId ? { candidateKey: skillId, disposition: 'local-only' as const } : decision))
		setSelectedKeys(nextKeys)
		setLibraryDecisions((current) => ({
			...current,
			[skillId]: { candidateKey: skillId, disposition: 'local-only' },
		}))
		await reviewPublishPlan(nextKeys, nextDecisions, minimumReleaseAgeMinutes)
	}

	async function reviewUndo(historyId: string) {
		if (!profile) return
		setBusy('reviewing')
		try {
			setUndoPreview(
				await invoke('sync_undo_preview', {
					profileId: profile.profile_id,
					historyId,
				}),
			)
		} catch (error) {
			toast(error instanceof Error ? error.message : String(error), 'destructive')
		} finally {
			setBusy('idle')
		}
	}

	async function applyReviewedUndo() {
		if (!profile || !undoPreview) return
		setBusy('undoing')
		try {
			await invoke('sync_undo_apply', {
				profileId: profile.profile_id,
				historyId: undoPreview.history_id,
				planId: undoPreview.plan_id,
			})
			setUndoPreview(null)
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: ['sync-history', profile.profile_id],
				}),
				queryClient.invalidateQueries({ queryKey: ['sync-profiles'] }),
				queryClient.invalidateQueries({ queryKey: ['sync-center-inventory'] }),
			])
			toast('The reviewed library operation was undone locally.')
		} catch (error) {
			toast(error instanceof Error ? error.message : String(error), 'destructive')
		} finally {
			setBusy('idle')
		}
	}

	useEffect(() => {
	  const returnHome = () => {
			const providerBrowseRequestId = providerBrowseRequestRef.current
			providerBrowseRequestRef.current = null
			if (providerBrowseRequestId) void invoke('sync_provider_libraries_cancel', { requestId: providerBrowseRequestId })
			const libraryCheckRequestId = libraryCheckRequestRef.current
			libraryCheckRequestRef.current = null
			if (libraryCheckRequestId) void invoke('sync_library_check_cancel', { requestId: libraryCheckRequestId })
			const conflictCompareRequestId = conflictCompareRequestRef.current
			conflictCompareRequestRef.current = null
			if (conflictCompareRequestId) void invoke('sync_library_check_cancel', { requestId: conflictCompareRequestId })
			setActiveConflictComparisonId(null)
			libraryCheckTokenRef.current += 1
			setActiveLibraryCheck(null)
		setShowInventory(false)
		setShowConnect(false)
			setShowConnectRemoteInput(false)
			setCreateFlow(false)
		setConnectPreview(null)
			setConnectProviderLibraries(null)
			setSelectedConnectLibraryLabel(null)
		setInspectedSkillKey(null)
		setPreview(null)
		setShowDestination(false)
			setPublishConfirmationOpen(false)
			setSetupMode(null)
			setGitHubRepositoryPreview(null)
			setGitLabProjectPreview(null)
			setProviderIdentity(null)
		setCustomDestinationPreview(null)
		setDestinationSetupError(null)
			setRemoteReview(null)
			setReviewingDeviceChoices(false)
			setRemoteSelections([])
			setLocalSelections([])
			setRemoteTrustPreview(null)
			setLocalPublishPreview(null)
			setUndoPreview(null)
			setDisconnectPreview(null)
		setRemoteUrl('')
	  }
	  window.addEventListener('skiller:sync-home', returnHome)
	  return () => window.removeEventListener('skiller:sync-home', returnHome)
	}, [])

  function showThreeWayReview(result: SyncThreeWayReviewJson, deviceChoices = false) {
		setReviewingDeviceChoices(deviceChoices)
    setRemoteReview(result)
    setRemoteSelections(result.skills.filter((skill) => skill.action === 'take-remote').map((skill) => skill.id))
    setLocalSelections(result.skills.filter((skill) => skill.action === 'publish-local').map((skill) => skill.id))
  }

	function cancelLibraryCheck() {
		const cancelledOperation = activeLibraryCheck
		const requestId = libraryCheckRequestRef.current
		libraryCheckRequestRef.current = null
		libraryCheckTokenRef.current += 1
		setActiveLibraryCheck(null)
		setBusy('idle')
		if (requestId) void invoke('sync_library_check_cancel', { requestId })
		toast(cancelledOperation === 'connecting'
			? 'Connection stopped. No skills or library files were changed.'
			: 'Check stopped. Nothing in your skills or library was changed.')
	}

	async function compareExternalConflict(skillId: string) {
		if (!profile || !remoteReview) return
		const requestId = crypto.randomUUID()
		conflictCompareRequestRef.current = requestId
		setActiveConflictComparisonId(skillId)
		setBusy('reviewing')
		try {
			const comparison = await invoke('sync_external_conflict_preview', {
				profileId: profile.profile_id,
				skillId,
				workspacePlanId: remoteReview.workspace_plan_id,
				reconciliationPlanId: remoteReview.reconciliation_plan_id,
				requestId,
			})
			if (conflictCompareRequestRef.current !== requestId) return
			setRemoteReview((current) => current
				&& current.workspace_plan_id === remoteReview.workspace_plan_id
				&& current.reconciliation_plan_id === remoteReview.reconciliation_plan_id
					? { ...current, skills: current.skills.map((skill) => skill.id === skillId ? { ...skill, comparison } : skill) }
					: current)
		} catch (error) {
			if (conflictCompareRequestRef.current === requestId) toast(error instanceof Error ? error.message : String(error), 'destructive')
		} finally {
			if (conflictCompareRequestRef.current === requestId) {
				conflictCompareRequestRef.current = null
				setActiveConflictComparisonId(null)
				setBusy('idle')
			}
		}
	}

	async function cancelConflictComparison() {
		const requestId = conflictCompareRequestRef.current
		conflictCompareRequestRef.current = null
		setActiveConflictComparisonId(null)
		setBusy('idle')
		if (!requestId) return
		try {
			await invoke('sync_library_check_cancel', { requestId })
		} catch {
			// The exact-source comparison may complete while cancellation is sent.
		}
	}

  async function connectExistingLibrary() {
    if (!connectRemoteUrl.trim() || !connectPreview) return
		const token = ++libraryCheckTokenRef.current
		const requestId = crypto.randomUUID()
		libraryCheckRequestRef.current = requestId
		setActiveLibraryCheck('connecting')
    setBusy('connecting')
    try {
      const connected = await invoke('sync_center_connect', {
        profileId: connectPreview.profile_id,
        remoteUrl: connectRemoteUrl,
        agentSlugs: connectAgentSlugs,
        planId: connectPreview.plan_id,
        minimumReleaseAgeMinutes: connectMinimumReleaseAgeMinutes,
			requestId,
      })
      await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
			setActiveProfileId(connected.profile_id)
			setShowConnect(false)
			setConnectPreview(null)
			if (libraryCheckTokenRef.current !== token) {
				toast('Library connected. Open Agent Library to review anything that needs attention.')
				return
			}
			// A connected library belongs in the same canonical workspace as a
			// newly created one. Agent Library immediately refreshes its safe
			// status and presents any resulting review inline.
			toast('Library connected. Its status is ready in Agent Library.')
		onComplete?.(connected.profile_id)
			navigate('/library', { replace: true })
    } catch (error) {
			if (libraryCheckTokenRef.current !== token) return
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    } finally {
			if (libraryCheckTokenRef.current === token) {
				libraryCheckRequestRef.current = null
				setActiveLibraryCheck(null)
				setBusy('idle')
			}
    }
  }

  async function reviewExistingLibraryConnection(minimumAgeOverride?: number) {
    if (!connectRemoteUrl.trim()) return
		const reviewedMinimumAge = minimumAgeOverride ?? connectMinimumReleaseAgeMinutes
		const token = ++libraryCheckTokenRef.current
		const requestId = crypto.randomUUID()
		libraryCheckRequestRef.current = requestId
		setActiveLibraryCheck('connect')
		setConnectReviewProblem(null)
    setBusy('reviewing')
    try {
			const result = await invoke('sync_center_connect_preview', {
        remoteUrl: connectRemoteUrl,
        agentSlugs: connectAgentSlugs,
        minimumReleaseAgeMinutes: reviewedMinimumAge,
				requestId,
			})
			if (libraryCheckTokenRef.current !== token) return
			setConnectPreview(result)
    } catch (error) {
			if (libraryCheckTokenRef.current !== token) return
      setConnectPreview(null)
			const message = error instanceof Error ? error.message : String(error)
			setConnectReviewProblem(message.includes('resolved to a commit that is') && message.includes('reviewed minimum')
				? 'This library was updated more recently than your optional safety delay allows. Review the current version now, or choose a shorter delay.'
				: message)
    } finally {
			if (libraryCheckTokenRef.current === token) {
				libraryCheckRequestRef.current = null
				setActiveLibraryCheck(null)
      setBusy('idle')
    }
  }
	}

  async function reviewGitHubRepository() {
		setDestinationSetupError(null)
    setProviderProblem(null)
		if (libraryPurpose === 'team' && !repositoryName.trim().includes('/')) {
			setGitHubRepositoryPreview(null)
			setDestinationSetupError('Enter your GitHub organization and repository, for example team/agent-library.')
			return
    }
    setBusy('reviewing')
    try {
			const requestId = crypto.randomUUID()
			providerBrowseRequestRef.current = requestId
			setBrowsingProvider('github')
			const connection = await invoke('sync_provider_check', { provider: 'github', requestId })
			if (providerBrowseRequestRef.current !== requestId) return
			if (!connection.connected) {
				setGitHubRepositoryPreview(null)
				setProviderIdentity(null)
				setProviderProblem({ provider: 'github', target: 'create', problem: connection.problem ?? { kind: 'unknown' } })
				return
			}
			setProviderIdentity({ provider: 'github', account: connection.account })
			const result = await invoke('sync_github_create_repo_preview', {
        repository: repositoryName,
        visibility: libraryMode,
			})
			setGitHubRepositoryPreview(result)
			setPublishConfirmationOpen(true)
    } catch (error) {
      setGitHubRepositoryPreview(null)
			if (!isAbortError(error)) {
				const message = error instanceof Error ? error.message : String(error)
				if (/already in use|already exists|name.*taken/i.test(message)) {
					setProviderProblem({ provider: 'github', target: 'create', problem: { kind: 'conflict' } })
				} else if (/permission|forbidden|not allowed/i.test(message)) {
					setProviderProblem({ provider: 'github', target: 'create', problem: { kind: 'permission' } })
				} else {
					setDestinationSetupError(message)
				}
			}
    } finally {
      providerBrowseRequestRef.current = null
			setBrowsingProvider(null)
      setBusy('idle')
    }
  }

	async function browseProviderLibraries(provider: 'github' | 'gitlab') {
    const requestId = crypto.randomUUID()
    providerBrowseRequestRef.current = requestId
    setBrowsingProvider(provider)
    setBusy('browsing')
    try {
			const result = await invoke('sync_provider_libraries', { provider, requestId })
			if (providerBrowseRequestRef.current !== requestId) return
			if (result.problem) {
				setConnectProviderLibraries(null)
				setProviderProblem({ provider, target: 'connect', problem: result.problem })
			} else {
				setProviderProblem(null)
				setConnectProviderLibraries({ provider, libraries: result.libraries })
			}
		} catch (error) {
			if (providerBrowseRequestRef.current !== requestId) return
			setConnectProviderLibraries(null)
			if (!isAbortError(error)) {
				setProviderProblem({ provider, target: 'connect', problem: { kind: 'unknown' } })
			}
		} finally {
			if (providerBrowseRequestRef.current === requestId) {
				providerBrowseRequestRef.current = null
				setBrowsingProvider(null)
				setBusy('idle')
			}
		}
	}

	async function cancelProviderBrowse() {
		const requestId = providerBrowseRequestRef.current
		if (!requestId) return
		providerBrowseRequestRef.current = null
		setBrowsingProvider(null)
		setProviderAuthorization(null)
		setBusy('idle')
		try {
			await invoke('sync_provider_libraries_cancel', { requestId })
		} catch {
			// Discovery may finish between the user's click and the cancellation.
		}
	}

	async function signInProvider(provider: 'github' | 'gitlab', targetOverride?: 'create' | 'connect') {
		const target = targetOverride ?? providerProblem?.target ?? 'connect'
		const requestId = crypto.randomUUID()
		providerBrowseRequestRef.current = requestId
		setBrowsingProvider(provider)
		setBusy('authenticating')
		try {
			const started = await invoke('sync_provider_sign_in_start', { provider, requestId })
			if (providerBrowseRequestRef.current !== requestId) return
			if (!started.started) {
				setProviderProblem({ provider, target, problem: started.problem })
				return
			}
			setProviderAuthorization({ provider, userCode: started.user_code })
			await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
			const result = await invoke('sync_provider_sign_in_finish', { provider, requestId })
			if (providerBrowseRequestRef.current !== requestId) return
			if (!result.connected) {
				setProviderProblem({ provider, target, problem: result.problem ?? { kind: 'unknown' } })
				return
			}
			if (result.account) setProviderIdentity({ provider, account: result.account })
			setProviderProblem(null)
			setProviderAuthorization(null)
			setBusy('idle')
			if (target === 'connect') await browseProviderLibraries(provider)
			else toast(`${provider === 'github' ? 'GitHub' : 'GitLab'} connected. You can create the ${provider === 'github' ? 'repository' : 'project'} now.`)
	} catch {
			if (providerBrowseRequestRef.current !== requestId) return
			setProviderAuthorization(null)
			setProviderProblem({ provider, target, problem: { kind: 'unknown' } })
    } finally {
		if (providerBrowseRequestRef.current === requestId) {
			providerBrowseRequestRef.current = null
			setBrowsingProvider(null)
			setProviderAuthorization(null)
			setBusy('idle')
		}
    }
  }

	function useProviderLibrary(library: SyncProviderLibraryJson) {
      setConnectRemoteUrl(library.remote_url)
      setShowConnectRemoteInput(false)
      setSelectedConnectLibraryLabel(library.label)
      setConnectProviderLibraries(null)
      setConnectPreview(null)
      toast(`${library.label} selected. Skiller will review its exact commit before it creates a local workspace.`)
  }

  async function reviewGitLabProject() {
		setDestinationSetupError(null)
    setProviderProblem(null)
		if (libraryPurpose === 'team' && !gitLabProjectName.trim().includes('/')) {
			setGitLabProjectPreview(null)
			setDestinationSetupError('Enter your GitLab group and project, for example team/agent-library.')
			return
		}
    setBusy('reviewing')
    try {
			const requestId = crypto.randomUUID()
			providerBrowseRequestRef.current = requestId
			setBrowsingProvider('gitlab')
			const connection = await invoke('sync_provider_check', { provider: 'gitlab', requestId })
			if (providerBrowseRequestRef.current !== requestId) return
			if (!connection.connected) {
				setGitLabProjectPreview(null)
				setProviderIdentity(null)
				setProviderProblem({ provider: 'gitlab', target: 'create', problem: connection.problem ?? { kind: 'unknown' } })
				return
			}
			setProviderIdentity({ provider: 'gitlab', account: connection.account })
			const result = await invoke('sync_gitlab_create_project_preview', {
        project: gitLabProjectName,
        visibility: libraryMode,
			})
			setGitLabProjectPreview(result)
			setPublishConfirmationOpen(true)
    } catch (error) {
      setGitLabProjectPreview(null)
			if (!isAbortError(error)) {
				setDestinationSetupError(error instanceof Error ? error.message : String(error))
			}
    } finally {
      providerBrowseRequestRef.current = null
			setBrowsingProvider(null)
      setBusy('idle')
    }
  }

	async function reviewCustomDestination() {
		const nextRemoteUrl = remoteUrl.trim()
		if (!nextRemoteUrl) {
			setDestinationSetupError('Enter the empty Git repository that will store this library.')
			return
		}
		const token = ++libraryCheckTokenRef.current
		const requestId = crypto.randomUUID()
		libraryCheckRequestRef.current = requestId
		setDestinationSetupError(null)
		setCustomDestinationPreview(null)
		setActiveLibraryCheck('destination')
		setBusy('reviewing')
		try {
			const result = await invoke('sync_git_destination_preview', {
				remoteUrl: nextRemoteUrl,
				requestId,
			})
			if (libraryCheckTokenRef.current !== token) return
			setRemoteUrl(nextRemoteUrl)
			setCustomDestinationPreview(result)
			setPublishConfirmationOpen(true)
		} catch (error) {
			if (libraryCheckTokenRef.current !== token) return
			setDestinationSetupError(error instanceof Error ? error.message : String(error))
		} finally {
			if (libraryCheckTokenRef.current === token) {
				libraryCheckRequestRef.current = null
				setActiveLibraryCheck(null)
				setBusy('idle')
			}
		}
	}

	async function copyProviderAuthorizationCode() {
		if (!providerAuthorization) return
		try {
			await navigator.clipboard.writeText(providerAuthorization.userCode)
			toast('Code copied.')
		} catch {
			toast('Select the code and copy it manually.', 'destructive')
		}
	}

  async function publishBackup() {
		if (!preview) return
		if (!remoteUrl && setupMode === 'github' && !githubRepositoryPreview) return
		if (!remoteUrl && setupMode === 'gitlab' && !gitLabProjectPreview) return
    if (!remoteUrl && setupMode === 'custom') return
    setBusy('publishing')
    try {
			let publishRemoteUrl = remoteUrl
			if (!publishRemoteUrl && setupMode === 'github' && githubRepositoryPreview) {
				const result = await invoke('sync_github_create_repo', {
					repository: repositoryName,
					visibility: libraryMode,
					planId: githubRepositoryPreview.plan_id,
				})
				if (result.problem || !result.remoteUrl) {
					setProviderProblem({ provider: 'github', target: 'create', problem: result.problem ?? { kind: 'unknown' } })
					setPublishConfirmationOpen(false)
					return
				}
				publishRemoteUrl = result.remoteUrl
				setRemoteUrl(result.remoteUrl)
				setProviderProblem(null)
			}
			if (!publishRemoteUrl && setupMode === 'gitlab' && gitLabProjectPreview) {
				const result = await invoke('sync_gitlab_create_project', {
					project: gitLabProjectName,
					visibility: libraryMode,
					planId: gitLabProjectPreview.plan_id,
				})
				if (result.problem || !result.remoteUrl) {
					setProviderProblem({ provider: 'gitlab', target: 'create', problem: result.problem ?? { kind: 'unknown' } })
					setPublishConfirmationOpen(false)
					return
				}
				publishRemoteUrl = result.remoteUrl
				setRemoteUrl(result.remoteUrl)
				setProviderProblem(null)
			}
			if (!publishRemoteUrl) throw new Error('Choose where to keep this library before publishing.')
			const published = await invoke('sync_center_publish', {
        remoteUrl: publishRemoteUrl,
        selectedKeys,
        decisions: reviewedDecisions,
				mode: syncLibraryMode,
        license: libraryMode === 'public' ? libraryLicense || undefined : undefined,
        planId: preview.plan_id,
        sourceAuthorizationId: preview.source_authorization_id,
        minimumReleaseAgeMinutes,
      })
			const publishedRepositoryUrl = repositoryBrowserUrl(publishRemoteUrl)
			toast(
				'Your skill library is published and ready to use.',
				'default',
				publishedRepositoryUrl ? { label: 'Open repository', onClick: () => openUrl(publishedRepositoryUrl) } : undefined,
			)
			setPublishConfirmationOpen(false)
      setPreview(null)
      setSetupMode(null)
			setGitHubRepositoryPreview(null)
			setGitLabProjectPreview(null)
			setShowInventory(false)
			setCreateFlow(false)
      await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
			setActiveProfileId(published.profile_id)
			await queryClient.invalidateQueries({
				queryKey: ['sync-center-inventory'],
			})
			// Setup is complete. The canonical home for an existing library is
			// Agent Library; leaving people on a second dashboard creates two
			// competing places to understand and operate the same data.
			onComplete?.(published.profile_id)
			navigate('/library', { replace: true })
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    } finally {
      setBusy('idle')
    }
  }

  async function reviewRemoteChanges(includeDeviceChoices = false) {
    if (!profile) return
		const token = ++libraryCheckTokenRef.current
		const requestId = crypto.randomUUID()
		libraryCheckRequestRef.current = requestId
		setRemoteReview(null)
		setRemoteSelections([])
		setLocalSelections([])
		setShowInventory(false)
		setActiveLibraryCheck('changes')
    setBusy('reviewing')
    try {
			const result = await invoke('sync_three_way_review', {
				profileId: profile.profile_id,
				requestId,
			})
			if (libraryCheckTokenRef.current !== token) return
			await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
			if (hasVisibleRemoteReview(result, includeDeviceChoices)) {
				showThreeWayReview(result, includeDeviceChoices)
      setShowInventory(true)
			} else {
				setRemoteReview(null)
				setReviewingDeviceChoices(false)
				setShowInventory(false)
				const repositoryUrl = repositoryBrowserUrl(profile.remote_identity)
				toast(
					'Your library and this computer are already in sync.',
					'default',
					repositoryUrl ? { label: 'Open repository', onClick: () => openUrl(repositoryUrl) } : undefined,
				)
			}
    } catch (error) {
			if (libraryCheckTokenRef.current !== token) return
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    } finally {
			if (libraryCheckTokenRef.current === token) {
				libraryCheckRequestRef.current = null
				setActiveLibraryCheck(null)
      setBusy('idle')
    }
  }
	}

	async function resolveProviderProblem() {
		if (!providerProblem) return
		const { provider, target } = providerProblem
		const action = providerProblemPresentation(provider, target, providerProblem.problem).action
		if (action === 'connect') {
			await signInProvider(provider)
			return
		}
		if (action === 'retry') {
			setProviderProblem(null)
			if (target === 'connect') await browseProviderLibraries(provider)
			else if (provider === 'github') await reviewGitHubRepository()
			else await reviewGitLabProject()
			return
		}
		if (action === 'rename') {
			setProviderProblem(null)
			if (provider === 'github') setGitHubRepositoryPreview(null)
			else setGitLabProjectPreview(null)
			return
		}
		if (action === 'choose-existing') {
			setProviderProblem(null)
			setPublishConfirmationOpen(false)
			setShowDestination(false)
			setShowInventory(false)
			setCreateFlow(false)
			setShowConnect(true)
			await browseProviderLibraries(provider)
			return
		}
		setProviderProblem(null)
		if (target === 'create') {
			setPublishConfirmationOpen(false)
			setDestinationStage('provider')
			setSetupMode(null)
		} else {
			setShowConnectRemoteInput(true)
			requestAnimationFrame(() => connectRemoteInputRef.current?.focus())
		}
	}

	async function reviewLocalLibraryChanges() {
		if (!profile) return
		setBusy('reviewing')
		try {
			const nextPreview = await invoke('sync_local_publish_preview', {
				profileId: profile.profile_id,
			})
			// The state can change between the compact status check and this review.
			// Do not send people into an empty second screen: refresh the library
			// status and state the useful outcome instead.
			if (!nextPreview.has_blockers && nextPreview.files.length === 0) {
				setLocalPublishPreview(null)
				await Promise.all([
					queryClient.invalidateQueries({ queryKey: ['sync-profiles'] }),
					queryClient.invalidateQueries({ queryKey: ['dotagents-resource-overview', profile.profile_id] }),
					queryClient.invalidateQueries({ queryKey: ['dotagents-library-health', profile.profile_id] }),
				])
				toast('Everything in this library is already saved.')
				return
			}
			setLocalPublishPreview(nextPreview)
		} catch (error) {
			setLocalPublishPreview(null)
			toast(error instanceof Error ? error.message : String(error), 'destructive')
		} finally {
			setBusy('idle')
		}
	}

	async function publishReviewedLocalLibrary() {
		if (!profile || !localPublishPreview) return
	  setBusy('publishing')
	  try {
			const result = await invoke('sync_local_publish_apply', {
				profileId: profile.profile_id,
				planId: localPublishPreview.plan_id,
			})
			setLocalPublishPreview(null)
			toast(result.pushed ? 'Your reviewed library changes are saved and uploaded.' : 'There were no remaining library changes to save.')
		} catch (error) {
			setLocalPublishPreview(null)
			toast(error instanceof Error ? error.message : String(error), 'destructive')
		} finally {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['sync-profiles'] }),
				queryClient.invalidateQueries({ queryKey: ['sync-history', profile.profile_id] }),
				queryClient.invalidateQueries({ queryKey: ['dotagents-resource-overview', profile.profile_id] }),
				queryClient.invalidateQueries({ queryKey: ['dotagents-library-health', profile.profile_id] }),
				queryClient.invalidateQueries({ queryKey: ['dotagents-resource-content', profile.profile_id] }),
			])
			setBusy('idle')
		}
	}

	async function finishPendingUpload() {
		if (!profile) return
		setBusy('publishing')
		try {
			const result = await invoke('sync_push_pending', {
				profileId: profile.profile_id,
			})
			toast(result.pushed ? 'The pending library update was uploaded.' : 'Nothing is waiting to upload.')
	  } catch (error) {
		toast(error instanceof Error ? error.message : String(error), 'destructive')
		} finally {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['sync-profiles'] }),
				queryClient.invalidateQueries({ queryKey: ['dotagents-resource-overview', profile.profile_id] }),
				queryClient.invalidateQueries({ queryKey: ['dotagents-library-health', profile.profile_id] }),
			])
		setBusy('idle')
	  }
	}

	async function copyLibraryLink() {
		if (!profile?.remote_identity) return
		try {
			await navigator.clipboard.writeText(profile.remote_identity)
			toast(profile.mode === 'public' ? 'Public library link copied.' : 'Team library address copied. Access is still controlled by your Git server.')
		} catch {
			toast('The library link could not be copied.', 'destructive')
		}
	}

	async function chooseActiveLibrary(profileId: string) {
		if (!profiles?.some((candidate) => candidate.profile_id === profileId)) return
		const previousProfileId = profile?.profile_id ?? null
		setActiveProfileId(profileId)
		setRemoteReview(null)
		setLocalPublishPreview(null)
		setUndoPreview(null)
		setDisconnectPreview(null)
		try {
			await invoke('sync_select_profile', { profileId })
			await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
		} catch (error) {
			setActiveProfileId(previousProfileId)
			toast(error instanceof Error ? error.message : String(error), 'destructive')
		}
	}

	async function reviewDisconnectLibrary() {
		if (!profile) return
		setBusy('reviewing')
		try {
			setDisconnectPreview(await invoke('sync_disconnect_preview', { profileId: profile.profile_id }))
		} catch (error) {
			toast(error instanceof Error ? error.message : String(error), 'destructive')
		} finally {
			setBusy('idle')
		}
	}

	async function disconnectLibraryFromComputer() {
		if (!profile || !disconnectPreview) return
		setBusy('disconnecting')
		try {
			await invoke('sync_disconnect_apply', {
				profileId: profile.profile_id,
				planId: disconnectPreview.plan_id,
			})
			setDisconnectPreview(null)
			setActiveProfileId(null)
			await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
			toast('Library disconnected from this computer. Installed skills and the remote library were left unchanged.')
		} catch (error) {
			toast(error instanceof Error ? error.message : String(error), 'destructive')
		} finally {
			setBusy('idle')
		}
	}

	async function publishSelectedLocalChanges() {
		if (!profile || !remoteReview || localSelections.length === 0) return
		setActiveSyncAction('local')
		setBusy('publishing')
    try {
			await invoke('sync_publish_local_changes', {
				profileId: profile.profile_id,
				skillIds: localSelections,
				workspacePlanId: remoteReview.workspace_plan_id,
				reconciliationPlanId: remoteReview.reconciliation_plan_id,
			})
			toast(`Published ${localSelections.length} reviewed local change${localSelections.length === 1 ? '' : 's'}.`)
			setLocalSelections([])
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['sync-profiles'] }),
				queryClient.invalidateQueries({ queryKey: ['sync-history', profile.profile_id] }),
			])
			const nextReview = await invoke('sync_three_way_review', {
				profileId: profile.profile_id,
			})
			if (hasVisibleRemoteReview(nextReview, reviewingDeviceChoices)) showThreeWayReview(nextReview, reviewingDeviceChoices)
			else leaveLibraryFlow()
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    } finally {
		setActiveSyncAction(null)
      setBusy('idle')
    }
  }

	async function reviewRemoteTrust() {
	  if (!profile) return
	  setBusy('reviewing')
	  try {
			setRemoteTrustPreview(
				await invoke('sync_remote_trust_preview', {
		  profileId: profile.profile_id,
		  minimumReleaseAgeMinutes: remoteTrustMinimumReleaseAgeMinutes,
				}),
			)
	  } catch (error) {
		toast(error instanceof Error ? error.message : String(error), 'destructive')
	  } finally {
		setBusy('idle')
	  }
	}

	async function changeRemoteTrustMinimumReleaseAge(minutes: number) {
	  setRemoteTrustMinimumReleaseAgeMinutes(minutes)
	  if (!profile || !remoteTrustPreview) return
	  setBusy('reviewing')
	  try {
			setRemoteTrustPreview(
				await invoke('sync_remote_trust_preview', {
		  profileId: profile.profile_id,
		  minimumReleaseAgeMinutes: minutes,
				}),
			)
	  } catch (error) {
		setRemoteTrustPreview(null)
		toast(error instanceof Error ? error.message : String(error), 'destructive')
	  } finally {
		setBusy('idle')
	  }
	}

	async function allowReviewedRemote() {
	  if (!profile || !remoteTrustPreview) return
	  setBusy('publishing')
	  try {
		await invoke('sync_remote_trust_apply', {
		  profileId: profile.profile_id,
		  planId: remoteTrustPreview.plan_id,
		  minimumReleaseAgeMinutes: remoteTrustPreview.minimum_release_age_minutes,
		})
		setRemoteTrustPreview(null)
		await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
		toast('This exact remote is now allowed on this device. Nothing was fetched yet.')
	  } catch (error) {
		toast(error instanceof Error ? error.message : String(error), 'destructive')
	  } finally {
		setBusy('idle')
	  }
	}

  async function applySelectedRemoteChanges() {
    if (!profile || !remoteReview || remoteSelections.length === 0) return
		setActiveSyncAction('remote')
    setBusy('publishing')
    try {
			const result = await invoke('sync_apply_remote_changes', {
				profileId: profile.profile_id,
				skillIds: remoteSelections,
				workspacePlanId: remoteReview.workspace_plan_id,
				reconciliationPlanId: remoteReview.reconciliation_plan_id,
			})
      toast(`Restored ${result.restored.length} remote change${result.restored.length === 1 ? '' : 's'}.`)
      setRemoteSelections([])
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['sync-profiles'] }),
				queryClient.invalidateQueries({ queryKey: ['sync-center-inventory'] }),
				queryClient.invalidateQueries({ queryKey: ['sync-history', profile.profile_id] }),
			])
			const nextReview = await invoke('sync_three_way_review', {
				profileId: profile.profile_id,
			})
			if (hasActionableRemoteReview(nextReview)) showThreeWayReview(nextReview)
			else leaveLibraryFlow()
		} catch (error) {
			toast(error instanceof Error ? error.message : String(error), 'destructive')
		} finally {
			setActiveSyncAction(null)
			setBusy('idle')
		}
	}

	async function acceptRemoteLibraryUpdate() {
		if (!profile || !remoteReview || !remoteReviewMetadataOnly) return
		setActiveSyncAction('metadata')
		setBusy('publishing')
		try {
			await invoke('sync_accept_remote_library_update', {
				profileId: profile.profile_id,
				workspacePlanId: remoteReview.workspace_plan_id,
				reconciliationPlanId: remoteReview.reconciliation_plan_id,
			})
			toast('The reviewed library record is up to date. Your local skills were not changed.')
			await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
			leaveLibraryFlow()
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    } finally {
		setActiveSyncAction(null)
      setBusy('idle')
    }
  }

	async function useRemoteForConflict(skillId: string) {
	  if (!profile || !remoteReview) return
		const reviewedSkill = remoteReview.skills.find((skill) => skill.id === skillId)
	  setBusy('publishing')
	  try {
			const result = await invoke('sync_apply_conflicting_remote_changes', {
				profileId: profile.profile_id,
				skillIds: [skillId],
				workspacePlanId: remoteReview.workspace_plan_id,
				reconciliationPlanId: remoteReview.reconciliation_plan_id,
		})
		toast(reviewedSkill?.comparison?.local_state === 'absent'
			? `Restored ${result.restored[0]} from the library on this computer.`
			: `Replaced the local copy of ${result.restored[0]} with the reviewed library version.`)
			const nextReview = await invoke('sync_three_way_review', {
				profileId: profile.profile_id,
			})
			if (hasVisibleRemoteReview(nextReview, reviewingDeviceChoices)) showThreeWayReview(nextReview, reviewingDeviceChoices)
			else leaveLibraryFlow()
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['sync-center-inventory'] }),
				queryClient.invalidateQueries({ queryKey: ['sync-profiles'] }),
				queryClient.invalidateQueries({ queryKey: ['sync-history', profile.profile_id] }),
			])
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
			await invoke('sync_adopt_local_changes', {
				profileId: profile.profile_id,
				skillIds: [skillId],
				workspacePlanId: remoteReview.workspace_plan_id,
				reconciliationPlanId: remoteReview.reconciliation_plan_id,
			})
		toast(`Published the local ${skillId} as the library version.`)
			const nextReview = await invoke('sync_three_way_review', {
				profileId: profile.profile_id,
			})
			if (hasActionableRemoteReview(nextReview)) showThreeWayReview(nextReview)
			else leaveLibraryFlow()
		await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
	  } catch (error) {
		toast(error instanceof Error ? error.message : String(error), 'destructive')
	  } finally {
		setBusy('idle')
	  }
	}

	async function keepConflictLocal(
		skillId: string,
		external: boolean,
		localState?: 'absent' | 'directory' | 'file' | 'symlink' | 'unsupported',
	) {
	  if (!profile || !remoteReview) return
	  setBusy('publishing')
	  try {
			await invoke(external ? 'sync_keep_external_local_changes' : 'sync_keep_local_changes', {
				profileId: profile.profile_id,
				skillIds: [skillId],
				workspacePlanId: remoteReview.workspace_plan_id,
				reconciliationPlanId: remoteReview.reconciliation_plan_id,
			})
		toast(localState === 'absent'
			? `${skillId} stays removed on this computer. Its saved library copy is unchanged.`
			: localState && localState !== 'directory'
				? `Left the local ${localState} untouched. The saved ${skillId} library copy is unchanged.`
				: `Kept both versions of ${skillId}. This computer keeps its copy; the library keeps its saved copy.`)
			const nextReview = await invoke('sync_three_way_review', {
				profileId: profile.profile_id,
			})
			if (hasActionableRemoteReview(nextReview)) showThreeWayReview(nextReview)
			else leaveLibraryFlow()
			await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
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
			const result = await invoke('sync_recovery_rollback', {
				profileId: profile.profile_id,
			})
      toast(result.recovered ? 'Interrupted restore was rolled back safely.' : 'No interrupted restore was found.')
			await queryClient.invalidateQueries({
				queryKey: ['sync-recovery', profile.profile_id],
			})
      await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
			await queryClient.invalidateQueries({
				queryKey: ['sync-center-inventory'],
			})
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    } finally {
      setBusy('idle')
    }
  }

	function renderFinalReviewAction() {
		if (setupMode === 'custom' && activeLibraryCheck === 'destination') {
			return (
				<Button size="sm" variant="outline" onClick={cancelLibraryCheck}>
					Stop checking
				</Button>
			)
		}
		const disabled = busy !== 'idle' || !remoteUrl.trim() || (preview?.secret_findings.length ?? 0) > 0 || (libraryMode === 'public' && !libraryLicense)
		const openReview = setupMode === 'custom'
			? (customDestinationPreview ? () => setPublishConfirmationOpen(true) : reviewCustomDestination)
			: () => setPublishConfirmationOpen(true)
		return (
			<Button size="sm" onClick={openReview} disabled={disabled}>
				{setupMode === 'custom' && busy === 'reviewing' ? (
					<><Loader2 className="size-3.5 animate-spin" /> Checking repository…</>
				) : customDestinationPreview ? (
					<>Open final review <ChevronRight className="size-3.5" /></>
				) : (
					<>Review final setup <ChevronRight className="size-3.5" /></>
				)}
			</Button>
		)
	}

	const plannedProviderPath = setupMode === 'github'
		? githubRepositoryPreview?.repository
		: setupMode === 'gitlab'
			? gitLabProjectPreview?.project
			: null
	const plannedProviderDestination = plannedProviderPath && providerIdentity?.provider === setupMode && !plannedProviderPath.includes('/')
		? `${providerIdentity.account}/${plannedProviderPath}`
		: plannedProviderPath
	const plannedDestination = customDestinationPreview?.remote_identity || remoteUrl
		|| plannedProviderDestination
		|| 'Destination not selected'
	const finalLibraryAccessLabel = setupMode === 'custom'
		? 'Access managed by your Git server'
		: libraryPurpose === 'public'
			? 'Public'
			: libraryPurpose === 'team'
				? 'Private team'
				: 'Private'
	const finalLibraryHeading = setupMode === 'custom'
		? 'Ready to create your library'
		: `Ready to create your ${libraryPurpose === 'public' ? 'public' : libraryPurpose === 'team' ? 'team' : 'private'} library`

	// SyncCenter is deliberately only the first-library journey. Once a profile
	// exists, Agent Library is the single destination for its contents, status,
	// reviews, and saving. Keeping this guard here also prevents a stale deep
	// link from reviving the old, parallel "Library sync" dashboard.
	if (!allowExisting && !profilesLoading && profiles?.length) {
		return <Navigate to="/library" replace />
	}

	return (
		<div className={isLanding ? 'h-full w-full animate-fade-in-up' : `${showInventory ? `relative flex h-full min-h-0 w-full flex-col ${preview || remoteReview ? 'overflow-y-auto' : 'overflow-hidden'}` : 'mx-auto w-full max-w-4xl px-6 py-8 min-h-full pb-12'} animate-fade-in-up`}>
			{isLanding && (
				<section className="sync-center-hero relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden px-6 py-10 text-center text-primary-foreground">
					<div className="absolute -left-28 -top-24 size-80 rounded-full border border-white/15" />
          <div className="absolute -bottom-36 -right-20 size-[28rem] rounded-full border border-white/12" />
					{canCloseLanding && (
						<div className="absolute right-6 top-6 z-10">
							<Tooltip content="Close library setup" side="bottom">
								<button
									type="button"
									onClick={() => onClose?.()}
									className="inline-flex size-9 items-center justify-center rounded-lg border border-white/20 bg-white/5 text-white/80 transition-colors hover:border-white/35 hover:bg-white/12 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
									aria-label="Close library setup"
								>
									<X className="size-4" />
								</button>
							</Tooltip>
						</div>
					)}
					{!showConnect ? (
						<div className="relative max-w-2xl">
							<div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-white">
								<Cloud className="size-3.5" /> {embedded ? 'Agent Library' : 'Sync Center'}
							</div>
							<h1 className="mt-6 text-balance text-4xl font-semibold tracking-[-0.055em] text-white sm:text-5xl">
								Keep your agent skills
								<br />
								ready for anything.
							</h1>
							<p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-primary-foreground/82 sm:text-base">Your hard-won skills, collected in one library you can carry to a new computer or share when you choose.</p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
								<Button size="lg" className="sync-library-cta h-11 px-5" onClick={startCreateLibrary}>
									<span className="text-[13px] font-semibold">Create my library</span>
                <ChevronRight className="ml-0.5 size-4" />
              </Button>
              <Button size="lg" variant="outline" className="h-11 border-white/25 bg-white/8 px-5 text-white hover:border-white/40 hover:bg-white/14 hover:text-white" onClick={() => setShowConnect(true)}>
                Use an existing library
              </Button>
            </div>
			<p className="mt-2 text-[11px] text-primary-foreground/68">Nothing is created or uploaded until you confirm the final step.</p>
            <div className="mt-9 flex flex-wrap justify-center gap-x-7 gap-y-2 text-xs text-primary-foreground/76">
			  <span>{inventoryLoading ? 'Scanning your setup…' : `${plural(librarySkillCount, 'skill')} ready for your library`}</span>
			  {agentCount > 0 && <span>{inventoryLoading ? '' : `${plural(agentCount, 'agent')} linked`}</span>}
			  <span>Private by default · share when ready</span>
            </div>
						</div>
					) : (
						<div className="relative w-full max-w-xl rounded-2xl border border-white/20 bg-background p-6 text-left text-foreground shadow-[0_24px_70px_rgb(0_0_0_/_0.22)] sm:p-7">
							<button
								type="button"
								className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
								onClick={() => {
									setShowConnect(false)
									setConnectPreview(null)
									setSelectedConnectLibraryLabel(null)
								}}
							>
								<ChevronLeft className="size-3.5" />
								Back
							</button>
							<div className="mt-5">
								<h1 className="text-2xl font-semibold tracking-[-0.03em]">Use an existing library</h1>
								<p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">Choose where it lives. You can inspect its skills before anything is added to this computer.</p>
            </div>
            <section className="mt-7">
								<div>
									<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Step 1</p>
									<p className="mt-1 text-sm font-semibold">Where does your library live?</p>
									<p className="mt-1 text-xs text-muted-foreground">Choose one place to look. Nothing is downloaded yet.</p>
								</div>
								{!showConnectRemoteInput && <div className="mt-3 grid grid-cols-2 gap-2">
										<Button size="default" variant="outline" className="h-12 justify-start border-primary/45 bg-primary/[0.10] px-3.5 font-semibold text-foreground hover:border-primary/70 hover:bg-primary/[0.18]" onClick={() => void (busy === 'browsing' && browsingProvider === 'github' ? cancelProviderBrowse() : browseProviderLibraries('github'))} disabled={busy !== 'idle' && !(busy === 'browsing' && browsingProvider === 'github')}>
											{busy === 'browsing' && browsingProvider === 'github' ? (
												<>
													<Loader2 className="size-3.5 animate-spin" />
													Stop checking
												</>
											) : (
												<>
													<Github className="size-3.5" />
													Choose from GitHub
												</>
											)}
										</Button>
										<Button size="default" variant="outline" className="h-12 justify-start border-primary/45 bg-primary/[0.10] px-3.5 font-semibold text-foreground hover:border-primary/70 hover:bg-primary/[0.18]" onClick={() => void (busy === 'browsing' && browsingProvider === 'gitlab' ? cancelProviderBrowse() : browseProviderLibraries('gitlab'))} disabled={busy !== 'idle' && !(busy === 'browsing' && browsingProvider === 'gitlab')}>
											{busy === 'browsing' && browsingProvider === 'gitlab' ? (
												<>
													<Loader2 className="size-3.5 animate-spin" />
													Stop checking
												</>
											) : (
												<>
													<Gitlab className="size-3.5" />
													Choose from GitLab
												</>
											)}
										</Button>
									</div>}
								{!showConnectRemoteInput && (
									<button
										type="button"
										className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
										onClick={() => {
											setShowConnectRemoteInput(true)
											requestAnimationFrame(() => connectRemoteInputRef.current?.focus())
										}}
									>
										<Server className="size-3.5" />
										Use another Git server or paste a repository address
									</button>
								)}
								{providerProblem?.target === 'connect' && providerProblemView && (
									<div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2.5">
										<p className="text-[11px] leading-relaxed text-amber-900 dark:text-amber-100">{providerProblemView.message}</p>
										<Button size="xs" className="h-7 px-2.5" onClick={() => void (busy === 'authenticating' ? cancelProviderBrowse() : resolveProviderProblem())} disabled={busy !== 'idle' && busy !== 'authenticating'}>
											{busy === 'authenticating' ? (
												<>
													<Loader2 className="size-3 animate-spin" />
													Stop connecting
												</>
											) : (
												providerProblemView.actionLabel
											)}
										</Button>
									</div>
								)}
								{connectProviderLibraries && (
									<label className="mt-3 grid gap-1 text-[11px] font-medium text-foreground">
										{connectProviderLibraries.provider === 'github' ? 'Choose a GitHub repository' : 'Choose a GitLab project'}
										<select
											defaultValue=""
											onChange={(event) => {
												const selected = connectProviderLibraries.libraries.find((library) => library.remote_url === event.target.value)
												if (selected) useProviderLibrary(selected)
											}}
											className="h-9 rounded-lg border border-border bg-background px-2.5 text-xs font-normal text-foreground outline-none focus:ring-2 focus:ring-ring/40"
										>
											<option value="" disabled>
												{connectProviderLibraries.libraries.length ? 'Select your library…' : `No writable ${connectProviderLibraries.provider === 'github' ? 'repositories' : 'projects'} found`}
											</option>
											{connectProviderLibraries.libraries.map((library) => (
												<option key={library.remote_url} value={library.remote_url}>
													{library.label}
												</option>
											))}
										</select>
									</label>
								)}
								{selectedConnectLibraryLabel && (
									<p className="mt-3 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
										<CheckCircle2 className="mr-1 inline size-3" />
										{selectedConnectLibraryLabel} selected
									</p>
								)}
								{showConnectRemoteInput && <div className="mt-4 rounded-xl border border-border bg-background px-3.5 py-3">
									<div className="flex items-start justify-between gap-3">
										<div><p className="text-xs font-semibold">Connect a Git repository</p><p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">Works with GitHub Enterprise, GitLab, or another compatible Git server.</p></div>
										<button type="button" className="shrink-0 text-[11px] font-medium text-primary hover:underline" onClick={() => { setShowConnectRemoteInput(false); setConnectRemoteUrl(''); setConnectPreview(null); setConnectReviewProblem(null) }}>Choose GitHub or GitLab</button>
									</div>
									<label className="mt-3 grid gap-1.5 text-xs font-medium">
										Repository address
										<input
											ref={connectRemoteInputRef}
											value={connectRemoteUrl}
											onChange={(event) => {
												setConnectRemoteUrl(event.target.value)
												setSelectedConnectLibraryLabel(null)
												setConnectPreview(null)
												setConnectReviewProblem(null)
											}}
											placeholder="git@git.example.com:team/agent-library.git"
											spellCheck={false}
											className="h-10 rounded-lg border border-border bg-background px-3 text-xs font-normal text-foreground outline-none focus:ring-2 focus:ring-ring/40"
										/>
									</label>
								</div>}
							</section>
							{connectReviewProblem && (
								<div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-3.5 py-3 text-xs">
									<div className="flex min-w-0 items-start gap-2">
										<AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" />
										<p className="max-w-md leading-relaxed text-amber-950 dark:text-amber-100">{connectReviewProblem}</p>
									</div>
									{connectMinimumReleaseAgeMinutes > 0 && (
										<Button size="xs" className="h-8 shrink-0 px-3" onClick={() => {
											setConnectMinimumReleaseAgeMinutes(0)
											void reviewExistingLibraryConnection(0)
										}}>Review current version</Button>
									)}
								</div>
							)}
							{connectRemoteUrl.trim() && <details open className="mt-5 border-t border-border/60 pt-4">
								<summary className="cursor-pointer text-xs font-semibold text-foreground">
									<span className="mr-2 text-primary">Step 2</span>Make this library available to your agents <span className="font-normal text-muted-foreground">· {plural(connectAgentSlugs.length, 'agent')} selected</span>
								</summary>
								<div className="mt-3">
									<div className="flex items-center justify-between gap-3">
										<p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">Skiller registers this library through <span className="font-mono text-foreground">.agents</span>, then prepares the selected apps to use it. No skill files are copied yet.</p>
										{detectedAgents.length > 0 && (
											<button
												type="button"
												className="text-[11px] font-medium text-primary hover:underline"
												onClick={() => {
													setConnectAgentSlugs(detectedAgents.map((agent) => agent.slug))
													setConnectPreview(null)
												}}
											>
												All detected
											</button>
										)}
            </div>
              <div className="mt-3 flex flex-wrap gap-2">
										{detectedAgents.map((agent) => {
											const checked = connectAgentSlugs.includes(agent.slug)
											return (
												<label key={agent.slug} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors ${checked ? 'border-primary/45 bg-primary/[0.07]' : 'border-border hover:bg-muted/40'}`}>
													<input
														type="checkbox"
														className="cursor-pointer"
														checked={checked}
														onChange={() => {
															setConnectAgentSlugs((current) => (checked ? current.filter((slug) => slug !== agent.slug) : [...current, agent.slug]))
															setConnectPreview(null)
														}}
													/>
													<AgentIcon slug={agent.slug} className="size-4" />
													<span>{agent.name}</span>
												</label>
											)
										})}
                {agents && detectedAgents.length === 0 && <p className="text-xs text-muted-foreground">No agents are detected yet. You can still review the library and connect agents later.</p>}
              </div>
            </div>
							</details>}
							{connectPreview && (
								<div className="mt-4 rounded-xl border border-primary/25 bg-primary/[0.06] px-3.5 py-3 text-xs">
									<div className="flex items-start gap-2">
										<CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
										<div>
											<p className="font-semibold">Library verified and ready</p>
											<p className="mt-1 leading-relaxed text-muted-foreground">A private local workspace will be created. Your current skills stay untouched until the next review.</p>
											<details className="mt-2">
												<summary className="cursor-pointer text-[11px] font-medium text-foreground">Technical details</summary>
												<p className="mt-1 break-all font-mono text-[10px]">
													{connectPreview.remote_identity} · {connectPreview.resolved_commit.slice(0, 12)}
												</p>
											</details>
										</div>
									</div>
								</div>
							)}
							<div className="mt-5 flex items-center justify-between gap-4 border-t border-border/60 pt-4">
								<p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
									{activeLibraryCheck === 'connect'
										? 'Checking the library address and exact version. Nothing is being downloaded into your skills.'
										: activeLibraryCheck === 'connecting'
											? 'Connecting this library on your computer. No skills are restored until the next review.'
										: !connectRemoteUrl.trim()
											? 'Choose where the library lives to continue.'
											: 'Next, Skiller checks this exact library. Nothing is copied into your agents yet.'}
								</p>
								{activeLibraryCheck === 'connect' || activeLibraryCheck === 'connecting' ? (
									<Button size="sm" variant="outline" className="h-9 shrink-0 px-4" onClick={cancelLibraryCheck}>
										{activeLibraryCheck === 'connecting' ? 'Stop connecting' : 'Stop checking'}
									</Button>
								) : (
									<Button size="sm" className="h-9 shrink-0 px-4" onClick={connectPreview ? connectExistingLibrary : () => void reviewExistingLibraryConnection()} disabled={busy !== 'idle' || !connectRemoteUrl.trim() || (detectedAgents.length > 0 && connectAgentSlugs.length === 0)}>
										{busy === 'connecting' ? (
											<>
												<Loader2 className="size-3.5 animate-spin" />
												Connecting…
											</>
										) : connectPreview ? (
											<>
												Connect library <ChevronRight className="size-3.5" />
											</>
										) : (
											<>
												Review this library <ChevronRight className="size-3.5" />
											</>
										)}
									</Button>
								)}
							</div>
						</div>
					)}
        </section>
      )}

			{profile && showLibraryDashboard && (
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
						<h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground">Library sync</h1>
						<p className="mt-1 text-xs text-muted-foreground">
							{profile.mode === 'public' ? 'Public library' : profile.mode === 'team' ? 'Team library' : 'Private library'} · {libraryDisplayName(profile)}
						</p>
					</div>
					<div className="flex flex-wrap items-center justify-end gap-2">
						{(profiles?.length ?? 0) > 1 && (
							<label className="relative">
								<span className="sr-only">Active library</span>
							<select value={profile.profile_id} disabled={libraryInteractionLocked} onChange={(event) => void chooseActiveLibrary(event.target.value)} className="h-8 appearance-none rounded-lg border border-border bg-background pl-3 pr-8 text-xs font-medium text-foreground outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50">
									{profiles!.map((item) => (
										<option key={item.profile_id} value={item.profile_id}>
										{libraryDisplayName(item)}
										</option>
									))}
								</select>
								<ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
							</label>
						)}
						{libraryInteractionLocked ? (
							<Button size="sm" variant="outline" disabled>Back to Agent Library</Button>
						) : (
							<Link to="/library" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
								Back to Agent Library
							</Link>
						)}
						{profile.mode !== 'private' && profile.remote_identity && (
							<Button size="sm" variant="outline" onClick={() => void copyLibraryLink()} disabled={libraryInteractionLocked}>
								<Share2 className="size-3.5" />
								{profile.mode === 'public' ? 'Copy public link' : 'Share with team'}
							</Button>
						)}
						<div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${libraryStatus.tone}`}>
							<LibraryStatusIcon className={`size-3.5 ${activeLibraryCheck === 'changes' ? 'animate-spin' : ''}`} /> {libraryStatus.label}
						</div>
          </div>
        </header>
      )}

			{profile && showLibraryDashboard && recovery?.pending && (
				<section className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
					<div className="flex items-start gap-3">
						<AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
						<div>
							<h2 className="text-sm font-semibold text-amber-950 dark:text-amber-100">An earlier {recoveryOperationLabel} was interrupted</h2>
							<p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">
								Skiller saved a checkpoint{recoveryItemCount > 0 ? ` for ${plural(recoveryItemCount, 'library item')}` : ''} and paused this library before anything else could change.
							</p>
							<details className="mt-2 text-xs text-amber-950 dark:text-amber-100">
								<summary className="cursor-pointer select-none font-medium">What recovery will do</summary>
								<ul className="mt-2 space-y-1 text-amber-900/80 dark:text-amber-200/80">
									<li>Return only the interrupted items to their safe checkpoint.</li>
									<li>Leave the remote repository and every unrelated local file unchanged.</li>
									<li>Resume library actions after the rollback succeeds.</li>
								</ul>
							</details>
						</div>
					</div>
					<Button size="sm" variant="outline" onClick={recoverInterruptedRestore} disabled={busy !== 'idle'}>
						{busy === 'reviewing' ? (
							<>
								<Loader2 className="size-3.5 animate-spin" />
								Recovering…
							</>
						) : (
							'Undo interrupted change'
						)}
					</Button>
				</section>
			)}

			{profile && showLibraryDashboard && !recovery?.pending && activeLibraryCheck === 'changes' && (
				<section className="mt-6 flex min-h-[22rem] items-center justify-center border-y border-border/70 px-6 py-10" role="status" aria-live="polite">
					<div className="w-full max-w-lg text-center">
						<div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
							<Loader2 className="size-5 animate-spin" />
						</div>
						<h2 className="mt-4 text-base font-semibold">Checking your library</h2>
						<p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">
							Comparing the saved library with this computer. Nothing changes until the review is ready.
						</p>
						<Button className="mt-5" size="sm" variant="outline" onClick={cancelLibraryCheck}>
							Stop checking
						</Button>
					</div>
				</section>
			)}

			{profile && showLibraryDashboard && !recovery?.pending && activeLibraryCheck !== 'changes' && !localPublishPreview && (
        <section className="mt-6 border-y border-border/70 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
							<h2 className="text-base font-semibold">{plural(profile.skill_count, 'skill')} in this library</h2>
							<p className="mt-1 text-xs text-muted-foreground">
								{profile.check_error
									? 'This computer could not confirm the saved library’s latest state.'
									: profile.changed
										? 'This computer has library changes ready for review.'
										: profile.behind > 0
											? `${plural(profile.behind, 'library update')} ready to review.`
											: profile.ahead > 0
												? `${plural(profile.ahead, 'change')} waiting to upload.`
												: profile.device_choice_count > 0
													? `Library is up to date. ${plural(profile.device_choice_count, 'reviewed choice')} applies only on this computer.`
													: 'Everything on this computer matches the saved library.'}
							</p>
							{(profile.behind > 0 || profile.ahead > 0) && (
								<div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
									{profile.behind > 0 && <span><strong className="text-foreground">{profile.behind}</strong> <span className="text-muted-foreground">from library</span></span>}
									{profile.ahead > 0 && <span><strong className="text-foreground">{profile.ahead}</strong> <span className="text-muted-foreground">waiting to upload</span></span>}
								</div>
							)}
							{profile.remote_url && (
								<details className="mt-3 max-w-xl text-[11px] text-muted-foreground">
									<summary className="cursor-pointer font-medium text-foreground hover:underline">Storage details</summary>
									<p className="mt-1 break-all">{profile.remote_url}</p>
									<p className="mt-1">Local library ID: <span className="font-mono">{profile.profile_id}</span></p>
									<div className="mt-3 border-t border-border/60 pt-3">
										{!disconnectPreview ? (
											<Button size="xs" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => void reviewDisconnectLibrary()} disabled={busy !== 'idle'}>
												<Trash2 className="size-3" /> Disconnect from this computer
											</Button>
										) : (
											<div className="rounded-lg border border-border/70 bg-background/60 p-3 text-xs">
												<p className="font-semibold text-foreground">Disconnect this library?</p>
												<p className="mt-1 leading-relaxed text-muted-foreground">Skiller will move only its local library connection to Trash. Installed skills and the remote repository stay unchanged. You can reconnect later.</p>
												{disconnectPreview.blockers.length > 0 && (
													<ul className="mt-2 space-y-1 text-amber-700 dark:text-amber-300">
														{disconnectPreview.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
													</ul>
												)}
												<div className="mt-3 flex justify-end gap-2">
													<Button size="xs" variant="outline" className="h-7 min-w-16" onClick={() => setDisconnectPreview(null)} disabled={busy !== 'idle'}>Cancel</Button>
													<Button size="xs" variant="outline" className="h-7 border-destructive/35 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => void disconnectLibraryFromComputer()} disabled={busy !== 'idle' || !disconnectPreview.can_disconnect}>
														{busy === 'disconnecting' ? <><Loader2 className="size-3 animate-spin" />Disconnecting…</> : 'Disconnect library'}
													</Button>
												</div>
											</div>
										)}
									</div>
								</details>
							)}
            </div>
            <div className="flex gap-2">
							{profile.remote_trust_required ? (
								<Button size="sm" onClick={() => void reviewRemoteTrust()} disabled={busy !== 'idle' || recovery?.pending}>
									Review remote access <ChevronRight className="size-3.5" />
								</Button>
							) : profile.changed ? (
								<Button size="sm" onClick={() => void reviewLocalLibraryChanges()} disabled={busy !== 'idle' || recovery?.pending}>
									{busy === 'reviewing' ? (
										<>
											<Loader2 className="size-3.5 animate-spin" />
											Reviewing…
										</>
									) : (
										<>
											Review local changes <ChevronRight className="size-3.5" />
										</>
									)}
								</Button>
							) : profile.ahead > 0 ? (
								<Button size="sm" onClick={() => void finishPendingUpload()} disabled={busy !== 'idle' || recovery?.pending}>
									{busy === 'publishing' ? (
										<>
											<Loader2 className="size-3.5 animate-spin" />
											Uploading…
										</>
									) : (
										<>
											Finish upload <ChevronRight className="size-3.5" />
										</>
									)}
								</Button>
							) : profile.skill_count === 0 && profile.behind === 0 ? (
								<>
									<Button size="sm" variant="outline" onClick={() => void reviewRemoteChanges()} disabled={busy !== 'idle'}>
										{profile.check_error ? 'Try again' : 'Check for updates'}
									</Button>
									<Link to="/library" className={buttonVariants({ size: 'sm' })}>
										Open Agent Library <ChevronRight className="size-3.5" />
									</Link>
								</>
							) : (
								<>
									{profile.device_choice_count > 0 && !profile.check_error && (
										<Button size="sm" variant="outline" onClick={() => void reviewRemoteChanges(true)} disabled={busy !== 'idle' || recovery?.pending}>
											Review device choices
										</Button>
									)}
									<Button size="sm" onClick={() => void reviewRemoteChanges()} disabled={busy !== 'idle' || recovery?.pending}>
										{profile.check_error ? 'Try again' : 'Check for updates'} <ChevronRight className="size-3.5" />
									</Button>
								</>
							)}
						</div>
            </div>
					{profile.skill_count === 0 && profile.behind === 0 && (
						<div className="mt-4 rounded-xl border border-dashed border-border bg-muted/15 px-4 py-3 text-xs">
							<p className="font-semibold text-foreground">This library is connected, but it is still empty.</p>
							<p className="mt-1 text-muted-foreground">Open Agent Library to inspect or add the agent content you want to preserve, then return here only to review and sync it.</p>
          </div>
					)}
		  {profile.remote_trust_required && !remoteTrustPreview && <p className="mt-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">This profile predates device-level source permissions, or its remote changed. Skiller will not contact it until you review the exact address once.</p>}
					{remoteTrustPreview && (
						<div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-4 text-xs">
							<div className="flex items-start gap-3">
								<AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" />
								<div className="min-w-0 flex-1">
									<p className="font-semibold text-foreground">Allow this library to check for updates?</p>
									<p className="mt-1 leading-relaxed text-muted-foreground">Skiller will remember this exact library address on this computer. Confirming does not download, install, or upload anything.</p>
									<details className="mt-3 rounded-lg border border-border/60 bg-background/55 px-3 py-2.5">
										<summary className="cursor-pointer text-[11px] font-medium text-foreground">Advanced safety · {coolingOffLabel(remoteTrustPreview.minimum_release_age_minutes)} update delay</summary>
										<p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">{remoteTrustPreview.remote_identity}</p>
										<div className="mt-3 flex items-center justify-between gap-3">
											<p className="text-[11px] text-muted-foreground">Delay newly published versions before they can be applied.</p>
											<label className="relative min-w-36">
												<span className="sr-only">Update delay</span>
												<select value={remoteTrustPreview.minimum_release_age_minutes} disabled={busy !== 'idle'} onChange={(event) => void changeRemoteTrustMinimumReleaseAge(Number(event.target.value))} className="h-8 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-8 text-xs font-medium text-foreground outline-none focus:ring-2 focus:ring-ring/40">
													<option value={0}>Off</option>
													<option value={1440}>24 hours</option>
													<option value={10080}>7 days · recommended</option>
													<option value={43200}>30 days</option>
												</select>
												<ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
											</label>
										</div>
									</details>
									<div className="mt-3 flex justify-end gap-2">
										<Button size="sm" variant="ghost" onClick={() => setRemoteTrustPreview(null)} disabled={busy !== 'idle'}>
											Cancel
										</Button>
										<Button size="sm" onClick={() => void allowReviewedRemote()} disabled={busy !== 'idle'}>
											{busy === 'publishing' ? (
												<>
													<Loader2 className="size-3.5 animate-spin" />
													Saving…
												</>
											) : (
												'Allow update checks'
											)}
										</Button>
									</div>
								</div>
							</div>
						</div>
					)}
		  {profile.check_error && !profile.remote_trust_required && (
				<div className="mt-3 flex items-start gap-2 text-xs text-destructive" role="alert">
					<AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
					<div>
						<p className="font-medium">Skiller could not check this library. Nothing was changed.</p>
						<p className="mt-0.5 text-muted-foreground">Check your connection or access, then try again.</p>
						<details className="mt-1.5 text-muted-foreground">
							<summary className="cursor-pointer text-[11px] font-medium hover:text-foreground">Technical details</summary>
							<p className="mt-1 break-words font-mono text-[10px] leading-4">{profile.check_error}</p>
						</details>
					</div>
				</div>
			)}
        </section>
	      )}

			{profile && showLibraryDashboard && !recovery?.pending && localPublishPreview && (
				<section className="mx-auto mt-6 w-full max-w-3xl" aria-label="Review local library changes">
					<div className="border-b border-border/70 pb-5">
						<p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Review changes</p>
						<h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Changes to save</h2>
						<p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">These are changes in your Agent Library. Installed agent folders stay untouched until you use the library on a device.</p>
					</div>
					<div className="mt-5 divide-y divide-border/70 border-y border-border/70">
						<div className="flex items-start gap-3 py-4 text-sm"><span className={localPublishPreview.has_blockers ? 'grid size-8 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive' : 'grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600'}>{localPublishPreview.has_blockers ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}</span><div><p className="font-semibold">{localPublishPreview.has_blockers ? 'A few items need your decision' : `${plural(localPublishPreview.files.length, 'change')} ready to save`}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{localPublishPreview.has_blockers ? 'Nothing will be changed or uploaded until these items are resolved.' : 'Skiller will save and upload only the changes listed below.'}</p></div></div>
						{localPublishPreview.has_blockers ? <div className="space-y-2 py-4 text-xs text-destructive">{localPublishPreview.secret_findings.map((finding) => <p key={`${finding.file}:${finding.line}:${finding.rule}`}>{finding.file}:{finding.line} · Possible {finding.rule}</p>)}{localPublishPreview.unsafe_paths.map((path) => <p key={path}>{path} · Not a portable library path</p>)}{localPublishPreview.audit_errors.map((issue) => <p key={`${issue.code}:${issue.field ?? ''}`}>{issue.message} {issue.remediation}</p>)}</div> : <details className="py-4 text-xs"><summary className="cursor-pointer font-medium text-foreground hover:underline">See {plural(localPublishPreview.files.length, 'changed file')}</summary><div className="mt-3 max-h-52 overflow-y-auto rounded-lg bg-muted/35 px-3 py-2 font-mono text-[10px] leading-5 text-muted-foreground">{localPublishPreview.files.map((file) => <p key={file}>{file}</p>)}</div></details>}
					</div>
					<div className="mt-5 flex flex-wrap items-center justify-between gap-3"><Button variant="ghost" onClick={() => setLocalPublishPreview(null)} disabled={busy !== 'idle'}>Back</Button><Button size="lg" onClick={() => void publishReviewedLocalLibrary()} disabled={busy !== 'idle' || localPublishPreview.has_blockers}>{busy === 'publishing' ? <><Loader2 className="size-4 animate-spin" />Saving…</> : <>Save changes <ChevronRight className="size-4" /></>}</Button></div>
				</section>
			)}

			{profile && showLibraryDashboard && !recovery?.pending && !localPublishPreview && history.length > 0 && (
		<section className="mt-4 border-b border-border/70">
					<details>
						<summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-4 hover:text-foreground">
							<div className="flex items-start gap-3">
								<div className="rounded-lg bg-primary/10 p-2 text-primary">
									<History className="size-4" />
								</div>
								<div>
									<h2 className="text-sm font-semibold">Recent library activity</h2>
									<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">Review or undo recent library operations.</p>
		  </div>
							</div>
							<span className="shrink-0 text-[11px] text-muted-foreground">Last {Math.min(history.length, 3)}</span>
						</summary>
						<div>
		  <div className="divide-y divide-border/60 border-t border-border/60">
								{history.slice(0, 3).map((entry) => (
									<div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
										<div className="min-w-0">
											<p className="text-xs font-medium capitalize">{entry.operation.split('-').join(' ')}</p>
											<p className="mt-0.5 text-[11px] text-muted-foreground">
												{new Date(entry.completed_at).toLocaleString()} · {plural(entry.changes.length, 'change')}
											</p>
											{entry.undo_unavailable_reason === 'sensitive-previous-content' && (
												<p className="mt-1 text-[11px] text-muted-foreground">Undo is unavailable because potentially sensitive previous content was not retained.</p>
											)}
											{entry.undo_unavailable_reason === 'unsupported-previous-target' && (
												<p className="mt-1 text-[11px] text-muted-foreground">Undo is unavailable because the previous local item could not be retained safely.</p>
											)}
										  </div>
										{entry.undone_at ? (
											<span className="shrink-0 rounded-md bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">Undone</span>
										) : entry.undo_available ? (
											<Button size="xs" variant="outline" className="h-7 px-2.5" disabled={busy !== 'idle'} onClick={() => void reviewUndo(entry.id)}>
												<RotateCcw className="size-3" />
												Review undo
											</Button>
										) : (
											<span className="shrink-0 rounded-md bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">Undo unavailable</span>
										)}
									</div>
								))}
							</div>
							{undoPreview && (
								<div className={`border-t px-5 py-4 text-xs ${undoPreview.has_conflicts ? 'border-amber-500/30 bg-amber-500/[0.06]' : 'border-primary/20 bg-primary/[0.05]'}`}>
									<div className="flex items-start justify-between gap-4">
            <div>
											<p className="font-semibold">Undo preview</p>
											<p className="mt-1 leading-relaxed text-muted-foreground">{undoPreview.has_conflicts ? 'The library changed after this operation. Undo is blocked so newer work is not overwritten.' : `${plural(undoPreview.changes.length, 'reviewed change')} will be reversed in the local library. Nothing is pushed automatically.`}</p>
										</div>
										<button type="button" className="text-[11px] font-medium text-muted-foreground hover:text-foreground" onClick={() => setUndoPreview(null)}>
											Close
										</button>
									</div>
									<div className="mt-3 max-h-32 divide-y divide-border/50 overflow-y-auto rounded-lg border border-border/60 bg-background/55">
										{undoPreview.changes.map((change) => (
											<div key={change.path} className="flex items-center justify-between gap-3 px-3 py-2">
												<span className="min-w-0 truncate font-mono text-[10px]">{change.path}</span>
												<span className={change.reason ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}>{change.reason ?? (change.action === 'remove-created' ? 'Remove created item' : 'Restore previous item')}</span>
            </div>
										))}
          </div>
									<div className="mt-3 flex justify-end">
										<Button size="sm" disabled={busy !== 'idle' || undoPreview.has_conflicts} onClick={() => void applyReviewedUndo()}>
											{busy === 'undoing' ? (
												<>
													<Loader2 className="size-3.5 animate-spin" />
													Undoing…
												</>
											) : (
												<>
													<RotateCcw className="size-3.5" />
													Undo reviewed operation
												</>
											)}
										</Button>
									</div>
								</div>
							)}
						</div>
					</details>
        </section>
      )}
      {showInventory && (
				<>
					<div className="shrink-0 px-6 pb-1 pt-4 xl:absolute xl:left-2 xl:top-2 xl:z-10 xl:p-0">
						<Button
							variant="ghost"
							size="sm"
							className="h-8 px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
							aria-label={preview
								? publishConfirmationOpen ? 'Back to storage setup' : showDestination ? destinationStage === 'setup' ? 'Back to storage choices' : 'Back to library review' : 'Back to skills'
								: sourceDecisionReview ? 'Back to library review' : showPurposeChoice ? profile ? 'Back to library' : embedded ? 'Back to Agent Library' : 'Back to Sync' : 'Back to library access'}
							onClick={() =>
								preview
									? publishConfirmationOpen
										? setPublishConfirmationOpen(false)
										: showDestination
										? destinationStage === 'setup'
										? (setDestinationStage('provider'), setRemoteUrl(''), setCustomDestinationPreview(null), setDestinationSetupError(null))
											: setShowDestination(false)
									: (() => { setPreview(null); setSetupMode(null); setRemoteUrl('') })()
									: void (sourceDecisionReview ? returnToLibraryReview() : showPurposeChoice ? leaveLibraryFlow() : setShowPurposeChoice(true))
							}
							disabled={busy !== 'idle'}
						>
							<ChevronLeft className="size-3.5" />
							Back
						</Button>
					</div>
				<section className={`sync-library-review mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-visible px-6 pb-3 pt-4 xl:py-8 ${preview || remoteReview ? 'min-h-full xl:h-full xl:flex-none xl:overflow-hidden' : 'xl:h-full xl:flex-none'}`}>
					{!preview && (
						<div className="flex items-start justify-between gap-4">
            <div>
								<p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{remoteReview ? (reviewingDeviceChoices ? 'This computer' : 'Library changes') : busy === 'reviewing' ? 'Preparing' : sourceDecisionReview ? 'Source review' : showPurposeChoice ? 'Step 1 of 5' : 'Step 2 of 5'}</p>
								<h2 className="mt-1 text-lg font-semibold tracking-[-0.02em]">{remoteReview && reviewingDeviceChoices ? 'Review device choices' : remoteReviewMetadataOnly ? 'Review library record update' : remoteReview ? 'Review what changed' : busy === 'reviewing' ? 'Building a safe restore plan' : sourceDecisionReview ? 'Resolve source problems' : showPurposeChoice ? 'Choose library access' : 'Choose your skills'}</h2>
								<p className="mt-1 text-xs leading-relaxed text-muted-foreground">{remoteReview && reviewingDeviceChoices ? 'These choices affect only this computer. The saved library stays unchanged until you choose otherwise.' : remoteReviewMetadataOnly ? 'The saved source moved forward without changing any of your skill files.' : remoteReview ? 'Bring library updates to this computer, save local improvements, and resolve only the versions that truly conflict.' : busy === 'reviewing' ? 'You can cancel at any time. Your current skills remain untouched.' : sourceDecisionReview ? `${plural(sourceDecisionSourceCount, 'source')} affected ${plural(sourceDecisionReview.length, 'skill')}. Related skills are grouped so one decision can cover the whole source.` : showPurposeChoice ? 'Choose who can use this library before Skiller checks the exact plan. This does not publish anything.' : 'Everything is selected by default. Open a skill only if you want to leave it out or change how it is stored.'}</p>
            </div>
						</div>
					)}
					{creatingLibrary && !preview && !sourceDecisionReview && !showPurposeChoice && busy !== 'reviewing' && (
			<div className="order-4 mt-4 flex w-full shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border/60 px-1 pt-3">
							<div className="max-w-xl text-xs">
									<p className="font-semibold">
										{plural(selectedKeys.length, 'skill')} selected <span className="ml-1 font-normal text-muted-foreground">{librarySkillCount > selectedKeys.length ? `${librarySkillCount - selectedKeys.length} stay only on this computer.` : 'Review the plan before anything is saved.'}</span>
								</p>
								{reviewedExternalSkillCount > 0 && (
									<p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{plural(reviewedExternalSkillCount, 'skill')} will stay linked to {reviewedExternalSkillCount === 1 ? 'its original source' : 'their original sources'}. Skiller checks those links before showing your plan. If one is unavailable, you can save a copy or leave it on this computer.</p>
								)}
								{missingVendoredLicenses.length > 0 && <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">Add an upstream license for {plural(missingVendoredLicenses.length, 'vendored skill')} in Skill details before continuing.</p>}
								{unresolvedCollisionCount > 0 && <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">Confirm how to handle {plural(unresolvedCollisionCount, 'duplicate name')} before continuing.</p>}
							</div>
							<div className="flex items-center gap-3">
								<Button size="lg" onClick={() => void buildLibraryPlan()} disabled={busy !== 'idle' || selectedKeys.length === 0 || missingVendoredLicenses.length > 0 || unresolvedCollisionCount > 0}>
								Review plan <ChevronRight className="size-3.5" />
								</Button>
			</div>
			</div>
					  )}
					{sourceDecisionReview && !preview && busy !== 'reviewing' && (
						<div className="order-1 mt-4 flex shrink-0 flex-wrap items-center justify-between gap-3 border-y border-amber-400/35 bg-amber-500/[0.05] px-3 py-3 text-xs">
							<div>
								<p className="font-semibold text-foreground">Decide what to do with {plural(sourceDecisionSourceCount, 'unavailable source')}</p>
								<p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
									{unresolvedDecisionCount
										? `${plural(unresolvedDecisionSourceCount, 'source')} still need a choice · ${plural(unresolvedDecisionCount, 'affected skill')}`
										: 'Every affected skill has a safe outcome. Review the updated plan when you are ready.'}
								</p>
							</div>
							<Button size="sm" variant="outline" className="h-8" onClick={() => void keepRemainingSourceDecisionsLocal()} disabled={busy !== 'idle' || unresolvedDecisionCount === 0}>
								Keep remaining only here
							</Button>
						</div>
					)}

					{!preview && !remoteReview && busy === 'reviewing' && (
						<div className="order-2 mt-4 flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-border/70 bg-muted/10 px-6 py-10" role="status" aria-live="polite">
							<div className="w-full max-w-lg text-center">
								<div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
									<Loader2 className="size-5 animate-spin" />
								</div>
								<h3 className="mt-4 text-base font-semibold">Preparing your library</h3>
								<p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">{reviewedExternalSkillCount > 0 ? 'Verifying the original sources needed to restore your selected skills.' : 'Checking the selected files before saving complete copies.'} Nothing is being uploaded or changed.</p>
								<div className="mx-auto mt-5 max-w-sm">
									<div className="h-1.5 overflow-hidden rounded-full bg-muted">
										<div
											className={`h-full rounded-full bg-primary ${sourceReviewProgress?.total ? 'transition-[width] duration-300' : 'w-1/3 animate-pulse'}`}
											style={
												sourceReviewProgress?.total
													? {
															width: `${Math.max(4, Math.round((sourceReviewProgress.completed / sourceReviewProgress.total) * 100))}%`,
														}
													: undefined
											}
										/>
									</div>
									<p className="mt-2 text-[11px] text-muted-foreground">{sourceReviewProgress?.total ? `${sourceReviewProgress.completed} of ${sourceReviewProgress.total} sources checked` : reviewedExternalSkillCount > 0 ? 'Finding the sources to check…' : 'Reviewing selected files…'}</p>
								</div>
								<Button className="mt-5" size="sm" variant="outline" onClick={() => void cancelSourceReview()}>
									Cancel and return to skills
								</Button>
							</div>
						</div>
					)}

					{showPurposeChoice && !preview && !remoteReview && busy !== 'reviewing' && (
						<div className="order-2 mt-6 flex min-h-0 flex-1">
							<section className="flex h-full min-h-0 w-full flex-col">
								<div className="flex min-h-0 flex-1 items-center justify-center">
									<div className="grid w-full max-w-2xl gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Library access">
									{([
										['personal', 'Just me', 'Keep it private. External skills are saved as complete copies when possible.', UserRound],
										['public', 'Public sharing', 'Make a library others can discover. External sources stay linked when possible.', Globe2],
										['team', 'My team', 'Keep access with your Git organization or private server.', UsersRound],
									] as const).map(([purpose, label, detail, Icon]) => (
										<button
											key={purpose}
											type="button"
											role="radio"
											aria-checked={libraryPurpose === purpose}
											onClick={() => chooseLibraryPurpose(purpose)}
											className={`flex min-h-32 flex-col rounded-xl border p-4 text-left transition-colors ${libraryPurpose === purpose ? 'border-primary bg-primary/[0.06] ring-1 ring-primary/25' : 'border-border/70 hover:border-primary/45 hover:bg-muted/20'}`}
										>
											<Icon className={`size-5 ${libraryPurpose === purpose ? 'text-primary' : 'text-muted-foreground'}`} aria-hidden="true" />
											<p className="mt-4 text-sm font-semibold text-foreground">{label}</p>
											<p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
										</button>
									))}
									</div>
								</div>
								<div className="flex shrink-0 justify-end border-t border-border/60 pt-4">
									<Button size="lg" onClick={continueToSkills} disabled={busy !== 'idle'}>
										Choose skills <ChevronRight className="size-3.5" />
									</Button>
								</div>
							</section>
						</div>
					)}
					{!showPurposeChoice && !preview && !remoteReview && busy !== 'reviewing' && (
						<div className="sync-library-review-body order-2 mt-4 flex min-h-0 flex-1 overflow-hidden">
							<div className="relative min-w-0 flex-1">
								<div ref={inventoryScrollRef} className="sync-library-review-list h-full min-w-0 overflow-y-auto pr-1">
								<div className="relative w-full" style={{ height: inventoryVirtualizer.getTotalSize() }}>
			{inventoryVirtualizer.getVirtualItems().map((virtualItem) => {
										  const item = reviewInventoryItems[virtualItem.index]
			  if (!item) return null
										return (
											<div
												key={virtualItem.key}
												className="absolute left-0 top-0 w-full border-b border-border/60"
												style={{
													transform: `translateY(${virtualItem.start}px)`,
												}}
											>
								<InventorySkillRow
									item={item}
									selected={selectedKeySet.has(item.candidate_key)}
									inspected={item.candidate_key === inspectedSkillKey}
									reviewReason={sourceDecisionByKey.get(item.candidate_key)?.reason}
									agentNames={agentNames}
									onToggle={toggleSelectedKey}
									onInspect={setInspectedSkillKey}
								/>
			  </div>
										)
			})}
			{!inventoryLoading && librarySkillCount === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">No valid skills were found yet.</p>}
								</div>
							</div>
								<ScrollFade viewportRef={inventoryScrollRef} />
							</div>
							{inspectedSkill && (() => {
								const sourceIssue = sourceDecisionByKey.get(inspectedSkill.candidate_key)
								const sourceGroupItems = sourceIssue
									? sourceDecisionReview?.filter((source) => source.source === sourceIssue.source && source.requested_ref === sourceIssue.requested_ref) ?? []
									: []
								return (
									<ReviewSkillDetail
										item={inspectedSkill}
										decision={libraryDecisions[inspectedSkill.candidate_key] ?? defaultLibraryDecision(inspectedSkill, libraryPurpose)}
										purpose={libraryPurpose}
										sourceIssue={sourceIssue}
										reviewPosition={sourceDecisionReview && inspectedSourceReviewIndex >= 0 ? { current: inspectedSourceReviewIndex + 1, total: sourceDecisionReview.length } : undefined}
										sourceGroup={sourceIssue ? { label: sourceDisplayName(sourceIssue.source), count: sourceGroupItems.length, onApply: (disposition) => applyDecisionToSource(sourceIssue, disposition) } : undefined}
										onDecision={chooseLibraryOutcome}
										onClose={() => setInspectedSkillKey(null)}
										onPrevious={sourceDecisionReview && inspectedSourceReviewIndex > 0 ? () => setInspectedSkillKey(sourceDecisionReview[inspectedSourceReviewIndex - 1]!.id) : undefined}
										onNext={sourceDecisionReview && inspectedSourceReviewIndex >= 0 && inspectedSourceReviewIndex < sourceDecisionReview.length - 1 ? () => setInspectedSkillKey(sourceDecisionReview[inspectedSourceReviewIndex + 1]!.id) : undefined}
									/>
								)
							})()}
						</div>
					)}
					{creatingLibrary && !preview && !sourceDecisionReview && !showPurposeChoice && busy !== 'reviewing' && (inventory?.invalid_paths || inventory?.collisions.length || inventory?.linked_aliases) ? (
						<div className="order-3 mt-3 shrink-0 space-y-2 border-t border-border/60 px-1 pt-3 text-xs">
							{inventory?.invalid_paths ? (
								<div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.045] px-3 py-2.5 text-amber-800 dark:text-amber-200">
									<AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
									<div>
										<p>
											<span className="font-semibold">{plural(inventory.invalid_paths, 'item')} {inventory.invalid_paths === 1 ? 'stays' : 'stay'} on this computer.</span> Nothing is deleted or changed.
										</p>
										<details className="mt-1.5">
											<summary className="cursor-pointer font-medium text-amber-900 underline-offset-2 hover:underline dark:text-amber-100">Why this item was left out</summary>
											<ul className="mt-1.5 space-y-1 border-l border-amber-500/30 pl-2.5">
												{(inventory.invalid_entries ?? []).map((entry) => (
											<li key={entry.invalid_id} className="flex items-start justify-between gap-3">
												<span className="min-w-0"><span className="font-medium">{entry.display_name}</span><span className="text-amber-800/80 dark:text-amber-200/80"> · It links to a file outside this skill. Skiller leaves it here so your library stays portable.</span></span>
												<Button size="xs" variant="ghost" className="h-6 shrink-0 px-2 text-[10px] text-amber-950 dark:text-amber-100" onClick={() => void revealInvalidEntry(entry.invalid_id)}>
													<FolderOpen className="size-3" /> Open folder
												</Button>
											</li>
												))}
											</ul>
											<p className="mt-2 leading-relaxed text-amber-800/80 dark:text-amber-200/80">No action is needed to continue. Open the folder only if you want to make this skill portable later.</p>
										</details>
									</div>
								</div>
							) : null}
							{(inventory?.collisions.length ?? 0) > 0 && (
								<div className={`flex items-start gap-2 ${unresolvedCollisionCount > 0 ? 'text-amber-800 dark:text-amber-200' : 'text-muted-foreground'}`}>
									{unresolvedCollisionCount > 0 ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />}
									<div className="min-w-0 flex-1">
										<p><span className="font-semibold">{plural(inventory?.collisions.length ?? 0, 'name')} belong to skills with different contents.</span> Keep every version as a separate skill, or deselect the versions you do not want.</p>
										{unresolvedCollisionCount > 0 ? (
											<Button size="xs" variant="outline" className="mt-2 h-7 border-amber-500/35 bg-background/50 px-2.5 text-amber-950 hover:bg-background dark:text-amber-100" onClick={() => setAcknowledgedCollisions(new Set((inventory?.collisions ?? []).map((collision) => collision.display_name)))}>
												Keep all versions separately
											</Button>
										) : (
											<p className="mt-1 text-[11px]">Every selected version will be saved under its own stable library key.</p>
										)}
									</div>
								</div>
							)}
						</div>
					) : null}
					{sourceDecisionReview && !preview && busy !== 'reviewing' && (
						<div className="order-4 mt-3 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border/60 px-1 pt-3 text-xs">
							<p className={unresolvedDecisionCount ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}>{unresolvedDecisionCount ? `Choose an outcome for ${plural(unresolvedDecisionSourceCount, 'remaining source')}.` : 'Ready to rebuild the library plan with these decisions.'}</p>
							<Button size="lg" onClick={() => void finishSourceDecisionReview()} disabled={busy !== 'idle' || unresolvedDecisionCount > 0}>
								Review updated plan <ChevronRight className="size-3.5" />
							</Button>
						</div>
					)}
          {remoteReview && (
						<div className="order-2 mt-5 min-h-0 flex-1 overflow-y-auto pb-2 text-xs">
							{reviewingDeviceChoices ? (
								<div className="flex items-start gap-3 border-y border-border/70 py-4">
									<MonitorCog className="mt-0.5 size-4 shrink-0 text-primary" />
									<div>
										<p className="font-semibold text-foreground">{plural(remoteReview.skills.filter((skill) => skill.action === 'kept-local').length, 'choice')} saved for this computer</p>
										<p className="mt-1 max-w-2xl leading-relaxed text-muted-foreground">Your library still keeps its saved versions. Restore one below whenever you want this computer to use it again.</p>
									</div>
								</div>
							) : remoteReviewMetadataOnly ? (
								<div className="flex items-start gap-3 border-y border-border/70 py-4">
									<CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
									<div>
										<p className="font-semibold text-foreground">Only the library record changed</p>
										<p className="mt-1 max-w-2xl leading-relaxed text-muted-foreground">The pinned Git source moved to a new commit, but the skill files you use are identical. Updating this record will not change anything in your agent folders.</p>
									</div>
								</div>
							) : (
							<div className="grid border-y border-border/70 sm:grid-cols-3 sm:divide-x sm:divide-border/70">
								<div className="py-3 sm:pr-4">
									<p className="text-lg font-semibold tracking-[-0.03em] text-foreground">{remoteReview.skills.filter((skill) => skill.action === 'take-remote').length}</p>
									<p className="font-medium text-foreground">Ready from library</p>
									<p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">Updates available for this computer.</p>
								</div>
								<div className="border-t border-border/70 py-3 sm:border-t-0 sm:px-4">
									<p className="text-lg font-semibold tracking-[-0.03em] text-foreground">{remoteReview.skills.filter((skill) => skill.action === 'publish-local').length}</p>
									<p className="font-medium text-foreground">Changed here</p>
									<p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">Local improvements ready to save.</p>
								</div>
								<div className="border-t border-border/70 py-3 sm:border-t-0 sm:pl-4">
									<p className={`text-lg font-semibold tracking-[-0.03em] ${remoteReview.skills.some((skill) => skill.action === 'conflict' || skill.action === 'unmanaged') ? 'text-amber-700 dark:text-amber-300' : 'text-foreground'}`}>{remoteReview.skills.filter((skill) => skill.action === 'conflict' || skill.action === 'unmanaged').length}</p>
									<p className="font-medium text-foreground">Need a decision</p>
									<p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">Different versions are never overwritten silently.</p>
								</div>
							</div>
							)}

							{remoteReview.skills.some((skill) => skill.action === 'kept-local') && reviewingDeviceChoices && (
								<section className="mt-4 overflow-hidden rounded-xl border border-border/70">
									<div className="border-b border-border/60 bg-muted/15 px-4 py-3">
										<p className="font-semibold text-foreground">Different only on this computer</p>
										<p className="mt-0.5 text-[11px] text-muted-foreground">No files change until you choose a library version.</p>
									</div>
									<div className="divide-y divide-border/60">
										{remoteReview.skills
											.filter((skill) => skill.action === 'kept-local')
											.map((skill) => {
												const localState = skill.comparison?.local_state
												const description = localState === 'absent'
													? 'Removed on this computer'
													: localState && localState !== 'directory'
														? `Local ${localState} left untouched`
														: 'This computer keeps a different local version'
												return (
													<div key={skill.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
														<div className="min-w-0 flex-1">
															<p className="font-medium text-foreground">{skill.id}</p>
															<p className="mt-0.5 text-[11px] text-muted-foreground">{description} · saved library version is unchanged</p>
														</div>
														<Button size="xs" variant="outline" className="h-8 shrink-0 px-3" onClick={() => void useRemoteForConflict(skill.id)} disabled={busy !== 'idle'}>
															{localState === 'absent' ? 'Restore from library' : 'Use library version'}
														</Button>
													</div>
												)
											})}
									</div>
								</section>
							)}

							{remoteReview.skills.some((skill) => skill.action === 'take-remote') && (
								<section className="mt-4 overflow-hidden rounded-xl border border-border/70">
									<div className="border-b border-border/60 bg-muted/15 px-4 py-3">
										<p className="font-semibold text-foreground">Bring updates to this computer</p>
										<p className="mt-0.5 text-[11px] text-muted-foreground">Selected by default. Nothing changes until you confirm below.</p>
									</div>
									<div className="divide-y divide-border/60">
										{remoteReview.skills
											.filter((skill) => skill.action === 'take-remote')
											.map((skill) => (
												<label key={skill.id} className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/15">
													<input type="checkbox" className="cursor-pointer" checked={remoteSelections.includes(skill.id)} onChange={() => setRemoteSelections((current) => (current.includes(skill.id) ? current.filter((id) => id !== skill.id) : [...current, skill.id]))} />
											<span className="min-w-0 flex-1">
														<span className="block font-medium text-foreground">{skill.id}</span>
											{skill.source && (
															<span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
																Pinned {skill.kind === 'skills_sh' ? 'skills.sh' : 'Git'} version · {skill.source.ref.slice(0, 8)}
															</span>
														)}
											</span>
											{skill.target_agents.length > 0 && (
												<span className="flex shrink-0 items-center gap-1" aria-label={`Available to ${skill.target_agents.join(', ')}`}>
													{skill.target_agents.slice(0, 5).map((slug) => <Tooltip key={slug} content={agentNames.get(slug) ?? slug}><span><AgentIcon slug={slug} className="size-3.5" /></span></Tooltip>)}
													{skill.target_agents.length > 5 && <Tooltip content={skill.target_agents.slice(5).map((slug) => agentNames.get(slug) ?? slug).join(', ')}><span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border bg-secondary px-1 text-[9px] font-medium tabular-nums text-secondary-foreground">+{skill.target_agents.length - 5}</span></Tooltip>}
												</span>
											)}
											<span className="text-[11px] font-medium text-primary">Use library version</span>
				  </label>
											))}
									</div>
								</section>
							)}

							{remoteReview.skills.some((skill) => skill.action === 'publish-local') && (
								<section className="mt-4 overflow-hidden rounded-xl border border-border/70">
									<div className="border-b border-border/60 bg-muted/15 px-4 py-3">
										<p className="font-semibold text-foreground">Save local improvements</p>
										<p className="mt-0.5 text-[11px] text-muted-foreground">These skills changed only on this computer.</p>
									</div>
									<div className="divide-y divide-border/60">
										{remoteReview.skills
											.filter((skill) => skill.action === 'publish-local')
											.map((skill) => (
												<label key={skill.id} className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/15">
													<input type="checkbox" className="cursor-pointer" checked={localSelections.includes(skill.id)} onChange={() => setLocalSelections((current) => (current.includes(skill.id) ? current.filter((id) => id !== skill.id) : [...current, skill.id]))} />
													<span className="min-w-0 flex-1 font-medium text-foreground">{skill.id}</span>
													<span className="text-[11px] font-medium text-primary">Save to library</span>
												</label>
											))}
									</div>
								</section>
							)}

							{remoteReview.skills
								.filter((skill) => skill.action === 'conflict' || skill.action === 'unmanaged')
								.map((skill) => {
									const external = skill.kind !== 'bundled'
									const localState = skill.comparison?.local_state
									const localMissing = localState === 'absent'
									const localBlocked = localState === 'file' || localState === 'symlink' || localState === 'unsupported'
									return (
										<section key={skill.id} className="mt-4 rounded-xl border border-amber-500/35 bg-amber-500/[0.07] p-4">
											<div className="flex items-start gap-3">
												<AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" />
												<div className="min-w-0 flex-1">
															<p className="font-semibold text-foreground">
															{localMissing
																? `${skill.id} was removed from this computer`
																: localBlocked
																	? `Decide how to handle the local ${skill.id}`
																	: `Choose which ${skill.id} to keep`}
															</p>
											<p className="mt-1 leading-relaxed text-muted-foreground">
												{localMissing
																? 'The saved library copy is still available. Restore it here, or keep it removed only on this computer.'
																: localBlocked
																	? 'A local item with this name is not a normal skill folder, so Skiller will leave it alone. Keep it here, or deliberately replace it with the library version.'
																	: 'The library and this computer contain different versions. Keeping both is safest; replacing either version is always a deliberate choice.'}
															</p>
															{localBlocked && <p className="mt-1 text-[10px] text-muted-foreground">Technical detail: the local item is a {localState}, not a regular skill folder.</p>}
													{skill.source && (
														<p className="mt-1 truncate text-[10px] text-muted-foreground">
															Library source: {skill.kind === 'skills_sh' ? 'skills.sh' : 'Git'} · {skill.source.ref.slice(0, 8)}
												</p>
											)}
											{external && !skill.comparison && (
												<div className="mt-3 flex items-center justify-between gap-3 border-y border-amber-500/20 py-3">
													<p className="text-[11px] leading-relaxed text-muted-foreground">Load the exact pinned source temporarily to compare file names and SKILL.md. Nothing is installed.</p>
													{activeConflictComparisonId === skill.id ? (
														<Button size="xs" variant="outline" className="h-8 shrink-0 px-3" onClick={() => void cancelConflictComparison()}>
															<Loader2 className="size-3 animate-spin" /> Stop comparison
														</Button>
													) : (
														<Button size="xs" variant="outline" className="h-8 shrink-0 bg-background/60 px-3" onClick={() => void compareExternalConflict(skill.id)} disabled={busy !== 'idle'}>
															Compare versions
														</Button>
													)}
												</div>
											)}
											{skill.comparison && (
												<details className="mt-3 border-y border-amber-500/20 py-3">
													<summary className="cursor-pointer font-medium text-foreground">Compare before choosing</summary>
													<div className="mt-3 grid gap-3 sm:grid-cols-2">
														<div>
															<p className="font-semibold text-foreground">This computer</p>
															<p className="mt-0.5 text-[11px] text-muted-foreground">
																{skill.comparison.local_file_count === null
																	? skill.comparison.local_state === 'absent'
																		? 'Not installed'
																		: `Cannot compare safely · ${skill.comparison.local_state}`
																	: plural(skill.comparison.local_file_count, 'file')}
															</p>
														</div>
														<div>
															<p className="font-semibold text-foreground">Library</p>
															<p className="mt-0.5 text-[11px] text-muted-foreground">{plural(skill.comparison.library_file_count, 'file')}</p>
														</div>
													</div>
													{(skill.comparison.changed_files.length > 0 || skill.comparison.only_on_computer.length > 0 || skill.comparison.only_in_library.length > 0) && (
														<div className="mt-3 grid gap-3 text-[11px] sm:grid-cols-3">
															{[
																['Changed in both', skill.comparison.changed_files],
																['Only on this computer', skill.comparison.only_on_computer],
																['Only in library', skill.comparison.only_in_library],
															].map(([label, files]) => (files as string[]).length > 0 && (
																<div key={label as string} className="min-w-0">
																	<p className="font-medium text-foreground">{label as string} · {(files as string[]).length}</p>
																	<ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto font-mono text-[10px] text-muted-foreground">
																		{(files as string[]).map((file) => <li key={file} className="break-all">{file}</li>)}
																	</ul>
																</div>
															))}
														</div>
													)}
													{skill.comparison.unchanged_file_count > 0 && (
														<p className="mt-3 text-[11px] text-muted-foreground">{plural(skill.comparison.unchanged_file_count, 'unchanged file')} hidden to keep this comparison focused.</p>
													)}
													{(skill.comparison.local_skill_md || skill.comparison.library_skill_md) && (
														<details className="mt-3">
															<summary className="cursor-pointer text-[11px] font-medium text-foreground">Compare SKILL.md text</summary>
															<div className="mt-2 grid gap-3 sm:grid-cols-2">
																{[
																	['This computer', skill.comparison.local_skill_md, skill.comparison.local_skill_md_truncated],
																	['Library', skill.comparison.library_skill_md, skill.comparison.library_skill_md_truncated],
																].map(([label, content, truncated]) => (
																	<div key={label as string} className="min-w-0">
																		<p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label as string}</p>
																		<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/70 p-2 font-mono text-[10px] leading-relaxed text-foreground">{(content as string | undefined) ?? 'No readable SKILL.md'}</pre>
																		{Boolean(truncated) && <p className="mt-1 text-[10px] text-muted-foreground">Preview shortened.</p>}
																	</div>
																))}
															</div>
														</details>
													)}
												</details>
											)}
											<div className="mt-3 flex flex-wrap gap-2">
												{localMissing ? (
													<>
														<Button size="xs" className="h-8 px-3" onClick={() => void useRemoteForConflict(skill.id)} disabled={busy !== 'idle'}>
															Restore from library
														</Button>
														<Button size="xs" variant="outline" className="h-8 bg-background/60 px-3" onClick={() => void keepConflictLocal(skill.id, external, localState)} disabled={busy !== 'idle'}>
															Keep removed on this computer
														</Button>
													</>
												) : localBlocked ? (
													<>
														<Button size="xs" className="h-8 px-3" onClick={() => void useRemoteForConflict(skill.id)} disabled={busy !== 'idle'}>
															Replace with library skill
														</Button>
														<Button size="xs" variant="outline" className="h-8 bg-background/60 px-3" onClick={() => void keepConflictLocal(skill.id, external, localState)} disabled={busy !== 'idle'}>
															Leave local item untouched
														</Button>
													</>
												) : (
													<>
														<Button size="xs" className="h-8 px-3" onClick={() => void keepConflictLocal(skill.id, external, localState)} disabled={busy !== 'idle'}>
															Keep both versions
														</Button>
														<Button size="xs" variant="outline" className="h-8 bg-background/60 px-3" onClick={() => void useRemoteForConflict(skill.id)} disabled={busy !== 'idle'}>
															Replace this computer
														</Button>
														<Button size="xs" variant="ghost" className="h-8 px-3" onClick={() => void adoptLocalVersion(skill.id)} disabled={busy !== 'idle'}>
															{external ? 'Save my copy as library version' : 'Replace library version'}
														</Button>
													</>
												)}
											</div>
												</div>
											</div>
										</section>
									)
				})}

							{!reviewingDeviceChoices && remoteReview.dependency_changes.length > 0 && (
								<details className="mt-4 rounded-xl border border-border/60 bg-muted/10 px-4 py-3 text-muted-foreground">
									<summary className="cursor-pointer font-medium text-foreground">
										Technical source changes <span className="font-normal text-muted-foreground">· {plural(remoteReview.dependency_changes.length, 'pinned source')}</span>
									</summary>
									<p className="mt-1.5 text-[11px] leading-relaxed">Exact commits, licenses, and exported paths recorded by the library. Most people do not need to review these details.</p>
									<div className="mt-3 divide-y divide-border/50 border-t border-border/50">
										{remoteReview.dependency_changes.map((change) => (
											<div key={change.dependency} className="py-2.5">
												<div className="flex items-center justify-between gap-3">
													<span className="font-medium text-foreground">{change.dependency}</span>
													<span>{change.action}</span>
												</div>
												<p className="mt-0.5 font-mono text-[10px]">
													{change.from_commit?.slice(0, 8) ?? 'new'} → {change.to_commit?.slice(0, 8) ?? 'removed'}
												</p>
											</div>
										))}
									</div>
								</details>
							)}

							<div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border py-3">
								<p className="text-[11px] leading-relaxed text-muted-foreground">
									{reviewingDeviceChoices
										? 'Your saved library will not change. Restore only the choices you want to use on this computer.'
										: remoteReviewMetadataOnly
										? 'No skill files will change.'
										: remoteSelections.length > 0
											? remoteTargetAgentSlugs.length > 0
												? `${plural(remoteSelections.length, 'selected update')} will be made available to ${plural(remoteTargetAgentSlugs.length, 'detected agent')}. Anything unresolved stays untouched.`
												: `${plural(remoteSelections.length, 'selected update')} will be saved in .agents. Connect an agent later to make them available there.`
											: remoteReviewDecisionCount > 0
												? `Choose an outcome for ${plural(remoteReviewDecisionCount, 'skill')}. Nothing is overwritten automatically.`
												: 'Nothing needs to change on this computer.'}
								</p>
								<div className="flex flex-wrap gap-2">
									{remoteReviewMetadataOnly && (
										<Button size="sm" onClick={() => void acceptRemoteLibraryUpdate()} disabled={busy !== 'idle'}>
											{activeSyncAction === 'metadata' ? (
												<>
													<Loader2 className="size-3.5 animate-spin" />
													Updating…
												</>
											) : (
												'Update library record'
											)}
										</Button>
									)}
									{localSelections.length > 0 && (
										<Button size="sm" variant="outline" onClick={publishSelectedLocalChanges} disabled={busy !== 'idle'}>
											{activeSyncAction === 'local' ? (
												<>
													<Loader2 className="size-3.5 animate-spin" />
													Saving…
												</>
											) : (
												<>Save {plural(localSelections.length, 'local change')}</>
											)}
										</Button>
									)}
									{remoteSelections.length > 0 && (
										<Button size="sm" onClick={applySelectedRemoteChanges} disabled={busy !== 'idle'}>
											{activeSyncAction === 'remote' ? (
												<>
													<Loader2 className="size-3.5 animate-spin" />
													Applying…
												</>
											) : (
												<>Bring {plural(remoteSelections.length, 'update')} to this computer</>
											)}
										</Button>
									)}
								</div>
			  </div>
            </div>
          )}
          {preview && (
							<div className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden text-xs">
							<div className="shrink-0">
								<p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{publishConfirmationOpen ? 'Step 5 of 5' : showDestination ? 'Step 4 of 5' : 'Step 3 of 5'}</p>
								<h2 className="mt-1 text-lg font-semibold tracking-[-0.02em]">{publishConfirmationOpen ? finalLibraryHeading : showDestination ? (destinationStage === 'setup' ? `Set up ${setupMode === 'github' ? 'GitHub' : setupMode === 'gitlab' ? 'GitLab' : 'your Git server'}` : 'Choose where to keep it') : 'Review your plan'}</h2>
								<p className="mt-1 leading-relaxed text-muted-foreground">{publishConfirmationOpen ? `This is the only step that ${setupMode === 'github' || setupMode === 'gitlab' ? 'creates the destination and ' : ''}uploads your reviewed library. Your local agent folders stay unchanged.` : showDestination ? (destinationStage === 'setup' ? (setupMode === 'custom' ? 'Use an empty Git repository. Nothing is uploaded until the final confirmation.' : `Choose the new ${setupMode === 'github' ? 'repository' : 'project'} now. It is created only after the final confirmation.`) : libraryPurpose === 'public' ? 'Publish a library anyone can discover and reuse.' : libraryPurpose === 'team' ? 'Keep access with your Git organization or private server.' : 'Keep it private unless you decide to invite someone.') : 'Nothing is saved yet. Resolve the few items that need a decision, then choose where to store the library.'}</p>
							</div>
							{!showDestination && (
								<>
									<div className="min-h-0 flex-1 overflow-y-auto pr-1">
										<section className="mt-5">
											<p className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ready for storage</p>
											<div className="mt-2 rounded-xl border border-border/70 bg-muted/[0.035] px-4 py-3.5">
												<div className="flex items-start gap-3">
													<CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
													<div className="min-w-0 flex-1">
														<p className="text-sm font-semibold text-foreground">{previewIncludedCount === selectedKeys.length ? `${previewIncludedCount} selected ${previewIncludedCount === 1 ? 'skill is' : 'skills are'} ready` : `${previewIncludedCount} of ${plural(selectedKeys.length, 'selected skill')} are ready`}</p>
														<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{previewOwnedCount === previewIncludedCount ? `${plural(previewFileCount, 'file')} will be saved as complete copies.` : `${plural(previewOwnedCount, 'skill')} copied · ${plural(preview.skills_sh.length + preview.references.length, 'skill')} kept linked to their original source.`}{preview.secret_findings.length === 0 && previewFileCount > 0 ? ' All selected files were checked for possible secrets.' : ''}</p>
													</div>
												</div>
											</div>
										</section>
										{previewExcludedItems.length > 0 && (
											<section className="mt-4 border-y border-border/70 py-4">
												<div className="flex items-start gap-3">
													<Info className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
													<div className="min-w-0 flex-1">
														<p className="text-sm font-semibold text-foreground">{plural(previewExcludedItems.length, 'skill')} will stay on this computer</p>
														<p className="mt-1 text-xs leading-relaxed text-muted-foreground">They are safe where they are. They will not be added to this library or appear on another computer unless you go back and include them.</p>
														<details className="mt-2 text-[11px] text-muted-foreground">
															<summary className="cursor-pointer font-medium text-foreground hover:underline">See skills kept here</summary>
															<div className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-border/60 bg-muted/10 px-3 py-2">
																{previewExcludedItems.map((item) => <p key={item.candidate_key} className="py-0.5">{item.display_name}</p>)}
															</div>
														</details>
													</div>
											</div>
										</section>
										)}
										{preview.skills.length > 0 && (
											<details open={libraryPurpose === 'public'} className="mt-5">
												<summary className="cursor-pointer rounded-md px-1 py-1 font-semibold text-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
													{libraryPurpose === 'public' ? `${plural(previewFileCount, 'public file')}` : `See ${plural(previewFileCount, 'file')} to be copied`}
												</summary>
												<p className="mt-1 px-1 text-[11px] leading-relaxed text-muted-foreground">
													These are the exact bundled files that will be {libraryPurpose === 'public' ? 'public' : 'copied'}. If anything looks unexpected,{' '}
													<button type="button" className="font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-primary" onClick={() => { setPreview(null); setSetupMode(null); setRemoteUrl('') }}>go back to skills</button>{' '}
													and leave that skill out. Skills kept linked to an original source are not copied.
												</p>
												<div className="mt-3 max-h-52 overflow-y-auto rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5">
													{preview.skills.map((skill) => (
														<div key={skill.id} className="border-b border-border/50 py-2 last:border-b-0">
															<p className="font-semibold text-foreground">{skill.id} <span className="font-normal text-muted-foreground">· {plural(skill.file_count, 'file')}</span></p>
															<ul className="mt-1 space-y-0.5 font-mono text-[10px] text-muted-foreground">
																{skill.files.map((file) => <li key={file} className="break-all">{file}</li>)}
															</ul>
														</div>
													))}
												</div>
											</details>
										)}
										{preview.source_trust.length > 0 && (
											<details className="mt-4 text-xs text-muted-foreground">
												<summary className="inline-flex cursor-pointer items-center gap-1.5 font-medium hover:text-foreground">
													<Info className="size-3.5" />
													Source settings
												</summary>
												<div className="mt-2 rounded-lg border border-border/60 bg-muted/10 px-3 py-3">
													<div className="flex flex-wrap items-start justify-between gap-3">
														<div>
															<p className="font-medium text-foreground">{plural(preview.source_trust.length, 'source')} verified</p>
																						<p className="mt-0.5 max-w-xl leading-relaxed">Only these exact sources were contacted. Their addresses and update rules stay on this computer.</p>
														</div>
														<label className="grid min-w-40 gap-1 text-[10px] font-semibold uppercase tracking-[0.1em]">
																							Wait before using new source versions
															<span className="relative">
																<select value={minimumReleaseAgeMinutes} disabled={busy !== 'idle'} onChange={(event) => void changeMinimumReleaseAge(Number(event.target.value))} className="h-8 w-full appearance-none rounded-lg border border-border bg-background px-2.5 pr-8 text-xs font-medium normal-case tracking-normal text-foreground outline-none focus:ring-2 focus:ring-ring/40">
																	<option value={0}>No delay</option>
																	<option value={1440}>24 hours</option>
																	<option value={10080}>7 days</option>
																	<option value={43200}>30 days</option>
																</select>
																<ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
															</span>
														</label>
													</div>
												</div>
											</details>
										)}
										{preview.unresolved_sources && preview.unresolved_sources.length > 0 && (
											<section className="mt-4 rounded-xl border border-amber-400/35 bg-amber-500/[0.07] px-4 py-3.5 text-amber-950 dark:text-amber-100">
												<div className="flex gap-3">
													<AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" />
													<div className="min-w-0 flex-1">
														<p className="font-semibold">Choose what to do with {plural(preview.unresolved_sources.length, 'skill')}</p>
														<p className="mt-1 leading-relaxed text-amber-900/80 dark:text-amber-200/80">
															Skiller could not reach or confirm {plural(previewUnresolvedSourceCount, 'original source')}. Your current files are safe. Save copies to include them, or leave them only on this computer.
														</p>
														<div className="mt-3 flex flex-wrap gap-2">
															{libraryPurpose !== 'public' && (
																<Button size="xs" className="h-7 px-2.5" onClick={() => void saveUnresolvedAsCopies()} disabled={busy !== 'idle'}>
																	Save {plural(preview.unresolved_sources.length, 'copy')}
																</Button>
															)}
															{libraryPurpose === 'public' && <Button size="xs" className="h-7 px-2.5" onClick={() => beginSourceDecisionReview(preview.unresolved_sources ?? [])}>Choose source options</Button>}
															{preview.unresolved_sources.some((source) => source.reason === 'too-new') && (
																<Button size="xs" variant="ghost" className="h-7 px-2.5 text-amber-950 hover:bg-amber-500/10 dark:text-amber-100" onClick={() => void changeMinimumReleaseAge(0)}>
																	Use current source version
																</Button>
															)}
															<Button size="xs" variant="ghost" className="h-7 px-2.5 text-amber-950 hover:bg-amber-500/10 dark:text-amber-100" onClick={() => void keepUnresolvedSkillsLocal()} disabled={busy !== 'idle'}>
																Leave them here
															</Button>
														</div>
														<details className="mt-3">
															<summary className="cursor-pointer font-medium text-amber-900 underline-offset-2 hover:underline dark:text-amber-100">See affected skills and reasons</summary>
															<div className="mt-2 space-y-1.5 text-[11px] text-amber-900/80 dark:text-amber-200/80">
															{previewUnresolvedSourceGroups.map((source) => (
																<div key={`${source.source}-${source.requestedRef}-${source.reason}`} className="rounded-md bg-amber-500/[0.06] px-2.5 py-2">
																	<p className="font-medium text-amber-950 dark:text-amber-100">{sourceDisplayName(source.source)} <span className="font-normal text-amber-900/80 dark:text-amber-200/80">· {plural(source.skillIds.length, 'skill')}</span></p>
																	<p className="mt-0.5">{unresolvedSourceLabel(source.reason)}.</p>
																	<details className="mt-1.5">
																		<summary className="cursor-pointer font-medium hover:underline">See skills</summary>
																		<p className="mt-1 leading-relaxed">{source.skillIds.join(' · ')}</p>
																	</details>
																</div>
															))}
															</div>
														</details>
													</div>
													</div>
												</section>
											)}
											{preview.secret_findings.length > 0 && (
											<section className="mt-4 border-y border-destructive/25 py-3">
												<p className="font-medium text-destructive">
													Review {preview.secret_findings.length} possible secret
													{preview.secret_findings.length === 1 ? '' : 's'} before continuing
												</p>
												<p className="mt-1 text-muted-foreground">The matched values stay hidden. Remove the value, or leave the affected skill on this computer.</p>
												<div className="mt-2 max-h-40 divide-y divide-destructive/10 overflow-y-auto rounded-lg border border-destructive/15 bg-background/45">
													{groupSecretFindings(preview.secret_findings).map((group) => (
														<div key={`${group.skillId}-${group.relativePath}`} className="px-2.5 py-2">
															<div className="flex items-center gap-2">
																<p className="min-w-0 flex-1 truncate font-medium text-foreground">
																	{group.skillId} <span className="font-normal text-muted-foreground">· {group.relativePath}</span>
																</p>
																<Button size="xs" variant="ghost" className="h-7 shrink-0 px-2 text-[11px]" onClick={() => void leaveSecretSkillLocal(group.skillId)} disabled={busy !== 'idle'}>
																	Keep local
																</Button>
																<Button size="xs" variant="outline" className="h-7 shrink-0 px-2 text-[11px]" onClick={() => void revealSecretFinding(group.skillId, group.relativePath)}>
																	<FolderOpen className="size-3" />
																	Open file
																</Button>
															</div>
															<div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
																{group.findings.map((finding) => (
																	<p key={`${finding.line}-${finding.column}-${finding.rule}`}>
																		Line {finding.line} · Possible {secretRuleLabel(finding.rule)}
																	</p>
																))}
															</div>
														</div>
													))}
												</div>
													</section>
													)}
			</div>
									<div className="mt-3 flex shrink-0 items-center justify-end gap-3 border-t border-border/60 bg-background px-1 py-3">
										{previewIncludedCount === 0 && <p className="text-[11px] text-amber-700 dark:text-amber-300">No skill can be saved yet.</p>}
										{previewStaysLocalCount > 0 && <p className="text-[11px] text-amber-700 dark:text-amber-300">Resolve the skills above before choosing storage.</p>}
										<Button
											size="sm"
											className="h-9 px-4"
											onClick={() => {
												setDestinationStage('provider')
												setSetupMode('github')
												setShowDestination(true)
											}}
											disabled={preview.secret_findings.length > 0 || previewIncludedCount === 0 || previewStaysLocalCount > 0}
										>
											Choose storage <ChevronRight className="size-3.5" />
										</Button>
									</div>
								</>
							)}
							{showDestination && (
								<div className="min-h-0 flex-1">
									{publishConfirmationOpen && (
										<section className="mt-5 overflow-hidden rounded-2xl border border-border/70 bg-muted/10">
											<div className="border-b border-border/60 px-5 py-4">
												<div className="flex flex-wrap items-start justify-between gap-3">
													<div>
																	<p className="font-semibold text-foreground">{setupMode === 'github' ? 'GitHub' : setupMode === 'gitlab' ? 'GitLab' : 'Git server'} · {finalLibraryAccessLabel}</p>
												<p className="mt-1 max-w-xl break-all text-[11px] leading-relaxed text-muted-foreground">{plannedDestination}</p>
													</div>
													{libraryLicense && <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-medium">{libraryLicense}</span>}
												</div>
											</div>
											<div className="divide-y divide-border/60 px-5">
												<div className="flex items-center justify-between gap-4 py-3.5">
															<div><p className="font-medium text-foreground">Saved with your library</p><p className="mt-0.5 text-[11px] text-muted-foreground">{plural(previewFileCount, 'reviewed file')} will be uploaded.</p></div>
													<strong className="text-base text-foreground">{preview.skills.length}</strong>
												</div>
												<div className="flex items-center justify-between gap-4 py-3.5">
															<div><p className="font-medium text-foreground">Restored from original sources</p><p className="mt-0.5 text-[11px] text-muted-foreground">Their saved versions are recorded without uploading duplicate files.</p></div>
													<strong className="text-base text-foreground">{preview.references.length + preview.skills_sh.length}</strong>
												</div>
												<div className="flex items-center gap-2 py-3.5 text-[11px] text-muted-foreground">
													<CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
													No secret patterns were found in the files being uploaded.
												</div>
											</div>
																	{busy === 'publishing' ? (
																		<div className="border-t border-border/60 bg-background/50 px-5 py-4">
																			<div className="flex items-center gap-2 text-sm font-medium text-foreground"><Loader2 className="size-4 animate-spin text-primary" />Creating your library</div>
																			<p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Saving the reviewed files and recording their source versions. Your local agent folders stay unchanged.</p>
																			<div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Creating library" aria-valuetext="Creating and uploading your library">
																				<div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
																			</div>
																		</div>
																	) : (
																		<div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 bg-background/50 px-5 py-4">
																			<p className="max-w-md text-[11px] leading-relaxed text-muted-foreground">Nothing in your local agent folders is moved, deleted, or replaced by this publish.</p>
																			<Button size="sm" className="h-9 px-4" onClick={() => void publishBackup()} disabled={busy !== 'idle'}>
																				Create library and upload {plural(previewIncludedCount, 'skill')} <ChevronRight className="size-3.5" />
																			</Button>
																		</div>
																	)}
												</section>
												)}
									{!publishConfirmationOpen && destinationStage === 'provider' && (
											<section className="relative mt-5 flex min-h-[28rem] flex-1 overflow-hidden rounded-2xl border border-border/70 bg-muted/[0.12] p-5 sm:p-7">
												<div className="pointer-events-none absolute inset-0 overflow-hidden text-muted-foreground/[0.07] dark:text-muted-foreground/[0.10]" aria-hidden="true">
													<Github className="absolute -left-5 top-8 size-24 -rotate-12" />
													<Gitlab className="absolute right-[14%] top-5 size-16 rotate-12" />
													<Server className="absolute -bottom-7 right-8 size-28 rotate-[-10deg]" />
													<Github className="absolute bottom-[16%] left-[38%] size-12 rotate-[18deg]" />
												</div>
												<div className="relative flex w-full flex-col justify-center">
													{libraryMode === 'public' && (
													<label className="mb-5 grid max-w-xs gap-1 text-xs font-medium">
														Library license <span className="font-normal text-muted-foreground">Required for public sharing</span>
														<span className="relative">
															<select value={libraryLicense} onChange={(event) => setLibraryLicense(event.target.value as typeof libraryLicense)} className="h-9 w-full appearance-none rounded-lg border border-border bg-background px-2.5 pr-9 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40">
															<option value="">Choose a license…</option>
															<option value="MIT">MIT</option>
															<option value="Apache-2.0">Apache 2.0</option>
															<option value="CC0-1.0">CC0 1.0</option>
														</select>
														<ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
														</span>
														{!libraryLicense && <span className="text-[11px] font-normal leading-relaxed text-amber-700 dark:text-amber-300">Choose how other people may reuse the skill copies in this library.</span>}
													</label>
											)}
											<section className="grid gap-3 md:grid-cols-[1.35fr_1fr]">
											<button
												type="button"
												disabled={libraryMode === 'public' && !libraryLicense}
													aria-pressed={setupMode === 'github'}
													onClick={() => {
													setSetupMode('github')
													setRemoteUrl('')
													setCustomDestinationPreview(null)
											setGitHubRepositoryPreview(null)
											setProviderIdentity(null)
													setDestinationSetupError(null)
												}}
												className={`group flex min-h-56 flex-col rounded-xl border bg-background p-6 text-left transition-all enabled:hover:-translate-y-0.5 enabled:hover:bg-background disabled:cursor-not-allowed disabled:opacity-45 ${setupMode === 'github' ? 'border-primary ring-1 ring-primary/20' : 'border-border/70 enabled:hover:border-primary/65'}`}
											>
												<div className="flex items-center justify-between">
													<span className="flex items-center gap-2 text-base font-semibold">
														<Github className="size-5 text-primary" />
														GitHub
													</span>
													<span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">Recommended</span>
												</div>
												<p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">Create a new repository in the account you already use. Skiller will ask for its name next.</p>
													<span className="mt-auto flex items-center gap-1.5 pt-7 text-xs font-semibold text-primary">Select GitHub <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" /></span>
											</button>
											<div className="grid gap-3">
											<button
												type="button"
												disabled={libraryMode === 'public' && !libraryLicense}
													aria-pressed={setupMode === 'gitlab'}
													onClick={() => {
														setSetupMode('gitlab')
														setRemoteUrl('')
													setCustomDestinationPreview(null)
											setGitHubRepositoryPreview(null)
											setProviderIdentity(null)
													setGitLabProjectPreview(null)
													setDestinationSetupError(null)
												}}
												className={`group rounded-xl border bg-background/55 p-5 text-left transition-all enabled:hover:-translate-y-0.5 enabled:hover:bg-background disabled:cursor-not-allowed disabled:opacity-45 ${setupMode === 'gitlab' ? 'border-primary ring-1 ring-primary/20' : 'border-border/70 enabled:hover:border-primary/45'}`}
											>
													<span className="flex items-center gap-2 font-semibold">
														<Gitlab className="size-4 text-orange-500" />
														GitLab
													</span>
													<p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">Create a new project.</p>
												</button>
											<button
												type="button"
												disabled={libraryMode === 'public' && !libraryLicense}
													aria-pressed={setupMode === 'custom'}
													onClick={() => {
													setSetupMode('custom')
													setGitHubRepositoryPreview(null)
													setGitLabProjectPreview(null)
													setCustomDestinationPreview(null)
													setDestinationSetupError(null)
												}}
												className={`group rounded-xl border bg-background/55 p-5 text-left transition-all enabled:hover:-translate-y-0.5 enabled:hover:bg-background disabled:cursor-not-allowed disabled:opacity-45 ${setupMode === 'custom' ? 'border-primary ring-1 ring-primary/20' : 'border-border/70 enabled:hover:border-primary/45'}`}
												>
													<span className="flex items-center gap-2 font-semibold">
														<Server className="size-4 text-muted-foreground" />
														Other Git
													</span>
													<p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">Use an empty Git repository.</p>
												</button>
											</div>
											</section>
													<div className="mt-6 flex justify-end border-t border-border/60 pt-4">
														<Button
															size="lg"
															onClick={() => {
																setDestinationStage('setup')
																if (setupMode === 'github' && providerIdentity?.provider !== 'github') void signInProvider('github', 'create')
																if (setupMode === 'gitlab' && providerIdentity?.provider !== 'gitlab') void signInProvider('gitlab', 'create')
															}}
															disabled={!setupMode || (libraryMode === 'public' && !libraryLicense)}
														>
													Continue with {setupMode === 'gitlab' ? 'GitLab' : setupMode === 'custom' ? 'Other Git' : 'GitHub'} <ChevronRight className="size-3.5" />
												</Button>
											</div>
												</div>
											</section>
									)}
								  {!publishConfirmationOpen && destinationStage === 'setup' && (setupMode === 'gitlab' ? (
										<div className="mx-auto mt-5 w-full max-w-xl">
											{!remoteUrl ? (
											<section className="py-2">
												{providerIdentity?.provider !== 'gitlab' ? (
															<div className="mx-auto max-w-sm py-6">
																<div className="flex min-h-32 flex-col rounded-xl border border-border/70 p-4">
																	<div className="flex items-center gap-3">
																		<div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted"><Gitlab className="size-5 text-orange-500" /></div>
																		<div><p className="text-sm font-semibold">{providerAuthorization?.provider === 'gitlab' ? 'Continue in GitLab' : 'Connect GitLab'}</p><p className="mt-0.5 text-xs text-muted-foreground">{providerAuthorization?.provider === 'gitlab' ? 'Finish signing in in your browser.' : 'Sign in to check the project name before anything is created.'}</p></div>
																	</div>
                                                                    {providerAuthorization?.provider === 'gitlab' ? <><p className="mt-5 text-center text-xs text-muted-foreground">Enter this temporary code on GitLab.</p><div className="relative mx-auto mt-2" style={{ width: `${Math.max(220, providerAuthorization.userCode.length * 26)}px` }}><input readOnly aria-label="GitLab one-time code" value={providerAuthorization.userCode} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} className="h-12 w-full bg-transparent px-0 text-center font-mono text-2xl font-semibold tracking-[0.16em] text-foreground outline-none selection:bg-primary/20" /><Tooltip content="Copy code"><Button size="sm" variant="ghost" className="absolute left-full top-1/2 ml-0.5 size-9 -translate-y-1/2 p-0 active:-translate-y-1/2" aria-label="Copy GitLab one-time code" onClick={() => void copyProviderAuthorizationCode()}><Copy className="size-4" /></Button></Tooltip></div><div className="mt-4 flex justify-center"><Button size="sm" variant="outline" className="min-w-[5.5rem]" onClick={() => void cancelProviderBrowse()}>Cancel</Button></div></> : <Button className="mt-5 self-start" size="default" onClick={() => void signInProvider('gitlab', 'create')} disabled={busy !== 'idle'}><Gitlab className="size-3.5" />Connect GitLab</Button>}
																</div>
															</div>
												) : <>
													<div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2 text-xs"><Gitlab className="size-4 shrink-0 text-orange-500" /><span className="font-semibold">GitLab connected</span><span className="truncate text-muted-foreground">{providerIdentity.account}</span></div><button type="button" className="text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => void signInProvider('gitlab', 'create')}>Reconnect</button></div>
													<label className="mt-4 grid gap-1.5 text-xs font-medium">
													{libraryPurpose === 'team' ? 'Group and project path' : 'Project path'}
														<input
															value={gitLabProjectName}
															onChange={(event) => {
														setGitLabProjectName(event.target.value)
																	setGitLabProjectPreview(null)
																	setDestinationSetupError(null)
																	setProviderProblem(null)
															}}
														placeholder={libraryPurpose === 'team' ? 'your-group/agent-library' : 'agent-library'}
															className="h-10 rounded-lg border border-border bg-background px-3 text-xs font-normal text-foreground"
														/>
					</label>
											{destinationSetupError && <p className="mt-2 text-[11px] leading-relaxed text-destructive" role="alert">{destinationSetupError}</p>}
													<div className="mt-4 flex justify-end">
												<Button
													size="sm"
													onClick={busy === 'reviewing' && browsingProvider === 'gitlab'
														? cancelProviderBrowse
														: gitLabProjectPreview
															? () => setPublishConfirmationOpen(true)
															: reviewGitLabProject}
													disabled={(busy !== 'idle' && !(busy === 'reviewing' && browsingProvider === 'gitlab')) || preview.secret_findings.length > 0 || (libraryMode === 'public' && !libraryLicense)}
												>
															{busy === 'reviewing' && browsingProvider === 'gitlab' ? (
																<>
																	<Loader2 className="size-3.5 animate-spin" />
																	Stop checking
																</>
													) : gitLabProjectPreview ? (
														'Open final review'
													) : (
														'Review final setup'
															)}
														</Button>
													</div>
													</>}
											</section>
											) : (
												<section className="rounded-xl border border-border/70 p-4">
													<p className="text-xs font-medium">Project ready</p>
													<p className="mt-1 break-all text-[11px] text-muted-foreground">{remoteUrl}</p>
											<div className="mt-4">{renderFinalReviewAction()}</div>
												</section>
											)}
											{providerIdentity?.provider === 'gitlab' && providerProblem?.target === 'create' && providerProblem.provider === 'gitlab' && providerProblemView && (
												<div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2">
													<p className="text-[11px] text-amber-900 dark:text-amber-100">{providerProblemView.message}</p>
													<Button size="xs" onClick={() => void (busy === 'authenticating' ? cancelProviderBrowse() : resolveProviderProblem())} disabled={busy !== 'idle' && busy !== 'authenticating'}>
														{busy === 'authenticating' ? 'Stop connecting' : providerProblemView.actionLabel}
													</Button>
												</div>
											)}
				</div>
				  ) : setupMode === 'github' ? (
										<div className="mx-auto mt-5 w-full max-w-xl">
											{!remoteUrl ? (
											<section className="py-2">
												{providerIdentity?.provider !== 'github' ? (
															<div className="mx-auto max-w-sm py-6">
																<div className="flex min-h-32 flex-col rounded-xl border border-border/70 p-4">
																	<div className="flex items-center gap-3">
																		<div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted"><Github className="size-5" /></div>
																		<div className="min-w-0"><p className="text-sm font-semibold">{providerAuthorization?.provider === 'github' ? 'Continue in GitHub' : 'Connect GitHub'}</p><p className="mt-0.5 text-xs text-muted-foreground">{providerAuthorization?.provider === 'github' ? 'Finish signing in in your browser.' : 'Sign in to check the repository name before anything is created.'}</p></div>
																	</div>
                                                                    {providerAuthorization?.provider === 'github' ? <><p className="mt-5 text-center text-xs text-muted-foreground">Enter this temporary code on GitHub.</p><div className="relative mx-auto mt-2" style={{ width: `${Math.max(220, providerAuthorization.userCode.length * 26)}px` }}><input readOnly aria-label="GitHub one-time code" value={providerAuthorization.userCode} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} className="h-12 w-full bg-transparent px-0 text-center font-mono text-2xl font-semibold tracking-[0.16em] text-foreground outline-none selection:bg-primary/20" /><Tooltip content="Copy code"><Button size="sm" variant="ghost" className="absolute left-full top-1/2 ml-0.5 size-9 -translate-y-1/2 p-0 active:-translate-y-1/2" aria-label="Copy GitHub one-time code" onClick={() => void copyProviderAuthorizationCode()}><Copy className="size-4" /></Button></Tooltip></div><div className="mt-4 flex justify-center"><Button size="sm" variant="outline" className="min-w-[5.5rem]" onClick={() => void cancelProviderBrowse()}>Cancel</Button></div></> : <Button className="mt-5 self-start" size="default" onClick={() => void signInProvider('github', 'create')} disabled={busy !== 'idle'}><Github className="size-3.5" />Connect GitHub</Button>}
																</div>
															</div>
												) : (
													<div>
														<div className="flex items-center justify-between gap-3">
															<div className="flex min-w-0 items-center gap-2 text-xs">
																<Github className="size-4 shrink-0" />
																<span className="font-semibold">GitHub connected</span>
																<span className="truncate text-muted-foreground">{providerIdentity.account}</span>
															</div>
															<button type="button" className="text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => void signInProvider('github', 'create')}>Reconnect</button>
														</div>
														<label className="mt-4 grid gap-1.5 text-xs font-medium">
															{libraryPurpose === 'team' ? 'Organization and repository' : 'Repository name'}
															<input
																value={repositoryName}
																onChange={(event) => {
																	setRepositoryName(event.target.value)
																	setGitHubRepositoryPreview(null)
																	setDestinationSetupError(null)
																	setProviderProblem(null)
																}}
																placeholder={libraryPurpose === 'team' ? 'your-org/agent-library' : 'agent-library'}
																className="h-10 rounded-lg border border-border bg-background px-3 text-xs font-normal text-foreground"
															/>
														</label>
														{destinationSetupError && <p className="mt-2 text-[11px] leading-relaxed text-destructive" role="alert">{destinationSetupError}</p>}
														{providerProblem?.target === 'create' && providerProblem.provider === 'github' && providerProblemView && (
															<div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2" role="alert">
																<p className="text-[11px] leading-relaxed text-amber-900 dark:text-amber-100">{providerProblemView.message}</p>
																{providerProblemView.action !== 'rename' && <Button size="xs" onClick={() => void (busy === 'authenticating' ? cancelProviderBrowse() : resolveProviderProblem())} disabled={busy !== 'idle' && busy !== 'authenticating'}>{busy === 'authenticating' ? 'Stop connecting' : providerProblemView.actionLabel}</Button>}
															</div>
														)}
														<div className="mt-4 flex justify-end">
															<Button
																size="sm"
																onClick={busy === 'reviewing' && browsingProvider === 'github' ? cancelProviderBrowse : githubRepositoryPreview ? () => setPublishConfirmationOpen(true) : reviewGitHubRepository}
																disabled={(busy !== 'idle' && !(busy === 'reviewing' && browsingProvider === 'github')) || preview.secret_findings.length > 0 || (libraryMode === 'public' && !libraryLicense)}
															>
																{busy === 'reviewing' && browsingProvider === 'github' ? <><Loader2 className="size-3.5 animate-spin" />Stop checking</> : githubRepositoryPreview ? 'Open final review' : 'Review final setup'}
															</Button>
														</div>
													</div>
												)}
											</section>
											) : (
												<section className="rounded-xl border border-border/70 p-4">
													<p className="text-xs font-medium">Repository ready</p>
													<p className="mt-1 break-all text-[11px] text-muted-foreground">{remoteUrl}</p>
											<div className="mt-4">{renderFinalReviewAction()}</div>
												</section>
											)}
                </div>
              ) : setupMode === 'custom' ? (
								<section className="mx-auto mt-5 w-full max-w-xl py-2">
									<label className="grid gap-1.5 text-xs font-medium">
										Empty Git repository
										<input
											id="sync-custom-git-remote"
											value={remoteUrl}
											disabled={activeLibraryCheck === 'destination'}
											aria-invalid={Boolean(destinationSetupError)}
											aria-describedby={destinationSetupError ? 'sync-custom-git-error sync-custom-git-help' : 'sync-custom-git-help'}
											onChange={(event) => {
												setRemoteUrl(event.target.value)
												setCustomDestinationPreview(null)
												setDestinationSetupError(null)
												setPublishConfirmationOpen(false)
											}}
											placeholder="git@git.example.com:team/agent-library.git"
											className="h-10 rounded-lg border border-border bg-background px-3 text-xs font-normal text-foreground"
										/>
										<span id="sync-custom-git-help" className="font-normal text-muted-foreground">Skiller checks that it is reachable and empty. Your server controls who can access it.</span>
									</label>
									{destinationSetupError && <p id="sync-custom-git-error" className="mt-2 text-[11px] leading-relaxed text-destructive" role="alert">{destinationSetupError}</p>}
									<div className="mt-4 flex justify-end">{renderFinalReviewAction()}</div>
								</section>
													) : null)}
				</div>
				)}
            </div>
          )}
        </section>
        </>
      )}
    </div>
  )
}
