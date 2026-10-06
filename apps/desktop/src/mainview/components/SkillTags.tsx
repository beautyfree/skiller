import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Settings2 } from 'lucide-react'
import { invoke } from '@/mainview/lib/native'
import { Button } from './ui/button'

export type TaggedSkill = { id: string; name: string; canonical_path: string; userTags?: string[] }
const chipClass = 'rounded-full border px-2.5 py-1 text-[11px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring'
const inputClass = 'w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

function TagDialog({ title, pending, close, children }: { title: string; pending: boolean; close: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal(); dialog.current?.querySelector<HTMLInputElement>('input')?.focus() }, [])
  return <dialog ref={dialog} onClose={close} onCancel={event => { if (pending) event.preventDefault() }} aria-labelledby="tags-dialog-title" className="m-auto w-[min(30rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-auto rounded-2xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/50">
    <header className="flex items-center justify-between border-b border-border px-5 py-4"><h2 id="tags-dialog-title" className="text-sm font-semibold">{title}</h2><Button size="sm" variant="ghost" disabled={pending} onClick={() => dialog.current?.close()}>Close</Button></header>
    <div className="space-y-4 p-5">{children}</div>
  </dialog>
}

export function SkillTagEditor({ skills, allTags, onClose }: { skills: TaggedSkill[]; allTags: string[]; onClose: () => void }) {
  const client = useQueryClient()
  const [input, setInput] = useState('')
  const [adds, setAdds] = useState<string[]>([])
  const [removes, setRemoves] = useState<string[]>([])
  const [inputError, setInputError] = useState('')
  const counts = new Map<string, number>()
  for (const skill of skills) for (const tag of skill.userTags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  const save = useMutation({
    mutationFn: () => invoke('edit_skill_tags', { skills: skills.map(skill => ({ id: skill.id, sourcePath: skill.canonical_path })), add: adds, remove: removes }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['skill-tags'] }); onClose() },
  })
  function addTag(raw: string) {
    const tag = raw.trim()
    if (!tag) return
    if (tag.length > 64 || /[\x00-\x1f\x7f]/.test(tag)) { setInputError('Use a tag of up to 64 characters without line breaks.'); return }
    if (adds.length >= 32 && !adds.includes(tag)) { setInputError('Add at most 32 tags at a time.'); return }
    setAdds(previous => [...new Set([...previous, tag])])
    setRemoves(previous => previous.filter(item => item !== tag))
    setInput(''); setInputError('')
  }
  const suggestions = allTags.filter(tag => !adds.includes(tag) && !counts.has(tag) && tag.toLowerCase().includes(input.trim().toLowerCase())).slice(0, 8)
  return <TagDialog title={skills.length === 1 ? `Tags · ${skills[0]!.name}` : `Tags · ${skills.length} selected skills`} pending={save.isPending} close={onClose}>
    <p className="text-xs text-muted-foreground">Organize these skills with labels. Tags are saved on this computer.</p>
    <fieldset disabled={save.isPending} className="space-y-4">
      {!!counts.size && <div><p className="mb-2 text-xs font-medium">Current tags · click to remove from this selection</p><div className="flex flex-wrap gap-2">{[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([tag, count]) => <button type="button" key={tag} aria-pressed={removes.includes(tag)} onClick={() => { setRemoves(previous => previous.includes(tag) ? previous.filter(item => item !== tag) : [...previous, tag]); setAdds(previous => previous.filter(item => item !== tag)) }} className={`${chipClass} ${removes.includes(tag) ? 'border-destructive/40 text-destructive line-through' : 'border-border text-muted-foreground hover:text-foreground'}`}>{tag} <span className="opacity-60">{count}/{skills.length}</span></button>)}</div></div>}
      <form onSubmit={event => { event.preventDefault(); addTag(input) }} className="flex gap-2"><input autoFocus aria-label="New tag" placeholder="Add a tag…" value={input} onChange={event => { setInput(event.target.value); setInputError('') }} className={inputClass} /><Button size="sm" variant="outline" type="submit" disabled={!input.trim()}>Add tag</Button></form>
      {!!suggestions.length && <div className="flex flex-wrap gap-2" aria-label="Suggested tags">{suggestions.map(tag => <button key={tag} type="button" className={`${chipClass} border-border text-muted-foreground hover:text-foreground`} onClick={() => addTag(tag)}>{tag}</button>)}</div>}
      {!!adds.length && <div><p className="mb-2 text-xs font-medium">Add to all selected skills</p><div className="flex flex-wrap gap-2">{adds.map(tag => <button key={tag} type="button" aria-label={`Cancel adding ${tag}`} className={`${chipClass} inline-flex items-center gap-1 border-primary/30 text-foreground`} onClick={() => setAdds(previous => previous.filter(item => item !== tag))}>{tag}<X className="size-3" aria-hidden /></button>)}</div></div>}
    </fieldset>
    {(save.error || inputError) && <p role="alert" className="text-xs text-destructive">{save.error?.message ?? inputError}</p>}
    <Button size="sm" disabled={save.isPending || (!adds.length && !removes.length) || skills.length > 200} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save tags'}</Button>
    {skills.length > 200 && <p role="alert" className="text-xs text-destructive">Select at most 200 skills per edit.</p>}
  </TagDialog>
}

