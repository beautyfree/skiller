import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import {
  FolderOpen,
  FolderPlus,
  Plus,
  Folder,
  Trash2,
  Puzzle,
  GitBranch,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";
import { Button } from "@/mainview/components/ui/button";
import { Checkbox } from "@/mainview/components/ui/checkbox";
import { visibleSkillSelection } from "@/mainview/lib/selection";
import { Tooltip } from "@/mainview/components/ui/tooltip";
import { invoke, pickFolder, revealItemInDir } from "@/mainview/lib/native";
import ImportWizard from "@/mainview/components/ImportWizard";
import ProjectSkillDetailModal from "@/mainview/components/ProjectSkillDetailModal";
import ResizeHandle from "@/mainview/components/ResizeHandle";
import { useResizable } from "@/mainview/hooks/useResizable";
import { useSkills } from "@/mainview/hooks/useSkills";
import { SkillPresets } from "@/mainview/components/SkillPresets";
import {
  useAddProject,
  useAddProjectFolder,
  useProjectFolders,
  useProjectSkills,
  useProjects,
  useRemoveProject,
  useRemoveProjectFolder,
  useRenameProjectFolder,
  useSetProjectGroup,
  useUninstallProjectSkill,
  type Project,
  type ProjectSkill,
} from "@/mainview/hooks/useProjects";

export default function ProjectsPage() {
  const { t } = useTranslation();
  const { data: projects, isLoading } = useProjects();
  const { data: folders } = useProjectFolders();
  const addProject = useAddProject();
  const removeProject = useRemoveProject();
  const addFolder = useAddProjectFolder();
  const removeFolder = useRemoveProjectFolder();
  const renameFolder = useRenameProjectFolder();
  const setGroup = useSetProjectGroup();
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(null);
  const requestedProjectPath = searchParams.get("path");

  useEffect(() => {
    if (selected || !requestedProjectPath || !projects?.some((project) => project.path === requestedProjectPath)) return;
    setSelected(requestedProjectPath);
  }, [projects, requestedProjectPath, selected]);

  const sidebar = useResizable({
    initial: 260,
    min: 200,
    max: 500,
    storageKey: "projects.sidebarWidth",
  });
  const [newFolderRequestId, setNewFolderRequestId] = useState(0);

  async function handleAddProject() {
    try {
      const picked = await pickFolder({ title: t("projects.pickFolderTitle") });
      if (!picked) return;
      await addProject.mutateAsync(picked);
      setSelected(picked);
    } catch (err) {
      console.error("[Projects] add failed:", err);
      alert(`Add project failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function requestNewFolder() {
    setNewFolderRequestId((n) => n + 1);
  }

  async function commitNewFolder(raw: string) {
    const name = raw.trim();
    if (!name) return;
    const existing = (folders ?? []).find(
      (f) => f.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      alert(t("projects.folderAlreadyExists", { name: existing }));
      return;
    }
    try {
      await addFolder.mutateAsync(name);
    } catch (err) {
      alert(`New folder failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const active = projects?.find((p) => p.path === selected) ?? projects?.[0] ?? null;

  return (
    <div className="flex h-full min-h-0">
      {/* Left: project list */}
      <div
        className="flex shrink-0 flex-col border-r border-border/60"
        style={{ width: sidebar.width }}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-3">
          <h2 className="text-sm font-[590]">{t("projects.title")}</h2>
          <div className="flex items-center gap-1">
            <Tooltip content={t("projects.newFolder")}>
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("projects.newFolder")}
              onClick={requestNewFolder}
            >
              <FolderPlus className="size-3.5" aria-hidden />
            </Button>
            </Tooltip>
            <Button size="sm" variant="outline" onClick={handleAddProject}>
              <Plus className="size-3.5" aria-hidden />
              {t("projects.add")}
            </Button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2 pt-2">
          {isLoading ? (
            <div className="space-y-1 px-2">
              <div className="h-10 rounded-md bg-muted/30 animate-pulse" />
              <div className="h-10 rounded-md bg-muted/30 animate-pulse" />
            </div>
          ) : (!projects || projects.length === 0) && (!folders || folders.length === 0) ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              {t("projects.empty")}
            </p>
          ) : (
            <ProjectTree
              projects={projects ?? []}
              folders={folders ?? []}
              activePath={active?.path ?? null}
              onSelectProject={(path) => setSelected(path)}
              onRemoveProject={(path) => {
                if (selected === path) setSelected(null);
                void removeProject.mutateAsync(path);
              }}
              onRemoveFolder={async (name) => {
                const inside = (projects ?? []).filter((p) => p.group === name);
                const msg =
                  inside.length > 0
                    ? t("projects.removeFolderConfirmWithProjects", {
                        name,
                        count: inside.length,
                      })
                    : t("projects.removeFolderConfirmEmpty", { name });
                if (!window.confirm(msg)) return;
                try {
                  // Explicitly unregister each project first so the outcome is identical
                  // regardless of whether the main process has the latest backend code.
                  for (const p of inside) {
                    if (selected === p.path) setSelected(null);
                    await removeProject.mutateAsync(p.path);
                  }
                  await removeFolder.mutateAsync(name);
                } catch (err) {
                  alert(
                    `Remove folder failed: ${
                      err instanceof Error ? err.message : String(err)
                    }`,
                  );
                }
              }}
              onRenameFolder={(from, to) => {
                if (from === to) return;
                void renameFolder.mutateAsync({ from, to });
              }}
              onRequestNewFolder={requestNewFolder}
              newFolderRequestId={newFolderRequestId}
              onCommitNewFolder={commitNewFolder}
              onMoveProject={(path, folder) => {
                void setGroup.mutateAsync({ path, group: folder });
              }}
            />
          )}
        </div>
      </div>

      <ResizeHandle onPointerDown={sidebar.onPointerDown} onMouseDown={sidebar.onMouseDown} isResizing={sidebar.isResizing} />

      {/* Right: selected project's skills */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {active ? (
          <ProjectDetail key={active.path} project={active} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <FolderOpen className="mx-auto mb-3 size-8 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">
                {t("projects.selectHint")}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const PROJECT_FOLDERS_COLLAPSED_KEY = "projects.collapsedFolders";
const UNGROUPED_KEY = "__ungrouped__";

function loadCollapsedFolders(): Set<string> {
  try {
    const raw = localStorage.getItem(PROJECT_FOLDERS_COLLAPSED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveCollapsedFolders(set: Set<string>): void {
  try {
    localStorage.setItem(PROJECT_FOLDERS_COLLAPSED_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

function ProjectTree({
  projects,
  folders,
  activePath,
  onSelectProject,
  onRemoveProject,
  onRemoveFolder,
  onRenameFolder,
  onRequestNewFolder,
  newFolderRequestId,
  onCommitNewFolder,
  onMoveProject,
}: {
  projects: Project[];
  folders: string[];
  activePath: string | null;
  onSelectProject: (path: string) => void;
  onRemoveProject: (path: string) => void;
  onRemoveFolder: (name: string) => void;
  onRenameFolder: (from: string, to: string) => void;
  onRequestNewFolder: () => void;
  /** Increments each time parent asks to open a draft row. */
  newFolderRequestId: number;
  onCommitNewFolder: (name: string) => void;
  onMoveProject: (path: string, folder: string | null) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsedFolders());
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    kind: "folder" | "canvas";
    folderName?: string;
  } | null>(null);

  // Open draft whenever parent bumps the request id.
  useEffect(() => {
    if (newFolderRequestId > 0) setDraftOpen(true);
  }, [newFolderRequestId]);

  // Close context menu on outside click
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menu]);

  // Build: folder-name → projects[]
  const byFolder = useMemo(() => {
    const m = new Map<string, Project[]>();
    // Pre-seed known folders so empty ones still render
    for (const f of folders) m.set(f, []);
    const ungrouped: Project[] = [];
    for (const p of projects) {
      const g = p.group?.trim();
      if (g && m.has(g)) {
        m.get(g)!.push(p);
      } else if (g) {
        // folder name used but not registered — fall back to show it as a folder anyway
        const arr = m.get(g) ?? [];
        arr.push(p);
        m.set(g, arr);
      } else {
        ungrouped.push(p);
      }
    }
    return { folderMap: m, ungrouped };
  }, [folders, projects]);

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveCollapsedFolders(next);
      return next;
    });
  }

  const folderNames = useMemo(
    () => [...byFolder.folderMap.keys()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    [byFolder.folderMap],
  );

  const isCanvasDragOver = dragOver === UNGROUPED_KEY;

  return (
    <div
      className={`flex-1 rounded-md transition-colors ${
        isCanvasDragOver ? "bg-primary/5 ring-1 ring-primary/20" : ""
      }`}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest("[data-folder-row]")) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, kind: "canvas" });
      }}
      onDragOver={(e) => {
        // Only highlight canvas if we're NOT over a folder section
        if ((e.target as HTMLElement).closest("[data-folder-section]")) return;
        e.preventDefault();
        setDragOver(UNGROUPED_KEY);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDragOver((cur) => (cur === UNGROUPED_KEY ? null : cur));
        }
      }}
      onDrop={(e) => {
        // Folder sections stopPropagation; only fires when dropped on canvas (outside folders)
        e.preventDefault();
        setDragOver(null);
        const path = e.dataTransfer.getData("text/skiller-project");
        if (path) onMoveProject(path, null);
      }}
    >
      {draftOpen && (
        <NewFolderDraftRow
          onCancel={() => setDraftOpen(false)}
          onCommit={(name) => {
            setDraftOpen(false);
            onCommitNewFolder(name);
          }}
        />
      )}

      {folderNames.map((name) => {
        const items = byFolder.folderMap.get(name) ?? [];
        const isCollapsed = collapsed.has(name);
        const isDragOver = dragOver === name;
        const isRenaming = renaming === name;
        return (
          <div
            key={name}
            data-folder-section
            className={`mb-px rounded-md transition-colors ${
              isDragOver ? "bg-primary/10 ring-1 ring-primary/30" : ""
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
              setDragOver(name);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDragOver((cur) => (cur === name ? null : cur));
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(null);
              const path = e.dataTransfer.getData("text/skiller-project");
              if (path) onMoveProject(path, name);
            }}
          >
            <div
              data-folder-row
              className="group flex items-center gap-1 rounded-md px-1 py-1 cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
              onClick={() => !isRenaming && toggle(name)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({
                  x: e.clientX,
                  y: e.clientY,
                  kind: "folder",
                  folderName: name,
                });
              }}
            >
              {isCollapsed ? (
                <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
              )}
              <Folder className="size-3.5 shrink-0 text-muted-foreground" />
              {isRenaming ? (
                <input
                  autoFocus
                  type="text"
                  defaultValue={name}
                  className="flex-1 min-w-0 bg-transparent text-sm font-medium outline-none border-b border-primary/50"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const next = (e.currentTarget as HTMLInputElement).value.trim();
                      setRenaming(null);
                      if (next && next !== name) onRenameFolder(name, next);
                    } else if (e.key === "Escape") {
                      setRenaming(null);
                    }
                  }}
                  onBlur={(e) => {
                    const next = e.currentTarget.value.trim();
                    setRenaming(null);
                    if (next && next !== name) onRenameFolder(name, next);
                  }}
                />
              ) : (
                <span className="flex-1 truncate text-sm font-medium">{name}</span>
              )}
              <span className="text-[10px] tabular-nums text-muted-foreground/60">
                {items.length}
              </span>
              <Tooltip content={t("projects.removeFolder")}>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 ml-1 text-muted-foreground hover:text-destructive transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveFolder(name);
                }}
              >
                <X className="size-3" />
              </button>
              </Tooltip>
            </div>
            {!isCollapsed && (
              <div className="pl-4 space-y-0.5 pt-0.5 pb-0.5">
                {items.length === 0 ? (
                  <p className="px-2 py-1 text-[10px] italic text-muted-foreground/50">
                    {t("projects.emptyFolder")}
                  </p>
                ) : (
                  items.map((p) => (
                    <ProjectRow
                      key={p.path}
                      project={p}
                      active={activePath === p.path}
                      onClick={() => onSelectProject(p.path)}
                      onRemove={() => onRemoveProject(p.path)}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Top-level (ungrouped) projects — live alongside folders, no separate section. */}
      {byFolder.ungrouped.length > 0 && (
        <div className="space-y-0.5 mt-px">
          {byFolder.ungrouped.map((p) => (
            <ProjectRow
              key={p.path}
              project={p}
              active={activePath === p.path}
              onClick={() => onSelectProject(p.path)}
              onRemove={() => onRemoveProject(p.path)}
            />
          ))}
        </div>
      )}

      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[180px] rounded-xl glass-elevated p-1 shadow-lg animate-fade-in-up"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          {menu.kind === "folder" && menu.folderName && (
            <>
              <button
                type="button"
                className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-black/[0.05] dark:hover:bg-white/[0.06]"
                onClick={() => {
                  setRenaming(menu.folderName ?? null);
                  setMenu(null);
                }}
              >
                {t("projects.renameFolder")}
              </button>
              <button
                type="button"
                className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-black/[0.05] dark:hover:bg-white/[0.06]"
                onClick={() => {
                  onRequestNewFolder();
                  setMenu(null);
                }}
              >
                {t("projects.newFolder")}
              </button>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] text-destructive hover:bg-destructive/10"
                onClick={() => {
                  onRemoveFolder(menu.folderName!);
                  setMenu(null);
                }}
              >
                {t("projects.removeFolder")}
              </button>
            </>
          )}
          {menu.kind === "canvas" && (
            <button
              type="button"
              className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-black/[0.05] dark:hover:bg-white/[0.06]"
              onClick={() => {
                onRequestNewFolder();
                setMenu(null);
              }}
            >
              {t("projects.newFolder")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NewFolderDraftRow({
  onCommit,
  onCancel,
}: {
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-1 flex items-center gap-1 rounded-md px-1 py-1 bg-primary/5 border border-primary/20">
      <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" />
      <Folder className="size-3.5 shrink-0 text-primary/70" />
      <input
        autoFocus
        type="text"
        defaultValue=""
        placeholder={t("projects.newFolderPlaceholder")}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const v = (e.currentTarget as HTMLInputElement).value.trim();
            if (v) onCommit(v);
            else onCancel();
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim();
          if (v) onCommit(v);
          else onCancel();
        }}
      />
    </div>
  );
}

function ProjectRow({
  project,
  active,
  onClick,
  onRemove,
}: {
  project: Project;
  active: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/skiller-project", project.path);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`group flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
        active
          ? "bg-black/[0.05] dark:bg-white/[0.09]"
          : "hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
      }`}
    >
      <button type="button" aria-label={`Open project ${project.name}`} aria-current={active ? 'true' : undefined} onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium truncate leading-tight">{project.name}</span>
        <span className="block text-[10px] text-muted-foreground/70 truncate font-mono">
          {project.path}
        </span>
      </span>
      </button>
      <button
        type="button"
        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label="Remove project"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

function ProjectDetail({ project }: { project: Project }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const projectSkillsQuery = useProjectSkills(project.path);
  const { data: skills, isLoading } = projectSkillsQuery;
  const inventory = useSkills();
  const uninstall = useUninstallProjectSkill();
  const toggle = useMutation({
    mutationFn: (skill: ProjectSkill) => invoke('set_project_skill_enabled', { projectPath: project.path, skillId: skill.id, enabled: skill.enabled === false }),
    onSuccess: async () => { await projectSkillsQuery.refetch(); await queryClient.invalidateQueries({ queryKey: ['skills'] }); },
  });
  const [wizardMode, setWizardMode] = useState<"git" | "local" | null>(null);
  const [wizardLocalPath, setWizardLocalPath] = useState<string | null>(null);
  const [openedSkill, setOpenedSkill] = useState<ProjectSkill | null>(null);
  const [search, setSearch] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [rawSelection, setRawSelection] = useState<Set<string>>(new Set());
  const [removal, setRemoval] = useState<ProjectSkill[] | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removalError, setRemovalError] = useState('');
  const removalDialog = useRef<HTMLDialogElement>(null);
  const visible = (skills ?? []).filter(skill => `${skill.name} ${skill.id} ${skill.description ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selection = visibleSkillSelection(rawSelection, visible.map(skill => skill.id));
  useEffect(() => { setRawSelection(current => visibleSkillSelection(current, visible.map(skill => skill.id))) }, [skills, search]);
  useEffect(() => { if (removal) removalDialog.current?.showModal() }, [!!removal]);

  async function removeReviewedSkills() {
    if (!removal || removing) return;
    setRemoving(true);
    const errors: string[] = [];
    for (const skill of removal) {
      try {
        const result = await uninstall.mutateAsync({ projectPath: project.path, skillId: skill.id });
        if (result.kept.length) errors.push(`${skill.name}: separate agent copies were kept`);
        setRawSelection(current => new Set([...current].filter(id => id !== skill.id)));
      } catch (error) { errors.push(`${skill.name}: ${error instanceof Error ? error.message : 'Could not remove skill'}`) }
    }
    await projectSkillsQuery.refetch();
    setRemoving(false);
    if (errors.length) setRemovalError(errors.join('\n'));
    else { removalDialog.current?.close(); setSelecting(false); }
  }
  const pickingLocalRef = useRef(false);

  async function openLocalImport() {
    if (pickingLocalRef.current) return;
    pickingLocalRef.current = true;
    try {
      const picked = await pickFolder();
      if (picked) {
        setWizardLocalPath(picked);
        setWizardMode("local");
      }
    } finally {
      pickingLocalRef.current = false;
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-lg font-[590]">{project.name}</h1>
          <Tooltip content={t("projects.revealInFinder")}>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground font-mono truncate block max-w-full"
            onClick={() => revealItemInDir(project.path)}
          >
            {project.path}
          </button>
          </Tooltip>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={() => setWizardMode("git")}>
            <GitBranch className="size-3.5" />
            {t("projects.installFromGit")}
          </Button>
          <Button size="sm" variant="outline" onClick={openLocalImport}>
            <FolderOpen className="size-3.5" />
            {t("projects.installFromLocal")}
          </Button>
        </div>
      </div>

      <SkillPresets key={project.path} project={project} projectSkills={skills} skills={inventory.data} disabled={isLoading || !inventory.data || uninstall.isPending} />

      {wizardMode && (
        <ImportWizard
          mode={wizardMode}
          initialLocalPath={wizardLocalPath}
          initialProjectPath={project.path}
          onClose={() => {
            setWizardMode(null);
            setWizardLocalPath(null);
            queryClient.invalidateQueries({ queryKey: ["project-skills", project.path] });
          }}
        />
      )}

      {openedSkill && (
        <ProjectSkillDetailModal
          projectPath={project.path}
          skill={openedSkill}
          librarySkill={inventory.data?.find(item => item.id === openedSkill.id)}
          onClose={() => setOpenedSkill(null)}
        />
      )}

      {removal && <dialog ref={removalDialog} onClose={() => { setRemoval(null); setRemovalError('') }} onCancel={event => { if (removing) event.preventDefault() }} aria-labelledby="project-removal-title" className="m-auto w-[min(32rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-auto rounded-2xl border border-border bg-card p-5 text-foreground shadow-2xl backdrop:bg-black/50">
        <h2 id="project-removal-title" className="text-sm font-semibold">Remove {removal.length} {removal.length === 1 ? 'skill' : 'skills'} from {project.name}?</h2>
        <ul className="my-4 max-h-64 space-y-3 overflow-auto">{removal.map(skill => <li key={skill.id} className="text-xs"><p className="font-medium">{skill.name}</p><code className="mt-1 block break-all text-muted-foreground">{skill.path}</code></li>)}</ul>
        <p className="text-xs text-muted-foreground">Project copies move to Trash. Library sources stay in place.</p>
        {removalError && <p role="alert" className="mt-3 whitespace-pre-line text-xs text-destructive">{removalError}</p>}
        <div className="mt-4 flex gap-2"><Button size="sm" variant="destructive" disabled={removing || !!removalError} onClick={() => void removeReviewedSkills()}>{removing ? 'Removing…' : 'Move to Trash'}</Button><Button size="sm" variant="outline" disabled={removing} onClick={() => removalDialog.current?.close()}>{removalError ? 'Done' : 'Cancel'}</Button></div>
      </dialog>}

      <div className="space-y-2">
        {!!skills?.length && <div className="flex flex-wrap items-center justify-between gap-3">
          <input type="search" aria-label="Filter project skills" placeholder="Filter skills…" value={search} onChange={event => setSearch(event.target.value)} className="w-64 rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <div className="flex items-center gap-2">
            {selecting && <><span className="text-xs tabular-nums text-muted-foreground">{selection.size} selected</span><Button size="sm" variant="ghost" disabled={!visible.length || removing} onClick={() => setRawSelection(selection.size === visible.length ? new Set() : new Set(visible.map(skill => skill.id)))}>{selection.size === visible.length && visible.length > 0 ? 'Clear selection' : 'Select all in view'}</Button><Button size="sm" variant="outline" disabled={!selection.size || removing} onClick={() => { setRemovalError(''); setRemoval(visible.filter(skill => selection.has(skill.id))) }}>Remove selected…</Button></>}
            <Button size="sm" variant="ghost" disabled={removing} onClick={() => { setSelecting(value => !value); setRawSelection(new Set()) }}>{selecting ? 'Done' : 'Select'}</Button>
          </div>
        </div>}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">
            {t("projects.skillsHeading")}
          </h2>
          {skills && skills.length > 0 && (
            <span className="text-[10px] tabular-nums text-muted-foreground/60">
              {search.trim() ? `${visible.length} of ${skills.length} skills` : t("projects.skillsCount", { count: skills.length })}
            </span>
          )}
        </div>

        {toggle.error && <p role="alert" className="mb-2 text-xs text-destructive">{toggle.error.message}</p>}
        {projectSkillsQuery.isError ? <div role="alert" className="space-y-2 rounded-xl border border-border p-4"><p className="text-sm text-destructive">{projectSkillsQuery.error.message}</p><Button size="sm" variant="outline" onClick={() => void projectSkillsQuery.refetch()}>Retry</Button></div> : isLoading ? (
          <div className="space-y-2">
            <div className="h-12 rounded-md bg-muted/30 animate-pulse" />
            <div className="h-12 rounded-md bg-muted/30 animate-pulse" />
          </div>
        ) : !skills || skills.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 px-6 py-10 text-center">
            <Puzzle className="mx-auto mb-3 size-7 text-muted-foreground/40" />
            <p className="text-sm font-medium">
              {t("projects.noSkillsInProject")}
            </p>
            <p className="mt-2 text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
              {t("projects.emptyStateIntro")}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <RouterLink to="/marketplace" className="rounded-md px-3 py-2 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{t("projects.openMarketplace")}</RouterLink>
            </div>
          </div>
        ) : !visible.length ? <div className="rounded-xl border border-dashed border-border/60 p-8 text-center"><p className="text-sm text-muted-foreground">No matching skills.</p><Button size="sm" variant="ghost" className="mt-2" onClick={() => setSearch('')}>Clear search</Button></div> : (
          <div className="space-y-1">
            {visible.map((s) => (
              <div
                key={s.id}
                className={`group flex items-center gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04] ${selection.has(s.id) ? 'border-border bg-muted/30' : 'border-border/40'}`}
              >
                {selecting ? <Checkbox aria-label={`Select ${s.name}`} checked={selection.has(s.id)} disabled={removing} onCheckedChange={checked => { const next = new Set(selection); if (checked) next.add(s.id); else next.delete(s.id); setRawSelection(next) }} /> : <Puzzle className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                <button type="button" aria-label={`Open ${s.name}`} onClick={() => setOpenedSkill(s)} className="min-w-0 flex-1 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <p className="text-sm font-medium truncate">{s.name}{s.enabled === false && <span className="ml-2 text-xs font-normal text-muted-foreground">Disabled</span>}</p>
                  {s.description && (
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {s.description}
                    </p>
                  )}
                </button>
                <input type="checkbox" role="switch" aria-label={`Enable ${s.name} in ${project.name}`} checked={s.enabled !== false} disabled={removing || uninstall.isPending || toggle.isPending} onChange={() => { toggle.reset(); toggle.mutate(s); }} className="relative h-5 w-9 shrink-0 appearance-none rounded-full bg-muted-foreground/20 outline-none transition-colors checked:bg-foreground before:absolute before:left-0.5 before:top-0.5 before:size-4 before:rounded-full before:bg-background before:transition-transform checked:before:translate-x-4 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${s.name}`}
                  className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                  disabled={removing || toggle.isPending}
                  onClick={() => { setRemovalError(''); setRemoval([s]); }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
