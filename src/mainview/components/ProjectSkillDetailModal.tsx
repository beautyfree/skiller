import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Eye, X, FolderOpen } from "lucide-react";
import { Button } from "@/mainview/components/ui/button";
import MarkdownContent from "@/mainview/components/MarkdownContent";
import { invoke, revealItemInDir } from "@/mainview/lib/native";
import { extractMarkdownBody } from "@/mainview/lib/markdown";
import type { ProjectSkill } from "@/mainview/hooks/useProjects";

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
}

export default function ProjectSkillDetailModal({ projectPath, skill, onClose }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const skillMdPath = skill.path.endsWith("SKILL.md")
    ? skill.path
    : `${skill.path}/SKILL.md`;

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setDirty(false);
    setError(null);
    invoke("read_skill_content", { path: skillMdPath })
      .then((text) => {
        setContent(text as string);
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
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["project-skills", projectPath] });
      setMode("view");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-shell fixed inset-0 z-50 flex items-center justify-center bg-black/25 dark:bg-black/40 animate-backdrop-in"
      onClick={() => {
        if (dirty) return;
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="modal-panel-flex flex h-[min(85dvh,calc(100dvh-2rem))] w-full max-w-3xl flex-col rounded-3xl outline-none animate-modal-in glass-elevated"
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
            {mode === "view" ? (
              <Button size="sm" variant="outline" onClick={() => setMode("edit")}>
                <Pencil className="size-3.5" />
                {t("projects.editSkillMd")}
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => setMode("view")}>
                  <Eye className="size-3.5" />
                  {t("projects.previewSkillMd")}
                </Button>
                {dirty && (
                  <Button size="sm" disabled={saving} onClick={handleSave}>
                    {saving ? <Loader2 className="size-3.5 animate-spin" /> : t("projects.save")}
                  </Button>
                )}
              </>
            )}
            <Button variant="ghost" size="icon-sm" onClick={onClose} disabled={dirty && mode === "edit"}>
              <X className="size-4" />
            </Button>
          </div>
        </div>

        <hr className="border-border/60" />

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              {t("projects.loading")}
            </div>
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
            />
          )}
        </div>

        {error && (
          <div className="shrink-0 border-t border-border/60 px-6 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
