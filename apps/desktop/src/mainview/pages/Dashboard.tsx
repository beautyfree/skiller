import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Puzzle,
  MonitorCheck,
  ArrowRight,
  RefreshCw,
  Copy,
  X,
  ChevronDown,
  Cloud,
  ShieldCheck,
} from "lucide-react";
import { getAgentIcon } from "@/mainview/lib/agentIcons";
import { AgentIcon } from "@/mainview/components/AgentIcon";
import {
  getInstallCommand,
  getInstallDocsUrl,
  useAgents,
  useRuntimeAgent,
  useSkillsCliLock,
  type AgentConfig,
} from "@/mainview/hooks/useAgents";
import { useSkills, installedAgents } from "@/mainview/hooks/useSkills";
import LiquidGlass from "@/mainview/components/LiquidGlass";
import { Button } from "@/mainview/components/ui/button";
import { Tooltip } from "@/mainview/components/ui/tooltip";
import SearchInput from "@/mainview/components/SearchInput";
import { cn, nativeSelectClass, nativeSelectChevronClass } from "@/mainview/lib/utils";
import { openUrl } from "@/mainview/lib/native";
import { invoke } from "@/mainview/lib/native";
import type { SyncProfileStatusJson } from "@/shared/rpc-schema";

export default function Dashboard() {
  const { t } = useTranslation();
  const {
    data: agents,
    isLoading: agentsLoading,
    isFetching: agentsFetching,
    refetch: refetchAgents,
  } = useAgents();
  const { data: runtimeAgent } = useRuntimeAgent();
  const { data: skillsCliLock } = useSkillsCliLock();
  const {
    data: skills,
    isLoading: skillsLoading,
    isFetching: skillsFetching,
    refetch: refetchSkills,
  } = useSkills();

  const { data: syncProfiles } = useQuery<SyncProfileStatusJson[]>({
    queryKey: ["sync-profiles"],
    queryFn: () => invoke("list_sync_profiles"),
    staleTime: 30_000,
  });
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "detected" | "not-installed">("all");
  const [sortBy, setSortBy] = useState<"name" | "skills">("name");
  const [guideAgent, setGuideAgent] = useState<string | null>(null);

  const detectedAgents = agents?.filter((a) => a.detected) ?? [];
  const totalSkills = skills?.length ?? 0;
  const isRefreshing = agentsFetching || skillsFetching;
  const syncProfile = syncProfiles?.[0];

  const skillCountByAgent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const agent of agents ?? []) {
      counts.set(agent.slug, 0);
    }
    for (const skill of skills ?? []) {
      for (const slug of installedAgents(skill)) {
        counts.set(slug, (counts.get(slug) ?? 0) + 1);
      }
    }
    return counts;
  }, [agents, skills]);

  const filteredAgents = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return (agents ?? [])
      .filter((agent) => {
        if (!query) return true;
        const haystack = [
          agent.name,
          agent.slug,
          agent.cli_command ?? "",
          ...agent.global_paths,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .filter((agent) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "detected") return agent.detected;
        return !agent.detected;
      })
      .sort((a, b) => {
        if (sortBy === "skills") {
          const bySkills = (skillCountByAgent.get(b.slug) ?? 0) - (skillCountByAgent.get(a.slug) ?? 0);
          if (bySkills !== 0) return bySkills;
        }
        if (a.detected !== b.detected) return a.detected ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [agents, searchTerm, statusFilter, sortBy, skillCountByAgent]);

  const selectedGuide = useMemo(
    () => (agents ?? []).find((agent) => agent.slug === guideAgent) ?? null,
    [agents, guideAgent]
  );

  return (
    <div className="space-y-6 px-6 py-6 animate-fade-in-up">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-5">
        <div>
          <h1 className="text-lg font-semibold tracking-[-0.03em] text-foreground">{t("dashboard.setupTitle")}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><MonitorCheck className="size-3.5 text-primary" />{agentsLoading ? t("dashboard.scanning") : t("dashboard.agentsReady", { detected: detectedAgents.length, total: agents?.length ?? 0 })}</span>
            <span className="hidden size-1 rounded-full bg-border sm:block" />
            {skillsLoading ? (
              <span className="inline-flex items-center gap-1.5"><Puzzle className="size-3.5 text-primary" />{t("dashboard.scanning")}</span>
            ) : (
              <Tooltip content="View all skills">
              <button
                type="button"
                onClick={() => navigate('/skills')}
                className="inline-flex items-center gap-1.5 rounded-sm text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <Puzzle className="size-3.5 text-primary" />
                <span className="underline decoration-border underline-offset-4 transition-colors hover:decoration-primary">{t("dashboard.skillsAvailable", { count: totalSkills })}</span>
              </button>
              </Tooltip>
            )}
            {runtimeAgent && <span className="hidden lg:inline">{t("dashboard.runtimeAgent", { agent: runtimeAgent.runtime_name, source: runtimeAgent.source })}</span>}
            {skillsCliLock && <span className="hidden lg:inline">{t("dashboard.skillsCliLock", { count: skillsCliLock.skills.length, version: skillsCliLock.version })}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button size="sm" variant={syncProfile ? "outline" : "default"} onClick={() => navigate("/library")}>
            {syncProfile ? <ShieldCheck className="size-3.5" /> : <Cloud className="size-3.5" />}
            {syncProfile ? t("dashboard.openSync") : t("dashboard.protectLibrary")}
          </Button>
          {!syncProfile && <p className="text-[11px] text-muted-foreground">{t("dashboard.remoteLibraryHint")}</p>}
        </div>
      </header>

      {/* Agent cards */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("dashboard.agents")}</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("dashboard.detectedOf", { detected: detectedAgents.length, total: agents?.length ?? 0 })}
            </span>
            <Tooltip content={t("dashboard.refreshTitle")}>
            <span className="inline-flex">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={isRefreshing}
              onClick={() => {
                void Promise.all([refetchAgents(), refetchSkills()]);
              }}
            >
              <RefreshCw className={cn("size-3.5", isRefreshing && "animate-spin")} />
            </Button>
            </span>
            </Tooltip>
          </div>
        </div>
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center">
          <div className="w-full md:max-w-[280px] md:shrink-0">
            <SearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder={t("dashboard.searchPlaceholder")}
              debounce={0}
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="relative min-w-[7rem]">
              <select
                className={cn(nativeSelectClass, "w-full min-w-[7rem]")}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "all" | "detected" | "not-installed")}
                aria-label={t("dashboard.filterStatusAria")}
              >
                <option value="all">{t("dashboard.filterAll")}</option>
                <option value="detected">{t("dashboard.filterDetected")}</option>
                <option value="not-installed">{t("dashboard.filterNotInstalled")}</option>
              </select>
              <ChevronDown className={nativeSelectChevronClass} aria-hidden />
            </div>
            <div className="relative min-w-[7.5rem]">
              <select
                className={cn(nativeSelectClass, "w-full min-w-[7.5rem]")}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "name" | "skills")}
                aria-label={t("dashboard.sortAgentsAria")}
              >
                <option value="name">{t("dashboard.sortName")}</option>
                <option value="skills">{t("dashboard.sortSkills")}</option>
              </select>
              <ChevronDown className={nativeSelectChevronClass} aria-hidden />
            </div>
          </div>
        </div>
        {agentsLoading ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl p-4 glass-surface-tint">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-lg animate-skeleton shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-24 rounded animate-skeleton" />
                    <div className="h-3 w-16 rounded animate-skeleton" />
                  </div>
                  <div className="size-8 shrink-0 rounded-md animate-skeleton" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t("dashboard.noAgentsMatch")}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3">
            {filteredAgents.map((agent) => {
              const agentSkillCount = skillCountByAgent.get(agent.slug) ?? 0;

              return (
                <LiquidGlass
                  key={agent.slug}
                  className="group flex items-center gap-3 rounded-2xl p-4 text-left glass-hover cursor-pointer"
                  onClick={() => {
                    if (agent.detected) {
                      navigate("/skills?agent=" + agent.slug);
                    } else {
                      setGuideAgent(agent.slug);
                    }
                  }}
                >
                  <div
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted",
                      !agent.detected && "grayscale opacity-50"
                    )}
                  >
                    {(() => {
                      const icon = getAgentIcon(agent.slug);
                      return icon.type === "component"
                        ? <icon.Component className="size-6 rounded-[3px]" aria-hidden="true" />
                        : <img src={icon.src} alt="" className={`size-6 rounded-[3px] ${icon.monochrome ? "dark:invert" : ""}`} />;
                    })()}
                  </div>
                  <div className="min-w-0 flex-1 relative z-[3]">
                    <span className="text-sm font-medium truncate block">
                      {agent.name}
                    </span>
                    {agent.detected ? (
                      <>
                        <p className="text-xs text-muted-foreground mt-1">
                          {t("dashboard.skillCount", { count: agentSkillCount })}
                        </p>
                        <p className="text-[11px] text-muted-foreground/75 mt-0.5">
                          {detectionReasonLabel(agent, t)}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground mt-1">{t("dashboard.notInstalled")}</p>
                        <p className="text-[11px] text-muted-foreground/75 mt-0.5">
                          {detectionReasonLabel(agent, t)}
                        </p>
                      </>
                    )}
                  </div>
                  <div className="relative z-[3] shrink-0">
                    {agent.detected ? (
                      <Tooltip content={`Open ${agent.name} skills`}>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); navigate("/skills?agent=" + agent.slug); }}
                      >
                        <ArrowRight className="size-4 text-muted-foreground" />
                      </Button>
                      </Tooltip>
                    ) : (
                      <Tooltip content={t("dashboard.installationGuide")}>
                      <Button
                        variant="outline"
                        size="xs"
                        className="shrink-0 whitespace-nowrap px-2"
                        aria-label={t("dashboard.installationGuide")}
                        onClick={(e) => { e.stopPropagation(); setGuideAgent(agent.slug); }}
                      >
                        {t("dashboard.installationGuideShort")}
                      </Button>
                      </Tooltip>
                    )}
                  </div>
                </LiquidGlass>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent skills */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("dashboard.recentSkills")}
          </h2>
          {totalSkills > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => navigate("/skills")}
            >
              {t("dashboard.viewAll")}
              <ArrowRight className="size-3" />
            </Button>
          )}
        </div>
        {skillsLoading ? (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-2xl px-4 py-3 glass-surface-tint">
                <div className="flex items-center gap-3">
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 rounded animate-skeleton" />
                    <div className="h-3 w-48 rounded animate-skeleton" />
                  </div>
                  <div className="h-5 w-14 rounded-full animate-skeleton" />
                </div>
              </div>
            ))}
          </div>
        ) : !skills?.length ? (
          <div className="rounded-2xl border border-dashed border-black/[0.06] dark:border-white/[0.06] p-10 text-center">
            <div className="inline-flex size-14 items-center justify-center rounded-2xl glass-surface-tint mb-4">
              <Puzzle className="size-7 text-primary/40" />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("dashboard.noSkillsYet")}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => navigate("/marketplace")}
            >
              {t("dashboard.browseMarketplace")}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {skills.slice(0, 6).map((skill) => (
              <LiquidGlass
                key={skill.id}
                className="group flex items-center justify-between rounded-2xl px-4 py-3 glass-hover cursor-pointer"
                onClick={() => navigate("/skills?skill=" + encodeURIComponent(skill.id))}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate("/skills?skill=" + encodeURIComponent(skill.id));
                  }
                }}
              >
                <div className="min-w-0 flex-1 relative z-[3]">
                  <span className="text-sm font-medium truncate block">
                    {skill.name}
                  </span>
                  {skill.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {skill.description}
                    </p>
                  )}
                </div>
                <SkillAgentsBadge
                  slugs={installedAgents(skill)}
                  agents={agents ?? []}
                />
              </LiquidGlass>
            ))}
          </div>
        )}
      </div>

      <InstallGuideModal
        agent={selectedGuide}
        onClose={() => setGuideAgent(null)}
      />
    </div>
  );
}

