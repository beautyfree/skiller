import { useEffect, useState, type ReactNode } from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/mainview/lib/utils"

/**
 * shadcn's Base UI tooltip composition. Keeping this provider at the app root
 * gives every tooltip the same delayed, keyboard-accessible behaviour.
 */
export function TooltipProvider({
  // Match Linear's deliberate hover behaviour: a tooltip explains an icon,
  // it should not compete with ordinary pointer movement through a list.
  delay = 700,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />
}

export function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

export function TooltipContent({
  className,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "collisionAvoidance"
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={8}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-lg border border-border/70 bg-popover px-2 py-1 text-[11px] font-medium leading-[1.35] text-popover-foreground shadow-[0_0.5px_1px_1px_rgb(0_0_0_/_0.22)]",
            "data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
            "data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-[0.98] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.98] data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-[0.98]",
            className,
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow
            className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] border-b border-r border-border/70 bg-popover fill-popover data-[side=bottom]:top-1 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5"
          />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

/**
 * Compatibility wrapper for the existing concise call sites. New components
 * may use TooltipTrigger and TooltipContent directly when composition helps.
 */
export function Tooltip({
  content,
  children,
  side = "bottom",
  className,
}: {
  content: ReactNode
  children: ReactNode
  side?: "top" | "right" | "bottom" | "left"
  className?: string
}) {
  const [open, setOpen] = useState(false)

  // A tooltip is anchored to a concrete list row. Once that row starts moving,
  // keeping the portal open leaves the explanation detached from its item.
  // Listen only while this particular tooltip is open, so a long virtualized
  // list does not add one scroll listener per row.
  useEffect(() => {
    if (!open) return
    const dismiss = () => setOpen(false)
    document.addEventListener("scroll", dismiss, true)
    window.addEventListener("wheel", dismiss, { passive: true })
    return () => {
      document.removeEventListener("scroll", dismiss, true)
      window.removeEventListener("wheel", dismiss)
    }
  }, [open])

  return (
    <TooltipPrimitive.Root data-slot="tooltip" open={open} onOpenChange={setOpen}>
      <TooltipPrimitive.Trigger data-slot="tooltip-trigger" render={<span className="inline-flex" />}>
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipContent side={side} className={className}>
        {content}
      </TooltipContent>
    </TooltipPrimitive.Root>
  )
}
