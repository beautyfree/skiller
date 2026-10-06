import type { ComponentProps } from 'react';
import { ContextMenu } from '@base-ui/react/context-menu';
import { Copy, ExternalLink } from 'lucide-react';
import { openUrl } from '@/mainview/lib/native';
import { useToast } from './ToastProvider';

/** Shared external link: primary click opens it, secondary click exposes its URL. */
export function AppLink({ href, children, onClick, ...props }: ComponentProps<'a'>) {
  const { toast } = useToast();
  if (!href || !/^https?:\/\//i.test(href)) return <a href={href} {...props}>{children}</a>;
  const itemClass = 'flex min-h-8 cursor-default items-center gap-2 rounded-lg px-2.5 py-1.5 outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground';
  return <ContextMenu.Root>
    <ContextMenu.Trigger render={<a {...props} href={href} onClick={event => { onClick?.(event); if (event.defaultPrevented) return; event.preventDefault(); openUrl(href); }} />}>
      {children}
    </ContextMenu.Trigger>
    <ContextMenu.Portal>
      <ContextMenu.Positioner className="z-[150] outline-none" sideOffset={4}>
        <ContextMenu.Popup className="min-w-40 rounded-xl border border-border bg-popover p-1.5 text-sm text-popover-foreground shadow-lg outline-none">
          <ContextMenu.Item className={itemClass} onClick={() => { void navigator.clipboard.writeText(href).then(() => toast('Link copied'), () => toast('Could not copy link', 'destructive')); }}><Copy className="size-3.5" aria-hidden />Copy link</ContextMenu.Item>
          <ContextMenu.Item className={itemClass} onClick={() => openUrl(href)}><ExternalLink className="size-3.5" aria-hidden />Open in browser</ContextMenu.Item>
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Portal>
  </ContextMenu.Root>;
}