export function SkillTagFilter({ allTags, selected, untagged, onChange }: { allTags: string[]; selected: string[]; untagged: boolean; onChange: (tags: string[], untagged: boolean) => void }) {
  const [manage, setManage] = useState(false)
  const active = 'bg-primary/15 text-primary'
  const idle = 'bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground'
  const filterChip = 'max-w-48 shrink-0 truncate rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  return <section aria-label="Tag filters" className="flex min-w-0 items-center gap-2">
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
      <button type="button" aria-pressed={!selected.length && !untagged} className={`${filterChip} ${!selected.length && !untagged ? active : idle}`} onClick={() => onChange([], false)}>All tags</button>
      <button type="button" aria-pressed={untagged} className={`${filterChip} ${untagged ? active : idle}`} onClick={() => onChange(selected, !untagged)}>Untagged</button>
      {!!allTags.length && <span className="mx-1 h-3 shrink-0 border-l border-border" aria-hidden />}
      {allTags.map(tag => <button key={tag} type="button" title={tag} aria-pressed={selected.includes(tag)} className={`${filterChip} ${selected.includes(tag) ? active : idle}`} onClick={() => onChange(selected.includes(tag) ? selected.filter(item => item !== tag) : [...selected, tag], untagged)}>{tag}</button>)}
    </div>
    {!!allTags.length && <Button type="button" variant="ghost" size="icon-xs" title="Manage tags" aria-label="Manage tags" onClick={() => setManage(true)}><Settings2 className="size-3.5" aria-hidden /></Button>}
    {manage && <ManageTags allTags={allTags} onClose={() => setManage(false)} onRename={(oldName, newName) => onChange(selected.flatMap(tag => tag === oldName ? (newName ? [newName] : []) : [tag]), untagged)} />}
  </section>
}

function ManageTags({ allTags, onClose, onRename }: { allTags: string[]; onClose: () => void; onRename: (oldName: string, newName: string | null) => void }) {
  const client = useQueryClient()
  const [names, setNames] = useState<Record<string, string>>({})
  const rename = useMutation({
    mutationFn: (params: { oldName: string; newName: string | null }) => invoke('rename_skill_tag', params),
    onSuccess: async (_, params) => { onRename(params.oldName, params.newName); await client.invalidateQueries({ queryKey: ['skill-tags'] }) },
  })
  return <TagDialog title="Manage tags" pending={rename.isPending} close={onClose}>
    <p className="text-xs text-muted-foreground">Rename merges matching tags across the library. Remove deletes only the tag; skills and instructions stay unchanged.</p>
    <div className="space-y-2">{allTags.map(tag => <div key={tag} className="flex items-center gap-2"><input aria-label={`Rename ${tag}`} value={names[tag] ?? tag} maxLength={64} disabled={rename.isPending} className={inputClass} onChange={event => setNames(previous => ({ ...previous, [tag]: event.target.value }))} /><Button size="sm" variant="outline" disabled={rename.isPending || !(names[tag] ?? '').trim() || names[tag]?.trim() === tag} onClick={() => rename.mutate({ oldName: tag, newName: names[tag]!.trim() })}>Rename</Button><Button size="sm" variant="ghost" disabled={rename.isPending} aria-label={`Remove tag ${tag}`} onClick={() => rename.mutate({ oldName: tag, newName: null })}><X className="size-3.5" aria-hidden /></Button></div>)}</div>
    {!allTags.length && <p className="text-xs text-muted-foreground">No tags left.</p>}
    {rename.error && <p role="alert" className="text-xs text-destructive">{rename.error.message}</p>}
  </TagDialog>
}

export function SkillTagBadges({ tags = [] }: { tags?: string[] }) {
  return tags.length ? <div className="mt-2 flex w-full min-w-0 items-center gap-1 overflow-x-auto" aria-label={`Tags: ${tags.join(', ')}`}>
    {tags.map(tag => <span key={tag} title={tag} className="max-w-40 shrink-0 truncate rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">{tag}</span>)}
  </div> : null
}


export function InlineSkillTags({ skill, disabled = false }: { skill: TaggedSkill; disabled?: boolean }) {
  const client = useQueryClient()
  const [error, setError] = useState('')
  const tags = skill.userTags ?? []
  const edit = useMutation({
    mutationFn: (change: { add: string[]; remove: string[] }) => invoke('edit_skill_tags', { skills: [{ id: skill.id, sourcePath: skill.canonical_path }], ...change }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['skill-tags'] })
      setError('')
    },
    onError: failure => { setError(failure.message) },
  })
  const busy = disabled || edit.isPending
  if (!tags.length) return null
  return <div className="min-w-0" onClick={event => event.stopPropagation()}>
    <div className="flex min-h-5 items-center gap-1 overflow-x-auto" aria-label={`Tags for ${skill.name}`}>
      {tags.map(tag => <span key={tag} className="group/tag inline-flex shrink-0 items-center rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary"><span className="max-w-40 truncate" title={tag}>{tag}</span><button type="button" aria-label={`Remove ${tag} from ${skill.name}`} disabled={busy} onClick={() => edit.mutate({ add: [], remove: [tag] })} className="ml-0 inline-flex h-3.5 w-0 items-center justify-center overflow-hidden rounded-full opacity-0 transition-[width,margin,opacity] duration-150 ease-out group-hover/tag:ml-0.5 group-hover/tag:w-3.5 group-hover/tag:opacity-70 group-focus-within/tag:ml-0.5 group-focus-within/tag:w-3.5 group-focus-within/tag:opacity-100 hover:!opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary motion-reduce:transition-none disabled:opacity-30"><X className="size-2.5 shrink-0" aria-hidden /></button></span>)}

    </div>
    {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
  </div>
}
