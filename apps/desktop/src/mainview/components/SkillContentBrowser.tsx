import { useRef, type ReactNode } from "react";
import { File, Image } from "lucide-react";
import { ScrollFade } from "@/mainview/components/ScrollFade";
import { Tooltip } from "@/mainview/components/ui/tooltip";
import { cn } from "@/mainview/lib/utils";

export type SkillContentFile = {
  path: string;
  status?: "added" | "modified" | "deleted" | null;
};

interface SkillContentBrowserProps {
  files: Array<string | SkillContentFile>;
  selectedFile: string | null;
  onSelectFile: (file: string) => void;
  loading?: boolean;
  children: ReactNode;
  className?: string;
  previewClassName?: string;
  emptyFiles?: ReactNode;
  ariaLabel?: string;
}

function isImageFile(path: string) {
  return /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(path);
}

function ChangeMarker({ status }: { status: NonNullable<SkillContentFile["status"]> }) {
  const label = status === "modified" ? "Changed" : status === "added" ? "New" : "Removed";
  const marker = status === "modified" ? "M" : status === "added" ? "A" : "D";
  return (
    <Tooltip content={label}>
      <span className={cn(
        "grid size-4 shrink-0 place-items-center rounded text-[9px] font-sans font-bold",
        status === "deleted" ? "bg-destructive/12 text-destructive" : status === "added" ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-800 dark:text-amber-200",
      )}>
        {marker}
      </span>
    </Tooltip>
  );
}

/**
 * Shared file navigator for local and marketplace skill details.
 *
 * The data sources differ, but browsing a skill should always look and behave
 * the same: a labelled file list on the left and the selected file on the right.
 */
export default function SkillContentBrowser({
  files,
  selectedFile,
  onSelectFile,
  loading = false,
  children,
  className,
  previewClassName,
  emptyFiles,
  ariaLabel = "Files in this skill",
}: SkillContentBrowserProps) {
  const entries = files.map((file): SkillContentFile => typeof file === "string" ? { path: file } : file);
  const fileListRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  return (
    <div className={cn("flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border/70 bg-muted/[0.12]", className)}>
      <div className="flex min-h-[22rem] min-w-0 flex-1">
        <div className="relative w-44 shrink-0 border-r border-border/70 bg-muted/[0.18]">
          <nav ref={fileListRef} className="h-full overflow-y-auto py-2" aria-label={ariaLabel}>
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Files</p>
            {loading ? (
              <div className="space-y-2 px-3 py-2 animate-pulse">
                <div className="h-3 w-20 rounded bg-muted" />
                <div className="h-3 w-28 rounded bg-muted/70" />
              </div>
            ) : entries.length === 0 ? emptyFiles : (
              entries.map((file) => (
                <button
                  key={`${file.status ?? "clean"}:${file.path}`}
                  type="button"
                  onClick={() => onSelectFile(file.path)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[11px] transition-colors",
                    selectedFile === file.path
                      ? "bg-primary/[0.12] text-foreground hover:bg-primary/[0.16]"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                  )}
                >
                  {file.status ? <ChangeMarker status={file.status} /> : isImageFile(file.path) ? <Image className="size-3.5 shrink-0" /> : <File className="size-3.5 shrink-0" />}
                  <span className="min-w-0 truncate">{file.path}</span>
                </button>
              ))
            )}
          </nav>
          <ScrollFade viewportRef={fileListRef} surface="muted" />
        </div>
        <div className="relative min-w-0 flex-1">
          <div ref={previewRef} className={cn("h-full overflow-y-auto px-5 py-4", previewClassName)}>{children}</div>
          <ScrollFade viewportRef={previewRef} />
        </div>
      </div>
    </div>
  );
}
