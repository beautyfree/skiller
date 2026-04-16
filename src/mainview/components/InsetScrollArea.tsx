import { cn } from "@/mainview/lib/utils";
import { SCROLLBAR_EDGE_INSET } from "@/mainview/lib/shell-chrome";

type InsetScrollAreaProps = {
  className?: string;
  /**
   * When true (default), wraps children in overflow-y-auto (outlet, detail bodies).
   * When false, only applies the right gutter — the child must own scrolling (e.g. virtualized lists).
   */
  scroll?: boolean;
  scrollClassName?: string;
  children: React.ReactNode;
};

/**
 * Right “card” gutter + optional scroll viewport so thin scrollbars stay off the panel edge.
 */
export function InsetScrollArea({
  className,
  scroll = true,
  scrollClassName,
  children,
}: InsetScrollAreaProps) {
  const outer = cn("min-h-0 min-w-0", SCROLLBAR_EDGE_INSET, className);

  if (!scroll) {
    return <div className={outer}>{children}</div>;
  }

  return (
    <div className={outer}>
      <div
        className={cn("h-full min-h-0 overflow-y-auto", scrollClassName)}
      >
        {children}
      </div>
    </div>
  );
}
