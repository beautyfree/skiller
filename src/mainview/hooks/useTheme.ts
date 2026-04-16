import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@/mainview/lib/native";

interface AppSettings {
  theme: string | null;
  language: string | null;
  path_overrides: Record<string, string[]> | null;
}

/**
 * Reads the persisted theme setting and applies the `.dark` class
 * to `<html>`. Responds to system preference when theme is "system" / null.
 */
export function useTheme() {
  const { data: settings } = useQuery<AppSettings>({
    queryKey: ["settings"],
    queryFn: async () => (await invoke("read_settings")) as AppSettings,
    staleTime: 5 * 60 * 1000,
  });

  // Persisted "system" is stored as omitted key / null in TOML → `undefined` after parse.
  // Only explicit "light" or "dark" strings force a fixed theme.
  const t = settings?.theme;
  const theme: "light" | "dark" | "system" =
    t === "light" || t === "dark" ? t : "system";

  useEffect(() => {
    const root = document.documentElement;

    function apply(dark: boolean) {
      root.classList.toggle("dark", dark);
    }

    if (theme === "dark") {
      apply(true);
      return;
    }
    if (theme === "light") {
      apply(false);
      return;
    }

    // System: match OS preference and listen for changes
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    apply(mq.matches);

    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);
}
