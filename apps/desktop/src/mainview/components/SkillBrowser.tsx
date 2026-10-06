import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type RefObject } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip } from './ui/tooltip';
import { cn } from '@/mainview/lib/utils';

export type SkillViewMode = 'grid' | 'list';

export function useSkillViewMode(storageKey: string, defaultMode: SkillViewMode) {
  const [viewMode, setViewMode] = useState<SkillViewMode>(() => {
    try { const saved = localStorage.getItem(storageKey); return saved === 'grid' || saved === 'list' ? saved : defaultMode; }
    catch { return defaultMode; }
  });
  useEffect(() => { try { localStorage.setItem(storageKey, viewMode); } catch { /* View remains usable without storage. */ } }, [storageKey, viewMode]);
  return [viewMode, setViewMode] as const;
}

export function SkillViewToggle({ value, onChange, disabled = false }: { value: SkillViewMode; onChange: (value: SkillViewMode) => void; disabled?: boolean }) {
  return <div role="group" aria-label="Skill view" className="mr-1 flex gap-0.5 rounded-lg border border-border/60 p-0.5">
    {(['grid', 'list'] as const).map(view => <Tooltip key={view} content={view === 'grid' ? 'Grid view' : 'List view'}><Button variant={value === view ? 'secondary' : 'ghost'} size="icon-xs" aria-label={view === 'grid' ? 'Grid view' : 'List view'} aria-pressed={value === view} disabled={disabled} onClick={() => onChange(view)}>{view === 'grid' ? <LayoutGrid className="size-3.5" /> : <List className="size-3.5" />}</Button></Tooltip>)}
  </div>;
}

export function SkillCardSurface({ selected, viewMode, className, ...props }: ComponentProps<'div'> & { selected: boolean; viewMode: SkillViewMode }) {
  return <div {...props} data-selected={selected} className={cn('skill-grid-card group relative flex cursor-pointer flex-col overflow-hidden rounded-xl transition-[border-color,box-shadow] duration-150', viewMode === 'grid' && 'h-full', className)} />;
}

export function useSkillGridColumns(scrollRef: RefObject<HTMLDivElement | null>, viewMode: SkillViewMode, ready = true) {
  const [columns, setColumns] = useState(1);
  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport || !ready) return;
    const measure = () => setColumns(viewMode === 'grid' ? Math.max(1, Math.floor((viewport.clientWidth + 12) / 384)) : 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [scrollRef, viewMode, ready]);
  return columns;
}

export function SkillDetailFrame({ open, overlay, onClose, children }: { open: boolean; overlay: boolean; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const lastContent = useRef(children);
  const close = useRef(onClose);
  const returnFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { close.current = onClose; if (open) lastContent.current = children; });
  useLayoutEffect(() => {
    const panel = dialog.current;
    if (!overlay || !panel) return;
    if (open && panel.open) return;
    if (!open && !panel.open) return;
    if (open) {
      returnFocus.current = document.activeElement as HTMLElement;
      panel.show();
    }
    const finish = () => {
      if (!open) {
        const hadFocus = panel.contains(document.activeElement);
        panel.close();
        if (hadFocus && returnFocus.current?.isConnected) returnFocus.current.focus();
      }
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    const frames = [{ opacity: 0, transform: 'translateX(24px)' }, { opacity: 1, transform: 'translateX(0)' }];
    const animation = panel.animate(open ? frames : [...frames].reverse(), { duration: open ? 220 : 160, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' });
    animation.finished.then(() => { finish(); animation.cancel(); }).catch(() => {});
    return () => animation.cancel();
  }, [open, overlay]);
  useEffect(() => {
    if (!overlay || !open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (document.querySelector('dialog:modal') || target.closest('[data-slot="dropdown-menu-content"]')) return;
      if (!dialog.current?.contains(target) && !target.closest('.skill-grid-card')) close.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog:modal, [data-slot="dropdown-menu-content"]')) { event.preventDefault(); close.current(); }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown); };
  }, [open, overlay]);
  if (!overlay) return open ? <div className="flex min-w-0 flex-1 flex-col bg-card">{children}</div> : null;
  return <dialog ref={dialog} aria-label="Skill details" className="absolute inset-y-0 left-auto right-0 z-30 m-0 h-full max-h-none w-[min(42rem,100%)] max-w-none overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-xl">
    <div className="flex h-full min-h-0 flex-col">{open ? children : lastContent.current}</div>
  </dialog>;
}

