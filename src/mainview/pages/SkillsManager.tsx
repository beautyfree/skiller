import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useTransition,
  useDeferredValue,
  memo,
  useRef,
  Fragment,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Puzzle,
  Copy,
  X,
  Loader2,
  Info,
  Pencil,
  ArrowLeft,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Users,
  MoreHorizontal,
  Trash2,
  LayoutList,
  FileText,
  Ban,
  FolderKanban,
} from "lucide-react";
import { invoke, listen, revealItemInDir, openUrl } from "@/mainview/lib/native";
import {
	approxTokensFromChars,
	formatApproxTok,
} from "@/shared/skill-footprint";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { useSkills, installedAgents, allAgents, type Skill } from "@/mainview/hooks/useSkills";
import { SkillAgentList, installedAgentCount, busyKey, type BusyOp } from "@/mainview/components/SkillAgentList";
import { useRepos } from "@/mainview/hooks/useRepos";

/** Skill extended with optional repo origin */
type SkillWithRepo = Skill & { _repoName?: string };
import { useAgents, type AgentConfig } from "@/mainview/hooks/useAgents";
import { useResizable } from "@/mainview/hooks/useResizable";
import ResizeHandle from "@/mainview/components/ResizeHandle";
import { InsetScrollArea } from "@/mainview/components/InsetScrollArea";
import { Button } from "@/mainview/components/ui/button";
import InstallToProjectPicker from "@/mainview/components/InstallToProjectPicker";
import SearchInput from "@/mainview/components/SearchInput";
import MarkdownContent from "@/mainview/components/MarkdownContent";
import { useToast } from "@/mainview/components/ToastProvider";
import { cn, nativeSelectClass, nativeSelectChevronClass } from "@/mainview/lib/utils";
import { extractMarkdownBody } from "@/mainview/lib/markdown";
import { AgentIcon } from "@/mainview/components/AgentIcon";

/** Deferred outside-dismiss so opening click / contextmenu does not instantly close popovers. */
function useMenuDismissal(
  open: boolean,
  onClose: () => void,
  rootRef: RefObject<HTMLElement | null>,
  floatingRef?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    let cleanup: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      const onPointerDown = (e: PointerEvent) => {
        const target = e.target as Node;
        if (rootRef.current?.contains(target)) return;
        if (floatingRef?.current?.contains(target)) return;
        onClose();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      };
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("keydown", onKey);
      cleanup = () => {
        document.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("keydown", onKey);
      };
    }, 0);
    return () => {
      window.clearTimeout(timer);
      cleanup?.();
    };
  }, [open, onClose, rootRef, floatingRef]);
}

