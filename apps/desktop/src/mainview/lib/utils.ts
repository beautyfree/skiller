import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Native `<select>` styling aligned with SearchInput glass field */
export const nativeSelectClass =
  "h-8 min-h-8 rounded-xl border border-border bg-card/85 dark:bg-white/[0.04] backdrop-blur-md px-4 pr-8 text-sm text-foreground outline-none transition-all duration-200 cursor-pointer appearance-none focus:border-primary/35 focus:ring-2 focus:ring-primary/15 focus:bg-card dark:focus:bg-white/[0.06]";

/** Wrapper: place `<ChevronDown className="pointer-events-none ..."/>` absolutely at `right-2 top-1/2 -translate-y-1/2` */
export const nativeSelectChevronClass =
  "pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground opacity-70";
