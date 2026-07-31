import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ChevronRight, Cloud, GitBranch, ShieldCheck } from 'lucide-react'
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
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [selectionReady, setSelectionReady] = useState(false)
  const [setupMode, setSetupMode] = useState<'github' | 'custom' | null>(null)
  const [repositoryName, setRepositoryName] = useState('skiller-agent-library')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [preview, setPreview] = useState<SyncPublishPreviewJson | null>(null)
  const [remoteReview, setRemoteReview] = useState<SyncThreeWayReviewJson | null>(null)
  const [busy, setBusy] = useState<'idle' | 'reviewing' | 'creating' | 'publishing'>('idle')
  const { toast } = useToast()
  const { data: inventory, isLoading: inventoryLoading } = useQuery<SyncInventoryJson>({
    queryKey: ['sync-center-inventory'],
    queryFn: () => invoke('scan_sync_inventory'),
  })
  const { data: profiles, isLoading: profilesLoading } = useQuery<SyncProfileStatusJson[]>({
    queryKey: ['sync-profiles'],
    queryFn: () => invoke('list_sync_profiles'),
  })

  const profile = profiles?.[0]
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
      setRemoteReview(await invoke('sync_three_way_review', { profileId: profile.profile_id }))
      setShowInventory(true)
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'destructive')
    } finally {
      setBusy('idle')
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8 pb-12 animate-fade-in-up">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">Sync Center</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-foreground">
            {profile ? 'Your agent library' : 'Protect your agent setup'}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            One protected library for the skills your agents use. Skiller reviews every change before it touches a local folder or Git remote.
          </p>
        </div>
        {profile && (
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-3.5" /> Protected
          </div>
        )}
      </header>

      <section className="mt-7 grid gap-3 sm:grid-cols-3">
        <Stat label="Skills found" value={inventoryLoading ? '—' : String(protectedCount)} />
        <Stat label="Agents involved" value={inventoryLoading ? '—' : String(agentCount)} />
        <Stat label="Needs a decision" value={inventoryLoading ? '—' : String(inventory?.collisions.length ?? 0)} tone={(inventory?.collisions.length ?? 0) > 0 ? 'warning' : undefined} />
      </section>

      {!profile && !profilesLoading && (
        <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-(--ds-shadow-layered-subtle)">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="size-4" /></span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">A safe backup starts with a review</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                We found {plural(protectedCount, 'skill')} across {plural(agentCount, 'agent')}. Nothing will be copied, linked, committed, or uploaded until you inspect the plan.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setShowInventory(true)}>
                  Review my setup <ChevronRight className="size-3.5" />
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setShowAdvanced((value) => !value); setShowInventory(true) }}>
                  <GitBranch className="size-3.5" /> Other Git server
                </Button>
              </div>
            </div>
          </div>
          {showAdvanced && (
            <div className="mt-4 rounded-xl border border-dashed border-border p-3 text-xs leading-relaxed text-muted-foreground">
              GitLab, Gitea, SSH, HTTPS and local `file://` remotes are supported. The advanced connection form will appear after the same inventory review, so it cannot bypass the safety checks.
            </div>
          )}
        </section>
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
            <Button size="sm" onClick={reviewRemoteChanges} disabled={busy !== 'idle'}>Review changes <ChevronRight className="size-3.5" /></Button>
          </div>
        </section>
      )}

      {showInventory && (
        <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-(--ds-shadow-layered-subtle)">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold">Your setup, before anything changes</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Identical skills are grouped once. A skill in an individual agent folder is not automatically moved or overwritten.
              </p>
            </div>
            <Button size="xs" variant="ghost" onClick={() => setShowInventory(false)}>Close</Button>
          </div>

          {(inventory?.collisions.length ?? 0) > 0 && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <p>{plural(inventory?.collisions.length ?? 0, 'skill')} have the same name but different contents. Sync Center will ask which version to protect; it will never choose by filename.</p>
            </div>
          )}
          <div className="mt-4 divide-y divide-border/60 rounded-xl border border-border/70">
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
          {remoteReview && (
            <div className="mt-4 rounded-xl border border-border bg-muted/25 p-3 text-xs">
              <p className="font-semibold">Change review</p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-muted-foreground">
                {remoteReview.skills.map((skill) => <span key={skill.id} className="rounded-full border border-border bg-background px-2 py-0.5">{skill.id}: {skill.action.replace('-', ' ')}</span>)}
              </div>
              <p className="mt-2 text-muted-foreground">Nothing is applied from this review. Conflicts and unmanaged local changes stay local until you choose a resolution.</p>
            </div>
          )}
          {!profile && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/35 p-3">
              <p className="text-xs text-muted-foreground">{selectedKeys.length} selected. Next, choose where this protected library lives.</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => reviewBackup('custom')} disabled={busy !== 'idle' || selectedKeys.length === 0}>Other Git server</Button>
                <Button size="sm" onClick={() => reviewBackup('github')} disabled={busy !== 'idle' || selectedKeys.length === 0}>Continue with GitHub <ChevronRight className="size-3.5" /></Button>
              </div>
            </div>
          )}
          {preview && setupMode && (
            <div className="mt-4 rounded-xl border border-border bg-background/40 p-4 text-xs">
              <p className="font-semibold">Review: {preview.skills.length} skills · {preview.skills.reduce((total, skill) => total + skill.file_count, 0)} files</p>
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warning' }) {
  return (
    <div className={`rounded-xl border p-4 ${tone === 'warning' ? 'border-amber-500/25 bg-amber-500/5' : 'border-border bg-card/65'}`}>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone === 'warning' ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'}`}>{value}</p>
    </div>
  )
}
