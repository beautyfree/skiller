import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ChevronRight, Cloud } from 'lucide-react'
import { invoke } from '@/mainview/lib/native'
import type { SyncInventoryJson, SyncProfileStatusJson, SyncPublishPreviewJson, SyncThreeWayReviewJson } from '@/shared/rpc-schema'
import { Button } from '@/mainview/components/ui/button'
import { useToast } from '@/mainview/components/ToastProvider'

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/**
 * Sync has its own product surface because it describes an evolving protected
 * state, not an application preference. Setup actions are deliberately kept
 * out of the first view until their reviewed plan is ready to apply.
 */
export default function SyncCenter() {
  const [showInventory, setShowInventory] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [selectionReady, setSelectionReady] = useState(false)
  const [setupMode, setSetupMode] = useState<'github' | 'custom' | null>(null)
  const [repositoryName, setRepositoryName] = useState('skiller-agent-library')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [preview, setPreview] = useState<SyncPublishPreviewJson | null>(null)
  const [remoteReview, setRemoteReview] = useState<SyncThreeWayReviewJson | null>(null)
  const [remoteSelections, setRemoteSelections] = useState<string[]>([])
	const [localSelections, setLocalSelections] = useState<string[]>([])
	const [keepLocalSelections, setKeepLocalSelections] = useState<string[]>([])
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
  const { data: recovery } = useQuery<{ pending: boolean }>({
    queryKey: ['sync-recovery', profile?.profile_id],
    queryFn: () => invoke('sync_recovery_status', { profileId: profile!.profile_id }),
    enabled: Boolean(profile),
  })
  const protectedCount = inventory?.items.length ?? 0
  const agentCount = new Set(inventory?.items.flatMap((item) => item.locations.map((location) => location.agent_slug)) ?? []).size

  useEffect(() => {
    if (!inventory || selectionReady) return
    setSelectedKeys(inventory.items.map((item) => item.candidate_key))
    setSelectionReady(true)
  }, [inventory, selectionReady])

  async function reviewBackup(mode: 'github' | 'custom') {
    setBusy('reviewing')
    try {
      const result = await invoke('sync_center_publish_preview', { selectedKeys })
      setPreview(result)
      setSetupMode(mode)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    } finally {
      setBusy('idle')
    }
  }

  async function createGitHubRepository() {
    setBusy('creating')
    try {
      const result = await invoke('sync_github_create_repo', { repository: repositoryName, visibility: 'private' })
      setRemoteUrl(result.remoteUrl)
      toast('Private GitHub repository created. Review and create the backup when ready.')
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
      toast('Your agent library is now protected.')
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
	  setKeepLocalSelections(result.skills.filter((skill) => skill.action === 'conflict' || skill.action === 'unmanaged').map((skill) => skill.id))
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
    <div className="mx-auto w-full max-w-4xl px-6 py-8 pb-12 animate-fade-in-up">
      {!profile && !profilesLoading && !showInventory && (
        <section className="relative overflow-hidden rounded-[28px] bg-primary px-6 py-7 text-primary-foreground shadow-[0_28px_70px_-36px_color-mix(in_srgb,var(--primary)_90%,transparent)] sm:px-9 sm:py-9">
          <div className="absolute -right-14 -top-20 size-72 rounded-full border border-white/15" />
          <div className="absolute -bottom-28 right-28 size-64 rounded-full border border-white/10" />
          <div className="relative max-w-2xl">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground/70"><Cloud className="size-3.5" /> Your agent library</div>
            <h1 className="mt-5 max-w-xl text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">Your best agent setup deserves a way back.</h1>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-primary-foreground/80">Keep your skills in one private library. Move to a new Mac, try a new agent, or recover from a bad change — without copying hidden folders or risking private data.</p>
            <div className="mt-7"><Button size="lg" className="bg-background text-foreground shadow-none hover:bg-background/90" onClick={() => setShowInventory(true)}>Start protected backup <ChevronRight className="size-4" /></Button></div>
            <div className="mt-8 flex flex-wrap gap-x-7 gap-y-2 text-xs text-primary-foreground/75">
              <span>{inventoryLoading ? 'Scanning your setup…' : `${plural(protectedCount, 'skill')} found`}</span>
              <span>{inventoryLoading ? '' : `${plural(agentCount, 'agent')} connected`}</span>
              <span>Nothing leaves this Mac without approval</span>
            </div>
          </div>
        </section>
      )}

      {profile && (
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">Sync Center</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-foreground">Your agent library</h1>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-3.5" /> Protected</div>
        </header>
      )}

      {profile && (
        <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-(--ds-shadow-layered-subtle)">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold">{profile.skill_count} protected skills</h2>
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
        <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-(--ds-shadow-layered-subtle)">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Step 1 of 2</p>
              <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em]">Review your library</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Identical skills are grouped once. A skill in an individual agent folder is not automatically moved or overwritten.
              </p>
            </div>
          </div>
		  {!profile && !preview && (
			<div className="fixed bottom-10 left-1/2 z-50 flex w-[min(42rem,calc(100vw-3rem))] -translate-x-1/2 flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-card/95 p-3 shadow-(--ds-shadow-layered-medium) backdrop-blur">
			  <div>
				<p className="text-xs font-semibold">{selectedKeys.length} skills ready to protect</p>
				<p className="mt-0.5 text-[11px] text-muted-foreground">You can change the selection below. The repository is created only after a final review.</p>
			  </div>
			  <div className="flex gap-2">
				<Button size="sm" variant="outline" onClick={() => reviewBackup('custom')} disabled={busy !== 'idle' || selectedKeys.length === 0}>Other Git server</Button>
				<Button size="sm" onClick={() => reviewBackup('github')} disabled={busy !== 'idle' || selectedKeys.length === 0}>Continue with GitHub <ChevronRight className="size-3.5" /></Button>
			  </div>
			</div>
		  )}

          {!preview && <>
          {(inventory?.collisions.length ?? 0) > 0 && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <p>{plural(inventory?.collisions.length ?? 0, 'skill')} have the same name but different contents. Sync Center will ask which version to protect; it will never choose by filename.</p>
            </div>
          )}
          <div className="mt-4 divide-y divide-border/60 rounded-xl border border-border/70 pb-28">
            {inventory?.items.map((item) => (
              <label key={item.candidate_key} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-xs hover:bg-muted/30">
                <input
                  type="checkbox"
                  checked={selectedKeys.includes(item.candidate_key)}
                  onChange={() => setSelectedKeys((current) => current.includes(item.candidate_key)
                    ? current.filter((key) => key !== item.candidate_key)
                    : [...current, item.candidate_key])}
                />
                <Cloud className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{item.display_name}</span>
                <span className="text-muted-foreground">{item.locations.map((location) => location.agent_slug).join(' · ')}</span>
              </label>
            ))}
            {!inventoryLoading && protectedCount === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">No valid skills were found yet.</p>}
          </div>
          {inventory?.invalid_paths ? <p className="mt-3 text-xs text-muted-foreground">{inventory.invalid_paths} unreadable or invalid skill folder{inventory.invalid_paths === 1 ? '' : 's'} were left untouched.</p> : null}
		  </>}
          {remoteReview && (
            <div className="mt-4 rounded-xl border border-border bg-muted/25 p-3 text-xs">
              <p className="font-semibold">Change review</p>
              <div className="mt-2 space-y-1 text-muted-foreground">
                {remoteReview.skills.map((skill) => {
				  const selectable = skill.action === 'take-remote' || skill.action === 'publish-local' || skill.action === 'conflict' || skill.action === 'unmanaged'
				  const selected = skill.action === 'take-remote' ? remoteSelections : skill.action === 'publish-local' ? localSelections : keepLocalSelections
				  const setSelected = skill.action === 'take-remote' ? setRemoteSelections : skill.action === 'publish-local' ? setLocalSelections : setKeepLocalSelections
                  return <label key={skill.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-background/60">
					<input type="checkbox" disabled={!selectable} checked={selectable && selected.includes(skill.id)} onChange={() => setSelected((current) => current.includes(skill.id) ? current.filter((id) => id !== skill.id) : [...current, skill.id])} />
                    <span className="min-w-0 flex-1 truncate">{skill.id}</span>
                    <span>{skill.action.replace('-', ' ')}</span>
					{skill.action === 'conflict' && <Button size="xs" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={(event) => { event.preventDefault(); void useRemoteForConflict(skill.id) }} disabled={busy !== 'idle'}>Use remote</Button>}
                  </label>
                })}
              </div>
			  <p className="mt-2 text-muted-foreground">Remote-only changes can be applied; local-only changes can be published. For a conflict, keep local records this reviewed choice without touching the remote; a new remote revision will ask again.</p>
              {remoteSelections.length > 0 && <Button size="sm" className="mt-3" onClick={applySelectedRemoteChanges} disabled={busy !== 'idle'}>Apply selected remote changes</Button>}
			  {localSelections.length > 0 && <Button size="sm" variant="outline" className="mt-3 ml-2" onClick={publishSelectedLocalChanges} disabled={busy !== 'idle'}>Publish selected local changes</Button>}
			  {keepLocalSelections.length > 0 && <Button size="sm" variant="outline" className="mt-3 ml-2" onClick={keepSelectedLocalChanges} disabled={busy !== 'idle'}>Keep selected local changes</Button>}
            </div>
          )}
          {preview && setupMode && (
            <div className="mt-6 rounded-2xl border border-primary/20 bg-primary/5 p-5 text-xs">
			  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Step 2 of 2</p>
              <p className="mt-1 text-base font-semibold">Choose where to keep your library</p>
			  <p className="mt-2 font-medium">{preview.skills.length} skills · {preview.skills.reduce((total, skill) => total + skill.file_count, 0)} files</p>
              {preview.secret_findings.length > 0 ? <p className="mt-2 text-destructive">Blocked by {preview.secret_findings.length} possible secret(s). Remove them before creating a backup.</p> : <p className="mt-2 text-muted-foreground">No secret patterns found. This review is rebuilt immediately before commit.</p>}
              {setupMode === 'github' ? (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  {!remoteUrl ? <>
                    <label className="grid gap-1 text-[11px] text-muted-foreground">Repository name
                      <input value={repositoryName} onChange={(event) => setRepositoryName(event.target.value)} className="h-8 w-52 rounded-lg border border-border bg-background px-2 text-xs text-foreground" />
                    </label>
                    <Button size="sm" onClick={createGitHubRepository} disabled={busy !== 'idle' || preview.secret_findings.length > 0}>Create private GitHub repo</Button>
                  </> : <Button size="sm" onClick={publishBackup} disabled={busy !== 'idle' || preview.secret_findings.length > 0}>Create protected backup</Button>}
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="grid gap-1 text-[11px] text-muted-foreground">Git remote
                    <input value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="git@git.example.com:team/agent-library.git" className="h-8 w-72 rounded-lg border border-border bg-background px-2 text-xs text-foreground" />
                  </label>
                  <Button size="sm" onClick={publishBackup} disabled={busy !== 'idle' || !remoteUrl || preview.secret_findings.length > 0}>Create protected backup</Button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
