import MarketplacePackPicker from "@/mainview/components/MarketplacePackPicker";
import { AppLink } from "@/mainview/components/AppLink";
import { useState, useEffect, useCallback, useDeferredValue, useMemo, memo, useRef, useLayoutEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import {
  Store,
  Download,
  Loader2,
  ExternalLink,
  User,
  Check,
  FolderKanban,
  MoreHorizontal,
  ChevronRight,
  FolderGit2,
  Layers,
  X,
} from "lucide-react";
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { invoke, openUrl } from "@/mainview/lib/native";
import { useAgents, type AgentConfig } from "@/mainview/hooks/useAgents";
import { useSkills, type Skill } from "@/mainview/hooks/useSkills";
import { SkillAgentList, installedAgentCount, busyKey, type BusyOp } from "@/mainview/components/SkillAgentList";
import MarkdownContent from "@/mainview/components/MarkdownContent";
import SkillContentBrowser from "@/mainview/components/SkillContentBrowser";
import { useResizable } from "@/mainview/hooks/useResizable";
import { useTransientViewState } from "@/mainview/hooks/useTransientViewState";
import { SKILL_LIST_PANE } from "@/mainview/lib/shell-chrome";
import ResizeHandle from "@/mainview/components/ResizeHandle";
import { InsetScrollArea } from "@/mainview/components/InsetScrollArea";
import { ScrollFade } from "@/mainview/components/ScrollFade";
import SearchInput from "@/mainview/components/SearchInput";
import { Button } from "@/mainview/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/mainview/components/ui/dropdown-menu";
import { Tooltip } from "@/mainview/components/ui/tooltip";
import { useToast } from "@/mainview/components/ToastProvider";
import InstallToProjectPicker from "@/mainview/components/InstallToProjectPicker";
import ImportWizard from "@/mainview/components/ImportWizard";
import { SkillCardSurface, SkillDetailFrame, SkillViewToggle, useSkillViewMode, useSkillGridColumns, type SkillViewMode } from '@/mainview/components/SkillBrowser';
import { packSkillRows } from '@/mainview/lib/skill-grid';
import { groupMarketplaceRows, marketplaceRepository, marketplaceSkillKey as skillKey } from '@/mainview/lib/marketplace-groups';
import { nextMarketplacePage } from '@/mainview/lib/marketplace-pagination';
import { cn } from '@/mainview/lib/utils';
import { visibleResultSelection } from "@/mainview/lib/selection";
import { extractMarkdownBody, skillMarkdownDescription } from "@/mainview/lib/markdown";

interface MarketplaceSkill {
  name: string;
  description: string | null;
  author: string | null;
  repository: string | null;
  catalog_id?: string | null;
  url?: string | null;
  skill_path?: string | null;
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
  const [marketplaceView, setMarketplaceView] = useTransientViewState("marketplace-filters", {
    source: "skills.sh",
    skillsshSort: "all-time",
    clawhubSort: "default",
    searchQuery: "",
  });
  const { source, skillsshSort, clawhubSort, searchQuery } = marketplaceView;
  const [groupByRepository, setGroupByRepository] = useState(() => {
    try { return localStorage.getItem('skiller-marketplace-group-repositories') === 'true'; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem('skiller-marketplace-group-repositories', String(groupByRepository)); } catch { /* Storage may be unavailable. */ } }, [groupByRepository]);
  const [busyAgents, setBusyAgents] = useState<Map<string, BusyOp>>(new Map());
  // selectedKey drives list highlight (instant); detail uses deferred key
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const { data: agents } = useAgents();
  const { data: localSkills } = useSkills();
  const queryClient = useQueryClient();
  const listPane = useResizable(SKILL_LIST_PANE);
  const [viewMode, setViewMode] = useSkillViewMode('skiller-marketplace-view', 'list');
  const [collapsedRepositories, setCollapsedRepositories] = useState<Set<string>>(new Set());
  const [expandedGridRepositories, setExpandedGridRepositories] = useState<Set<string>>(new Set());
  const [installRepository, setInstallRepository] = useState<string | null>(null);

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
    setMarketplaceView((previous) => ({ ...previous, searchQuery: value }));
  }, [setMarketplaceView]);

  const detectedAgents = agents?.filter((a) => a.detected) ?? [];
  const currentSort = source === "skills.sh" ? skillsshSort : clawhubSort;
  const sorts = source === "skills.sh" ? SKILLSSH_SORTS : CLAWHUB_SORTS;
  const setSort = (sort: string) => setMarketplaceView((previous) =>
    source === "skills.sh" ? { ...previous, skillsshSort: sort } : { ...previous, clawhubSort: sort },
  );
  const deferredSelectedKey = useDeferredValue(selectedKey);

  const {
    data: pages,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useInfiniteQuery<MarketplaceSkill[], Error, InfiniteData<MarketplaceSkill[]>, string[], number>({
    queryKey: ["marketplace-pages", source, currentSort, searchQuery],
    initialPageParam: 1,
    getNextPageParam: (_last, allPages) => source === 'skills.sh' && !searchQuery.trim() ? nextMarketplacePage(allPages) : undefined,
    queryFn: async ({ pageParam }): Promise<MarketplaceSkill[]> => {
      if (searchQuery.trim()) {
        return (await invoke("search_marketplace", {
          query: searchQuery.trim(),
          source,
        })) as MarketplaceSkill[];
      }
      if (source === "skills.sh") {
        return (await invoke("fetch_skillssh", {
          sort: currentSort,
          page: pageParam,
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

  const items = useMemo(() => pages ? Array.from(new Map(pages.pages.flat().map(skill => [skillKey(skill), skill])).values()) : undefined, [pages]);

  // Keep details tied to the current results, including after search or sort changes.
  useEffect(() => {
    if (!items) return;
    setSelectedKey(current => viewMode === 'grid' && current === null ? null : visibleResultSelection(current, items.map(skillKey)));
  }, [items, viewMode]);

  const selectedSkill = useMemo(() => {
    if (!items?.length || !deferredSelectedKey) return null;
    return items.find((item) => skillKey(item) === deferredSelectedKey) ?? null;
  }, [items, deferredSelectedKey]);

  const listScrollRef = useRef<HTMLDivElement>(null);
  const columns = useSkillGridColumns(listScrollRef, viewMode, !!items?.length && !isLoading && !error);
  const gridCollapsedRepositories = useMemo(() => new Set((items ?? []).flatMap(skill => {
    const repository = marketplaceRepository(skill);
    const key = repository ? `repository:${repository.toLowerCase()}` : null;
    return key && !expandedGridRepositories.has(key) ? [key] : [];
  })), [items, expandedGridRepositories]);
  const resultRows = useMemo(() => groupMarketplaceRows(items ?? [], source === 'skills.sh' && groupByRepository, viewMode === 'grid' ? gridCollapsedRepositories : collapsedRepositories), [items, source, groupByRepository, viewMode, gridCollapsedRepositories, collapsedRepositories]);
  function toggleRepository(key: string, collapsed: boolean) {
    if (viewMode === 'grid') setExpandedGridRepositories(previous => { const next = new Set(previous); if (collapsed) next.add(key); else next.delete(key); return next; });
    else setCollapsedRepositories(previous => { const next = new Set(previous); if (collapsed) next.delete(key); else next.add(key); return next; });
  }
  const visualRows = useMemo(() => packSkillRows(resultRows, columns), [resultRows, columns]);
  const virtualizer = useVirtualizer({
    count: visualRows.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: index => visualRows[index]?.[0]?.kind === 'collection_header' && !visualRows[index]?.[0]?.collapsed ? 64 : viewMode === 'grid' ? 160 : 92,
    overscan: 12,
    getItemKey: index => visualRows[index]?.map(row => row.key).join('|') ?? String(index),
  });
  useEffect(() => {
    if (!selectedKey || !items?.length) return;
    const idx = visualRows.findIndex(rows => rows.some(row => row.kind !== 'collection_header' && row.key === selectedKey));
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll when selection changes; items from same render
  }, [selectedKey, columns, groupByRepository, viewMode]);

  useLayoutEffect(() => { if (listScrollRef.current) listScrollRef.current.scrollTop = 0; virtualizer.measure(); }, [source, currentSort, searchQuery, columns, groupByRepository, viewMode]);

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
    <div className="skills-grid-surface relative flex h-full min-h-0 flex-1 bg-card!">
      {/* Main list */}
      <div
        className={cn('flex h-full min-h-0 flex-col px-3 pt-3', viewMode === 'grid' ? 'min-w-0 flex-1' : 'shrink-0')}
        style={viewMode === 'list' ? { width: listPane.width } : undefined}
      >
        <div className="flex shrink-0 flex-col space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{t('sidebar.marketplace')} <span className="ml-2 text-xs font-normal text-muted-foreground">{items ? `${items.length} loaded` : ''}</span></span>
          <SkillViewToggle value={viewMode} onChange={setViewMode} />
        </div>
        {/* Sort filters on the left; marketplace sources on the right. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
          <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-1.5">
            {SOURCES.map((s) => (
              <Button
                key={s.key}
                variant={source === s.key ? "default" : "outline"}
                size="xs"
                onClick={() => {
                  setMarketplaceView((previous) => ({ ...previous, source: s.key, searchQuery: "" }));
                  setSelectedKey(null);
                }}
              >
                {s.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="flex flex-wrap items-center gap-2">
        <div className={cn('min-w-0 w-full', viewMode === 'grid' && 'max-w-sm')}>
        <SearchInput
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder={t("marketplace.searchPlaceholder", { source: source === "skills.sh" ? "skills.sh" : "ClawHub" })}
          debounce={350}
        />
        </div>
        {source === 'skills.sh' && <Button variant={groupByRepository ? 'secondary' : 'ghost'} size="xs" className="gap-1.5" aria-pressed={groupByRepository} onClick={() => setGroupByRepository(previous => !previous)}><FolderGit2 className="size-3.5" aria-hidden />Group by repository</Button>}
        </div>
        </div>

        {/* Results (virtualized) */}
        <InsetScrollArea scroll={false} className="mt-3 flex-1">
        <div className="relative h-full min-h-0">
        {isLoading ? (
          <div role="status" aria-label={t("skills.loading")} className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : error && !items?.length ? (
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
            className="h-full min-h-0 overflow-y-auto pr-1"
          >
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map(vi => {
                const rows = visualRows[vi.index];
                if (!rows) return null;
                return <div key={vi.key} data-index={vi.index} ref={virtualizer.measureElement} className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${vi.start}px)` }}>
                  <div className={viewMode === 'grid' ? 'grid gap-3 pb-3' : 'pb-1'} style={viewMode === 'grid' ? { gridTemplateColumns: `repeat(${rows[0]?.kind === 'collection_header' && !rows[0]?.collapsed ? 1 : columns},minmax(0,1fr))` } : undefined}>
                    {rows.map(row => row.kind === 'collection_header' ? viewMode === 'grid' && row.collapsed ?
                      <SkillCardSurface key={row.key} selected={false} viewMode="grid" className="min-h-32" role="group" aria-label={`Repository ${row.repository}`}>
                        <button type="button" aria-expanded={false} title={row.repository} onClick={() => toggleRepository(row.key, true)} className="flex min-w-0 flex-1 flex-col gap-2 rounded-xl px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <span className="flex w-full min-w-0 items-center gap-2"><FolderGit2 className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="min-w-0 flex-1 truncate text-sm font-semibold">{row.repository}</span><ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /></span>
                          <span title="Skills from this repository in the loaded results" className="text-xs text-muted-foreground">{row.count} skills{row.installs != null && <span title="Combined skill installs in the loaded results; not unique users or installs of the whole repository"> · {formatInstalls(row.installs)} installs</span>}</span>
                        </button>
                        <Button variant="outline" size="sm" className="mx-3 mb-3 self-end" aria-label={`Install all skills from ${row.repository}`} onClick={() => { setSelectedKey(null); setInstallRepository(`https://github.com/${row.repository}`); }}><Download className="size-3.5" aria-hidden />Install all</Button>
                      </SkillCardSurface> :
                      <div key={row.key} role="group" aria-label={`Repository ${row.repository}`} className="my-1 flex min-h-14 min-w-0 items-center gap-2 rounded-lg border border-foreground/15 bg-muted/60 px-3 py-2 transition-colors hover:border-foreground/25 hover:bg-muted/80 focus-within:border-foreground/25 focus-within:bg-muted/80">
                      <button type="button" title={row.repository} aria-expanded={!row.collapsed} onClick={() => toggleRepository(row.key, row.collapsed)} className="flex min-w-0 flex-1 items-center gap-2 self-stretch rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', !row.collapsed && 'rotate-90')} aria-hidden />
                        <FolderGit2 className="size-4 shrink-0 text-foreground/80" aria-hidden />
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{row.repository}</span><span title="Skills from this repository in the loaded results" className="mt-0.5 block text-xs text-muted-foreground">{row.count} skills{row.installs != null && <span title="Combined skill installs in the loaded results; not unique users or installs of the whole repository"> · {formatInstalls(row.installs)} installs</span>}</span></span>
                      </button>
                      <Button variant="outline" size="sm" className="shrink-0 gap-1" aria-label={`Install all skills from ${row.repository}`} onClick={() => { setSelectedKey(null); setInstallRepository(`https://github.com/${row.repository}`); }}><Download className="size-3.5" aria-hidden />Install all</Button>
                      </div> :
                      <div key={row.key} className={viewMode === 'list' && row.kind === 'collection_child' ? 'ml-3 border-l border-border/60 pl-2' : undefined}><MarketplaceListItem viewMode={viewMode} skill={row.skill} summary={row.skill.description ?? undefined} selected={selectedKey === row.key} onSelect={setSelectedKey} /></div>)}
                  </div>
                </div>;
              })}
            </div>
            {(hasNextPage || isFetchNextPageError) && <div className="flex flex-col items-center gap-2 py-4">
              {isFetchNextPageError && <p role="alert" className="text-xs text-destructive">Could not load more skills. Your loaded results are still available.</p>}
              <Button size="sm" variant="outline" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>{isFetchingNextPage ? <><Loader2 className="size-3.5 animate-spin" aria-hidden />Loading…</> : isFetchNextPageError ? 'Retry loading more' : 'Load more skills'}</Button>
            </div>}
          </div>
        )}
        <ScrollFade viewportRef={listScrollRef} />
        </div>
        </InsetScrollArea>
      </div>

      {viewMode === 'list' && <ResizeHandle onPointerDown={listPane.onPointerDown} onMouseDown={listPane.onMouseDown} isResizing={listPane.isResizing} />}
      <SkillDetailFrame open={!!selectedKey} overlay={viewMode === 'grid'} onClose={() => setSelectedKey(null)}>
        {selectedKey && !selectedSkill ? <div className="flex min-h-0 flex-1 items-center justify-center bg-card"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : selectedSkill ?
          <MarketplaceSkillDetail skill={selectedSkill} summary={undefined} busyAgents={busyAgents} detectedAgents={detectedAgents} localSkills={localSkills} onInstall={targets => handleInstall(selectedSkill, targets)} onUninstall={handleUninstall} onClose={() => setSelectedKey(null)} /> : null}
      </SkillDetailFrame>
      {!selectedKey && viewMode === 'list' && <div className="flex min-w-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">{items?.length ? t('marketplace.selectSkillDetail') : null}</div>}
      {installRepository && <ImportWizard mode="git" initialRepoUrl={installRepository} onClose={() => setInstallRepository(null)} />}
    </div>
  );
}

const MarketplaceListItem = memo(function MarketplaceListItem({
  viewMode,
  skill,
  summary,
  selected,
  onSelect,
}: {
  viewMode: SkillViewMode;
  skill: MarketplaceSkill;
  summary?: string;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const key = skillKey(skill);
  const description = skill.description ?? summary;
  return (
    <SkillCardSurface selected={selected} viewMode={viewMode}>
    <button
      type="button"
      aria-pressed={selected}
      data-selected={selected}
      className={cn('flex w-full flex-1 flex-col rounded-xl bg-transparent px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', viewMode === 'grid' ? 'py-3' : 'py-2.5')}
      onClick={() => onSelect(key)}
    >
      <div className="flex items-center justify-between gap-2">
        <Tooltip content={skill.name}><h3 className="min-w-0 flex-1 truncate text-sm font-medium">{skill.name}</h3></Tooltip>
        {skill.installs != null && (
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {formatInstalls(skill.installs)}
          </span>
        )}
      </div>
      {description && (
        <Tooltip content={description}><p className={cn('mt-0.5 text-xs text-muted-foreground', viewMode === 'grid' ? 'line-clamp-3' : 'line-clamp-1')}>{description}</p></Tooltip>
      )}
      <div className="mt-auto flex w-full min-w-0 items-center gap-2 pt-1.5">
        {skill.author && (
          <span className="text-[11px] text-muted-foreground truncate">
            {marketplaceRepository(skill) ?? skill.author}
          </span>
        )}
        <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
          {skill.source}
        </span>
      </div>
    </button>
    </SkillCardSurface>
  );
});

function MarketplaceSkillDetail({
  skill,
  summary,
  busyAgents,
  detectedAgents,
  localSkills,
  onInstall,
  onUninstall,
  onClose,
}: {
  skill: MarketplaceSkill;
  summary?: string;
  busyAgents: Map<string, BusyOp>;
  detectedAgents: AgentConfig[];
  localSkills: Skill[] | undefined;
  onInstall: (targetAgents: string[]) => void;
  onUninstall: (skillId: string, agentSlug: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [packPickerOpen, setPackPickerOpen] = useState(false);
  const [selectedRemoteFile, setSelectedRemoteFile] = useState<string | null>(null);
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
  const isInDotagents = localSkill?.scope.type === "SharedLibrary";
  const hasExplicitAgentLinks = installedCount > 0;

  useEffect(() => {
    setSelectedRemoteFile(null);
  }, [skillKey(skill)]);

  // Defer the heavy markdown rendering so detail panel paints instantly
  const currentSkillKey = skillKey(skill);
  const deferredSkillKey = useDeferredValue(currentSkillKey);
  const isStale = deferredSkillKey !== currentSkillKey;

  const skillPath = skill.skill_path ?? (skill.source === "skills.sh" ? `skills/${skill.name}` : null);

  // Fetch the repository tree first. skills.sh identifies a skill by its path,
  // which is not reliably derivable from the visible display name.
  const { data: remoteFiles, isLoading: filesLoading, isError: filesFailed, refetch: refetchFiles } = useQuery<string[]>({
    queryKey: ["skill-files", skill.repository, skill.catalog_id, skillPath, skill.name],
    queryFn: async () => {
      if (!skill.repository && !(skill.source === "skills.sh" && skill.catalog_id)) return [];
      return (await invoke("list_remote_skill_files", {
        repoUrl: skill.repository ?? "",
        skillName: skill.name,
        skillPath,
        source: skill.source,
        catalogId: skill.catalog_id,
      })) as string[];
    },
    enabled: (!!skill.repository || (skill.source === "skills.sh" && !!skill.catalog_id)) && !isStale,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });

  const visibleFiles = remoteFiles ?? [];
  const activeRemoteFile = selectedRemoteFile && visibleFiles.includes(selectedRemoteFile)
    ? selectedRemoteFile
    : visibleFiles[0] ?? null;

  // Fetch the selected file via React Query — cached across skill selections.
  const { data: remoteDocument, isLoading: contentLoading, isError: contentFailed, refetch: refetchContent } = useQuery<
    string | null
  >({
    queryKey: ["skill-content", skill.repository, skill.catalog_id, skillPath, activeRemoteFile],
    queryFn: async () => {
      const repoUrl = skill.repository ?? "";
      if ((!repoUrl && !(skill.source === "skills.sh" && skill.catalog_id)) || !activeRemoteFile) return null;
      const text = (await invoke("fetch_remote_skill_content", {
        repoUrl,
        skillName: skill.name,
        skillPath,
        filePath: activeRemoteFile,
        source: skill.source,
        catalogId: skill.catalog_id,
      })) as string;
      return text;
    },
    enabled: (!!skill.repository || (skill.source === "skills.sh" && !!skill.catalog_id)) && !!activeRemoteFile && !isStale && !filesLoading,
    staleTime: 30 * 60 * 1000, // SKILL.md content rarely changes; cache 30 min
    retry: false,
  });
  const remoteContent = remoteDocument ? extractMarkdownBody(remoteDocument) : null;
  const remoteSummary = remoteDocument ? extractFrontmatterDescription(remoteDocument) : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <h3 className="truncate text-sm font-medium">{t("marketplace.detail")}</h3>
        <Button variant="ghost" size="icon-xs" aria-label="Close skill details" onClick={onClose}><X className="size-3.5" /></Button>
      </div>

      {/* Content */}
      <InsetScrollArea className="min-h-0 flex-1" scrollClassName="min-h-0 p-4 space-y-5">
        {/* Header: Name + install action */}
        <div>
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <h2 className="truncate text-base font-[590] leading-6">{skill.name}</h2>
              <div className="shrink-0">
                <DropdownMenu>
                <Tooltip content={t("skills.action")}>
                  <DropdownMenuTrigger render={<button type="button" className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.08]" aria-label={t("skills.action")} />}>
                    <MoreHorizontal className="size-4 translate-y-px" />
                  </DropdownMenuTrigger>
                </Tooltip>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => setPackPickerOpen(true)} disabled={anyBusy || (!localSkill && !skill.repository)}><Layers />Add to pack…</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setProjectPickerOpen(true)} disabled={!skill.repository}>
                    <FolderKanban />{t("marketplace.installToProject")}
                  </DropdownMenuItem>
                  {skill.repository && <DropdownMenuItem onClick={() => openUrl(skill.repository!)}><ExternalLink />{t("marketplace.viewRepository")}</DropdownMenuItem>}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {hasAnyInstalled ? (
                <Tooltip content={isInDotagents && !hasExplicitAgentLinks
                  ? t("marketplace.availableFromDotagents")
                  : t("marketplace.installed")}>
                <span
                  className="inline-flex items-center gap-1 rounded-full badge-success px-2.5 py-1 text-xs font-medium"
                >
                  <Check className="size-3" />
                  {isInDotagents && !hasExplicitAgentLinks
                    ? t("marketplace.inDotagents")
                    : allInstalled
                      ? t("marketplace.installed")
                      : `${installedCount}/${detectedAgents.length}`}
                </span>
                </Tooltip>
              ) : (
                <Tooltip content={t("marketplace.installAllHint")}>
                  <span className="inline-flex">
                    <Button
                      variant="default"
                      size="sm"
                      className="gap-1.5 min-w-[100px]"
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
                  </span>
                </Tooltip>
              )}
            </div>
          </div>
          {(skill.description ?? summary ?? remoteSummary) && (
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {skill.description ?? summary ?? remoteSummary}
            </p>
          )}
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

        {/* Per-agent install status. A shared-library skill is already
            summarised by the compact In .agents badge above. */}
        {!isInDotagents || hasExplicitAgentLinks ? (detectedAgents.length > 0 && (
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
        )) : null}

        {/* Package Info */}
        <InfoSection label={t("marketplace.packageInfo")}>
          <InfoGrid>
            {skill.repository && (
              <InfoRow label={t("marketplace.repository")}>
                <AppLink
                  className="text-xs text-primary hover:underline font-mono break-all text-left inline-flex items-start gap-1 cursor-pointer"
                  href={skill.repository!}
                >
                  {skill.repository}
                  <ExternalLink className="size-3 shrink-0 mt-0.5" />
                </AppLink>
              </InfoRow>
            )}
            {skill.url && (
              <InfoRow label="URL">
                <AppLink
                  className="inline-flex items-start gap-1 break-all text-left font-mono text-xs text-primary hover:underline"
                  href={skill.url!}
                >
                  {skill.url}
                  <ExternalLink className="mt-0.5 size-3 shrink-0" />
                </AppLink>
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

        {/* Skill files from the remote source */}
        <InfoSection label={t("marketplace.skillContent")}>
          {isStale || filesLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t("marketplace.loading")}
            </div>
          ) : filesFailed ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-4 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Couldn’t list this skill’s files.</p>
              <p className="mt-1">The source may be temporarily unavailable.</p>
              <Button size="xs" variant="outline" className="mt-3" onClick={() => void refetchFiles()}>Retry</Button>
            </div>
          ) : visibleFiles.length === 0 ? (
            <p className="rounded-lg border border-border/70 bg-muted/20 p-4 text-xs text-muted-foreground">This source has no readable skill files.</p>
          ) : (
            <SkillContentBrowser
              files={visibleFiles}
              selectedFile={activeRemoteFile}
              onSelectFile={setSelectedRemoteFile}
              ariaLabel="Files in this marketplace skill"
            >
                {contentLoading ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    {t("marketplace.loading")}
                  </div>
                ) : remoteContent ? (
                  <MarkdownContent content={remoteContent} />
                ) : (
                  <div className="text-xs text-muted-foreground">
                    <p>{contentFailed ? "Couldn’t load this file from its source." : skill.repository ? t("marketplace.couldNotLoad") : t("marketplace.noRepoUrl")}</p>
                    {contentFailed && <Button size="xs" variant="outline" className="mt-3" onClick={() => void refetchContent()}>Retry</Button>}
                  </div>
                )}
            </SkillContentBrowser>
          )}
        </InfoSection>
      </InsetScrollArea>

      {packPickerOpen && <MarketplacePackPicker skill={skill} localSkill={localSkill} onClose={() => setPackPickerOpen(false)} />}
      {projectPickerOpen && (
        <InstallToProjectPicker
          skillName={skill.name}
          onInstall={async (projectPath) => {
            await invoke("install_marketplace_skill_to_project", {
              skill,
              projectPath,
            });
          }}
          onClose={() => setProjectPickerOpen(false)}
        />
      )}
    </div>
  );
}


function extractFrontmatterDescription(markdown: string): string | null {
  return skillMarkdownDescription(markdown);
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
      return !!localRepo && localRepo === remoteRepo;
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
