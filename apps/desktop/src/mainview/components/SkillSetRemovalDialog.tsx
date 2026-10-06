import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@/mainview/lib/native'
import type { SkillPresetJson, SkillPresetReviewJson } from '@/shared/rpc-schema'
import { Button } from './ui/button'

export function SkillSetRemovalDialog({ preset, target, destinationName, onClose }: {
  preset: SkillPresetJson; target: SkillPresetReviewJson['target']; destinationName: string; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const client = useQueryClient()
  const review = useQuery({
    queryKey: ['skill-set-removal', preset.id, target],
    queryFn: () => invoke('review_skill_preset_removal', { id: preset.id, target }),
    staleTime: 0, retry: false, refetchOnWindowFocus: false,
  })
  const remove = useMutation({
    mutationFn: () => invoke('remove_skill_preset_installations', { reviewId: review.data!.reviewId }),
    onSuccess: async () => { await Promise.all(['skills', 'project-skills', 'agents'].map(key => client.invalidateQueries({ queryKey: [key] }))) },
  })
  useEffect(() => { dialog.current?.showModal() }, [])
  const removable = review.data?.rows.filter(row => row.state === 'remove').length ?? 0
  const error = remove.error || review.error
  return <dialog ref={dialog} onClose={onClose} onCancel={event => { if (remove.isPending) event.preventDefault() }} aria-labelledby="remove-set-title" className="m-auto w-[min(32rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-auto rounded-2xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/50">
    <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4"><h2 id="remove-set-title" className="text-sm font-semibold">Remove {preset.name} from {destinationName}?</h2><Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => dialog.current?.close()}>Close</Button></header>
    <div className="space-y-4 p-5">
      {review.isFetching ? <p role="status" className="text-xs text-muted-foreground">Checking installed skills…</p> : !remove.data && review.data && <>
        <ul className="max-h-64 space-y-2 overflow-auto">{review.data.rows.map((row, index) => <li key={index} className="rounded-lg border border-border/50 p-3 text-xs"><div className="flex justify-between gap-3"><span className="font-medium">{row.name}</span><span className="text-muted-foreground">{row.state === 'remove' ? 'Move to Trash' : `Keep · ${row.reason}`}</span></div><code className="mt-1 block break-all text-[10px] text-muted-foreground">{row.destination}</code></li>)}</ul>
        <p className="text-xs text-muted-foreground">Copies moved to Trash can be restored. Your saved pack stays in Skiller.</p>
        <Button size="sm" variant="destructive" disabled={remove.isPending || !removable || !!error} onClick={() => remove.mutate()}>{remove.isPending ? 'Removing…' : removable ? `Remove ${removable} ${removable === 1 ? 'skill' : 'skills'}` : 'No copies to remove'}</Button>
      </>}
      {remove.data && <div role="status" className="space-y-3"><p className="text-sm font-medium">{remove.data.failed.length ? 'Some copies could not be removed' : 'Removal complete'}</p><p className="text-xs text-muted-foreground">Removed {remove.data.removed.length} · Kept {remove.data.skipped}</p>{remove.data.failed.map(row => <p key={row.destination} className="break-all text-xs text-destructive">{row.destination}: {row.reason}</p>)}<Button size="sm" onClick={() => dialog.current?.close()}>Done</Button></div>}
      {error && <div role="alert" className="space-y-2 text-xs text-destructive"><p>{error.message}</p><Button size="sm" variant="outline" disabled={remove.isPending || review.isFetching} onClick={() => { remove.reset(); void review.refetch() }}>Check again</Button></div>}
    </div>
  </dialog>
}
