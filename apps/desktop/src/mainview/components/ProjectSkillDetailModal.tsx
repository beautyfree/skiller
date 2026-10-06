import { FileChangePreview } from './FileChangePreview';
import type { Skill } from '@/mainview/hooks/useSkills';
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Eye, X, FolderOpen, RefreshCw } from "lucide-react";
import { Button } from "@/mainview/components/ui/button";
import MarkdownContent from "@/mainview/components/MarkdownContent";
import { invoke, revealItemInDir } from "@/mainview/lib/native";
import { extractMarkdownBody } from "@/mainview/lib/markdown";
import type { ProjectSkill } from "@/mainview/hooks/useProjects";
import type { ProjectSkillComparisonJson } from '@/shared/rpc-schema';

function extractFrontmatter(raw: string): string | null {
  const normalized = raw.replace(/\r\n/g, "\n");
  const trimmed = normalized.trimStart();
  const lines = trimmed.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      return lines.slice(1, i).join("\n");
    }
  }
  return null;
}

interface Props {
  projectPath: string;
  skill: ProjectSkill;
  onClose: () => void;
  librarySkill?: Skill;
}

export default function ProjectSkillDetailModal({ projectPath, skill, onClose, librarySkill }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const savedContent = useRef('');
  useEffect(() => { dialog.current?.showModal() }, []);
  const skillMdPath = skill.path.endsWith("SKILL.md")
    ? skill.path
    : `${skill.path}/SKILL.md`;

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [updateReview, setUpdateReview] = useState<ProjectSkillComparisonJson['libraryUpdate']>();
  const [updatingLibrary, setUpdatingLibrary] = useState(false);
  const [updateError, setUpdateError] = useState<string>();
  const [savedToLibrary, setSavedToLibrary] = useState(false);
  const [backupPath, setBackupPath] = useState<string>();
  const [tab, setTab] = useState<'project' | 'diff' | 'library'>('project');
  const [file, setFile] = useState('SKILL.md');
  const comparison = useQuery({
    queryKey: ['project-skill-comparison', projectPath, skill.id, librarySkill?.canonical_path],
    queryFn: () => invoke('compare_project_skill', { projectPath, skillId: skill.id, librarySourcePath: librarySkill!.canonical_path }),
    enabled: !!librarySkill && mode === 'view', retry: false,
  });
  const summary = comparison.data?.comparison;
  const files = summary ? [...summary.changed_files, ...summary.only_on_computer, ...summary.only_in_library].sort() : [];
  const selectedFile = files.includes(file) ? file : files[0];
  const preview = useQuery({
    queryKey: ['project-skill-file-diff', projectPath, skill.id, librarySkill?.canonical_path, selectedFile, comparison.dataUpdatedAt],
    queryFn: () => invoke('compare_project_skill', { projectPath, skillId: skill.id, librarySourcePath: librarySkill!.canonical_path, file: selectedFile }),
    enabled: !!librarySkill && !comparison.isFetching && tab === 'diff' && !!selectedFile && mode === 'view', retry: false,
  });
  const previewChanged = !!preview.data?.libraryUpdate && !!comparison.data?.libraryUpdate && (
    preview.data.libraryUpdate.projectHash !== comparison.data.libraryUpdate.projectHash ||
    preview.data.libraryUpdate.libraryHash !== comparison.data.libraryUpdate.libraryHash
  );
  const [error, setError] = useState<string | null>(null);

  async function updateLibrary() {
    if (!librarySkill || !updateReview || updatingLibrary) return;
    setUpdatingLibrary(true);
    setUpdateError(undefined);
    try {
      const result = await invoke('update_project_skill_to_library', { projectPath, skillId: skill.id, librarySourcePath: librarySkill.canonical_path, ...updateReview });
      setBackupPath(result.backupPath);
      setUpdateReview(undefined);
      setSavedToLibrary(true);
      await queryClient.invalidateQueries({ queryKey: ['skills'] });
      await queryClient.invalidateQueries({ queryKey: ['project-skill-comparison'] });
      await queryClient.invalidateQueries({ queryKey: ['agent-skill-comparison'] });
    } catch (err) { setUpdateError(err instanceof Error ? err.message : String(err)); }
    finally { setUpdatingLibrary(false); }
  }

  useEffect(() => {
    setLoading(true);
    setDirty(false);
    setError(null);
    invoke("read_skill_content", { path: skillMdPath })
      .then((text) => {
        setContent(text as string);
        savedContent.current = text as string;
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [skillMdPath]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await invoke("write_skill_content", { path: skillMdPath, content });
      savedContent.current = content;
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["project-skills", projectPath] });
      queryClient.invalidateQueries({ queryKey: ['project-skill-comparison', projectPath] });
      setMode("view");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-label={skill.name}
      className="m-auto w-[min(64rem,calc(100vw-2rem))] max-w-none max-h-none border-0 bg-transparent p-0 text-foreground backdrop:bg-black/50"
      onClose={onClose}
      onCancel={event => { if (dirty || saving || updatingLibrary) event.preventDefault() }}
      onClick={event => { if (event.target === event.currentTarget && !dirty && !saving && !updatingLibrary) dialog.current?.close() }}
    >
      <div
        className="modal-panel-flex flex h-[min(44rem,85dvh,calc(100dvh-2rem))] w-full flex-col rounded-2xl outline-none animate-modal-in glass-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 px-6 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-[590] truncate">{skill.name}</h2>
            {skill.description && (
              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                {skill.description}
              </p>
            )}
            <button
              type="button"
              className="mt-1 block text-[10px] text-muted-foreground/70 hover:text-foreground font-mono truncate max-w-full"
              onClick={() => revealItemInDir(skill.path)}
            >
              <FolderOpen className="inline size-3 mr-1 align-[-2px]" />
              {skill.path}
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {mode === "view" && tab === "project" ? (
              <Button size="sm" variant="outline" disabled={updatingLibrary || !!updateReview} onClick={() => { setMode("edit"); setSavedToLibrary(false); setUpdateError(undefined); }}>
                <Pencil className="size-3.5" />
                {t("projects.editSkillMd")}
              </Button>
            ) : mode === "edit" ? (
              <>
                <Button size="sm" variant="outline" disabled={saving} onClick={() => setMode("view")}>
                  <Eye className="size-3.5" />
                  {t("projects.previewSkillMd")}
                </Button>
                {dirty && (
                  <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setContent(savedContent.current); setDirty(false); setMode('view') }}>Discard changes</Button>
                )}
                {dirty && (
                  <Button size="sm" disabled={saving} onClick={handleSave}>
                    {saving ? <Loader2 className="size-3.5 animate-spin" /> : t("projects.save")}
                  </Button>
                )}
              </>
            ) : null}
            <Button autoFocus variant="ghost" size="icon-sm" aria-label="Close skill" onClick={() => dialog.current?.close()} disabled={dirty || saving || updatingLibrary}>
              <X className="size-4" />
            </Button>
          </div>
        </div>

        <div className="shrink-0 space-y-2 border-t border-border/60 px-6 py-3">
          <div className="flex items-center gap-2" role="group" aria-label="Project and library comparison">
            {(['project', 'diff', 'library'] as const).map(item => <button key={item} type="button" aria-pressed={tab === item} disabled={mode === 'edit' || updatingLibrary || (item !== 'project' && !librarySkill)} onClick={() => setTab(item)} className={`rounded-full px-3 py-1.5 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 ${tab === item ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'}`}>{{ project: 'Project', diff: 'Diff', library: 'Library' }[item]}</button>)}
            {librarySkill && <Button size="icon-xs" variant="ghost" aria-label="Refresh comparison" disabled={mode === 'edit' || comparison.isFetching || updatingLibrary} onClick={() => { setUpdateReview(undefined); setUpdateError(undefined); setSavedToLibrary(false); void comparison.refetch(); }}><RefreshCw className="size-3.5" /></Button>}
          </div>
          {!librarySkill ? <p className="text-xs text-muted-foreground">This skill has no matching entry in your library.</p> : <>
            <button type="button" title={librarySkill.canonical_path} onClick={() => revealItemInDir(librarySkill.canonical_path)} className="block max-w-full truncate text-left text-[11px] text-muted-foreground hover:text-foreground">Library · {librarySkill.canonical_path}</button>
            {comparison.isFetching ? <p role="status" className="text-xs text-muted-foreground">Comparing package files…</p> : summary && <p className="text-xs text-muted-foreground">{files.length ? `${summary.changed_files.length} changed · ${summary.only_on_computer.length} only in project · ${summary.only_in_library.length} only in library` : 'Project and library files are identical'}</p>}
            {comparison.error && <p role="alert" className="text-xs text-destructive">{comparison.error.message}</p>}
          </>}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              {t("projects.loading")}
            </div>
          ) : mode === 'view' && tab === 'diff' ? (
            <div className="h-full overflow-auto space-y-3 px-6 py-4">
              {comparison.isFetching ? <p role="status" className="text-xs text-muted-foreground">Comparing…</p> : summary && !files.length ? <p className="text-sm text-muted-foreground">No differences in this package.</p> : <>
                <div className="grid gap-4 md:grid-cols-[11rem_minmax(0,1fr)]">
                <div className="flex flex-col gap-1" aria-label="Changed package files">{files.map(path => <button key={path} type="button" title={path} aria-pressed={selectedFile === path} onClick={() => setFile(path)} className={`rounded-lg px-3 py-2 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedFile === path ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'}`}><span className="block truncate font-mono">{path}</span><span className="mt-1 block text-[10px] opacity-60">{summary!.only_on_computer.includes(path) ? 'Only in project' : summary!.only_in_library.includes(path) ? 'Only in library' : 'Changed'}</span></button>)}</div>
                <div className="min-w-0 space-y-3">
                <p className="text-xs text-muted-foreground"><span className="text-red-700 dark:text-red-300">− Library</span><span className="mx-3 text-emerald-700 dark:text-emerald-300">+ Project</span></p>
                {preview.isFetching ? <p role="status" className="text-xs text-muted-foreground">Loading file differences…</p> : preview.data?.filePreview?.diff ? <FileChangePreview diff={preview.data.filePreview.diff} /> : preview.data?.filePreview?.image_data_url ? <img src={preview.data.filePreview.image_data_url} alt={selectedFile} className="max-h-80 max-w-full rounded-lg" /> : preview.data?.filePreview?.unavailable_reason ? <p className="text-xs text-muted-foreground">{preview.data.filePreview.unavailable_reason}</p> : null}
                {preview.error && <p role="alert" className="text-xs text-destructive">{preview.error.message}</p>}
                {previewChanged && <p role="alert" className="text-xs text-destructive">Files changed since this comparison. Refresh before saving.</p>}
                </div></div>
              </>}
            </div>
          ) : mode === 'view' && tab === 'library' ? (
            <div className="h-full overflow-auto px-6 py-4">{summary?.library_skill_md ? <><MarkdownContent content={summary.library_skill_md} />{summary.library_skill_md_truncated && <p className="mt-3 text-xs text-muted-foreground">This preview is truncated. Open the library file to read the complete document.</p>}</> : <p className="text-xs text-muted-foreground">{comparison.isFetching ? 'Loading library instructions…' : 'Library instructions could not be previewed.'}</p>}</div>
          ) : mode === "view" ? (
            <div className="h-full overflow-y-auto px-6 py-4 space-y-4">
              {(() => {
                const fm = extractFrontmatter(content);
                const body = extractMarkdownBody(content);
                return (
                  <>
                    {fm !== null && (
                      <pre className="rounded-md border border-border/60 bg-black/[0.03] dark:bg-white/[0.04] px-3 py-2 text-[11px] font-mono leading-relaxed whitespace-pre-wrap select-text">
                        {fm.trim()}
                      </pre>
                    )}
                    {body ? (
                      <MarkdownContent content={body} />
                    ) : fm === null ? (
                      <p className="text-xs italic text-muted-foreground">
                        {t("projects.emptySkillMd")}
                      </p>
                    ) : null}
                  </>
                );
              })()}
            </div>
          ) : (
            <textarea
              className="h-full w-full resize-none bg-transparent px-6 py-4 font-mono text-sm leading-relaxed outline-none"
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setDirty(true);
              }}
              spellCheck={false}
              disabled={saving}
            />
          )}
        </div>

        {error && (
          <div className="shrink-0 border-t border-border/60 px-6 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        {mode === 'view' && !dirty && librarySkill && (files.length > 0 || savedToLibrary || backupPath || updateError) && <footer className="shrink-0 space-y-2 border-t border-border/60 px-6 py-3">
          {savedToLibrary && <p role="status" className="text-xs text-muted-foreground">Saved to library.</p>}
          {backupPath && <button className="max-w-full truncate text-left text-xs text-muted-foreground hover:text-foreground" title={backupPath} onClick={() => revealItemInDir(backupPath)}>Previous version kept here: {backupPath}</button>}
          {updateError && <p role="alert" className="text-xs text-destructive">{updateError}</p>}
          {updateReview && <p className="text-xs text-muted-foreground">Replace the library package with this project version? Agents reading the library will use it immediately. The previous version moves to Trash.</p>}
          {!comparison.isFetching && files.length > 0 && !comparison.data?.libraryUpdate && <p className="text-xs text-muted-foreground">{comparison.data?.libraryUpdateBlocked}</p>}
          {files.length > 0 && comparison.data?.libraryUpdate && <div className="flex justify-end gap-2">
            {updateReview && <Button size="sm" variant="outline" disabled={updatingLibrary} onClick={() => { setUpdateReview(undefined); setUpdateError(undefined); }}>Cancel</Button>}
            <Button size="sm" disabled={updatingLibrary || comparison.isFetching || comparison.isError || previewChanged || (tab === 'diff' && (preview.isFetching || preview.isError))} onClick={() => {
              if (updateReview) void updateLibrary();
              else if (tab !== 'diff') setTab('diff');
              else { setUpdateReview(comparison.data!.libraryUpdate); setUpdateError(undefined); }
            }}>{updatingLibrary ? 'Saving…' : updateReview ? 'Replace library version' : tab === 'diff' ? 'Save to library' : 'Review library update'}</Button>
          </div>}
        </footer>}
      </div>
    </dialog>
  );
}