function AgentFilterDropdown({
  value,
  detectedAgents,
  onChange,
  allLabel,
  ariaLabel,
}: {
  value: string;
  detectedAgents: AgentConfig[];
  onChange: (slug: string) => void;
  allLabel: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useMenuDismissal(open, close, rootRef);

  const selectedName =
    value === "all"
      ? allLabel
      : detectedAgents.find((a) => a.slug === value)?.name ?? value;

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <button
        type="button"
        className={cn(
          nativeSelectClass,
          "flex h-8 w-full min-w-0 items-center gap-2 pl-3 pr-8 text-left text-xs",
        )}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
      >
        {value === "all" ? (
          <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <AgentIcon slug={value} className="size-4" />
        )}
        <span className="min-w-0 flex-1 truncate">{selectedName}</span>
      </button>
      <ChevronDown className={nativeSelectChevronClass} aria-hidden />
      {open && (
        <ul
          className="absolute left-0 top-full z-50 mt-1 grid max-h-56 min-w-full w-max max-w-[min(100vw-1.5rem,48rem)] grid-cols-1 overflow-auto rounded-xl border border-border bg-card/95 p-1 shadow-lg backdrop-blur-md"
          role="listbox"
        >
          <li role="presentation" className="min-w-0">
            <button
              type="button"
              role="option"
              aria-selected={value === "all"}
              className={cn(
                "flex w-full min-w-max items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs whitespace-nowrap",
                value === "all"
                  ? "bg-secondary/60"
                  : "hover:bg-black/[0.05] dark:hover:bg-white/[0.06]",
              )}
              onClick={() => {
                onChange("all");
                setOpen(false);
              }}
            >
              <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>{allLabel}</span>
            </button>
          </li>
          {detectedAgents.map((agent) => (
            <li key={agent.slug} role="presentation" className="min-w-0">
              <button
                type="button"
                role="option"
                aria-selected={value === agent.slug}
                className={cn(
                  "flex w-full min-w-max items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs whitespace-nowrap",
                  value === agent.slug
                    ? "bg-secondary/60"
                    : "hover:bg-black/[0.05] dark:hover:bg-white/[0.06]",
                )}
                onClick={() => {
                  onChange(agent.slug);
                  setOpen(false);
                }}
              >
                <AgentIcon slug={agent.slug} className="size-4 shrink-0" />
                <span>{agent.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function SkillsManager() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: skills, isLoading } = useSkills();
  const { data: agents } = useAgents();
  const { data: repos } = useRepos();
  // Fetch skills from all subscribed repos
  const repoSkillQueries = useQueries({
    queries: (repos ?? []).map((repo) => ({
      queryKey: ["repo-skills", repo.id],
      queryFn: async () =>
        (await invoke("list_repo_skills", { repoIdParam: repo.id })) as Skill[],
      staleTime: 30 * 1000,
    })),
  });

  // Stable data reference for repo skills to avoid re-renders
  const repoSkillsData = repoSkillQueries.map((q) => q.data);

  // Merge local skills + repo skills (dedup by skill id, local wins)
  // For installed skills that match a repo skill, carry over the repo source info
  const mergedSkills = useMemo(() => {
    const localSkills = skills ?? [];
    const localById = new Map(localSkills.map((s) => [s.id, s]));

    // Build a map of repo skill source info by skill id
    const repoSourceById = new Map<string, { source: unknown; repoName: string }>();
    repoSkillsData.forEach((data, idx) => {
      if (data) {
        const repoName = repos?.[idx]?.name ?? "Repo";
        for (const s of data) {
          repoSourceById.set(s.id, { source: s.source, repoName });
        }
      }
    });

    // Enrich local skills with repo source info where available
    const enrichedLocal: SkillWithRepo[] = localSkills.map((s) => {
      const repoInfo = repoSourceById.get(s.id);
      if (repoInfo) {
        return { ...s, source: repoInfo.source, _repoName: repoInfo.repoName };
      }
      return s;
    });

    // Add repo-only skills (not installed locally)
    // Clear their virtual installations so they don't appear as "directly installed"
    const repoOnly: SkillWithRepo[] = [];
    repoSkillsData.forEach((data, idx) => {
      if (data) {
        const repoName = repos?.[idx]?.name ?? "Repo";
        for (const s of data) {
          if (!localById.has(s.id)) {
            repoOnly.push({ ...s, installations: [], _repoName: repoName });
          }
        }
      }
    });

    return [...enrichedLocal, ...repoOnly];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills, ...repoSkillsData, repos]);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const agentParam = searchParams.get("agent") ?? "all";
  const skillParam = searchParams.get("skill");
  const installParam = searchParams.get("install");
  const [filter, setFilter] = useState<string>(agentParam);
  const [installFilter, setInstallFilter] = useState<"all" | "direct" | "inherited-only">(() =>
    installParam === "direct" || installParam === "inherited-only" ? installParam : "all",
  );
  const [busyAgents, setBusyAgents] = useState<Map<string, BusyOp>>(new Map());
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const isSearchStale = deferredSearch !== searchQuery;
  // selectedId drives list highlight (instant); selectedSkill drives detail (deferred)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [isPending, startTransition] = useTransition();
  const [panelMode, setPanelMode] = useState<"detail" | "editor">("detail");
  const listPane = useResizable({
    initial: 300,
    min: 200,
    max: 500,
    storageKey: "skills-list-width",
  });

  // Sync agent filter from URL. When the agent changes (e.g. sidebar click), drop the
  // selected skill so the auto-select effect below picks the first skill applicable to
  // the new agent. First render doesn't clear so deep links (?skill=) still work.
  const prevAgentParam = useRef(agentParam);
  useEffect(() => {
    if (prevAgentParam.current !== agentParam) {
      setSelectedId(null);
      setSelectedSkill(null);
      prevAgentParam.current = agentParam;
    }
    setFilter(agentParam);
  }, [agentParam]);

  useEffect(() => {
    setInstallFilter(
      installParam === "direct" || installParam === "inherited-only" ? installParam : "all",
    );
  }, [installParam]);

  // Skills visible for the current agent filter, ignoring search (used for URL skill id + auto-select)
  const listWithoutSearch = useMemo(() => {
    const available = mergedSkills?.filter((s) => allAgents(s).length > 0);
    const byAgent = filter === "all"
      ? available
      : available?.filter((s) => allAgents(s).includes(filter));
    return byAgent?.filter((s) => matchesInstallFilter(s, installFilter));
  }, [mergedSkills, filter, installFilter]);

  /** Sum of listing-slice ~tok and full-file ~tok for skills visible under the agent filter (no budget / caps in UI). */
  const agentTokenTotals = useMemo(() => {
    if (filter === "all" || !listWithoutSearch?.length) return null;
    let sumListingChars = 0;
    let sumFullChars = 0;
    for (const s of listWithoutSearch) {
      sumListingChars += s.footprint_listing_slice_chars ?? 0;
      sumFullChars += s.footprint_skill_md_chars ?? 0;
    }
    return {
      listingTok: approxTokensFromChars(sumListingChars),
      fullTok: approxTokensFromChars(sumFullChars),
    };
  }, [filter, listWithoutSearch]);

  // Apply ?skill= deep link or auto-select first row when nothing is selected.
  // Prefer a skill that is actually visible in the tree: a top-level row (either
  // standalone or a collection parent). A collection child whose parent isn't in the
  // filtered list is not directly visible, so skip it.
  useEffect(() => {
    if (!listWithoutSearch?.length) return;

    if (skillParam) {
      const found = listWithoutSearch.find((s) => s.id === skillParam);
      if (found) {
        setSelectedId(found.id);
        setSelectedSkill(found);
        setPanelMode("detail");
        return;
      }
    }

    // Prefer a top-level (non-child) skill — collection children are only visible when
    // their parent is expanded, and are hidden entirely when the parent isn't in the
    // filtered list. Fall back to the first item if there's nothing top-level.
    const firstTopLevel =
      listWithoutSearch.find((s) => !s.collection) ?? listWithoutSearch[0];

    setSelectedId((current) => (current != null ? current : firstTopLevel.id));
    setSelectedSkill((current) => (current != null ? current : firstTopLevel));
  }, [mergedSkills, filter, skillParam, listWithoutSearch]);

  // Keep selectedSkill in sync when underlying data refreshes (e.g. filesystem changes)
  useEffect(() => {
    if (selectedId && mergedSkills?.length) {
      const refreshed = mergedSkills.find((s) => s.id === selectedId);
      if (refreshed) {
        setSelectedSkill(refreshed);
      }
    }
  }, [mergedSkills, selectedId]);

  function changeFilter(f: string) {
    setFilter(f);
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (f === "all") p.delete("agent");
      else p.set("agent", f);
      p.delete("skill");
      return p;
    });
    setSelectedId(null);
    setSelectedSkill(null);
  }

  function changeInstallFilter(mode: "all" | "direct" | "inherited-only") {
    setInstallFilter(mode);
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (mode === "all") p.delete("install");
        else p.set("install", mode);
        p.delete("skill");
        return p;
      },
      { replace: true },
    );
    setSelectedId(null);
    setSelectedSkill(null);
  }

  const selectSkill = useCallback(
    (skill: Skill) => {
      setSelectedId(skill.id);
      setPanelMode("detail");
      startTransition(() => {
        setSelectedSkill(skill);
      });
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set("skill", skill.id);
          if (filter === "all") p.delete("agent");
          else p.set("agent", filter);
          if (installFilter === "all") p.delete("install");
          else p.set("install", installFilter);
          return p;
        },
        { replace: true }
      );
    },
    [filter, installFilter, setSearchParams]
  );

  function closePanel() {
    setSelectedId(null);
    setSelectedSkill(null);
    setPanelMode("detail");
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete("skill");
        return p;
      },
      { replace: true }
    );
  }

  const detectedAgents = agents?.filter((a) => a.detected) ?? [];
  const [confirmIntent, setConfirmIntent] = useState<
    | { kind: "uninstall_all" | "unlink_inherited"; skill: Skill }
    | null
  >(null);
  const [confirmRunning, setConfirmRunning] = useState(false);

  // Filter by agent (direct + inherited), then by search query
  const filtered = useMemo(() => {
    // Only show skills that have at least one installation (direct or inherited)
    const available = mergedSkills?.filter((s) => allAgents(s).length > 0);
    let list = filter === "all"
      ? available
      : available?.filter((s) => allAgents(s).includes(filter));
    list = list?.filter((s) => matchesInstallFilter(s, installFilter));
    if (deferredSearch.trim()) {
      const q = deferredSearch.toLowerCase();
      list = list?.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          (s.description && s.description.toLowerCase().includes(q))
      );
    }
    return list;
  }, [mergedSkills, filter, installFilter, deferredSearch]);

  // Skills managed by a collection (parent + children) — read-only, no sync/uninstall
  const collectionSkillIds = useMemo(() => {
    const ids = new Set<string>();
    const collectionNames = new Set<string>();
    for (const s of mergedSkills ?? []) {
      if (s.collection) {
        ids.add(s.id);
        collectionNames.add(s.collection);
      }
    }
    // Also mark the parent skill
    for (const s of mergedSkills ?? []) {
      if (collectionNames.has(s.id)) ids.add(s.id);
    }
    return ids;
  }, [mergedSkills]);

  async function refreshAndReselect() {
    // Force a fresh scan, bypassing cache
    const updated = await queryClient.fetchQuery<Skill[]>({
      queryKey: ["skills"],
      queryFn: async () =>
        (await invoke("scan_all_skills")) as Skill[],
      staleTime: 0,
    });
    // Also invalidate so other components pick up the change
    queryClient.setQueryData(["skills"], updated);
    if (selectedId) {
      const refreshed = updated?.find((s) => s.id === selectedId);
      setSelectedSkill(refreshed ?? null);
      if (!refreshed) setSelectedId(null);
    }
    return updated;
  }

  async function handleUninstall(skillId: string, agentSlug: string) {
    const k = busyKey(skillId, agentSlug);
    setBusyAgents((prev) => new Map(prev).set(k, "uninstalling"));
    try {
      await invoke("uninstall_skill", { skillId, agentSlug });
      await refreshAndReselect();
    } catch (e) {
      console.error("Uninstall failed:", e instanceof Error ? e.message : String(e));
      toast(t("skills.uninstallFailed"), "destructive");
    } finally {
      setBusyAgents((prev) => { const next = new Map(prev); next.delete(k); return next; });
    }
  }

  async function handleUninstallAll(skill: Skill) {
    const slugs = installedAgents(skill);
    if (!slugs.length) return;
    setBusyAgents((prev) => {
      const next = new Map(prev);
      slugs.forEach((s) => next.set(busyKey(skill.id, s), "uninstalling"));
      return next;
    });
    try {
      await invoke("uninstall_skill_all", { skillId: skill.id });
      setSelectedId(null);
      setSelectedSkill(null);
      const updated = await refreshAndReselect();
      const remaining = updated.find((s) => s.id === skill.id);
      const remainingDirect = remaining ? directInstallSlugs(remaining).length : 0;
      const inheritedOnlyRemaining =
        !!remaining &&
        remainingDirect === 0 &&
        remaining.installations.some((i) => i.is_inherited);
      if (inheritedOnlyRemaining) {
        toast(t("skills.uninstallAllDirectDoneInheritedRemains"));
      } else {
        toast(t("skills.uninstallAllSuccess"));
      }
    } catch (e) {
      console.error("Uninstall all failed:", e instanceof Error ? e.message : String(e));
      toast(t("skills.uninstallFailed"), "destructive");
    } finally {
      setBusyAgents(new Map());
    }
  }

  async function handleUnlinkInherited(skill: Skill) {
    try {
      await invoke("unlink_inherited_skill", { skillId: skill.id });
      setSelectedId(null);
      setSelectedSkill(null);
      await refreshAndReselect();
      toast(t("skills.unlinkInheritedSuccess"));
    } catch (e) {
      console.error("Unlink inherited failed:", e instanceof Error ? e.message : String(e));
      toast(t("skills.unlinkInheritedFailed"), "destructive");
    }
  }

  function requestUninstallAll(skill: Skill) {
    setConfirmIntent({ kind: "uninstall_all", skill });
  }

  function requestUnlinkInherited(skill: Skill) {
    setConfirmIntent({ kind: "unlink_inherited", skill });
  }

  async function runConfirmedAction() {
    if (!confirmIntent || confirmRunning) return;
    setConfirmRunning(true);
    try {
      if (confirmIntent.kind === "uninstall_all") {
        await handleUninstallAll(confirmIntent.skill);
      } else {
        await handleUnlinkInherited(confirmIntent.skill);
      }
      setConfirmIntent(null);
    } finally {
      setConfirmRunning(false);
    }
  }

  async function handleSync(skillId: string, targetAgents: string[]) {
    setBusyAgents((prev) => {
      const next = new Map(prev);
      targetAgents.forEach((a) => next.set(busyKey(skillId, a), "syncing"));
      return next;
    });
    try {
      await invoke("sync_skill", { skillId, targetAgents });
      await refreshAndReselect();
    } catch (e) {
      console.error("Sync failed:", e instanceof Error ? e.message : String(e));
      toast(t("skills.syncFailed"), "destructive");
    } finally {
      setBusyAgents((prev) => {
        const next = new Map(prev);
        targetAgents.forEach((a) => next.delete(busyKey(skillId, a)));
        return next;
      });
    }
  }

  const [updating, setUpdating] = useState(false);

  async function handleUpdate(skillId: string) {
    setUpdating(true);
    try {
      await invoke("update_skill", { skillId });
      await refreshAndReselect();
      toast(t("skills.updateSuccess"));
    } catch (e) {
      console.error("Update failed:", e instanceof Error ? e.message : String(e));
      toast(t("skills.updateFailed"), "destructive");
    } finally {
      setUpdating(false);
    }
  }

  // ─── Update All ───
  const [updatingAll, setUpdatingAll] = useState(false);
  const [updateAllProgress, setUpdateAllProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ done: number; total: number; current_skill: string }>(
      "skill_update_progress",
      (event) => {
        setUpdateAllProgress({ done: event.payload.done, total: event.payload.total });
      },
    ).then((cleanup) => { unlisten = cleanup; });
    return () => { unlisten?.(); };
  }, []);

  async function handleUpdateAll() {
    setUpdatingAll(true);
    setUpdateAllProgress(null);
    try {
      const result = (await invoke("update_all_skills")) as {
        updated: string[];
        failed: [string, string][];
        skipped: number;
      };
      await queryClient.invalidateQueries({ queryKey: ["skills"] });
      await refreshAndReselect();

      if (result.failed.length === 0 && result.updated.length > 0) {
        toast(t("skills.updateAllDone", { updated: result.updated.length }));
      } else if (result.updated.length > 0) {
        toast(t("skills.updateAllPartial", { updated: result.updated.length, failed: result.failed.length }), "destructive");
      } else if (result.failed.length > 0) {
        toast(t("skills.updateAllFailed"), "destructive");
      }
    } catch (e) {
      console.error("Update all failed:", e instanceof Error ? e.message : String(e));
      toast(t("skills.updateAllFailed"), "destructive");
    } finally {
      setUpdatingAll(false);
      setUpdateAllProgress(null);
    }
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Main list: header + filters scroll with pane; skill rows are virtualized */}
      <div
        className="flex h-full min-h-0 shrink-0 flex-col p-4"
        style={{ width: listPane.width }}
      >
        <div className="flex shrink-0 flex-col space-y-3">
        <div className="flex items-center justify-between relative z-20">
          <div className="flex min-h-[22px] items-center">
            {mergedSkills && (
              <span className="text-sm text-muted-foreground tabular-nums">
                ({filtered?.length})
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size={updatingAll ? "sm" : "icon-sm"}
            className={updatingAll ? "gap-1.5 text-xs" : ""}
            title={t("skills.updateAll")}
            disabled={updatingAll || isLoading}
            onClick={handleUpdateAll}
          >
            <RefreshCw className={`size-3.5 ${updatingAll ? "animate-spin" : ""}`} />
            {updatingAll && (
              <span>
                {updateAllProgress
                  ? t("skills.updateAllProgress", { done: updateAllProgress.done, total: updateAllProgress.total })
                  : t("skills.updating")}
              </span>
            )}
          </Button>
        </div>

        {/* Agent + install source (single row, 50/50) */}
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <AgentFilterDropdown
            value={filter}
            detectedAgents={detectedAgents}
            onChange={changeFilter}
            allLabel={t("skills.filterAll")}
            ariaLabel={t("skills.filterAgentAria")}
          />
          <div className="relative min-w-0">
            <select
              className={cn(nativeSelectClass, "h-8 w-full pl-3 pr-8 text-xs")}
              value={installFilter}
              onChange={(e) =>
                changeInstallFilter(e.target.value as "all" | "direct" | "inherited-only")
              }
              aria-label={t("skills.filterInstallAria")}
            >
              <option value="all">{t("skills.filterInstallAll")}</option>
              <option value="direct">{t("skills.filterDirect")}</option>
              <option value="inherited-only">{t("skills.filterInheritedOnly")}</option>
            </select>
            <ChevronDown className={nativeSelectChevronClass} aria-hidden />
          </div>
        </div>

        {/* Search */}
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={t("skills.filterPlaceholder")}
          debounce={0}
        />

        {filter !== "all" && agentTokenTotals && (
          <div
            className="flex items-center justify-center gap-3 rounded-xl border border-border/50 bg-muted/25 px-2 py-1.5"
            title={t("skills.agentTokensBarOverview")}
          >
            <div
              className="flex cursor-help items-center gap-1.5 text-[11px] font-medium tabular-nums text-foreground/90"
              title={t("skills.agentTokenTooltipListingSum")}
            >
              <LayoutList className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span>{formatApproxTok(agentTokenTotals.listingTok)}</span>
            </div>
            <span className="h-3 w-px shrink-0 bg-border" aria-hidden />
            <div
              className="flex cursor-help items-center gap-1.5 text-[11px] font-medium tabular-nums text-foreground/90"
              title={t("skills.agentTokenTooltipFullSum")}
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span>{formatApproxTok(agentTokenTotals.fullTok)}</span>
            </div>
          </div>
        )}
        </div>

        {/* Skill list (virtualized) */}
        <InsetScrollArea scroll={false} className="mt-3 flex-1">
        {isLoading ? (
          <div className="space-y-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-transparent px-3 py-2.5 space-y-2">
                <div className="h-4 w-28 rounded animate-skeleton" />
                <div className="h-3 w-40 rounded animate-skeleton" />
                <div className="flex gap-1">
                  <div className="h-4 w-12 rounded-full animate-skeleton" />
                </div>
              </div>
            ))}
          </div>
        ) : !filtered?.length ? (
          <div className="rounded-2xl border border-dashed border-black/[0.06] dark:border-white/[0.06] p-8 text-center">
            <div className="inline-flex size-12 items-center justify-center rounded-xl glass mb-3">
              <Puzzle className="size-6 text-primary/40" />
            </div>
            <p className="text-sm text-muted-foreground">{t("skills.noSkillsFound")}</p>
          </div>
        ) : (
          <SkillListGrouped
            skills={filtered}
            selectedId={selectedId}
            agents={agents}
            activeAgentSlug={filter !== "all" && filter !== "installed-anywhere" ? filter : null}
            onSelect={selectSkill}
            onReveal={revealItemInDir}
            onUninstallAll={requestUninstallAll}
            onUnlinkInherited={requestUnlinkInherited}
            onUninstallFromAgent={async (skill, agentSlug) => {
              // Composite remove: uninstall direct + detach shared if both
              // exist. Mirrors the detail-panel smart-remove so the list
              // menu behaves the same way.
              const agent = detectedAgents.find((a) => a.slug === agentSlug);
              if (!agent) return;
              const installedOnActive = skill.installations.some(
                (i) => i.agent_slug === agentSlug && !i.is_inherited,
              );
              const inheritedOnActive = skill.installations.some(
                (i) => i.agent_slug === agentSlug && i.is_inherited,
              );
              const preservedAgents = detectedAgents.filter(
                (a) =>
                  a.slug !== agentSlug &&
                  skill.installations.some(
                    (i) => i.agent_slug === a.slug && i.is_inherited,
                  ),
              );
              let confirmMsg: string;
              if (installedOnActive && inheritedOnActive) {
                confirmMsg = t("skills.removeFromAgentConfirmBoth", {
                  skill: skill.name || skill.id,
                  agent: agent.name,
                  preservedNames:
                    preservedAgents.map((a) => a.name).join(", ") ||
                    t("skills.detachNoOthers"),
                  preservedCount: preservedAgents.length,
                });
              } else if (inheritedOnActive) {
                confirmMsg = t("skills.detachConfirm", {
                  skill: skill.name || skill.id,
                  agent: agent.name,
                  preservedCount: preservedAgents.length,
                  preservedNames:
                    preservedAgents.map((a) => a.name).join(", ") ||
                    t("skills.detachNoOthers"),
                });
              } else {
                confirmMsg = t("skills.removeFromAgentConfirmDirect", {
                  skill: skill.name || skill.id,
                  agent: agent.name,
                });
              }
              if (!window.confirm(confirmMsg)) return;
              try {
                if (installedOnActive) {
                  await handleUninstall(skill.id, agentSlug);
                }
                if (inheritedOnActive) {
                  await invoke("detach_shared_skill", {
                    skillId: skill.id,
                    removeFromAgent: agentSlug,
                  });
                }
                await refreshAndReselect();
              } catch (err) {
                toast(
                  `Remove failed: ${err instanceof Error ? err.message : String(err)}`,
                  "destructive",
                );
              }
            }}
            isSearchStale={isSearchStale}
          />
        )}
        </InsetScrollArea>
      </div>

      <ResizeHandle onMouseDown={listPane.onMouseDown} />

      {!selectedId && (
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-6">
          {filtered && filtered.length > 0 ? (
            <div className="text-center">
              <div className="inline-flex size-16 items-center justify-center rounded-2xl glass mb-4">
                <Puzzle className="size-8 text-primary/30" />
              </div>
              <p className="max-w-xs text-sm text-muted-foreground/80">
                {t("skills.selectToView")}
              </p>
            </div>
          ) : null}
        </div>
      )}

      {/* Detail / Editor panel */}
      {selectedId && panelMode === "detail" && (
        isPending || !selectedSkill ? (
          <div className="flex-1 min-w-0 m-2 ml-0 flex items-center justify-center rounded-2xl glass-panel">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <SkillDetail
            skill={selectedSkill}
            detectedAgents={detectedAgents}
            activeAgentSlug={filter !== "all" && filter !== "installed-anywhere" ? filter : null}
            busyAgents={busyAgents}
            updating={updating}
            readOnly={collectionSkillIds.has(selectedSkill.id)}
            onClose={closePanel}
            onEdit={() => setPanelMode("editor")}
            onSync={handleSync}
            onUpdate={handleUpdate}
            onUninstall={handleUninstall}
            onUninstallAll={requestUninstallAll}
            onUnlinkInherited={requestUnlinkInherited}
          />
        )
      )}
      {selectedSkill && panelMode === "editor" && (
        <SkillEditor
          skill={selectedSkill}
          onClose={closePanel}
          onBack={() => setPanelMode("detail")}
        />
      )}

      <SkillNameConfirmDialog
        open={confirmIntent !== null}
        actionKind={confirmIntent?.kind ?? "uninstall_all"}
        skillName={confirmIntent?.skill.name ?? ""}
        onCancel={() => {
          if (confirmRunning) return;
          setConfirmIntent(null);
        }}
        onConfirm={runConfirmedAction}
        pending={confirmRunning}
      />
    </div>
  );
}

