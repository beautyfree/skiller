import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

const RESTORE_WINDOW_MS = 30_000;

type Entry<T> = {
  value: T;
  expiresAt: number;
};

const transientViews = new Map<string, Entry<unknown>>();

/**
 * Preserves a view's filters across a short navigation detour. This deliberately
 * lives in memory rather than localStorage: filters are context, not a setting.
 */
export function useTransientViewState<T>(key: string, initialValue: T): readonly [T, Dispatch<SetStateAction<T>>, boolean] {
  const restored = useRef(false);
  const [state, setState] = useState<T>(() => {
    const cached = transientViews.get(key) as Entry<T> | undefined;
    if (cached && cached.expiresAt > Date.now()) {
      restored.current = true;
      return cached.value;
    }
    transientViews.delete(key);
    return initialValue;
  });
  const latest = useRef(state);

  useEffect(() => {
    latest.current = state;
  }, [state]);

  useEffect(() => () => {
    transientViews.set(key, { value: latest.current, expiresAt: Date.now() + RESTORE_WINDOW_MS });
  }, [key]);

  return [state, setState, restored.current] as const;
}