function detectionReasonLabel(
  agent: AgentConfig,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (agent.detection_reason) {
    case "cli":
      return t("dashboard.detectionCli");
    case "marker":
      return t("dashboard.detectionMarker");
    case "skills-only":
      return t("dashboard.detectionSkillsOnly");
    case "not-found":
      return t("dashboard.detectionNotFound");
  }
}

/**
 * Compact agent badge row for Recent Skills cards. Shows up to N logos
 * stacked; anything beyond collapses into a "+K" pill so cards with 10+
 * targeted agents don't vomit pills across the row.
 */
function SkillAgentsBadge({
  slugs,
  agents,
  max = 4,
}: {
  slugs: string[];
  agents: AgentConfig[];
  max?: number;
}) {
  if (slugs.length === 0) return null;
  const visible = slugs.slice(0, max);
  const overflow = slugs.length - visible.length;
  const title = slugs
    .map((s) => agents.find((a) => a.slug === s)?.name ?? s)
    .join(", ");
  return (
    <Tooltip content={title}>
    <div
      className="flex shrink-0 items-center ml-3 relative z-[3]"
    >
      <div className="flex -space-x-1.5">
        {visible.map((slug) => (
          <div
            key={slug}
            className="flex size-5 items-center justify-center rounded-full bg-background ring-1 ring-border/60"
          >
            <AgentIcon slug={slug} className="size-3.5" />
          </div>
        ))}
      </div>
      {overflow > 0 && (
        <span className="ml-1.5 text-[10px] font-medium tabular-nums text-muted-foreground">
          +{overflow}
        </span>
      )}
    </div>
    </Tooltip>
  );
}

