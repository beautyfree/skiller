import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/mainview/lib/utils'

export function FileChangePreview({ diff }: { diff: string }) {
  const lines = diff.split('\n')
  const contentLines = lines.filter((line) => !line.startsWith('--- ') && !line.startsWith('+++ '))
  const viewportRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: contentLines.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 20,
    overscan: 16,
  })

  return <section className="overflow-hidden rounded-lg border border-border/70 bg-background" aria-label="Changes in this file">
    <div ref={viewportRef} className="max-h-[min(60dvh,48rem)] overflow-auto font-mono text-[11px] leading-5">
      <div className="relative min-w-max" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => {
        const line = contentLines[item.index] ?? ''
        const index = item.index
        const added = line.startsWith('+ ')
        const removed = line.startsWith('- ')
        const unchanged = line.startsWith('  ')
        const marker = added ? '+' : removed ? '−' : unchanged ? '·' : ' '
        const value = added || removed || unchanged ? line.slice(2) : line
        return <div key={`${index}:${line}`} className={cn(
          'grid min-w-max grid-cols-[1.8rem_minmax(0,1fr)] px-3',
          added && 'bg-emerald-500/12 text-emerald-950 dark:text-emerald-100',
          removed && 'bg-red-500/12 text-red-950 dark:text-red-100',
          !added && !removed && 'text-muted-foreground',
        )} style={{ position: 'absolute', left: 0, top: 0, transform: `translateY(${item.start}px)`, height: item.size }}><span className="select-none text-center opacity-70">{marker}</span><code className="whitespace-pre">{value || ' '}</code></div>
      })}
      </div>
    </div>
  </section>
}

