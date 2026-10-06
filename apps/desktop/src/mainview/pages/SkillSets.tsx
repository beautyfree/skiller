import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Layers, Plus, Puzzle, X, Upload, Download } from 'lucide-react'
import { invoke } from '@/mainview/lib/native'
import { useSkillSets } from '@/mainview/hooks/useSkillSets'
import { useSkills } from '@/mainview/hooks/useSkills'
import { Button } from '@/mainview/components/ui/button'
import { SkillPresets } from '@/mainview/components/SkillPresets'
import { useToast } from '@/mainview/components/ToastProvider'

export default function SkillSets() {
  const { id } = useParams()
  // A new route is a new editing session, including when navigating between sets.
  return <SkillSetPage key={id ?? 'index'} id={id} />
}

function SkillSetPage({ id }: { id?: string }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const { toast } = useToast()
  const [params] = useSearchParams()
  const creating = id === 'new'
  const sets = useSkillSets()
  const inventory = useSkills({ enabled: !!id })
  const preset = sets.data?.find(set => set.id === id)
  const [editing, setEditing] = useState(creating)
  const [name, setName] = useState('')
  const [members, setMembers] = useState<string[]>(() => {
    if (!creating) return []
    try {
      const values: unknown = JSON.parse(params.get('skills') ?? '[]')
      return Array.isArray(values) && values.length <= 200 && values.every(value => typeof value === 'string') ? [...new Set(values)] : []
    } catch { return [] }
  })
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [importPreview, setImportPreview] = useState<{ reviewId: string; name: string; count: number; added: number; reused: number } | null>(null)
  const previewImport = useMutation({ mutationFn: () => invoke('preview_import_skill_pack'), onSuccess: setImportPreview })
  const importPack = useMutation({
    mutationFn: () => invoke('import_skill_pack', { reviewId: importPreview!.reviewId }),
    onSuccess: async saved => {
      await Promise.all(['skills', 'skill-presets', 'agents'].map(key => client.invalidateQueries({ queryKey: [key] })))
      setImportPreview(null); toast(`Imported ${saved.name}`); navigate(`/skill-sets/${saved.id}`)
    },
  })
  const exportPack = useMutation({ mutationFn: () => invoke('export_skill_pack', { id: preset!.id }), onSuccess: saved => { if (saved) toast('Pack exported') } })
  const save = useMutation({
    mutationFn: () => invoke('save_skill_preset', { ...(preset ? { id: preset.id } : {}), name, skillIds: members }),
    onSuccess: async saved => {
      await client.invalidateQueries({ queryKey: ['skill-presets'] })
      setEditing(false)
      toast(`Saved ${saved.name}`)
      navigate(`/skill-sets/${saved.id}`, { replace: creating })
    },
  })
  const remove = useMutation({
    mutationFn: () => invoke('remove_skill_preset', { id: preset!.id }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['skill-presets'] })
      toast('Pack deleted. Installed skills were kept.')
      navigate('/skill-sets', { replace: true })
    },
  })
  const memberUpdate = useMutation({
    mutationFn: (input: { skillId: string; sourcePath: string; enabled: boolean }) => invoke('set_skill_preset_member', { id: preset!.id, ...input }),
    onSuccess: async saved => {
      client.setQueryData(['skill-presets'], (current: typeof sets.data) => current?.map(set => set.id === saved.id ? saved : set))
      await client.invalidateQueries({ queryKey: ['skill-presets'] })
    },
    onError: async () => { await Promise.all(['skills', 'skill-presets'].map(key => client.invalidateQueries({ queryKey: [key] }))) },
  })
  const busy = save.isPending || remove.isPending || memberUpdate.isPending || previewImport.isPending || importPack.isPending || exportPack.isPending
  const local = (inventory.data ?? []).filter(skill => !skill.collection)
  const options = [
    ...local.map(skill => ({ id: skill.id, name: skill.name, description: skill.description, sourcePath: skill.canonical_path, available: !preset?.skills.some(ref => ref.id === skill.id && ref.sourcePath !== skill.canonical_path) })),
    ...(preset?.skills.filter(ref => !local.some(skill => skill.id === ref.id)).map(ref => ({ id: ref.id, name: ref.name, description: null, sourcePath: ref.sourcePath, available: false })) ?? []),
  ]
  const selectedIds = editing ? members : preset?.skills.map(ref => ref.id) ?? []
  const visible = options.filter(skill => `${skill.name} ${skill.id} ${skill.description ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
  const contents = options.filter(skill => selectedIds.includes(skill.id))
  const error = save.error || remove.error || memberUpdate.error || sets.error || inventory.error || previewImport.error || importPack.error || exportPack.error

  function edit() {
    setName(preset!.name)
    setMembers(preset!.skills.map(ref => ref.id))
    setSearch('')
    setConfirmDelete(false)
    save.reset()
    remove.reset()
    setEditing(true)
  }

  return <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
    {id && <Link to="/skill-sets" className="text-xs text-muted-foreground hover:text-foreground">← Skill packs</Link>}
    <header className="flex items-start justify-between gap-4">
      <div className="space-y-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold"><Layers className="size-5 text-muted-foreground" aria-hidden />{creating ? 'New skill pack' : preset?.name ?? 'Skill packs'}</h1>
        {!id && <p className="max-w-xl text-sm text-muted-foreground">Save skills you use together, then add them to an agent or a project.</p>}
      </div>
      {!id && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => { importPack.reset(); previewImport.mutate() }}><Upload className="size-3.5" aria-hidden />{previewImport.isPending ? 'Opening…' : 'Import pack'}</Button><Button size="sm" disabled={busy} onClick={() => navigate('/skill-sets/new')}><Plus className="size-3.5" aria-hidden />New pack</Button></div>}
      {preset && !editing && <div className="flex gap-2">
        <Button size="sm" variant="ghost" disabled={busy || inventory.isPending} onClick={() => exportPack.mutate()}><Download className="size-3.5" aria-hidden />{exportPack.isPending ? 'Exporting…' : 'Export'}</Button>
        <SkillPresets preset={preset} skills={inventory.data} disabled={busy || !inventory.data} />
        <Button size="sm" variant="outline" disabled={busy || !inventory.data} onClick={edit}><Plus className="size-3.5" aria-hidden />Add skills</Button>
      </div>}
    </header>


    {importPreview && <section aria-label="Import pack preview" className="space-y-3 rounded-xl border border-border bg-muted/15 p-4"><h2 className="text-sm font-medium">Import {importPreview.name}?</h2><p className="text-xs text-muted-foreground">{importPreview.count} skills · {importPreview.added} to add · {importPreview.reused} already in Library</p><div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => importPack.mutate()}>{importPack.isPending ? 'Importing…' : 'Import pack'}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => { setImportPreview(null); importPack.reset() }}>Cancel</Button></div></section>}
    {sets.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading packs…</p>
      : !id ? sets.data?.length ? <ul className="space-y-2" aria-label="Your skill packs">
        {sets.data.map(set => <li key={set.id}><Link to={`/skill-sets/${set.id}`} className="flex items-center gap-3 rounded-xl border border-border/60 px-4 py-3 outline-none transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring">
          <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="min-w-0 flex-1 truncate text-sm font-medium">{set.name}</span><span className="text-xs text-muted-foreground">{set.skills.length ? `${set.skills.length} skills` : 'Empty pack'}</span>
        </Link></li>)}
      </ul> : !sets.isError && <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <p className="text-sm font-medium">No packs yet</p><p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">Collect skills for a workflow, then add the pack to an agent or project.</p><Button className="mt-4" size="sm" onClick={() => navigate('/skill-sets/new')}>Create your first pack</Button>
      </div>
      : !creating && !preset ? !sets.isError && <p className="text-sm text-muted-foreground">This pack no longer exists. <Link to="/skill-sets" className="underline">View your packs</Link></p>
      : editing ? <form className="space-y-5" onSubmit={event => { event.preventDefault(); save.mutate() }}>
        <fieldset disabled={busy} className="@container space-y-8">
          <label className="flex flex-col gap-2 text-sm"><span className="font-medium">Pack name</span><input autoFocus required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="Name your pack" className="h-10 w-full rounded-md border border-border bg-muted/15 px-3 text-sm font-normal outline-none transition-colors hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring" /></label>
          <div className="grid items-start gap-4 @min-[44rem]:grid-cols-[minmax(0,1fr)_16rem]">
            <section className="min-w-0 space-y-3" aria-label="Choose library skills">
              <h2 className="text-sm font-medium">Add skills</h2><input type="search" aria-label="Find skills for this pack" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find skills…" className="h-9 w-full min-w-0 rounded-md border border-border bg-muted/15 px-3 text-sm outline-none transition-colors hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring" />
              {inventory.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading your skills…</p> : <div className="max-h-96 overflow-auto rounded-md border border-border/60">
                {visible.map(skill => <label key={skill.id} className={`flex items-start gap-3 border-b border-border/40 px-3 py-3 last:border-0 transition-colors hover:bg-muted/25 ${members.includes(skill.id) ? 'bg-muted/15' : ''}`}>
                  <input type="checkbox" className="mt-1 shrink-0 accent-current" checked={members.includes(skill.id)} disabled={(!skill.available || members.length >= 200) && !members.includes(skill.id)} onChange={event => setMembers(event.target.checked ? [...members, skill.id] : members.filter(value => value !== skill.id))} />
                  <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{skill.name}</span>{skill.description && <span className="mt-1 block text-xs text-muted-foreground line-clamp-2">{skill.description}</span>}{!skill.available && <span className="mt-1 block text-xs text-muted-foreground">Source unavailable or changed</span>}</span>
                </label>)}
                {!options.length && <p className="p-4 text-sm text-muted-foreground">Import skills into Library to add them here.</p>}
                {!!options.length && !visible.length && <p className="p-4 text-sm text-muted-foreground">No matching skills.</p>}
              </div>}
            </section>
            <section aria-label="Selected pack skills" className="min-w-0 rounded-md border border-border/60 p-4">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-medium">Skills in pack <span className="rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">{members.length}</span></h2>
              <ul className="max-h-96 space-y-2 overflow-auto">{contents.map(skill => <li key={skill.id} className="flex items-center gap-2 rounded-md bg-muted/25 px-3 py-2"><span className="min-w-0 flex-1 break-words text-xs font-medium">{skill.name}{!skill.available && <span className="mt-1 block font-normal text-muted-foreground">Source unavailable or changed</span>}</span><button type="button" aria-label={`Remove ${skill.name} from pack`} className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setMembers(members.filter(value => value !== skill.id))}><X className="size-3.5" aria-hidden /></button></li>)}</ul>
              {!members.length && <p className="text-xs text-muted-foreground">Select skills from Library.</p>}
            </section>
          </div>
          <div className="flex gap-2 border-t border-border/60 pt-4"><Button type="submit" size="sm" disabled={busy || !name.trim() || inventory.isPending || inventory.isError}>{save.isPending ? 'Saving…' : creating ? 'Create pack' : 'Save changes'}</Button><Button type="button" size="sm" variant="outline" onClick={() => { if (creating) navigate('/skill-sets'); else { setEditing(false); save.reset() } }}>Cancel</Button></div>
        </fieldset>
      </form> : preset && <>
        <section aria-label="Pack contents" className="space-y-3">
          <h2 className="text-sm font-medium">Skills in pack <span className="ml-1 text-xs tabular-nums text-muted-foreground">{preset.skills.length}</span></h2>
          {inventory.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading your skills…</p> : <ul className="divide-y divide-border/40 rounded-xl border border-border/60">
            {contents.map(skill => {
              return <li key={skill.id} className="flex items-center gap-3 bg-muted/15 px-4 py-3 transition-colors hover:bg-muted/20">
                <Puzzle className="size-4 shrink-0 text-muted-foreground" aria-hidden /><div className="min-w-0 flex-1">
                  {skill.available ? <Link className="text-sm font-medium hover:text-foreground/70" to={`/skills?skill=${encodeURIComponent(skill.id)}`}>{skill.name}</Link> : <p className="text-sm font-medium">{skill.name}</p>}
                  {skill.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{skill.description}</p>}
                  {!skill.available && <p className="mt-1 text-xs text-muted-foreground">Source unavailable or changed</p>}
                </div>
                <button type="button" aria-label={`Remove ${skill.name} from ${preset.name}`} disabled={busy || inventory.isError} onClick={() => { save.reset(); memberUpdate.mutate({ skillId: skill.id, sourcePath: skill.sourcePath, enabled: false }) }} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><X className="size-3.5" aria-hidden /></button>
              </li>
            })}
            {!contents.length && <li className="p-6 text-sm text-muted-foreground">No skills in this pack. <button type="button" disabled={busy || !inventory.data} onClick={edit} className="text-foreground hover:underline">Add skills</button></li>}
          </ul>}
          {memberUpdate.isPending && <p role="status" className="text-xs text-muted-foreground">Saving selection…</p>}
        </section>
        <div className="space-y-3 border-t border-border/60 pt-4">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setConfirmDelete(true); remove.reset() }}>Delete pack</Button>
          {confirmDelete && <div className="space-y-3 rounded-xl border border-border p-4"><p className="text-sm">Delete {preset.name}? Its installed skills will stay in their folders.</p><div className="flex gap-2"><Button size="sm" variant="destructive" disabled={busy} onClick={() => remove.mutate()}>{remove.isPending ? 'Deleting…' : 'Delete pack only'}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</Button></div></div>}
        </div>
      </>}
    {error && <p role="alert" className="text-sm text-destructive">{error.message}{sets.isError && <button className="ml-2 underline" onClick={() => sets.refetch()}>Retry</button>}{inventory.isError && <button className="ml-2 underline" onClick={() => inventory.refetch()}>Reload skills</button>}</p>}
  </div>
}
