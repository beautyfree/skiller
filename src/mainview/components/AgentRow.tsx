import { memo, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { revealItemInDir } from "@/mainview/lib/native";
import { Button } from "@/mainview/components/ui/button";
import { AgentIcon } from "@/mainview/components/AgentIcon";
import { cn } from "@/mainview/lib/utils";

type AgentRowStatus = "installed" | "inherited" | "not-installed";

interface AgentRowProps {
  /** Agent slug — used for the same logos as the sidebar */
  agentSlug: string;
  name: string;
  status: AgentRowStatus;
  path?: string;
  /** Extra tags after agent name (e.g. "via X", "symlink") */
  tags?: ReactNode;
  /** Right-side action slot — if not provided, renders default uninstall/install buttons */
  action?: ReactNode;
  /** Uninstall handler — shown when status is "installed" and no custom action */
  onUninstall?: () => void;
  /** Install handler — shown when status is "not-installed" and no custom action */
  onInstall?: () => void;
  /** Labels */
  uninstallTitle?: string;
  installLabel?: string;
  installTitle?: string;
  revealTitle?: string;
  disabled?: boolean;
}

export const AgentRow = memo(function AgentRow({
  agentSlug,
  name,
  status,
  path,
  tags,
  action,
  onUninstall,
  onInstall,
  uninstallTitle,
  installLabel = "Install",
  installTitle,
  revealTitle,
  disabled,
}: AgentRowProps) {
  const isInstalled = status === "installed";
  const isInherited = status === "inherited";
  const isActive = isInstalled || isInherited;

  const iconClass = cn(
    !isActive && "opacity-45",
  );

  return (
    <div
      className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs transition-colors ${
        isInstalled
          ? "glass-inset"
          : isInherited
            ? "glass-inset opacity-70"
            : "bg-black/[0.02] dark:bg-white/[0.02] border border-transparent"
      }`}
    >
      <AgentIcon slug={agentSlug} className={iconClass} />
      {/* Name + path */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={isActive ? "font-medium truncate" : "text-muted-foreground truncate"}>
            {name}
          </span>
          {tags}
        </div>
        {path && (
          <button
            className="mt-1 break-all text-left font-mono text-[10px] leading-relaxed text-muted-foreground/70 transition-colors hover:text-primary cursor-pointer"
            title={revealTitle}
            onClick={() => revealItemInDir(path)}
          >
            {path}
          </button>
        )}
      </div>
      {/* Right: action */}
      {action ?? (
        isInstalled && onUninstall ? (
          <button
            className="flex items-center justify-center size-6 rounded-md text-destructive/60 hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 shrink-0"
            title={uninstallTitle}
            disabled={disabled}
            onClick={onUninstall}
          >
            <Trash2 className="size-3" aria-hidden="true" />
          </button>
        ) : !isActive && onInstall ? (
          <Button
            variant="outline"
            size="xs"
            className="shrink-0 h-5 px-2 text-[10px]"
            title={installTitle}
            disabled={disabled}
            onClick={onInstall}
          >
            {installLabel}
          </Button>
        ) : null
      )}
    </div>
  );
});
