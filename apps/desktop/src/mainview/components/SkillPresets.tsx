import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { invoke } from '@/mainview/lib/native'
import type { SkillPresetJson } from '@/shared/rpc-schema'
import { Button } from './ui/button'
import { nativeSelectClass } from '@/mainview/lib/utils'

export function SkillPresets({ selectedIds, disabled }: { selectedIds: string[]; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const client = useQueryClient()
  const sets = useQuery({ queryKey: ['skill-presets'], queryFn: () => invoke('list_skill_presets'), enabled: open })
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => invoke('detect_agents'), enabled: open })
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => invoke('list_projects'), enabled: open })
  const [draft, setDraft] = useState<{ id?: string; name: string; skillIds: string[] } | null>(null)
  const [targetAgents, setTargetAgents] = useState<string[]>([])
  const [projectPath, setProjectPath] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const save = useMutation({
    mutationFn: (value: NonNullable<typeof draft>) => invoke('save_skill_preset', value),
    onSuccess: async preset => { choose(preset); await client.invalidateQueries({ queryKey: ['skill-presets'] }) },
  })
  const remove = useMutation({
    mutationFn: (id: string) => invoke('remove_skill_preset', { id }),
    onSuccess: async () => { setDraft(null); setDeleteConfirm(false); review.reset(); await client.invalidateQueries({ queryKey: ['skill-presets'] }) },
  })
  const review = useMutation({ mutationFn: (id: string) => invoke('review_skill_preset', { id, target: { agents: targetAgents, ...(projectPath ? { projectPath } : {}) } }) })
  const apply = useMutation({
    mutationFn: (reviewId: string) => invoke('apply_skill_preset', { reviewId }),
    onSuccess: async () => { await Promise.all(['skills', 'project-skills', 'agents'].map(key => client.invalidateQueries({ queryKey: [key] }))) },
  })
  const busy = save.isPending || remove.isPending || review.isPending || apply.isPending
  useEffect(() => { if (open) dialog.current?.showModal() }, [open])
  function clearReview() { review.reset(); apply.reset(); setDeleteConfirm(false) }
  function choose(preset: SkillPresetJson) {
    setDraft({ id: preset.id, name: preset.name, skillIds: preset.skills.map(skill => skill.id) })
    clearReview(); save.reset(); remove.reset()
  }
  const saved = sets.data?.find(preset => preset.id === draft?.id)
  const dirty = !saved || saved.name !== draft?.name || JSON.stringify(saved.skills.map(skill => skill.id)) !== JSON.stringify(draft?.skillIds)
  const availableAgents = agents.data?.filter(agent => agent.detected && agent.enabled && (!projectPath || agent.project_skills_dir)) ?? []
  const error = save.error || remove.error || review.error || apply.error || sets.error || agents.error || projects.error
  return <>
    <Button size="sm" variant="ghost" disabled={disabled} onClick={() => { setOpen(true); setDraft(null); clearReview(); save.reset(); remove.reset() }}>Skill sets</Button>
    {open && <dialog ref={dialog} onClose={() => setOpen(false)} onCancel={event => { if (busy) event.preventDefault() }} className="m-auto w-[min(44rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-auto rounded-2xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/50" aria-labelledby="skill-sets-title">
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div><h2 id="skill-sets-title" className="text-base font-semibold">Skill sets</h2><p className="mt-1 text-xs text-muted-foreground">Save a selection and reuse it across agents and projects.</p></div>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => dialog.current?.close()}>Close</Button>
      </header>
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap gap-2">
          {sets.data?.map(preset => <Button key={preset.id} size="sm" variant={draft?.id === preset.id ? 'default' : 'outline'} disabled={busy} onClick={() => choose(preset)}>{preset.name} · {preset.skills.length}</Button>)}
          <Button size="sm" variant="outline" disabled={!selectedIds.length || busy} onClick={() => { setDraft({ name: '', skillIds: selectedIds }); clearReview(); save.reset(); remove.reset() }}>Save selection ({selectedIds.length})</Button>
        </div>
        {!draft && <p className="text-sm text-muted-foreground">Choose a saved set, or close this window and use Select to choose skills for a new set.</p>}
        {draft && <>
          <label className="block space-y-1 text-xs">Set name<input className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" value={draft.name} maxLength={80} disabled={busy} onChange={event => { setDraft({ ...draft, name: event.target.value }); clearReview() }} placeholder="Frontend" /></label>
          <ul className="max-h-40 space-y-1 overflow-auto">
            {draft.skillIds.map(id => <li key={id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/30 px-3 py-1 text-xs"><span className="break-all">{saved?.skills.find(skill => skill.id === id)?.name ?? id}</span><Button size="sm" variant="ghost" aria-label={`Remove ${id} from this set`} disabled={busy} onClick={() => { setDraft({ ...draft, skillIds: draft.skillIds.filter(value => value !== id) }); clearReview() }}>Remove</Button></li>)}
          </ul>
          <div className="flex flex-wrap gap-2">
            {dirty && <Button size="sm" disabled={busy || !draft.name.trim() || !draft.skillIds.length} onClick={() => save.mutate(draft)}>Save set</Button>}
            {!!selectedIds.length && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setDraft({ ...draft, skillIds: [...new Set([...draft.skillIds, ...selectedIds])] }); clearReview() }}>Add selected skills</Button>}
            {draft.id && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeleteConfirm(true)}>Delete set</Button>}
          </div>
          {deleteConfirm && draft.id && <div className="space-y-2 rounded-lg border border-border p-3"><p className="text-xs">Delete this set? Installed skills will stay in their folders.</p><Button size="sm" variant="destructive" disabled={busy} onClick={() => remove.mutate(draft.id!)}>Delete set only</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeleteConfirm(false)}>Cancel</Button></div>}
          {saved && !dirty && <div className="space-y-3 border-t border-border pt-4">
            <label className="block space-y-1 text-xs">Install to<span className="relative block"><select className={`${nativeSelectClass} w-full pr-8`} value={projectPath} disabled={busy} onChange={event => { setProjectPath(event.target.value); setTargetAgents([]); clearReview() }}><option value="">Personal agent folders</option>{projects.data?.map(project => <option key={project.path} value={project.path}>{project.name} — {project.path}</option>)}</select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /></span></label>
            {projectPath && <p className="text-xs text-muted-foreground">Adds to the project’s .agents/skills folder. Select additional agent folders below if needed.</p>}
            <fieldset disabled={busy} className="space-y-2"><legend className="mb-2 text-xs font-medium">Agents</legend><div className="grid grid-cols-2 gap-2">{availableAgents.map(agent => <label key={agent.slug} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={targetAgents.includes(agent.slug)} onChange={event => { setTargetAgents(event.target.checked ? [...targetAgents, agent.slug] : targetAgents.filter(slug => slug !== agent.slug)); clearReview() }} />{agent.name}</label>)}</div></fieldset>
            <Button size="sm" variant="outline" disabled={busy || (!projectPath && !targetAgents.length)} onClick={() => { apply.reset(); review.mutate(saved.id) }}>{review.isPending ? 'Reviewing…' : 'Review installation'}</Button>
          </div>}
          {review.data && <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Existing skills and local changes are preserved. Unavailable sources and conflicting destinations are skipped.</p>
            <div className="max-h-56 overflow-auto rounded-lg border border-border"><table className="w-full text-left text-xs"><thead className="bg-muted/50"><tr><th className="p-2">Skill</th><th className="p-2">Destination</th><th className="p-2">Action</th></tr></thead><tbody>{review.data.rows.map(row => <tr key={`${row.skillId}:${row.destination}`} className="border-t border-border"><td className="p-2">{row.name}</td><td className="max-w-64 break-all p-2 font-mono">{row.destination}</td><td className="p-2">{{ add: 'Add', installed: 'Already installed', conflict: 'Keep existing', unavailable: 'Source unavailable' }[row.state]}</td></tr>)}</tbody></table></div>
            {!apply.isSuccess && <Button size="sm" disabled={busy || !review.data.rows.some(row => row.state === 'add')} onClick={() => apply.mutate(review.data!.reviewId)}>{apply.isPending ? 'Installing…' : `Install ${review.data.rows.filter(row => row.state === 'add').length} missing entries`}</Button>}
          </div>}
          {apply.data && <div role="status" className="space-y-1 text-xs"><p>Added {apply.data.added.length} · Skipped {apply.data.skipped} · Failed {apply.data.failed.length}</p>{apply.data.failed.map(item => <p key={item.destination} className="break-all text-destructive">{item.destination}: {item.reason}</p>)}</div>}
        </>}
        {error && <p role="alert" className="text-xs text-destructive">{error.message}</p>}
      </div>
    </dialog>}
  </>
}
