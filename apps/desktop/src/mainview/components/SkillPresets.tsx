import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Pencil } from 'lucide-react'
import { invoke } from '@/mainview/lib/native'
import type { SkillPresetJson } from '@/shared/rpc-schema'
import type { Skill } from '@/mainview/hooks/useSkills'
import { Button } from './ui/button'
import { useToast } from './ToastProvider'
import { nativeSelectClass } from '@/mainview/lib/utils'

type Flow = { mode: 'save' | 'install'; preset?: SkillPresetJson; skillIds: string[]; revision: number }

export function SkillPresets({ selectedIds, skills = [], agentSlug, disabled }: {
  selectedIds: string[]; skills?: Skill[]; agentSlug?: string; disabled: boolean
}) {
  const client = useQueryClient()
  const { toast } = useToast()
  const dialog = useRef<HTMLDialogElement>(null)
  const [flow, setFlow] = useState<Flow | null>(null)
  const [name, setName] = useState('')
  const [members, setMembers] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [targetAgents, setTargetAgents] = useState<string[]>([])
  const [projectPath, setProjectPath] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const sets = useQuery({ queryKey: ['skill-presets'], queryFn: () => invoke('list_skill_presets') })
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => invoke('detect_agents'), enabled: flow?.mode === 'install' })
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => invoke('list_projects'), enabled: flow?.mode === 'install' })
  const review = useQuery({
    queryKey: ['skill-set-review', flow, targetAgents, projectPath],
    queryFn: () => invoke('review_skill_preset', {
      ...(flow!.preset ? { id: flow!.preset.id } : { skillIds: flow!.skillIds }),
      target: { agents: targetAgents, ...(projectPath ? { projectPath } : {}) },
    }),
    enabled: flow?.mode === 'install' && (!!projectPath || !!targetAgents.length),
    retry: false, staleTime: Infinity, refetchOnWindowFocus: false,
  })
  const save = useMutation({
    mutationFn: () => invoke('save_skill_preset', { ...(flow?.preset ? { id: flow.preset.id } : {}), name, skillIds: members }),
    onSuccess: async preset => { await client.invalidateQueries({ queryKey: ['skill-presets'] }); toast(`Saved ${preset.name}`); dialog.current?.close() },
  })
  const remove = useMutation({
    mutationFn: () => invoke('remove_skill_preset', { id: flow!.preset!.id }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['skill-presets'] }); dialog.current?.close() },
  })
  const apply = useMutation({
    mutationFn: () => invoke('apply_skill_preset', { reviewId: review.data!.reviewId }),
    onSuccess: async () => { await Promise.all(['skills', 'project-skills', 'agents'].map(key => client.invalidateQueries({ queryKey: [key] }))) },
  })
  const busy = save.isPending || remove.isPending || apply.isPending
  useEffect(() => {
    if (!flow) return
    dialog.current?.showModal()
    if (flow.mode === 'save') dialog.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [!!flow])
  function start(mode: Flow['mode'], preset?: SkillPresetJson) {
    const ids = preset ? preset.skills.map(skill => skill.id) : selectedIds
    setFlow({ mode, preset, skillIds: ids, revision: Date.now() })
    setName(preset?.name ?? ''); setMembers(ids); setSearch(''); setDeleteConfirm(false)
    setProjectPath(''); setTargetAgents(agentSlug ? [agentSlug] : [])
    save.reset(); remove.reset(); apply.reset()
  }
  const local = skills.filter(skill => !skill.collection)
  const options = [...local.map(skill => ({ id: skill.id, name: skill.name, available: true })),
    ...(flow?.preset?.skills.filter(ref => !local.some(skill => skill.id === ref.id)).map(ref => ({ ...ref, available: false })) ?? [])]
  const availableAgents = agents.data?.filter(agent => agent.detected && agent.enabled && (!projectPath || agent.project_skills_dir)) ?? []
  const counts = { add: 0, installed: 0, conflict: 0, unavailable: 0 }
  review.data?.rows.forEach(row => counts[row.state]++)
  const error = save.error || remove.error || apply.error || (flow?.mode === 'install' ? review.error || agents.error || projects.error : null)

  return <section aria-label="Skill sets" className="mt-3 shrink-0 space-y-2">
    {selectedIds.length > 0 && <div className="grid grid-cols-2 gap-2">
      <Button size="sm" disabled={disabled} onClick={() => start('install')}>Install selected</Button>
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => start('save')}>Save as set</Button>
    </div>}
    {!!sets.data?.length && <>
      <p className="text-xs font-medium text-muted-foreground">Skill sets</p>
      <div className="max-h-36 space-y-1 overflow-auto">
        {sets.data.map(preset => {
          const present = agentSlug ? preset.skills.filter(ref => skills.some(skill => skill.id === ref.id && skill.canonical_path === ref.sourcePath && skill.installations.some(installation => installation.agent_slug === agentSlug))).length : null
          return <div key={preset.id} className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/20 px-2 py-1">
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{preset.name}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{present === null ? `${preset.skills.length} skills` : `${present}/${preset.skills.length} present`}</span>
            {present === preset.skills.length && <Check className="size-3 shrink-0 text-primary" aria-label="All skills present" />}
            <Button size="xs" variant="ghost" disabled={disabled} aria-label={`Install ${preset.name}`} onClick={() => start('install', preset)}>Install</Button>
            <Button size="icon-xs" variant="ghost" disabled={disabled} aria-label={`Edit ${preset.name}`} onClick={() => start('save', preset)}><Pencil className="size-3" /></Button>
          </div>
        })}
      </div>
    </>}
    {sets.isError && <p role="alert" className="text-xs text-destructive">Could not load sets. <button className="underline" onClick={() => sets.refetch()}>Retry</button></p>}
    {flow && <dialog ref={dialog} onClose={() => setFlow(null)} onCancel={event => { if (busy) event.preventDefault() }} className="m-auto w-[min(32rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-auto rounded-2xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/50" aria-labelledby="skill-set-title">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 id="skill-set-title" className="text-sm font-semibold">{flow.mode === 'save' ? flow.preset ? `Edit ${flow.preset.name}` : 'Save skill set' : `Install ${flow.preset?.name ?? `${flow.skillIds.length} selected skills`}`}</h2>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => dialog.current?.close()}>Close</Button>
      </header>
      <div className="space-y-4 p-5">
        {flow.mode === 'save' ? <form className="space-y-4" onSubmit={event => { event.preventDefault(); save.mutate() }}>
          <label className="block space-y-1 text-xs">Set name<input autoFocus required maxLength={80} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="Frontend" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
          <input aria-label="Find skills for this set" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find skills…" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs" />
          <fieldset disabled={busy} className="space-y-2"><legend className="mb-2 text-xs text-muted-foreground">{members.length} skills selected</legend><div className="max-h-56 space-y-1 overflow-auto">
            {options.filter(skill => `${skill.name} ${skill.id}`.toLowerCase().includes(search.toLowerCase())).map(skill => <label key={skill.id} className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs hover:bg-muted/40"><input type="checkbox" checked={members.includes(skill.id)} disabled={!skill.available && !members.includes(skill.id)} onChange={event => setMembers(event.target.checked ? [...members, skill.id] : members.filter(id => id !== skill.id))} /><span className="min-w-0 flex-1">{skill.name}</span>{!skill.available && <span className="text-muted-foreground">Unavailable</span>}</label>)}
          </div></fieldset>
          <div className="flex items-center justify-between gap-2"><Button size="sm" type="submit" disabled={busy || !name.trim() || !members.length}>{save.isPending ? 'Saving…' : 'Save set'}</Button>{flow.preset && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setDeleteConfirm(true)}>Delete set</Button>}</div>
          {deleteConfirm && <div className="space-y-2 rounded-lg border border-border p-3"><p className="text-xs">Delete this set? Installed skills will stay in their folders.</p><Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => remove.mutate()}>Delete set only</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setDeleteConfirm(false)}>Cancel</Button></div>}
        </form> : <>
          {!apply.isSuccess && <>
            <label className="block space-y-1 text-xs">Destination<span className="relative block"><select className={`${nativeSelectClass} w-full pr-8`} value={projectPath} disabled={busy} onChange={event => { setProjectPath(event.target.value); setTargetAgents([]); apply.reset() }}><option value="">Personal agent folders</option>{projects.data?.map(project => <option key={project.path} value={project.path}>{project.name}</option>)}</select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /></span></label>
            {projectPath && <p className="text-xs text-muted-foreground">Installs in this project. Choose additional agent folders if needed.</p>}
            <fieldset disabled={busy} className="space-y-2"><legend className="mb-2 text-xs font-medium">Agents</legend><div className="grid grid-cols-2 gap-2">{availableAgents.map(agent => <label key={agent.slug} className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-xs"><input type="checkbox" checked={targetAgents.includes(agent.slug)} onChange={event => { setTargetAgents(event.target.checked ? [...targetAgents, agent.slug] : targetAgents.filter(slug => slug !== agent.slug)); apply.reset() }} />{agent.name}</label>)}</div></fieldset>
            {!projectPath && !targetAgents.length && <p className="text-xs text-muted-foreground">Choose the agents that should receive these skills.</p>}
            {review.isFetching && <p role="status" className="text-xs text-muted-foreground">Checking existing skills…</p>}
            {review.data && !review.isFetching && <div className="space-y-3 rounded-xl border border-border p-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs"><span className="font-medium">{counts.add} to add</span><span className="text-muted-foreground">{counts.installed} already installed</span></div>
              {counts.conflict > 0 && <p className="text-xs text-amber-600 dark:text-amber-400">{counts.conflict} existing entries differ. They will be kept.</p>}
              {counts.unavailable > 0 && <p className="text-xs text-muted-foreground">{counts.unavailable} entries have unavailable sources and will be skipped.</p>}
              <details className="text-xs"><summary className="cursor-pointer text-muted-foreground hover:text-foreground">View skills and file locations</summary><ul className="mt-2 max-h-48 space-y-2 overflow-auto">{review.data.rows.map(row => <li key={`${row.skillId}:${row.destination}`}><span className="font-medium">{row.name}</span> · {{ add: 'Add', installed: 'Already installed', conflict: 'Keep existing', unavailable: 'Unavailable' }[row.state]}<code className="mt-0.5 block break-all text-[10px] text-muted-foreground">{row.destination}</code></li>)}</ul></details>
              <Button size="sm" disabled={busy || !counts.add || !!review.error || apply.isError} onClick={() => apply.mutate()}>{apply.isPending ? 'Installing…' : counts.add ? 'Install missing skills' : 'Everything available is already installed'}</Button>
            </div>}
          </>}
          {apply.data && <div role="status" className="space-y-3"><p className="text-sm font-medium">{apply.data.failed.length ? 'Installation finished with errors' : 'Installation complete'}</p><p className="text-xs text-muted-foreground">Added {apply.data.added.length} · Kept or skipped {apply.data.skipped}</p>{apply.data.failed.map(item => <p key={item.destination} className="break-all text-xs text-destructive">{item.destination}: {item.reason}</p>)}<Button size="sm" onClick={() => dialog.current?.close()}>Done</Button></div>}
        </>}
        {error && <div role="alert" className="space-y-2 text-xs text-destructive"><p>{error.message}</p>{flow.mode === 'install' && <Button size="sm" variant="outline" disabled={busy || review.isFetching} onClick={() => { apply.reset(); void review.refetch() }}>Check again</Button>}</div>}
      </div>
    </dialog>}
  </section>
}
