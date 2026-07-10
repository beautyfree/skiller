import { useMemo, useState, useRef, useEffect } from "react";
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
} from "lucide-react";
import { getAgentIcon } from "@/mainview/lib/agentIcons";
import { AgentIcon } from "@/mainview/components/AgentIcon";
import {
  getInstallCommand,
  getInstallDocsUrl,
  useAgents,
  type AgentConfig,
} from "@/mainview/hooks/useAgents";
import { useSkills, installedAgents } from "@/mainview/hooks/useSkills";
import LiquidGlass from "@/mainview/components/LiquidGlass";
import { Button } from "@/mainview/components/ui/button";
import SearchInput from "@/mainview/components/SearchInput";
import { cn, nativeSelectClass, nativeSelectChevronClass } from "@/mainview/lib/utils";
import { openUrl } from "@/mainview/lib/native";

export default function Dashboard() {
  const { t } = useTranslation();
  const {
    data: agents,
    isLoading: agentsLoading,
    isFetching: agentsFetching,
    refetch: refetchAgents,
  } = useAgents();
  const {
    data: skills,
    isLoading: skillsLoading,
    isFetching: skillsFetching,
    refetch: refetchSkills,
  } = useSkills();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "detected" | "not-installed">("all");
  const [sortBy, setSortBy] = useState<"name" | "skills">("name");
  const [guideAgent, setGuideAgent] = useState<string | null>(null);

  const detectedAgents = agents?.filter((a) => a.detected) ?? [];
  const totalSkills = skills?.length ?? 0;
  const isRefreshing = agentsFetching || skillsFetching;

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
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          label={t("dashboard.detectedAgents")}
          value={agentsLoading ? null : detectedAgents.length}
          total={agents?.length}
          icon={<MonitorCheck className="size-4 text-primary/70" />}
        />
        <StatCard
          label={t("dashboard.installedSkills")}
          value={skillsLoading ? null : totalSkills}
          icon={<Puzzle className="size-4 text-primary/70" />}
        />
      </div>

      {/* Agent cards */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("dashboard.agents")}</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("dashboard.detectedOf", { detected: detectedAgents.length, total: agents?.length ?? 0 })}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={isRefreshing}
              onClick={() => {
                void Promise.all([refetchAgents(), refetchSkills()]);
              }}
              title={t("dashboard.refreshTitle")}
            >
              <RefreshCw className={cn("size-3.5", isRefreshing && "animate-spin")} />
            </Button>
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("dashboard.skillCount", { count: agentSkillCount })}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1">{t("dashboard.notInstalled")}</p>
                    )}
                  </div>
                  <div className="relative z-[3] shrink-0">
                    {agent.detected ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); navigate("/skills?agent=" + agent.slug); }}
                        title={`Open ${agent.name} skills`}
                      >
                        <ArrowRight className="size-4 text-muted-foreground" />
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="xs"
                        className="shrink-0 whitespace-nowrap px-2"
                        title={t("dashboard.installationGuide")}
                        aria-label={t("dashboard.installationGuide")}
                        onClick={(e) => { e.stopPropagation(); setGuideAgent(agent.slug); }}
                      >
                        {t("dashboard.installationGuideShort")}
                      </Button>
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
    <div
      className="flex shrink-0 items-center ml-3 relative z-[3]"
      title={title}
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
  );
}

function StatCard({
  label,
  value,
  total,
  icon,
}: {
  label: string;
  value: number | null;
  total?: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg p-4 glass-surface-tint glass-stat">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex size-7 items-center justify-center rounded-xl bg-primary/10">
          {icon}
        </div>
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        {value == null ? (
          <div className="h-8 w-10 rounded animate-skeleton" />
        ) : (
          <span className="text-[22px] font-[590] tabular-nums tracking-[-0.02em] leading-7">{value}</span>
        )}
        {total != null && value != null && (
          <span className="text-sm text-muted-foreground/60 font-medium">/ {total}</span>
        )}
      </div>
    </div>
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
    <div className="modal-shell fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-[rgba(0,0,0,0.85)] animate-backdrop-in"
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
