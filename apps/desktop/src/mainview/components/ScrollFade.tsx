import { useEffect, useState, type RefObject } from 'react'
import { cn } from '@/mainview/lib/utils'

type ScrollFadeProps = {
	viewportRef: RefObject<HTMLElement | null>
	surface?: 'card' | 'sidebar'
	className?: string
}

/**
 * A quiet Linear-style cue that content continues beyond a scroll viewport.
 * It is absent when there is nothing to reveal, so it never decorates a static panel.
 */
export function ScrollFade({ viewportRef, surface = 'card', className }: ScrollFadeProps) {
	const [hasContentAbove, setHasContentAbove] = useState(false)

	useEffect(() => {
		const viewport = viewportRef.current
		if (!viewport) return

		let frame = 0
		const update = () => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(() => {
				setHasContentAbove(viewport.scrollTop > 2)
			})
		}

		update()
		viewport.addEventListener('scroll', update, { passive: true })
		const observer = new ResizeObserver(update)
		observer.observe(viewport)
		if (viewport.firstElementChild) observer.observe(viewport.firstElementChild)

		return () => {
			cancelAnimationFrame(frame)
			viewport.removeEventListener('scroll', update)
			observer.disconnect()
		}
	}, [viewportRef])

	return (
		<span
			aria-hidden="true"
			className={cn(
				'pointer-events-none absolute inset-x-0 top-0 z-10 h-7 bg-gradient-to-b via-40% to-transparent transition-opacity duration-300 ease-out',
				surface === 'sidebar' ? 'from-sidebar/55 via-sidebar/18' : 'from-card/55 via-card/18',
				hasContentAbove ? 'opacity-100' : 'opacity-0',
				className,
			)}
		/>
	)
}
