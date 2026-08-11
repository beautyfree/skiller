import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { FolderOpen, FolderPlus } from "lucide-react";
import { Button } from "@/mainview/components/ui/button";
import { pickFolder } from "@/mainview/lib/native";
import { useAddProject, useProjects } from "@/mainview/hooks/useProjects";

interface Props {
  skillName: string;
  /** Called with the chosen project path; caller performs the install. */
  onInstall: (projectPath: string) => Promise<void>;
  onClose: () => void;
}

export default function InstallToProjectPicker({ skillName, onInstall, onClose }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: projects } = useProjects();
  const addProject = useAddProject();
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePick(projectPath: string) {
    setBusyPath(projectPath);
    setError(null);
    try {
      await onInstall(projectPath);
      await queryClient.invalidateQueries({ queryKey: ["project-skills", projectPath] });
      onClose();
      navigate(`/projects?path=${encodeURIComponent(projectPath)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyPath(null);
    }
  }

  async function handleAddAndInstall() {
    setError(null);
    try {
      const picked = await pickFolder({ title: t("projects.pickFolderTitle") });
      if (!picked) return;
      await addProject.mutateAsync(picked);
      await handlePick(picked);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div
      className="modal-shell modal-overlay fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="modal-panel w-full max-w-md rounded-3xl p-6 space-y-4 outline-none animate-modal-in glass-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-[590]">
            {t("skills.installToProjectTitle", { name: skillName })}
          </h2>
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {!projects || projects.length === 0 ? (
          <p className="text-xs leading-5 text-muted-foreground">
            Choose a project folder. Skiller saves this skill in <code className="font-mono text-foreground">.agents/skills</code>, so it can travel with the project's Git repository.
          </p>
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {projects.map((p) => (
              <button
                key={p.path}
                type="button"
                disabled={busyPath !== null}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.04] disabled:opacity-50"
                onClick={() => handlePick(p.path)}
              >
                <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-[10px] text-muted-foreground/70 truncate font-mono">
                    {p.path}
                  </p>
                </div>
                {busyPath === p.path && (
                  <span className="text-xs text-muted-foreground">…</span>
                )}
              </button>
            ))}
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          disabled={busyPath !== null}
          onClick={handleAddAndInstall}
        >
          <FolderPlus className="size-3.5" />
          Choose project folder…
        </Button>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