type SkillVirtualRow =
  | { kind: "standalone"; skill: SkillWithRepo; key: string }
  | {
      kind: "collection_header";
      parent: SkillWithRepo;
      childCount: number;
      collapsed: boolean;
      key: string;
    }
  | { kind: "collection_child"; skill: SkillWithRepo; key: string };

function SkillListGrouped({
  skills,
  selectedId,
  agents,
  activeAgentSlug,
  onSelect,
  onReveal,
  onUninstallAll,
  onUnlinkInherited,
  onUninstallFromAgent,
  isSearchStale,
}: {
  skills: SkillWithRepo[];
  selectedId: string | null;
  agents: import("@/mainview/hooks/useAgents").AgentConfig[] | undefined;
  activeAgentSlug?: string | null;
  onSelect: (skill: SkillWithRepo) => void;
  onReveal: (path: string) => void;
  onUninstallAll: (skill: SkillWithRepo) => void;
  onUnlinkInherited: (skill: SkillWithRepo) => void;
  onUninstallFromAgent?: (skill: SkillWithRepo, agentSlug: string) => void;
  isSearchStale: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  // Group skills: collection skills grouped under their parent, standalone skills as-is
  const groups = useMemo(() => {
    // Collect child skills by collection name
    const children = new Map<string, SkillWithRepo[]>();
    for (const skill of skills) {
      if (skill.collection) {
        const list = children.get(skill.collection) ?? [];
        list.push(skill);
        children.set(skill.collection, list);
      }
    }
    // Find collection names that have children
    const collectionNames = new Set(children.keys());

    type Group =
      | { type: "standalone"; skill: SkillWithRepo }
      | { type: "collection"; parent: SkillWithRepo; children: SkillWithRepo[] };
    const result: Group[] = [];
    for (const skill of skills) {
      if (skill.collection) {
        // Skip child skills — they're nested under the parent
        continue;
      }
      if (collectionNames.has(skill.id)) {
        // This skill is the parent of a collection
        result.push({ type: "collection", parent: skill, children: children.get(skill.id)! });
      } else {
        result.push({ type: "standalone", skill });
      }
    }
    return result;
  }, [skills]);

  const flatRows = useMemo((): SkillVirtualRow[] => {
    const rows: SkillVirtualRow[] = [];
    for (const group of groups) {
      if (group.type === "standalone") {
        rows.push({
          kind: "standalone",
          skill: group.skill,
          key: `s-${group.skill.id}`,
        });
        continue;
      }
      const isCollapsed = collapsed[group.parent.id] ?? true;
      rows.push({
        kind: "collection_header",
        parent: group.parent,
        childCount: group.children.length,
        collapsed: isCollapsed,
        key: `h-${group.parent.id}`,
      });
      if (!isCollapsed) {
        for (const skill of group.children) {
          rows.push({ kind: "collection_child", skill, key: `c-${skill.id}` });
        }
      }
    }
    return rows;
  }, [groups, collapsed]);

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 88,
    overscan: 12,
    getItemKey: (index) => flatRows[index]?.key ?? String(index),
  });

  const toggle = (name: string) =>
    setCollapsed((prev) => ({ ...prev, [name]: !prev[name] }));

  useEffect(() => {
    if (selectedId == null) return;
    const idx = flatRows.findIndex((r) => {
      if (r.kind === "standalone") return r.skill.id === selectedId;
      if (r.kind === "collection_header") return r.parent.id === selectedId;
      return r.skill.id === selectedId;
    });
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll when selection changes; virtualizer stable; flatRows from same render
  }, [selectedId]);

  return (
    <div
      ref={scrollRef}
      className="h-full min-h-0 overflow-y-auto transition-opacity"
      style={{ opacity: isSearchStale ? 0.5 : 1 }}
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((vi) => {
          const row = flatRows[vi.index];
          if (!row) return null;
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${vi.start}px)` }}
            >
              <div className="pb-1">
                {row.kind === "standalone" ? (
                  <SkillListItem
                    skill={row.skill}
                    selected={selectedId === row.skill.id}
                    agents={agents}
                    activeAgentSlug={activeAgentSlug}
                    onSelect={onSelect}
                    onReveal={onReveal}
                    onUninstallAll={onUninstallAll}
                    onUnlinkInherited={onUnlinkInherited}
                    onUninstallFromAgent={onUninstallFromAgent}
                  />
                ) : row.kind === "collection_header" ? (
                  <CollectionItem
                    parent={row.parent}
                    childCount={row.childCount}
                    selected={selectedId === row.parent.id}
                    collapsed={row.collapsed}
                    agents={agents}
                    onSelect={onSelect}
                    onReveal={onReveal}
                    onUninstallAll={onUninstallAll}
                    onUnlinkInherited={onUnlinkInherited}
                    onToggle={() => toggle(row.parent.id)}
                  />
                ) : (
                  <div className="ml-3 border-l border-black/[0.06] dark:border-white/[0.06] pl-1">
                    <SkillListItem
                      skill={row.skill}
                      selected={selectedId === row.skill.id}
                      agents={agents}
                      onSelect={onSelect}
                      onReveal={onReveal}
                      onUninstallAll={onUninstallAll}
                      onUnlinkInherited={onUnlinkInherited}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CollectionItem = memo(function CollectionItem({
  parent,
  childCount,
  selected,
  collapsed,
  agents,
  onSelect,
  onReveal,
  onUninstallAll,
  onUnlinkInherited,
  onToggle,
}: {
  parent: SkillWithRepo;
  childCount: number;
  selected: boolean;
  collapsed: boolean;
  agents: import("@/mainview/hooks/useAgents").AgentConfig[] | undefined;
  onSelect: (skill: SkillWithRepo) => void;
  onReveal: (path: string) => void;
  onUninstallAll: (skill: SkillWithRepo) => void;
  onUnlinkInherited: (skill: SkillWithRepo) => void;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useMenuDismissal(menu !== null, closeMenu, rowRef, menuRef);

  const directSlugs = installedAgents(parent);
  const hasDirectInstall = directSlugs.length > 0;
  const inheritedSlugs = parent.installations
    .filter((i) => i.is_inherited)
    .map((i) => i.agent_slug)
    .filter((s) => !directSlugs.includes(s));
  const inheritedOnly = !hasDirectInstall && inheritedSlugs.length > 0;

  function openMenuFromMoreButton() {
    const r = moreRef.current?.getBoundingClientRect();
    if (r) {
      setMenu({
        x: Math.min(r.right - 180, window.innerWidth - 188),
        y: r.bottom + 4,
      });
    }
  }

  return (
    <div className="relative" ref={rowRef}>
      <div
        className={cn(
          "rounded-xl px-3 py-2.5 transition-all duration-200 select-none border-[0.5px]",
          selected
            ? "glass"
            : "border-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.04]",
        )}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <div className="flex items-start gap-0.5 w-full">
          <button
            type="button"
            className="flex-1 min-w-0 text-left"
            onClick={() => { onSelect(parent); if (collapsed) onToggle(); }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-sm font-medium truncate">{parent.name}</h3>
              <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {childCount} skills
              </span>
            </div>
            {parent.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                {parent.description}
              </p>
            )}
            <div className="flex flex-wrap gap-1 mt-1.5">
              {directSlugs.map((slug) => (
                <span
                  key={slug}
                  className="rounded-full border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground"
                >
                  {agents?.find((a) => a.slug === slug)?.name ?? slug}
                </span>
              ))}
              {inheritedSlugs.map((slug) => (
                <span
                  key={slug}
                  className="rounded-full border border-muted-foreground/35 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  {agents?.find((a) => a.slug === slug)?.name ?? slug}
                </span>
              ))}
            </div>
          </button>
          <button
            type="button"
            ref={moreRef}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-black/[0.06] dark:hover:bg-white/[0.08] mt-0.5"
            aria-label={t("skills.skillRowMenu")}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (menu) setMenu(null);
              else openMenuFromMoreButton();
            }}
          >
            <MoreHorizontal className="size-4" />
          </button>
          <button
            type="button"
            className="shrink-0 p-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-colors mt-0.5"
            aria-expanded={!collapsed}
            aria-label={collapsed ? t("skills.expandCollection") : t("skills.collapseCollection")}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
          >
            <ChevronRight
              className={cn(
                "size-3.5 text-muted-foreground transition-transform duration-200",
                !collapsed && "rotate-90",
              )}
            />
          </button>
        </div>
      </div>

      {menu &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[300] w-[180px] rounded-xl glass-elevated p-1 shadow-lg animate-fade-in-up"
            style={{ left: menu.x, top: menu.y }}
            role="menu"
          >
            <button
              type="button"
              role="menuitem"
              className="w-full px-2.5 py-1.5 text-[13px] text-left rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors"
              onClick={() => {
                onReveal(parent.canonical_path);
                setMenu(null);
              }}
            >
              {t("skills.revealInFinder")}
            </button>
            {hasDirectInstall && (
              <button
                type="button"
                role="menuitem"
                className="w-full px-2.5 py-1.5 text-[13px] text-left rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                onClick={() => {
                  onUninstallAll(parent);
                  setMenu(null);
                }}
              >
                {t("skills.uninstallAll")}
              </button>
            )}
            {inheritedOnly && (
              <button
                type="button"
                role="menuitem"
                className="w-full px-2.5 py-1.5 text-[13px] text-left rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                onClick={() => {
                  onUnlinkInherited(parent);
                  setMenu(null);
                }}
              >
                {t("skills.unlinkInherited")}
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
});

const SkillListItem = memo(function SkillListItem({
  skill,
  selected,
  agents,
  activeAgentSlug,
  onSelect,
  onReveal,
  onUninstallAll,
  onUnlinkInherited,
  onUninstallFromAgent,
}: {
  skill: SkillWithRepo;
  selected: boolean;
  agents: import("@/mainview/hooks/useAgents").AgentConfig[] | undefined;
  /** Non-null when the list is filtered to a single agent. The row then hides
   *  the agent chip strip (redundant — every row would show the same icon). */
  activeAgentSlug?: string | null;
  onSelect: (skill: SkillWithRepo) => void;
  onReveal: (path: string) => void;
  onUninstallAll: (skill: SkillWithRepo) => void;
  onUnlinkInherited: (skill: SkillWithRepo) => void;
  onUninstallFromAgent?: (skill: SkillWithRepo, agentSlug: string) => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useMenuDismissal(menu !== null, closeMenu, rowRef, menuRef);

  const directSlugs = directInstallSlugs(skill);
  const inheritedSlugs = skill.installations
    .filter((i) => i.is_inherited)
    .map((i) => i.agent_slug)
    .filter((s) => !directSlugs.includes(s));
  const hasDirectInstall = directSlugs.length > 0;
  const inheritedOnly = !hasDirectInstall && inheritedSlugs.length > 0;

  function openMenuFromMoreButton() {
    const r = moreRef.current?.getBoundingClientRect();
    if (r) {
      setMenu({
        x: Math.min(r.right - 180, window.innerWidth - 188),
        y: r.bottom + 4,
      });
    }
  }

  return (
    <div className="relative" ref={rowRef}>
      <button
        type="button"
        className={cn(
          "w-full rounded-xl px-3 py-2.5 pr-9 text-left transition-all duration-200 select-none border-[0.5px]",
          selected
            ? "glass"
            : "border-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.04]",
        )}
        onClick={() => onSelect(skill)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <h3 className="text-sm font-medium truncate">{skill.name}</h3>
        {skill.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {skill.description}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-medium tabular-nums text-muted-foreground/90">
          <span
            className="inline-flex cursor-help items-center gap-0.5"
            title={t("skills.tokenTooltipListing")}
          >
            <LayoutList className="size-3 shrink-0 opacity-80" aria-hidden />
            {formatApproxTok(approxTokensFromChars(skill.footprint_listing_slice_chars ?? 0))}
          </span>
          <span className="text-border">·</span>
          <span
            className="inline-flex cursor-help items-center gap-0.5"
            title={t("skills.tokenTooltipFull")}
          >
            <FileText className="size-3 shrink-0 opacity-80" aria-hidden />
            {formatApproxTok(approxTokensFromChars(skill.footprint_skill_md_chars ?? 0))}
          </span>
          {(skill.listing_excluded ?? false) && (
            <span
              className="inline-flex cursor-help items-center gap-0.5 text-muted-foreground/70"
              title={t("skills.listingExcludedTooltip")}
            >
              <Ban className="size-3 shrink-0" aria-hidden />
            </span>
          )}
        </div>
        {inheritedOnly && (
          <p className="mt-1 text-[11px] text-muted-foreground/80">
            {t("skills.inheritedOnlyHint")}
          </p>
        )}
        {!activeAgentSlug && (
          <AgentChipsCompact
            directSlugs={directSlugs}
            inheritedSlugs={inheritedSlugs}
            agents={agents}
          />
        )}
      </button>
      <button
        type="button"
        ref={moreRef}
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
        aria-label={t("skills.skillRowMenu")}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (menu) setMenu(null);
          else openMenuFromMoreButton();
        }}
      >
        <MoreHorizontal className="size-4" />
      </button>

      {menu &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[300] w-[180px] rounded-xl glass-elevated p-1 shadow-lg animate-fade-in-up"
            style={{ left: menu.x, top: menu.y }}
            role="menu"
          >
            <button
              type="button"
              role="menuitem"
              className="w-full px-2.5 py-1.5 text-[13px] text-left rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors"
              onClick={() => {
                onReveal(skill.canonical_path);
                setMenu(null);
              }}
            >
              {t("skills.revealInFinder")}
            </button>
            {(() => {
              // Row-menu destructive action, scoped to the active filter:
              //   - filter=X, skill visible on X (direct OR inherited) →
              //     single "Remove from X" that runs the composite flow
              //     (uninstall direct + detach shared as needed).
              //   - filter=All, skill has any direct install anywhere →
              //     "Uninstall from All Agents".
              const agent =
                activeAgentSlug && agents
                  ? agents.find((a) => a.slug === activeAgentSlug)
                  : undefined;
              if (agent && onUninstallFromAgent) {
                const visibleOnActive = skill.installations.some(
                  (i) => i.agent_slug === agent.slug,
                );
                if (visibleOnActive) {
                  return (
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full px-2.5 py-1.5 text-[13px] text-left rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                      onClick={() => {
                        onUninstallFromAgent(skill, agent.slug);
                        setMenu(null);
                      }}
                    >
                      {t("skills.removeFromAgent", { agent: agent.name })}
                    </button>
                  );
                }
              }
              if (hasDirectInstall) {
                return (
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full px-2.5 py-1.5 text-[13px] text-left rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                    onClick={() => {
                      onUninstallAll(skill);
                      setMenu(null);
                    }}
                  >
                    {t("skills.uninstallAll")}
                  </button>
                );
              }
              return null;
            })()}
            {inheritedOnly && !activeAgentSlug && (
              <button
                type="button"
                role="menuitem"
                className="w-full px-2.5 py-1.5 text-[13px] text-left rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                onClick={() => {
                  onUnlinkInherited(skill);
                  setMenu(null);
                }}
              >
                {t("skills.unlinkInherited")}
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
});

const AGENT_CHIPS_MAX = 8;

function AgentChipsCompact({
  directSlugs,
  inheritedSlugs,
  agents,
}: {
  directSlugs: string[];
  inheritedSlugs: string[];
  agents: import("@/mainview/hooks/useAgents").AgentConfig[] | undefined;
}) {
  const nameOf = (slug: string) => agents?.find((a) => a.slug === slug)?.name ?? slug;
  const total = directSlugs.length + inheritedSlugs.length;
  if (total === 0) return null;

  // Direct first (full color), then inherited (dimmed). Cap combined count.
  const ordered: Array<{ slug: string; inherited: boolean }> = [
    ...directSlugs.map((s) => ({ slug: s, inherited: false })),
    ...inheritedSlugs.map((s) => ({ slug: s, inherited: true })),
  ];
  const visible = ordered.slice(0, AGENT_CHIPS_MAX);
  const overflow = total - visible.length;
  const overflowTitle = overflow > 0
    ? ordered.slice(AGENT_CHIPS_MAX).map((o) => nameOf(o.slug)).join(", ")
    : "";

  return (
    <div className="mt-1.5 flex items-center gap-1">
      {visible.map(({ slug, inherited }) => (
        <span
          key={slug}
          title={inherited ? `${nameOf(slug)} (inherited)` : nameOf(slug)}
          className={cn(
            "inline-flex size-4 items-center justify-center",
            inherited && "opacity-40",
          )}
        >
          <AgentIcon slug={slug} className="size-3.5" />
        </span>
      ))}
      {overflow > 0 && (
        <span
          title={overflowTitle}
          className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border bg-secondary px-1 text-[9px] font-medium tabular-nums text-secondary-foreground"
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

function directInstallSlugs(skill: Skill): string[] {
  return skill.installations
    .filter((i) => !i.is_inherited)
    .map((i) => i.agent_slug);
}

function matchesInstallFilter(skill: Skill, mode: "all" | "direct" | "inherited-only"): boolean {
  if (mode === "all") return true;
  const hasDirectInstall = directInstallSlugs(skill).length > 0;
  const hasInherited = skill.installations.some((i) => i.is_inherited);
  if (mode === "direct") return hasDirectInstall;
  return !hasDirectInstall && hasInherited;
}

function repoSlugFromUrl(url: string): string | null {
  // "https://github.com/MiniMax-AI/skills.git" → "MiniMax-AI/skills"
  const cleaned = url.replace(/\/+$/, "").replace(/\.git$/, "");
  const parts = cleaned.split("/");
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return null;
}

function getSourceLabel(source: unknown, t: (key: string) => string): string {
  if (!source) return t("skills.sourceUnknown");
  if (typeof source === "string") return source === "Unknown" ? t("skills.sourceUnknown") : source;
  if (typeof source !== "object") return t("skills.sourceUnknown");
  const src = source as Record<string, unknown>;
  if ("LocalPath" in src) return t("skills.sourceLocalPath");
  if ("GitRepository" in src) {
    const git = src["GitRepository"] as Record<string, unknown>;
    const slug = typeof git.repo_url === "string" ? repoSlugFromUrl(git.repo_url) : null;
    return slug ?? t("skills.sourceGit");
  }
  if ("SkillsSh" in src) return t("skills.sourceSkillsSh");
  if ("ClawHub" in src) return t("skills.sourceClawHub");
  return t("skills.sourceUnknown");
}

function getSourceRepo(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const src = source as Record<string, unknown>;
  if ("GitRepository" in src) {
    const git = src["GitRepository"] as Record<string, unknown>;
    return (git.repo_url as string) ?? null;
  }
  if ("SkillsSh" in src) {
    const s = src["SkillsSh"] as Record<string, unknown>;
    return (s.repository as string) ?? null;
  }
  if ("ClawHub" in src) {
    const c = src["ClawHub"] as Record<string, unknown>;
    return (c.repository as string) ?? null;
  }
  return null;
}

function SkillDetail({
  skill,
  detectedAgents,
  activeAgentSlug,
  busyAgents,
  updating,
  readOnly = false,
  onEdit,
  onSync,
  onUpdate,
  onUninstall,
  onUninstallAll,
  onUnlinkInherited,
}: {
  skill: Skill;
  detectedAgents: AgentConfig[];
  /** Currently-filtered agent in the sidebar (or null when "All"). */
  activeAgentSlug?: string | null;
  busyAgents: Map<string, BusyOp>;
  updating: boolean;
  readOnly?: boolean;
  onClose: () => void;
  onEdit: () => void;
  onSync: (skillId: string, targetAgents: string[]) => void;
  onUpdate: (skillId: string) => void;
  onUninstall: (skillId: string, agentSlug: string) => void;
  onUninstallAll: (skill: Skill) => void | Promise<void>;
  onUnlinkInherited: (skill: Skill) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const directSlugs = directInstallSlugs(skill);
  const hasDirectInstall = directSlugs.length > 0;
  const inheritedOnly = directSlugs.length === 0 && skill.installations.some((i) => i.is_inherited);
  const uninstallAllBusy = directSlugs.some((slug) =>
    busyAgents.has(busyKey(skill.id, slug)),
  );
  const allAgentSlugs = new Set(allAgents(skill));
  const syncTargets = detectedAgents.filter(
    (a) => !allAgentSlugs.has(a.slug)
  );
  const sourceLabel = getSourceLabel(skill.source, t);
  const sourceRepo = getSourceRepo(skill.source);
  const metadata = skill.metadata as Record<string, unknown> | null;

  const [projectPickerOpen, setProjectPickerOpen] = useState(false);

  // Defer the heavy markdown rendering so the panel paints instantly
  const deferredSkillPath = useDeferredValue(skill.canonical_path);
  const isStale = deferredSkillPath !== skill.canonical_path;

  // Load SKILL.md content — try local first, fall back to remote if empty
  const skillMdPath = deferredSkillPath.endsWith("SKILL.md")
    ? deferredSkillPath
    : deferredSkillPath + "/SKILL.md";
  const { data: docContent, isLoading: docLoading } = useQuery<string | null>({
    queryKey: ["skill-content", skillMdPath, sourceRepo],
    queryFn: async () => {
      // Try local SKILL.md first
      try {
        const text = (await invoke("read_skill_content", {
          path: skillMdPath,
        })) as string;
        const body = extractMarkdownBody(text);
        if (body && body.trim().length > 0) return body;
      } catch { /* local read failed, fall through */ }
      // Fallback: fetch from remote repository if source info is available
      if (sourceRepo) {
        try {
          const text = (await invoke("fetch_remote_skill_content", {
            repoUrl: sourceRepo,
            skillName: skill.id,
          })) as string;
          return extractMarkdownBody(text);
        } catch { /* remote also unavailable */ }
      }
      return null;
    },
    staleTime: 60 * 1000,
    retry: false,
  });

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      {/* Header — z-20 to sit above the title-bar drag overlay (z-10) */}
      <div className="relative z-20 flex shrink-0 items-center justify-between px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Info className="size-4 shrink-0 text-muted-foreground" />
          <h3 className="truncate text-sm font-medium">{t("skills.detail")}</h3>
        </div>
      </div>

      {/* Content */}
      <InsetScrollArea className="min-h-0 flex-1" scrollClassName="min-h-0 p-4 space-y-5">
        {/* Header: Name & Description */}
        <div>
          <h2 className="text-base font-[590] leading-tight">
            {skill.name}
          </h2>
          {skill.description && (
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
              {skill.description}
            </p>
          )}
        </div>

        {activeAgentSlug && (() => {
          const agent = detectedAgents.find((a) => a.slug === activeAgentSlug);
          if (!agent) return null;
          const isInstalled = skill.installations.some((i) => i.agent_slug === activeAgentSlug);
          if (isInstalled) return null;
          const isBusy = busyAgents.has(busyKey(skill.id, activeAgentSlug));
          return (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <AgentIcon slug={activeAgentSlug} className="size-4" />
                <span className="truncate">
                  {t("skills.notInstalledForAgent", { name: agent.name })}
                </span>
              </div>
              <Button
                size="sm"
                disabled={isBusy || readOnly}
                onClick={() => onSync(skill.id, [activeAgentSlug])}
              >
                {isBusy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                {t("skills.installForAgent", { name: agent.name })}
              </Button>
            </div>
          );
        })()}

        <hr className="border-border" />

        {/* Package Info — grid layout */}
        <DetailSection label={t("skills.packageInfo")}>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-baseline">
            <span className="text-xs text-muted-foreground">{t("skills.sourceLabel")}</span>
            <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium w-fit">
              {sourceLabel}
            </span>
            {sourceRepo && (
              <>
                <span className="text-xs text-muted-foreground">{t("skills.repository")}</span>
                <button
                  className="text-xs font-mono break-all text-left text-primary hover:underline cursor-pointer"
                  onClick={() => openUrl(sourceRepo!)}
                >
                  {sourceRepo}
                </button>
              </>
            )}
            <span className="text-xs text-muted-foreground">{t("skills.scope")}</span>
            <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium w-fit ${
              skill.scope.type === "SharedGlobal"
                ? "badge-info"
                : "bg-muted text-muted-foreground"
            }`}>
              {skill.scope.type === "SharedGlobal"
                ? t("skills.scopeGlobal")
                : t("skills.scopeLocal", { name: detectedAgents.find((a) => a.slug === (skill.scope as { agent: string }).agent)?.name ?? "Local" })}
            </span>
            <span className="self-center text-xs text-muted-foreground">{t("skills.packageSizeLabel")}</span>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 self-center text-[11px] font-medium tabular-nums text-foreground/90">
              <span
                className="inline-flex cursor-help items-center gap-1"
                title={t("skills.tokenTooltipListing")}
              >
                <LayoutList className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                {formatApproxTok(approxTokensFromChars(skill.footprint_listing_slice_chars ?? 0))}
              </span>
              <span className="text-muted-foreground/40 select-none" aria-hidden>
                ·
              </span>
              <span
                className="inline-flex cursor-help items-center gap-1"
                title={t("skills.tokenTooltipFull")}
              >
                <FileText className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                {formatApproxTok(approxTokensFromChars(skill.footprint_skill_md_chars ?? 0))}
              </span>
              {(skill.listing_excluded ?? false) && (
                <>
                  <span className="text-muted-foreground/40 select-none" aria-hidden>
                    ·
                  </span>
                  <span
                    className="inline-flex cursor-help items-center gap-0.5 font-normal text-muted-foreground"
                    title={t("skills.listingExcludedTooltip")}
                  >
                    <Ban className="size-3 shrink-0" aria-hidden />
                    {t("skills.listingExcludedShort")}
                  </span>
                </>
              )}
            </div>
          </div>
        </DetailSection>

        {/* Skill Metadata */}
        {metadata && Object.keys(metadata).length > 0 && (
          <>
            <hr className="border-border" />
            <DetailSection label={t("skills.skillMetadata")}>
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-baseline">
                {Object.entries(metadata).map(([key, value]) => (
                  <Fragment key={key}>
                    <span className="text-xs text-muted-foreground capitalize">
                      {key}
                    </span>
                    <span className="text-xs break-all">
                      {typeof value === "string"
                        ? value
                        : JSON.stringify(value)}
                    </span>
                  </Fragment>
                ))}
              </div>
            </DetailSection>
          </>
        )}

        <hr className="border-border" />

        {/* Agent Assignment */}
        <DetailSection label={t("skills.agentsLabel", { installed: installedAgentCount(skill, detectedAgents), total: detectedAgents.length })}>
          <SkillAgentList
            skill={skill}
            detectedAgents={detectedAgents}
            busyAgents={busyAgents}
            readOnly={readOnly}
            onInstall={(targets) => onSync(skill.id, targets)}
            onUninstall={onUninstall}
          />
          {inheritedOnly && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("skills.inheritedOnlyUninstallInfo")}
            </p>
          )}
        </DetailSection>

        {!readOnly && (
          <>
            <hr className="border-border" />

            {/* Action */}
            <DetailSection label={t("skills.action")}>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-auto min-h-9 w-full min-w-0 justify-start gap-2 py-2 text-left whitespace-normal [text-wrap:balance]"
                  onClick={onEdit}
                >
                  <Pencil className="size-3.5 shrink-0" />
                  <span className="min-w-0">{t("skills.editSkillMd")}</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-auto min-h-9 w-full min-w-0 justify-start gap-2 py-2 text-left whitespace-normal [text-wrap:balance]"
                  onClick={() => setProjectPickerOpen(true)}
                >
                  <FolderKanban className="size-3.5 shrink-0" />
                  <span className="min-w-0">{t("skills.installToProject")}</span>
                </Button>
                {sourceRepo && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-auto min-h-9 w-full min-w-0 justify-start gap-2 py-2 text-left whitespace-normal [text-wrap:balance]"
                    disabled={updating}
                    onClick={() => onUpdate(skill.id)}
                  >
                    <RefreshCw className={`size-3.5 shrink-0 ${updating ? "animate-spin" : ""}`} />
                    <span className="min-w-0">
                      {updating ? t("skills.updating") : t("skills.updateFromSource")}
                    </span>
                  </Button>
                )}
                {syncTargets.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-auto min-h-9 w-full min-w-0 justify-start gap-2 py-2 text-left whitespace-normal [text-wrap:balance]"
                    disabled={busyAgents.size > 0}
                    onClick={() =>
                      onSync(
                        skill.id,
                        syncTargets.map((a) => a.slug)
                      )
                    }
                  >
                    <Copy className="size-3.5 shrink-0" />
                    <span className="min-w-0">
                      {t("skills.syncTo", { names: syncTargets.map((a) => a.name).join(", ") })}
                    </span>
                  </Button>
                )}
                {/*
                 * If the user is filtering by a single agent AND this skill is
                 * directly installed there, the primary destructive action
                 * removes it from THAT agent only. Without this scoping, a
                 * user on the Gemini tab clicking Uninstall would nuke it from
                 * Claude/Cursor too — surprising and hard to undo.
                 * The "Uninstall from all agents" fallback kicks in when
                 * viewing "All" or when the skill isn't on the active agent.
                 */}
                {(() => {
                  const agent =
                    activeAgentSlug &&
                    detectedAgents.find((a) => a.slug === activeAgentSlug);
                  if (!agent) return null;
                  const installedOnActive = skill.installations.some(
                    (i) => i.agent_slug === agent.slug && !i.is_inherited,
                  );
                  const inheritedOnActive = skill.installations.some(
                    (i) => i.agent_slug === agent.slug && i.is_inherited,
                  );
                  if (!installedOnActive && !inheritedOnActive) return null;

                  const preservedAgents = detectedAgents.filter(
                    (a) =>
                      a.slug !== agent.slug &&
                      skill.installations.some(
                        (i) => i.agent_slug === a.slug && i.is_inherited,
                      ),
                  );
                  const isBusy = busyAgents.has(busyKey(skill.id, agent.slug));
                  // DWIM "Remove from X": the user's mental model is
                  // "I don't want this skill in {agent}". Two surprises we
                  // had to fix:
                  //   1. Uninstalling only the direct copy left the shared
                  //      copy visible → skill "reappeared" after click.
                  //   2. Detaching without first removing the direct copy
                  //      would leave a stale direct copy behind after the
                  //      shared tree was restructured.
                  // Solution: one button, one confirm, composite action that
                  // does whatever's needed so the skill genuinely vanishes
                  // from {agent}.
                  return (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-auto min-h-9 w-full min-w-0 justify-start gap-2 border-destructive/30 py-2 text-left text-destructive whitespace-normal [text-wrap:balance] hover:bg-destructive/10 hover:text-destructive"
                      disabled={isBusy || busyAgents.size > 0}
                      onClick={async () => {
                        // Build a confirm string that fits the situation:
                        // direct only, shared only, or both.
                        let confirmMsg: string;
                        if (installedOnActive && inheritedOnActive) {
                          confirmMsg = t("skills.removeFromAgentConfirmBoth", {
                            skill: skill.name || skill.id,
                            agent: agent.name,
                            preservedNames:
                              preservedAgents.map((a) => a.name).join(", ") ||
                              t("skills.detachNoOthers"),
                            preservedCount: preservedAgents.length,
                          });
                        } else if (inheritedOnActive) {
                          confirmMsg = t("skills.detachConfirm", {
                            skill: skill.name || skill.id,
                            agent: agent.name,
                            preservedCount: preservedAgents.length,
                            preservedNames:
                              preservedAgents.map((a) => a.name).join(", ") ||
                              t("skills.detachNoOthers"),
                          });
                        } else {
                          confirmMsg = t("skills.removeFromAgentConfirmDirect", {
                            skill: skill.name || skill.id,
                            agent: agent.name,
                          });
                        }
                        if (!window.confirm(confirmMsg)) return;
                        try {
                          if (installedOnActive) {
                            await onUninstall(skill.id, agent.slug);
                          }
                          if (inheritedOnActive) {
                            await invoke("detach_shared_skill", {
                              skillId: skill.id,
                              removeFromAgent: agent.slug,
                            });
                          }
                        } catch (err) {
                          alert(
                            `Remove failed: ${err instanceof Error ? err.message : String(err)}`,
                          );
                        }
                      }}
                    >
                      <Trash2 className="size-3.5 shrink-0" />
                      <span className="min-w-0">
                        {isBusy
                          ? t("marketplace.uninstalling")
                          : t("skills.removeFromAgent", { agent: agent.name })}
                        {installedOnActive && inheritedOnActive && (
                          <span className="ml-1 text-[10px] font-normal text-muted-foreground block">
                            {t("skills.removeFromAgentHintBoth")}
                          </span>
                        )}
                        {!installedOnActive && inheritedOnActive && (
                          <span className="ml-1 text-[10px] font-normal text-muted-foreground block">
                            {t("skills.detachHint", { count: preservedAgents.length })}
                          </span>
                        )}
                      </span>
                    </Button>
                  );
                })()}
                {/*
                 * "Uninstall from all agents" only shows in the All-agents view.
                 * When scoped to a specific agent, offering it would be
                 * visually dominant and out of context — the user just wants
                 * to pull it out of that one agent.
                 */}
                {hasDirectInstall && !activeAgentSlug && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-auto min-h-9 w-full min-w-0 justify-start gap-2 border-destructive/30 py-2 text-left text-destructive whitespace-normal [text-wrap:balance] hover:bg-destructive/10 hover:text-destructive"
                    disabled={uninstallAllBusy || busyAgents.size > 0}
                    onClick={() => {
                      void onUninstallAll(skill);
                    }}
                  >
                    <Trash2 className="size-3.5 shrink-0" />
                    <span className="min-w-0">
                      {uninstallAllBusy ? t("marketplace.uninstalling") : t("skills.uninstallAll")}
                    </span>
                  </Button>
                )}
                {inheritedOnly && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-auto min-h-9 w-full min-w-0 justify-start gap-2 border-destructive/30 py-2 text-left text-destructive whitespace-normal [text-wrap:balance] hover:bg-destructive/10 hover:text-destructive"
                    disabled={busyAgents.size > 0}
                    onClick={() => {
                      void onUnlinkInherited(skill);
                    }}
                  >
                    <Trash2 className="size-3.5 shrink-0" />
                    <span className="min-w-0">{t("skills.unlinkInherited")}</span>
                  </Button>
                )}
              </div>

            </DetailSection>
          </>
        )}

        <hr className="border-border" />

        {/* Documentation — deferred so detail panel renders first */}
        <DetailSection label={t("skills.skillContent")}>
          {isStale || docLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t("skills.loading")}
            </div>
          ) : docContent ? (
            <MarkdownContent content={docContent} />
          ) : (
            <p className="text-xs text-muted-foreground italic">
              {t("skills.noContent")}
            </p>
          )}
        </DetailSection>
      </InsetScrollArea>

      {projectPickerOpen && (
        <InstallToProjectPicker
          skillName={skill.name}
          onInstall={async (projectPath) => {
            await invoke("install_skill_to_project", {
              source: { LocalPath: { path: skill.canonical_path } },
              projectPath,
            });
          }}
          onClose={() => setProjectPickerOpen(false)}
        />
      )}
    </div>
  );
}

