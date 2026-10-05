import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@/mainview/lib/native'
import { Button } from './ui/button'
import type { AppRPCSchema, AgentConfigJson } from '@/shared/rpc-schema'

type Draft = AppRPCSchema['bun']['requests']['save_custom_agent']['params']
const empty: Draft = { name: '', globalPath: '', projectPath: '', command: '', marker: '' }

export function CustomAgentsSettings() {
  const client = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [removeSlug, setRemoveSlug] = useState<string | null>(null)
  const agents = useQuery({ queryKey: ['all-agents'], queryFn: () => invoke('list_agents') })
  const invalidate = async () => {
    await Promise.all(['agents', 'all-agents', 'skills', 'project-skills'].map(key => client.invalidateQueries({ queryKey: [key] })))
  }
  const save = useMutation({
    mutationFn: (input: Draft) => invoke('save_custom_agent', input),
    onSuccess: async () => { setDraft(null); await invalidate() },
  })
  const remove = useMutation({
    mutationFn: (slug: string) => invoke('remove_custom_agent', { slug }),
    onSuccess: async () => { setRemoveSlug(null); await invalidate() },
  })
  function edit(agent: AgentConfigJson) {
    save.reset()
    setDraft({ slug: agent.slug, name: agent.name, globalPath: agent.global_paths[0] ?? '', projectPath: agent.project_skills_dir ?? '', command: agent.cli_command ?? '', marker: agent.detect_paths[0] ?? '' })
  }
  return <section className="rounded-2xl p-5 glass-panel settings-panel space-y-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-medium">Custom agents</h2>
        <p className="mt-1 text-xs text-muted-foreground">Connect an agent that reads SKILL.md packages.</p>
      </div>
      <Button size="sm" variant="outline" disabled={save.isPending || remove.isPending} onClick={() => { save.reset(); setDraft({ ...empty }); setRemoveSlug(null) }}>Add agent</Button>
    </div>
    {agents.isError && <p role="alert" className="text-xs text-destructive">Could not load agents. <button className="underline" onClick={() => agents.refetch()}>Retry</button></p>}
    {agents.data?.filter(agent => agent.slug.startsWith('custom-')).map(agent => <div key={agent.slug} className="rounded-xl glass-inset p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{agent.name}</span>
        <span className="text-xs text-muted-foreground">{agent.detected ? 'Detected' : 'Not detected'}</span>
      </div>
      <p className="text-xs font-mono break-all text-muted-foreground">{agent.global_paths[0]}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" disabled={save.isPending || remove.isPending} onClick={() => edit(agent)}>Edit</Button>
        <Button size="sm" variant="ghost" disabled={save.isPending || remove.isPending} onClick={() => { remove.reset(); setRemoveSlug(agent.slug) }}>Remove</Button>
      </div>
      {removeSlug === agent.slug && <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Remove this registration? Installed skills will stay in their folders.</p>
        <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(agent.slug)}>Remove registration</Button>
        <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => setRemoveSlug(null)}>Cancel</Button>
      </div>}
    </div>)}
    {remove.isError && <p role="alert" className="text-xs text-destructive">{remove.error.message}</p>}
    {draft && <form className="space-y-3" onSubmit={event => { event.preventDefault(); save.mutate(draft) }}>
      {([
        ['name', 'Agent name', 'My agent'],
        ['globalPath', 'Personal skills folder', '~/.my-agent/skills'],
        ['projectPath', 'Project skills path (optional)', '.my-agent/skills'],
        ['command', 'CLI command (optional)', 'my-agent'],
        ['marker', 'Agent configuration marker (optional)', '~/.my-agent/config.json'],
      ] as const).map(([key, label, placeholder]) => <label key={key} className="block space-y-1 text-xs">
        <span>{label}</span>
        <input value={draft[key]} required={key === 'name' || key === 'globalPath'} disabled={save.isPending} placeholder={placeholder} onChange={event => setDraft({ ...draft, [key]: event.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </label>)}
      <p className="text-xs text-muted-foreground">Skiller detects the agent by its command or configuration marker. A skills folder alone does not count as an installed agent. Changing paths does not move existing skills.</p>
      {draft.globalPath && <p className="text-xs text-muted-foreground break-all">Personal destination: <code>{draft.globalPath.replace(/[\\/]+$/, '')}/&lt;skill&gt;/SKILL.md</code>{draft.projectPath && <> · Project: <code>&lt;project&gt;/{draft.projectPath}/&lt;skill&gt;/SKILL.md</code></>}</p>}
      {save.isError && <p role="alert" className="text-xs text-destructive">{save.error.message}</p>}
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save agent'}</Button>
        <Button size="sm" type="button" variant="ghost" disabled={save.isPending} onClick={() => setDraft(null)}>Cancel</Button>
      </div>
    </form>}
  </section>
}