function InstallGuideModal({
  agent,
  onClose,
}: {
  agent: AgentConfig | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!agent) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [agent, onClose]);

  useEffect(() => {
    if (!agent) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const list = Array.from(focusables);
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    queueMicrotask(() => first.focus());
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, [agent]);

  if (!agent) return null;
  // Route through the shared helper so Windows/Linux/macOS all get the
  // correct command (Linux no longer silently falls back to `brew ...`).
  const installCommand = getInstallCommand(agent)?.trim();
  const docsUrl = getInstallDocsUrl(agent)?.trim();

  function formatInstallSourceLabel(label: string | null): string {
    switch (label) {
      case "official-docs":
        return t("dashboard.sourceOfficialDocs");
      case "official-help-center":
        return t("dashboard.sourceOfficialHelpCenter");
      case "official-readme":
        return t("dashboard.sourceOfficialReadme");
      case "official-marketplace":
        return t("dashboard.sourceOfficialMarketplace");
      case "homebrew-cask":
        return t("dashboard.sourceHomebrewCask");
      default:
        return t("dashboard.sourceUnspecified");
    }
  }

  const installSourceLabel = formatInstallSourceLabel(agent.install_source_label);
  const verifyCommand = agent.cli_command
    ? `${agent.cli_command} --version`
    : "";
  const lookupCommand = agent.cli_command
    ? `which ${agent.cli_command}`
    : "";
  return (
    <div className="modal-shell modal-overlay fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0"
        aria-hidden
        onClick={onClose}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-guide-dialog-title"
        className="modal-panel relative z-10 w-full max-w-lg rounded-3xl p-5 outline-none animate-modal-in glass-elevated"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 id="install-guide-dialog-title" className="text-sm font-[590]">
            {t("dashboard.installGuideTitle", { name: agent.name })}
          </h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="space-y-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{t("dashboard.source")}</span>
            <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
              {installSourceLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{t("dashboard.detection")}</span>
            <span>{detectionReasonLabel(agent, t)}</span>
          </div>
          <p>{t("dashboard.diagnoseTip")}</p>
          {verifyCommand ? (
            <CommandBlock label={t("dashboard.versionCheck")} command={verifyCommand} />
          ) : null}
          {lookupCommand ? (
            <CommandBlock label={t("dashboard.pathLookup")} command={lookupCommand} />
          ) : null}
          {installCommand ? (
            <CommandBlock label={t("dashboard.installCommand")} command={installCommand} />
          ) : null}
          {docsUrl ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => openUrl(docsUrl)}
            >
              {t("dashboard.openDocs")}
            </Button>
          ) : null}
          <div>
            <p className="mb-1 font-medium text-foreground">{t("dashboard.expectedPaths")}</p>
            <ul className="space-y-1">
              {agent.global_paths.map((path) => (
                <li key={path} className="font-mono text-[11px]">
                  {path}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function CommandBlock({
  label,
  command,
}: {
  label: string;
  command: string;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <p className="mb-1 font-medium text-foreground">{label}</p>
      <div className="flex items-center gap-2 rounded-xl glass-inset p-2.5">
        <code className="flex-1 break-all text-[11px] text-foreground">{command}</code>
        <Button
          variant="outline"
          size="xs"
          onClick={() => navigator.clipboard.writeText(command)}
        >
          <Copy className="size-3" />
          {t("dashboard.copy")}
        </Button>
      </div>
    </div>
  );
}