function SkillNameConfirmDialog({
  open,
  actionKind,
  skillName,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  actionKind: "uninstall_all" | "unlink_inherited";
  skillName: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!open) {
      setTyped("");
    }
  }, [open]);

  if (!open) return null;

  const normalizedTyped = typed.trim();
  const expected = skillName.trim();
  const matches = normalizedTyped.length > 0 && normalizedTyped === expected;
  const isUninstall = actionKind === "uninstall_all";

  return (
    <div className="modal-shell fixed inset-0 z-[320] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="modal-panel relative z-10 w-[min(32rem,calc(100vw-2rem))] rounded-2xl glass-panel border border-border/50 p-5 shadow-xl">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-[590]">
            {isUninstall ? t("skills.confirmUninstallTitle") : t("skills.confirmUnlinkTitle")}
          </h2>
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
            onClick={onCancel}
            disabled={pending}
            aria-label={t("common.close")}
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          {isUninstall
            ? t("skills.confirmUninstallBody")
            : t("skills.confirmUnlinkBody")}
        </p>
        <p className="mb-2 text-xs text-muted-foreground">
          {t("skills.typeSkillNamePrompt", { name: skillName })}
        </p>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={skillName}
          autoFocus
          className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none ring-offset-background transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={pending}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => void onConfirm()}
            disabled={!matches || pending}
          >
            {pending
              ? t("skills.runningAction")
              : isUninstall
                ? t("skills.uninstallAll")
                : t("skills.unlinkInherited")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DetailSection({
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

function SkillEditor({
  skill,
  onClose,
  onBack,
}: {
  skill: Skill;
  onClose: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLoading(true);
    setDirty(false);
    const skillMdPath = skill.canonical_path.endsWith("SKILL.md")
      ? skill.canonical_path
      : skill.canonical_path + "/SKILL.md";
    invoke("read_skill_content", { path: skillMdPath })
      .then((text) => {
        setContent(text as string);
        setLoading(false);
      })
      .catch(() => {
        setContent(t("skills.failedToLoad"));
        setLoading(false);
      });
  }, [skill.canonical_path, t]);

  async function handleSave() {
    setSaving(true);
    const skillMdPath = skill.canonical_path.endsWith("SKILL.md")
      ? skill.canonical_path
      : skill.canonical_path + "/SKILL.md";
    try {
      await invoke("write_skill_content", { path: skillMdPath, content });
      setDirty(false);
      // Invalidate cached content and skill metadata (name/description may have changed)
      queryClient.invalidateQueries({ queryKey: ["skill-content"] });
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    } catch (e) {
      console.error("Save failed:", e instanceof Error ? e.message : String(e));
      toast(t("skills.saveFailed"), "destructive");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header — z-20 to sit above the title-bar drag overlay (z-10) */}
      <div className="relative z-20 flex shrink-0 items-center justify-between px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            title={t("skills.backToDetail")}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium truncate">{skill.name}</h3>
            <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">
              SKILL.md
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 ml-2">
          {dirty && (
            <Button
              variant="default"
              size="xs"
              disabled={saving}
              onClick={handleSave}
            >
              {saving ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                t("skills.save")
              )}
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Editor */}
      {loading ? (
        <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" />
          {t("skills.loading")}
        </div>
      ) : (
        <textarea
          className="flex-1 resize-none bg-transparent px-4 py-3 text-sm font-mono leading-relaxed outline-none placeholder:text-muted-foreground"
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
          spellCheck={false}
        />
      )}
    </div>
  );
}
