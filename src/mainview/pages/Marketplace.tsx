import { useState, useEffect, useCallback, useDeferredValue, useMemo, memo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import {
  Store,
  Download,
  Loader2,
  ExternalLink,
  User,
  Tag,
  Check,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke, openUrl } from "@/mainview/lib/native";
import { useAgents, type AgentConfig } from "@/mainview/hooks/useAgents";
import { useSkills, type Skill } from "@/mainview/hooks/useSkills";
import { SkillAgentList, installedAgentCount, busyKey, type BusyOp } from "@/mainview/components/SkillAgentList";
import MarkdownContent from "@/mainview/components/MarkdownContent";
import { useResizable } from "@/mainview/hooks/useResizable";
import ResizeHandle from "@/mainview/components/ResizeHandle";
import { InsetScrollArea } from "@/mainview/components/InsetScrollArea";
import SearchInput from "@/mainview/components/SearchInput";
import { Button } from "@/mainview/components/ui/button";
import { useToast } from "@/mainview/components/ToastProvider";
import { cn } from "@/mainview/lib/utils";
import { extractMarkdownBody } from "@/mainview/lib/markdown";

interface MarketplaceSkill {
  name: string;
  description: string | null;
  author: string | null;
  repository: string | null;
  installs: number | null;
  source: string;
}

const SOURCES = [
  { key: "skills.sh", label: "skills.sh" },
  { key: "clawhub", label: "ClawHub" },
];

export default function Marketplace() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [source, setSource] = useState("skills.sh");
  const [skillsshSort, setSkillsshSort] = useState("all-time");
  const [clawhubSort, setClawhubSort] = useState("default");
  const [searchQuery, setSearchQuery] = useState("");
  const [busyAgents, setBusyAgents] = useState<Map<string, BusyOp>>(new Map());
  // selectedKey drives list highlight (instant); detail uses deferred key
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const { data: agents } = useAgents();
  const { data: localSkills } = useSkills();
  const queryClient = useQueryClient();
  const listPane = useResizable({
    initial: 340,
    min: 240,
    max: 560,
    storageKey: "marketplace-list-width",
  });

  // Sort options with translations
  const SKILLSSH_SORTS = useMemo(() => [
    { key: "all-time", label: t("marketplace.sortAllTime") },
    { key: "trending", label: t("marketplace.sortTrending") },
    { key: "hot", label: t("marketplace.sortHot") },
  ], [t]);

  const CLAWHUB_SORTS = useMemo(() => [
    { key: "default", label: t("marketplace.sortDefault") },
    { key: "downloads", label: t("marketplace.sortDownloads") },
    { key: "stars", label: t("marketplace.sortStars") },
  ], [t]);

  // SearchInput fires debounced changes; we store the query for React Query
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const detectedAgents = agents?.filter((a) => a.detected) ?? [];
  const currentSort = source === "skills.sh" ? skillsshSort : clawhubSort;
  const sorts = source === "skills.sh" ? SKILLSSH_SORTS : CLAWHUB_SORTS;
  const setSort = source === "skills.sh" ? setSkillsshSort : setClawhubSort;
  const deferredSelectedKey = useDeferredValue(selectedKey);

  const {
    data: items,
    isLoading,
    error,
  } = useQuery<MarketplaceSkill[]>({
    queryKey: ["marketplace", source, currentSort, searchQuery],
    queryFn: async () => {
      if (searchQuery.trim()) {
        return (await invoke("search_marketplace", {
          query: searchQuery.trim(),
          source,
        })) as MarketplaceSkill[];
      }
      if (source === "skills.sh") {
        return (await invoke("fetch_skillssh", {
          sort: currentSort,
          page: 1,
        })) as MarketplaceSkill[];
      }
      return (await invoke("fetch_clawhub", {
        endpoint: currentSort,
        params: {},
      })) as MarketplaceSkill[];
    },
    staleTime: 5 * 60 * 1000, // backend has 5-min SQLite cache; avoid redundant IPC
    // Do not show the previous source's list (e.g. skills.sh) while ClawHub loads; also
    // avoid showing the wrong sort order while a new sort is fetching.
    placeholderData: (previousData, previousQuery) => {
      const prev = previousQuery?.queryKey as unknown[] | undefined;
      if (!prev || prev.length < 4) return undefined;
      const sameSource = prev[1] === source;
      const sameSort = prev[2] === currentSort;
      const sameSearch = prev[3] === searchQuery;
      if (!sameSource || !sameSort || !sameSearch) return undefined;
      return previousData;
    },
  });

  // Auto-select first item when data loads
  useEffect(() => {
    if (items?.length && !selectedKey) {
      const first = items[0];
      setSelectedKey(skillKey(first));
    }
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedSkill = useMemo(() => {
    if (!items?.length || !deferredSelectedKey) return null;
    return items.find((item) => skillKey(item) === deferredSelectedKey) ?? null;
  }, [items, deferredSelectedKey]);

  const listScrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items?.length ?? 0,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => 92,
    overscan: 12,
    getItemKey: (index) => {
      const list = items;
      if (!list?.[index]) return String(index);
      return skillKey(list[index]);
    },
  });

  useEffect(() => {
    if (!selectedKey || !items?.length) return;
    const idx = items.findIndex((s) => skillKey(s) === selectedKey);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll when selection changes; items from same render
  }, [selectedKey]);

  async function handleInstall(
    skill: MarketplaceSkill,
    targetAgents: string[]
  ) {
    if (!targetAgents.length) return;
    const localSkill = findLocalSkill(localSkills, skill.name, skill.repository);
    const op: BusyOp = localSkill ? "syncing" : "installing";
    // Use localSkill.id when available, fall back to skill.name for first-time installs
    const sid = localSkill?.id ?? skill.name;
    setBusyAgents((prev) => {
      const next = new Map(prev);
      targetAgents.forEach((a) => next.set(busyKey(sid, a), op));
      return next;
    });
    try {
      if (localSkill) {
        // Fast path: copy from local installation (no git clone needed)
        await invoke("sync_skill", {
          skillId: localSkill.id,
          targetAgents,
        });
      } else {
        // Slow path: first install, clone from repository
        await invoke("install_from_marketplace", {
          skill,
          targetAgents,
        });
      }
      // Refresh local skills so "Installed" state updates
      const updated = await queryClient.fetchQuery<Skill[]>({
        queryKey: ["skills"],
        queryFn: async () =>
          (await invoke("scan_all_skills")) as Skill[],
        staleTime: 0,
      });
      queryClient.setQueryData(["skills"], updated);
    } catch (e) {
      console.error("Install failed:", e instanceof Error ? e.message : String(e));
      toast(t("marketplace.installFailed"), "destructive");
    } finally {
      setBusyAgents((prev) => {
        const next = new Map(prev);
        targetAgents.forEach((a) => next.delete(busyKey(sid, a)));
        return next;
      });
    }
  }

  async function handleUninstall(skillId: string, agentSlug: string) {
    const k = busyKey(skillId, agentSlug);
    setBusyAgents((prev) => new Map(prev).set(k, "uninstalling"));
    try {
      await invoke("uninstall_skill", { skillId, agentSlug });
      const updated = await queryClient.fetchQuery<Skill[]>({
        queryKey: ["skills"],
        queryFn: async () =>
          (await invoke("scan_all_skills")) as Skill[],
        staleTime: 0,
      });
      queryClient.setQueryData(["skills"], updated);
    } catch (e) {
      console.error("Uninstall failed:", e instanceof Error ? e.message : String(e));
      toast(t("marketplace.uninstallFailed"), "destructive");
    } finally {
      setBusyAgents((prev) => {
        const next = new Map(prev);
        next.delete(k);
        return next;
      });
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1">
      {/* Main list */}
      <div
        className="flex h-full min-h-0 shrink-0 flex-col p-4"
        style={{ width: listPane.width }}
      >
        <div className="flex shrink-0 flex-col space-y-3">
        {/* Source tabs + sorts: stack on narrow panes, wrap gracefully */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {SOURCES.map((s) => (
              <Button
                key={s.key}
                variant={source === s.key ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setSource(s.key);
                  setSearchQuery("");
                  setSelectedKey(null);
                }}
              >
                {s.label}
              </Button>
            ))}
          </div>

          {!searchQuery && (
            <div className="flex min-w-0 flex-wrap gap-1">
              {sorts.map((s) => (
                <Button
                  key={s.key}
                  variant={currentSort === s.key ? "secondary" : "ghost"}
                  size="xs"
                  onClick={() => setSort(s.key)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <SearchInput
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder={t("marketplace.searchPlaceholder", { source: source === "skills.sh" ? "skills.sh" : "ClawHub" })}
          debounce={350}
        />
        </div>

        {/* Results (virtualized) */}
        <InsetScrollArea scroll={false} className="mt-3 flex-1">
        {isLoading ? (
          <div className="space-y-1.5 py-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-lg px-3 py-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="h-4 w-28 rounded animate-skeleton" />
                  <div className="h-3 w-8 rounded animate-skeleton" />
                </div>
                <div className="h-3 w-44 rounded animate-skeleton" />
                <div className="flex gap-2">
                  <div className="h-3 w-16 rounded animate-skeleton" />
                  <div className="h-4 w-12 rounded-full animate-skeleton" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
            {t("marketplace.failedToLoad", { error: String(error) })}
          </div>
        ) : !items?.length ? (
          <div className="rounded-2xl border border-dashed border-black/[0.06] dark:border-white/[0.06] p-8 text-center">
            <div className="inline-flex size-12 items-center justify-center rounded-xl glass mb-3">
              <Store className="size-6 text-primary/40" />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("marketplace.noSkillsFound")}
            </p>
          </div>
        ) : (
          <div
            ref={listScrollRef}
            className="h-full min-h-0 overflow-y-auto"
          >
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((vi) => {
                const skill = items[vi.index];
                if (!skill) return null;
                const k = skillKey(skill);
                return (
                  <div
                    key={vi.key}
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${vi.start}px)` }}
                  >
                    <div className="pb-1">
                      <MarketplaceListItem
                        skill={skill}
                        selected={selectedKey === k}
                        onSelect={setSelectedKey}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </InsetScrollArea>
      </div>

      <ResizeHandle onMouseDown={listPane.onMouseDown} />

      {/* Detail panel — always occupies right column so empty state is explicit when nothing is selected */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {selectedKey && !selectedSkill ? (
          <div className="m-2 ml-0 flex min-h-0 flex-1 items-center justify-center rounded-2xl glass-panel">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : selectedKey && selectedSkill ? (
          <MarketplaceSkillDetail
            skill={selectedSkill}
            busyAgents={busyAgents}
            detectedAgents={detectedAgents}
            localSkills={localSkills}
            onInstall={(targets) => handleInstall(selectedSkill, targets)}
            onUninstall={handleUninstall}
            onClose={() => {
              setSelectedKey(null);
            }}
          />
        ) : items?.length ? (
          <div className="m-2 ml-0 flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/20 px-6 py-12 text-center">
            <Store className="mb-3 size-10 text-muted-foreground/50" />
            <p className="max-w-sm text-sm text-muted-foreground">{t("marketplace.selectSkillDetail")}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const MarketplaceListItem = memo(function MarketplaceListItem({
  skill,
  selected,
  onSelect,
}: {
  skill: MarketplaceSkill;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const key = skillKey(skill);
  return (
    <button
      type="button"
      className={cn(
        "w-full rounded-xl px-3 py-2.5 text-left transition-all duration-200",
        selected
          ? "glass border border-border/50"
          : "border border-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.04]",
      )}
      onClick={() => onSelect(key)}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium truncate">
          {skill.name}
        </h3>
        {skill.installs != null && (
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {formatInstalls(skill.installs)}
          </span>
        )}
      </div>
      {skill.description && (
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
          {skill.description}
        </p>
      )}
      <div className="flex items-center gap-2 mt-1">
        {skill.author && (
          <span className="text-[11px] text-muted-foreground truncate">
            {skill.author}
          </span>
        )}
        <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
          {skill.source}
        </span>
      </div>
    </button>
  );
});

function MarketplaceSkillDetail({
  skill,
  busyAgents,
  detectedAgents,
  localSkills,
  onInstall,
  onUninstall,
}: {
  skill: MarketplaceSkill;
  busyAgents: Map<string, BusyOp>;
  detectedAgents: AgentConfig[];
  localSkills: Skill[] | undefined;
  onInstall: (targetAgents: string[]) => void;
  onUninstall: (skillId: string, agentSlug: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const anyBusy = busyAgents.size > 0;
  const isInstalling = [...busyAgents.values()].some((op) => op === "installing" || op === "syncing");
  // Find the matching local skill (if any agent has it installed)
  const localSkill = useMemo(
    () => findLocalSkill(localSkills, skill.name, skill.repository),
    [localSkills, skill.name, skill.repository],
  );

  // Compute install status once per relevant update
  const { installedCount, hasAnyInstalled, allInstalled, notInstalledAgents } = useMemo(() => {
    const count = installedAgentCount(localSkill, detectedAgents);
    const allAgentSet = new Set(
      localSkill ? localSkill.installations.map((i) => i.agent_slug) : [],
    );
    const notInstalled = detectedAgents.filter((a) => !allAgentSet.has(a.slug));
    return {
      installedCount: count,
      hasAnyInstalled: !!localSkill,
      allInstalled: detectedAgents.length > 0 && notInstalled.length === 0,
      notInstalledAgents: notInstalled,
    };
  }, [localSkill, detectedAgents]);

  // Defer the heavy markdown rendering so detail panel paints instantly
  const currentSkillKey = skillKey(skill);
  const deferredSkillKey = useDeferredValue(currentSkillKey);
  const isStale = deferredSkillKey !== currentSkillKey;

  // Fetch SKILL.md via React Query — cached across skill selections
  const { data: remoteContent, isLoading: contentLoading } = useQuery<
    string | null
  >({
    queryKey: ["skill-content", skill.repository, skill.name],
    queryFn: async () => {
      const repoUrl = skill.repository;
      if (!repoUrl) return null;
      const text = (await invoke("fetch_remote_skill_content", {
        repoUrl,
        skillName: skill.name,
      })) as string;
      return extractMarkdownBody(text);
    },
    enabled: !!skill.repository && !isStale,
    staleTime: 30 * 60 * 1000, // SKILL.md content rarely changes; cache 30 min
    retry: false,
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <h3 className="truncate text-sm font-medium">{t("marketplace.detail")}</h3>
      </div>

      {/* Content */}
      <InsetScrollArea className="min-h-0 flex-1" scrollClassName="min-h-0 p-4 space-y-5">
        {/* Header: Name + install action */}
        <div>
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-[590] leading-tight">
              {skill.name}
            </h2>
            {hasAnyInstalled ? (
              <span className="shrink-0 inline-flex items-center gap-1 rounded-full badge-success px-2.5 py-1 text-xs font-medium">
                <Check className="size-3" />
                {allInstalled ? t("marketplace.installed") : `${installedCount}/${detectedAgents.length}`}
              </span>
            ) : (
              <Button
                variant="default"
                size="sm"
                className="shrink-0 gap-1.5 min-w-[100px]"
                disabled={anyBusy || !detectedAgents.length || !skill.repository}
                onClick={() =>
                  onInstall(notInstalledAgents.map((a) => a.slug))
                }
              >
                {isInstalling ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Download className="size-3.5" />
                )}
                {isInstalling ? t("marketplace.installing") : t("marketplace.installAll")}
              </Button>
            )}
          </div>
          {/* Author + source badge inline */}
          <div className="flex items-center gap-2 mt-1.5">
            {skill.author && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <User className="size-3" />
                {skill.author}
              </span>
            )}
            <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-[10px] font-medium">
              {skill.source}
            </span>
            {skill.installs != null && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatInstalls(skill.installs)} {t("marketplace.installs").toLowerCase()}
              </span>
            )}
          </div>
        </div>

        <hr className="border-border" />

        {/* Per-agent install status */}
        {detectedAgents.length > 0 && (
          <>
            <InfoSection
              label={t("marketplace.agentsLabel", { installed: installedAgentCount(localSkill, detectedAgents), total: detectedAgents.length })}
            >
              <SkillAgentList
                skill={localSkill}
                skillIdOverride={skill.name}
                detectedAgents={detectedAgents}
                busyAgents={busyAgents}
                onInstall={onInstall}
                onUninstall={(skillId, agentSlug) => onUninstall(skillId, agentSlug)}
              />
            </InfoSection>
            <hr className="border-border" />
          </>
        )}

        {/* Description as rendered markdown */}
        {skill.description && (
          <MarkdownContent content={skill.description} />
        )}

        <hr className="border-border" />

        {/* Package Info */}
        <InfoSection label={t("marketplace.packageInfo")}>
          <InfoGrid>
            {skill.repository && (
              <InfoRow label={t("marketplace.repository")}>
                <button
                  className="text-xs text-primary hover:underline font-mono break-all text-left inline-flex items-start gap-1 cursor-pointer"
                  onClick={() => openUrl(skill.repository!)}
                >
                  {skill.repository}
                  <ExternalLink className="size-3 shrink-0 mt-0.5" />
                </button>
              </InfoRow>
            )}
            {skill.installs != null && (
              <InfoRow label={t("marketplace.installs")}>
                <span className="text-xs font-medium tabular-nums">
                  {formatInstalls(skill.installs)}
                </span>
                <span className="text-xs text-muted-foreground/60 ml-1.5 tabular-nums">
                  ({skill.installs.toLocaleString()})
                </span>
              </InfoRow>
            )}
          </InfoGrid>
        </InfoSection>

        <hr className="border-border" />

        {/* Quick Actions */}
        <InfoSection label={t("marketplace.actions")}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {skill.repository && (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => openUrl(skill.repository!)}
              >
                <ExternalLink className="size-3.5" />
                {t("marketplace.viewRepository")}
              </Button>
            )}
            {skill.source === "skills.sh" && (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => openUrl("https://skills.sh")}
              >
                <Tag className="size-3.5" />
                {t("marketplace.viewOnSkillsSh")}
              </Button>
            )}
          </div>
        </InfoSection>

        <hr className="border-border" />

        {/* Skill Content from remote SKILL.md */}
        <InfoSection label={t("marketplace.skillContent")}>
          {isStale || contentLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t("marketplace.loading")}
            </div>
          ) : remoteContent ? (
            <MarkdownContent content={remoteContent} />
          ) : (
            <p className="text-xs text-muted-foreground italic">
              {skill.repository
                ? t("marketplace.couldNotLoad")
                : t("marketplace.noRepoUrl")}
            </p>
          )}
        </InfoSection>
      </InsetScrollArea>
    </div>
  );
}

function skillKey(skill: MarketplaceSkill): string {
  return `${skill.source}|${normalizeRepoUrl(skill.repository) ?? "no-repo"}|${skill.name}`;
}

function InfoSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
        {label}
      </p>
      {children}
    </div>
  );
}

function InfoGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-baseline">
      {children}
    </div>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {label}
      </span>
      <div>{children}</div>
    </>
  );
}

/** Find the matching local skill for a marketplace skill, checking repo URL when available */
function findLocalSkill(
  localSkills: Skill[] | undefined,
  skillName: string,
  repoUrl: string | null | undefined,
): Skill | undefined {
  if (!localSkills?.length) return undefined;
  const remoteRepo = normalizeRepoUrl(repoUrl);
  return localSkills.find((s) => {
    const nameMatches = s.name === skillName || s.id === skillName;
    if (!nameMatches) return false;
    if (remoteRepo) {
      const localRepo = normalizeRepoUrl(sourceRepository(s.source));
      if (localRepo) return localRepo === remoteRepo;
    }
    return true;
  });
}

function sourceRepository(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const src = source as Record<string, unknown>;
  if ("GitRepository" in src) {
    const git = src["GitRepository"] as Record<string, unknown>;
    return typeof git.repo_url === "string" ? git.repo_url : null;
  }
  if ("SkillsSh" in src) {
    const skillsSh = src["SkillsSh"] as Record<string, unknown>;
    return typeof skillsSh.repository === "string" ? skillsSh.repository : null;
  }
  if ("ClawHub" in src) {
    const clawHub = src["ClawHub"] as Record<string, unknown>;
    return typeof clawHub.repository === "string" ? clawHub.repository : null;
  }
  return null;
}

function normalizeRepoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url
    .trim()
    .toLowerCase()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

function formatInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
