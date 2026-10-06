import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Layers, Plus } from 'lucide-react'
import { invoke } from '@/mainview/lib/native'
import type { ProjectEntryJson, ProjectSkillJson, SkillPresetJson } from '@/shared/rpc-schema'
import type { Skill } from '@/mainview/hooks/useSkills'
import { useSkillSets } from '@/mainview/hooks/useSkillSets'
import { Button } from './ui/button'
import { nativeSelectClass } from '@/mainview/lib/utils'
import { SkillSetRemovalDialog } from './SkillSetRemovalDialog'

type Flow = { preset?: SkillPresetJson; skillIds: string[]; revision: number; picking?: boolean }

/** Assignment owns file writes; set creation and membership live on /skill-sets. */
export function SkillPresets({ selectedIds = [], skills = [], agentSlug, project, projectSkills = [], preset, disabled = false }: {
  selectedIds?: string[]; skills?: Skill[]; agentSlug?: string
  project?: ProjectEntryJson; projectSkills?: ProjectSkillJson[]
  preset?: SkillPresetJson; disabled?: boolean
}) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const dialog = useRef<HTMLDialogElement>(null)
  const [flow, setFlow] = useState<Flow | null>(null)
  const [targetAgents, setTargetAgents] = useState<string[]>([])
  const [projectPath, setProjectPath] = useState('')
  const [search, setSearch] = useState('')
  const [removing, setRemoving] = useState<SkillPresetJson | null>(null)
  const scoped = !!agentSlug || !!project
  const sets = useSkillSets(scoped)
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => invoke('detect_agents'), enabled: !!flow })
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => invoke('list_projects'), enabled: !!flow && !scoped })
  const review = useQuery({
    queryKey: ['skill-set-review', flow, targetAgents, projectPath],
    queryFn: () => invoke('review_skill_preset', {
      ...(flow!.preset ? { id: flow!.preset.id } : { skillIds: flow!.skillIds }),
      target: { agents: targetAgents, ...(projectPath ? { projectPath } : {}) },
    }),
    enabled: !!flow && !flow.picking && (!!projectPath || !!targetAgents.length),
    retry: false, staleTime: Infinity, refetchOnWindowFocus: false,
  })
  const library = skills.filter(skill => !skill.collection)
  const candidates = useQuery({
    queryKey: ['skill-picker-review', flow?.revision, library.map(skill => skill.id), targetAgents, projectPath],
    queryFn: async () => {
      const rows = []
      for (let offset = 0; offset < library.length; offset += 200) {
        const result = await invoke('review_skill_preset', {
          skillIds: library.slice(offset, offset + 200).map(skill => skill.id),
          target: { agents: targetAgents, ...(projectPath ? { projectPath } : {}) },
        })
        rows.push(...result.rows)
      }
      return rows
    },
    enabled: !!flow?.picking && (!!projectPath || !!targetAgents.length),
    retry: false, staleTime: Infinity, refetchOnWindowFocus: false,
  })
  function pickerState(id: string) {
    const rows = candidates.data?.filter(row => row.skillId === id) ?? []
    if (!rows.length || rows.some(row => row.state === 'unavailable')) return 'unavailable'
    if (rows.some(row => row.state === 'conflict')) return 'conflict'
    return rows.some(row => row.state === 'add') ? 'add' : 'installed'
  }
  const rank = { add: 0, conflict: 1, installed: 2, unavailable: 3 }
  const visible = library.filter(skill => `${skill.name} ${skill.id} ${skill.description ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => rank[pickerState(a.id)] - rank[pickerState(b.id)] || a.name.localeCompare(b.name))
  const selectable = visible.filter(skill => pickerState(skill.id) === 'add')
  const picked = flow?.skillIds.filter(id => pickerState(id) === 'add') ?? []
  const apply = useMutation({
    mutationFn: () => invoke('apply_skill_preset', { reviewId: review.data!.reviewId }),
    onSuccess: async () => { await Promise.all(['skills', 'project-skills', 'agents'].map(key => client.invalidateQueries({ queryKey: [key] }))) },
  })
  useEffect(() => { if (flow) dialog.current?.showModal() }, [!!flow])
  function start(set?: SkillPresetJson, picking = false) {
    setFlow({ preset: set, skillIds: picking ? [] : set ? set.skills.map(skill => skill.id) : selectedIds, revision: Date.now(), picking: picking ? true : undefined })
    setProjectPath(project?.path ?? '')
    setTargetAgents(agentSlug ? [agentSlug] : [])
    setSearch('')
    apply.reset()
  }
  const availableAgents = agents.data?.filter(agent => agent.detected && agent.enabled && (!projectPath || agent.project_skills_dir)) ?? []
  const counts = { add: 0, installed: 0, conflict: 0, unavailable: 0 }
  review.data?.rows.forEach(row => counts[row.state]++)
  const error = apply.error || review.error || candidates.error || agents.error || projects.error
  function startRemoval(set: SkillPresetJson) {
    dialog.current?.close()
    setRemoving(set)
  }

  return <>
    {selectedIds.length > 0 && <div className="mt-3 flex shrink-0 flex-wrap gap-2" aria-label="Selected skill actions">
      {!agentSlug && <Button size="sm" disabled={disabled} onClick={() => start()}>Add to…</Button>}
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => navigate(`/skill-sets/new?skills=${encodeURIComponent(JSON.stringify(selectedIds))}`)}>Save as pack</Button>
    </div>}
    {preset && preset.skills.length > 0 && <Button size="sm" disabled={disabled} onClick={() => start(preset)}>Add to…</Button>}
    {scoped && <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => start(undefined, true)}><Plus className="size-3.5" aria-hidden />Add skills</Button>
    {scoped && !!sets.data?.length && <section aria-label="Apply a skill pack" className="flex shrink-0 flex-wrap items-center gap-2">
      <Link to="/skill-sets" className="text-xs text-muted-foreground hover:text-foreground">Skill packs</Link>
      {sets.data.filter(set => set.skills.length > 0).map(set => {
        const available = set.skills.filter(ref => skills.some(skill => skill.id === ref.id && skill.canonical_path === ref.sourcePath))
        const present = project
          ? set.skills.filter(ref => projectSkills.some(skill => skill.id === ref.id)).length
          : available.filter(ref => skills.some(skill => skill.id === ref.id && skill.installations.some(installation => installation.agent_slug === agentSlug))).length
        const complete = set.skills.length > 0 && present === set.skills.length
        return <button key={set.id} type="button" className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${complete ? 'border-foreground/20 bg-muted/30 text-foreground' : present ? 'border-amber-500/30 text-amber-600 dark:text-amber-400' : 'border-border/60 text-muted-foreground hover:text-foreground'}`} disabled={disabled || (!complete && !available.length)} aria-label={`${complete ? 'Review removal of' : 'Review adding'} ${set.name} ${complete ? 'from' : 'to'} ${project?.name ?? agentSlug}`} title={complete ? 'Review removal' : !available.length ? 'Source unavailable' : 'Add missing skills'} onClick={() => complete ? startRemoval(set) : start(set)}>
          <Layers className="size-3" aria-hidden /><span className="max-w-40 truncate">{set.name}</span>{complete ? <Check className="size-3" aria-hidden /> : present > 0 && <span className="rounded bg-amber-500/10 px-1 text-[10px] tabular-nums">{present}/{set.skills.length}</span>}
        </button>
      })}
    </section>}
    </div>}
    {scoped && sets.isError && <p role="alert" className="mt-3 text-xs text-destructive">Could not load packs. <button className="underline" onClick={() => sets.refetch()}>Retry</button></p>}
    {flow && <dialog ref={dialog} onClose={() => setFlow(null)} onCancel={event => { if (apply.isPending) event.preventDefault() }} className="m-auto w-[min(32rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-auto rounded-2xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/50" aria-labelledby="skill-set-title">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 id="skill-set-title" className="text-sm font-semibold">{flow.picking ? 'Add skills from library' : `Add ${flow.preset?.name ?? `${flow.skillIds.length} selected skills`}`}</h2>
        <Button size="sm" variant="ghost" disabled={apply.isPending} onClick={() => dialog.current?.close()}>Close</Button>
      </header>
      <div className="space-y-4 p-5">
        {!apply.isSuccess && <>
          {agentSlug ? <p className="text-xs text-muted-foreground">Add to <strong className="text-foreground">{agents.data?.find(agent => agent.slug === agentSlug)?.name ?? agentSlug}</strong></p> : <>
            {project ? <p className="text-xs text-muted-foreground">Add to <strong className="text-foreground">{project.name}</strong><span className="mt-1 block break-all font-mono text-[11px]">{project.path}</span></p>
              : <label className="block space-y-1 text-xs">Destination<span className="relative block"><select className={`${nativeSelectClass} w-full pr-8`} value={projectPath} disabled={apply.isPending} onChange={event => { setProjectPath(event.target.value); setTargetAgents([]); apply.reset() }}><option value="">Personal agent folders</option>{projects.data?.map(item => <option key={item.path} value={item.path}>{item.name}</option>)}</select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /></span></label>}
            {projectPath && <p className="text-xs text-muted-foreground">Adds to this project's shared .agents/skills folder. Select agents below only if you also want copies in their project folders.</p>}
            <fieldset disabled={apply.isPending} className="space-y-2"><legend className="mb-2 text-xs font-medium">{projectPath ? 'Additional project agent folders (optional)' : 'Agents'}</legend><div className="grid grid-cols-2 gap-2">{availableAgents.map(agent => <label key={agent.slug} className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-xs"><input type="checkbox" checked={targetAgents.includes(agent.slug)} onChange={event => { setTargetAgents(event.target.checked ? [...targetAgents, agent.slug] : targetAgents.filter(slug => slug !== agent.slug)); apply.reset() }} />{agent.name}</label>)}</div></fieldset>
          </>}
          {!projectPath && !targetAgents.length && <p className="text-xs text-muted-foreground">Choose the agents that should receive these skills.</p>}
          {flow.picking && <div className="space-y-3">
            <input type="search" autoFocus aria-label="Search library skills" placeholder="Search library skills…" value={search} onChange={event => setSearch(event.target.value)} className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            {candidates.isFetching ? <p role="status" className="text-xs text-muted-foreground">Checking library and destinations…</p> : candidates.data && <>
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50" disabled={!selectable.length} onClick={() => setFlow({ ...flow, skillIds: selectable.every(skill => picked.includes(skill.id)) ? flow.skillIds.filter(id => !selectable.some(skill => skill.id === id)) : [...new Set([...picked, ...selectable.map(skill => skill.id)])].slice(0, 200) })}>{selectable.length > 0 && selectable.every(skill => picked.includes(skill.id)) ? 'Clear selection in this view' : 'Select available in this view'}</button>
              <div className="max-h-64 space-y-1 overflow-auto">
                {visible.map(skill => {
                  const state = pickerState(skill.id)
                  return <label key={skill.id} className="flex items-start gap-3 rounded-lg border border-border/50 p-3 hover:bg-muted/30">
                    <input type="checkbox" className="mt-1" disabled={state !== 'add' || (!picked.includes(skill.id) && picked.length >= 200)} checked={picked.includes(skill.id)} onChange={event => setFlow({ ...flow, skillIds: event.target.checked ? [...picked, skill.id] : picked.filter(id => id !== skill.id) })} />
                    <span className="min-w-0 flex-1"><span className="block text-xs font-medium">{skill.name}</span>{skill.description && <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">{skill.description}</span>}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{{ add: 'Available', installed: 'Added', conflict: 'Conflict', unavailable: 'Unavailable' }[state]}</span>
                  </label>
                })}
                {!visible.length && <p className="py-4 text-xs text-muted-foreground">{library.length ? 'No matching skills.' : 'Your library is empty. Import skills into Library first.'}</p>}
              </div>
              <p className="text-xs text-muted-foreground">{picked.length} selected{picked.length >= 200 ? ' · Maximum 200 per addition' : ''}. Existing skills stay unchanged.</p>
              <Button size="sm" disabled={!picked.length} onClick={() => setFlow({ ...flow, skillIds: picked, picking: false })}>Review {picked.length} selected skills</Button>
            </>}
          </div>}
          {flow.picking === false && <Button size="sm" variant="ghost" disabled={apply.isPending} onClick={() => { setFlow({ ...flow, picking: true }); apply.reset() }}>Change selection</Button>}
          {review.isFetching && <p role="status" className="text-xs text-muted-foreground">Checking existing skills…</p>}
          {review.data && !review.isFetching && <div className="space-y-3 rounded-xl border border-border p-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs"><span className="font-medium">{counts.add} to add</span><span className="text-muted-foreground">{counts.installed} already installed</span></div>
            {counts.conflict > 0 && <p className="text-xs text-amber-600 dark:text-amber-400">{counts.conflict} existing entries differ. They will be kept.</p>}
            {counts.unavailable > 0 && <p className="text-xs text-muted-foreground">{counts.unavailable} entries have unavailable sources and will be skipped.</p>}
            <details className="text-xs"><summary className="cursor-pointer text-muted-foreground hover:text-foreground">View skills and file locations</summary><ul className="mt-2 max-h-48 space-y-2 overflow-auto">{review.data.rows.map(row => <li key={`${row.skillId}:${row.destination}`}><span className="font-medium">{row.name}</span> · {{ add: 'Add', installed: 'Already installed', conflict: 'Keep existing', unavailable: 'Unavailable' }[row.state]}<code className="mt-0.5 block break-all text-[10px] text-muted-foreground">{row.destination}</code></li>)}</ul></details>
            <Button size="sm" disabled={apply.isPending || !counts.add || !!review.error || apply.isError} onClick={() => apply.mutate()}>{apply.isPending ? 'Adding…' : counts.add ? 'Add missing skills' : 'Nothing to add'}</Button>
            {scoped && flow.preset && (counts.installed > 0 || counts.conflict > 0) && <Button size="sm" variant="ghost" disabled={apply.isPending} onClick={() => startRemoval(flow.preset!)}>Remove installed skills…</Button>}
          </div>}
        </>}
        {apply.data && <div role="status" className="space-y-3"><p className="text-sm font-medium">{apply.data.failed.length ? 'Some skills could not be added' : 'Skills added'}</p><p className="text-xs text-muted-foreground">Added {apply.data.added.length} · Kept or skipped {apply.data.skipped}</p>{apply.data.failed.map(item => <p key={item.destination} className="break-all text-xs text-destructive">{item.destination}: {item.reason}</p>)}<Button size="sm" onClick={() => dialog.current?.close()}>Done</Button></div>}
        {error && <div role="alert" className="space-y-2 text-xs text-destructive"><p>{error.message}</p><Button size="sm" variant="outline" disabled={apply.isPending || review.isFetching} onClick={() => { apply.reset(); void (flow.picking ? candidates.refetch() : review.refetch()) }}>Check again</Button></div>}
      </div>
    </dialog>}
    {removing && <SkillSetRemovalDialog preset={removing} target={{ agents: agentSlug ? [agentSlug] : [], ...(project ? { projectPath: project.path } : {}) }} destinationName={project?.name ?? agents.data?.find(agent => agent.slug === agentSlug)?.name ?? agentSlug!} onClose={() => setRemoving(null)} />}
  </>
}
