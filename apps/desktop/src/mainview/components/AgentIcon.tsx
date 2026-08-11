import { memo } from "react";
import { getAgentIcon } from "@/mainview/lib/agentIcons";
import { cn } from "@/mainview/lib/utils";

/**
 * Agent logo for sidebars and skill-detail rows — matches `getAgentIcon` mapping.
 */
export const AgentIcon = memo(function AgentIcon({
  slug,
  className,
}: {
  slug: string;
  className?: string;
}) {
  const icon = getAgentIcon(slug);
  const base = "size-4 shrink-0 rounded-[3px]";
  if (icon.type === "component") {
    const C = icon.Component;
    return <C className={cn(base, className)} aria-hidden="true" />;
  }
  return (
    <img
      src={icon.src}
      alt=""
      className={cn(base, icon.monochrome ? "dark:invert" : "", className)}
    />
  );
});
