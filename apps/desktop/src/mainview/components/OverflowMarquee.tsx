import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { cn } from '@/mainview/lib/utils'

type OverflowMarqueeProps = {
  children: string
  active: boolean
  className?: string
}

/** Reveals clipped list text only while the row is being intentionally inspected. */
export function OverflowMarquee({ children, active, className }: OverflowMarqueeProps) {
  const viewportRef = useRef<HTMLSpanElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [measurement, setMeasurement] = useState({ overflow: false, width: 0 })

  useEffect(() => {
    const measure = () => {
      const viewport = viewportRef.current
      const text = measureRef.current
      if (!viewport || !text) return
      const width = Math.ceil(text.getBoundingClientRect().width)
      const overflow = width > viewport.clientWidth + 1
      setMeasurement((previous) => previous.overflow === overflow && previous.width === width ? previous : { overflow, width })
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (viewportRef.current) observer?.observe(viewportRef.current)
    if (measureRef.current) observer?.observe(measureRef.current)
    return () => observer?.disconnect()
  }, [children])

  const shouldScroll = active && measurement.overflow
  const duration = Math.min(14, Math.max(5, measurement.width / 28))
  const style = {
    '--skiller-marquee-distance': `${measurement.width + 20}px`,
    '--skiller-marquee-duration': `${duration}s`,
  } as CSSProperties

  return (
    <span ref={viewportRef} className={cn('relative block min-w-0 overflow-hidden whitespace-nowrap', className)} title={measurement.overflow ? children : undefined}>
      <span ref={measureRef} aria-hidden className="pointer-events-none absolute inline-block invisible whitespace-nowrap">{children}</span>
      {shouldScroll ? (
        <span className="skiller-overflow-marquee-track" style={style}>
          <span>{children}</span>
          <span aria-hidden>{children}</span>
        </span>
      ) : <span className="block truncate">{children}</span>}
    </span>
  )
}
