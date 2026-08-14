import { Toast as ToastPrimitive } from '@base-ui/react/toast'
import { createContext, useCallback, useContext, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { buttonVariants } from '@/mainview/components/ui/button'
import { cn } from '@/mainview/lib/utils'

type ToastVariant = 'default' | 'destructive'

type ToastMessage = string | {
  title: string
  description?: string
}

type ToastAction = {
  label: string
  onClick: () => void
  /** Keep an important notice visible after its action changes the view. */
  closeOnClick?: boolean
}

type ToastOptions = {
  /** Explicit duration for notices that need time to be read. */
  timeoutMs?: number
}

const ToastContext = createContext<{
  toast: (message: ToastMessage, variant?: ToastVariant, action?: ToastAction, options?: ToastOptions) => string
  dismiss: (toastId: string) => void
} | null>(null)

const toastManager = ToastPrimitive.createToastManager()
const AUTO_DISMISS_MS = 4_500
const MAX_DISMISS_MS = 12_000

function getToastDismissMs(message: ToastMessage): number {
  const text = typeof message === 'string' ? message : `${message.title} ${message.description ?? ''}`
  return Math.min(MAX_DISMISS_MS, AUTO_DISMISS_MS + text.trim().length * 35)
}

/** Shadcn's current Base UI Toast composition, adapted to Skiller's semantic theme tokens. */
function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager()

  return toasts.map((item) => (
    <ToastPrimitive.Root
      key={item.id}
      toast={item}
      className={cn(
        'pointer-events-auto absolute bottom-0 right-0 w-full origin-bottom rounded-2xl border bg-popover text-popover-foreground shadow-(--ds-shadow-layered-medium) outline-none',
        '[--gap:0.75rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--toast-offset-y)*-1+calc(var(--toast-index)*var(--gap)*-1)+var(--toast-swipe-movement-y))] [--peek:0.75rem] [--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))]',
        'h-(--height) [transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--peek))-(var(--shrink)*var(--height))))_scale(var(--scale))] [transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms]',
        'data-expanded:h-(--toast-height) data-expanded:[transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))] data-limited:opacity-0 data-starting-style:[transform:translateY(150%)] [&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:[transform:translateY(150%)]',
        'data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))] data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))] data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]',
        item.type === 'destructive' && 'border-destructive/25 bg-destructive/10 text-destructive',
      )}
    >
      <ToastPrimitive.Content className="flex h-full items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          {item.title && <ToastPrimitive.Title className="text-sm font-semibold leading-5" />}
          {item.description && <ToastPrimitive.Description className={cn('text-sm leading-5 text-muted-foreground', item.title && 'mt-0.5')} />}
        </div>
        {item.actionProps && (
          <ToastPrimitive.Action
            className="shrink-0"
            {...item.actionProps}
          />
        )}
        <ToastPrimitive.Close
          aria-label="Dismiss notification"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <X className="size-3.5" aria-hidden="true" />
        </ToastPrimitive.Close>
      </ToastPrimitive.Content>
    </ToastPrimitive.Root>
  ))
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const toast = useCallback((message: ToastMessage, variant: ToastVariant = 'default', action?: ToastAction, options?: ToastOptions) => {
    const content = typeof message === 'string' ? { description: message } : message
    let id = ''
    id = toastManager.add({
      ...content,
      type: variant,
      timeout: options?.timeoutMs ?? getToastDismissMs(message),
      ...(action ? {
        actionProps: {
          children: action.label,
          className: buttonVariants({ variant: 'default', size: 'xs' }),
          onClick: () => {
            action.onClick()
            if (action.closeOnClick !== false) toastManager.close(id)
          },
        },
      } : {}),
    })
    return id
  }, [])

  const dismiss = useCallback((toastId: string) => {
    toastManager.close(toastId)
  }, [])

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      <ToastPrimitive.Provider toastManager={toastManager} limit={3}>
        {children}
        <ToastPrimitive.Portal>
          <ToastPrimitive.Viewport className="pointer-events-none fixed bottom-4 right-4 z-[100] w-[min(24rem,calc(100vw-2rem))] outline-none" aria-label="Notifications">
            <ToastList />
          </ToastPrimitive.Viewport>
        </ToastPrimitive.Portal>
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
