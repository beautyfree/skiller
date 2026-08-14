/**
 * A draggable divider between resizable columns.
 *
 * Uses the same Linear-derived rail as PostPost: a generous 7px hit target
 * and a 0.5px faded guide that appears only while it is being used.
 */
export default function ResizeHandle({
  onPointerDown,
  onMouseDown,
  isResizing = false,
  className,
}: {
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  isResizing?: boolean;
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panels"
      data-resizing={isResizing}
      className={`linear-resize-handle app-no-drag electrobun-webkit-app-region-no-drag relative w-[7px] shrink-0 outline-none ${className ?? ""}`}
      onPointerDown={onPointerDown}
      onMouseDown={onMouseDown}
    />
  );
}
