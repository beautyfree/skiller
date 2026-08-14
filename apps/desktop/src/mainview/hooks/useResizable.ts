import { useState, useCallback, useRef, useEffect } from "react";

interface UseResizableOptions {
  /** Initial width in pixels */
  initial: number;
  /** Minimum width in pixels */
  min?: number;
  /** Maximum width in pixels */
  max?: number;
  /** Storage key to persist width across sessions */
  storageKey?: string;
}

export function useResizable({
  initial,
  min = 120,
  max = 800,
  storageKey,
}: UseResizableOptions) {
  const [width, setWidth] = useState<number>(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const n = parseInt(saved, 10);
        if (!isNaN(n) && n >= min && n <= max) return n;
      }
    }
    return initial;
  });

  const isDragging = useRef(false);
  const [isResizing, setIsResizing] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const widthRef = useRef(width);
  widthRef.current = width;

  // Persist width
  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(storageKey, String(width));
    }
  }, [width, storageKey]);

  const beginResize = useCallback(
    (clientX: number) => {
      if (isDragging.current) return;
      isDragging.current = true;
      setIsResizing(true);
      startX.current = clientX;
      startWidth.current = widthRef.current;

      const onMove = (ev: PointerEvent | MouseEvent) => {
        if (!isDragging.current) return;
        const delta = ev.clientX - startX.current;
        const newWidth = Math.min(max, Math.max(min, startWidth.current + delta));
        setWidth(newWidth);
      };

      const onUp = () => {
        isDragging.current = false;
        setIsResizing(false);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      // Electron may deliver a synthetic drag as either Pointer Events or
      // Mouse Events. Listen to both after the initial press so the divider
      // cannot become unresponsive when an embedded WebView changes event APIs.
      document.addEventListener("pointermove", onMove);
      document.addEventListener("mousemove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [min, max]
  );

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    beginResize(e.clientX);
  }, [beginResize]);

  // Some desktop automation and embedded WebViews emit only mouse events.
  // Keep this fallback alongside Pointer Events so panel resizing is reliable
  // in both Electron and the browser-based development shell.
  const onMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || isDragging.current) return;
    e.preventDefault();
    beginResize(e.clientX);
  }, [beginResize]);

  return { width, onPointerDown, onMouseDown, isResizing };
}

/**
 * Same as useResizable but measures delta from the right edge (for right-side panels).
 * Dragging left increases width, dragging right decreases width.
 */
export function useResizableFromRight({
  initial,
  min = 120,
  max = 800,
  storageKey,
}: UseResizableOptions) {
  const [width, setWidth] = useState<number>(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const n = parseInt(saved, 10);
        if (!isNaN(n) && n >= min && n <= max) return n;
      }
    }
    return initial;
  });

  const isDragging = useRef(false);
  const [isResizing, setIsResizing] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(storageKey, String(width));
    }
  }, [width, storageKey]);

  const beginResize = useCallback(
    (clientX: number) => {
      if (isDragging.current) return;
      isDragging.current = true;
      setIsResizing(true);
      startX.current = clientX;
      startWidth.current = widthRef.current;

      const onMove = (ev: PointerEvent | MouseEvent) => {
        if (!isDragging.current) return;
        // Moving left = increasing width
        const delta = startX.current - ev.clientX;
        const newWidth = Math.min(max, Math.max(min, startWidth.current + delta));
        setWidth(newWidth);
      };

      const onUp = () => {
        isDragging.current = false;
        setIsResizing(false);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("mousemove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [min, max]
  );

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    beginResize(e.clientX);
  }, [beginResize]);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || isDragging.current) return;
    e.preventDefault();
    beginResize(e.clientX);
  }, [beginResize]);

  return { width, onPointerDown, onMouseDown, isResizing };
}
