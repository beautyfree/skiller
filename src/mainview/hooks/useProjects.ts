import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@/mainview/lib/native";
import type { ProjectEntryJson, ProjectSkillJson } from "@/shared/rpc-schema";

export type Project = ProjectEntryJson;
export type ProjectSkill = ProjectSkillJson;

export function useProjects() {
  return useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => (await invoke("list_projects")) as Project[],
    staleTime: 60 * 1000,
  });
}

export function useAddProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) =>
      invoke("add_project", { path }) as Promise<Project>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useProjectFolders() {
  return useQuery<string[]>({
    queryKey: ["project-folders"],
    queryFn: async () => (await invoke("list_project_folders")) as string[],
    staleTime: 60 * 1000,
  });
}

export function useAddProjectFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      invoke("add_project_folder", { name }) as Promise<string[]>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-folders"] });
    },
  });
}

export function useRemoveProjectFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      invoke("remove_project_folder", { name }) as Promise<string[]>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-folders"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useRenameProjectFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      invoke("rename_project_folder", { from, to }) as Promise<string[]>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-folders"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useSetProjectGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, group }: { path: string; group: string | null }) =>
      invoke("set_project_group", { path, group }) as Promise<Project>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project-folders"] });
    },
  });
}

export function useRemoveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => invoke("remove_project", { path }),
    onSuccess: (_data, path) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project-skills", path] });
    },
  });
}

export function useProjectSkills(path: string | null) {
  return useQuery<ProjectSkill[]>({
    queryKey: ["project-skills", path],
    queryFn: async () =>
      (await invoke("list_project_skills", { path: path! })) as ProjectSkill[],
    enabled: !!path,
    staleTime: 30 * 1000,
  });
}

export function useUninstallProjectSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectPath, skillId }: { projectPath: string; skillId: string }) =>
      invoke("uninstall_project_skill", { projectPath, skillId }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["project-skills", vars.projectPath] });
    },
  });
}

export function useInstallRepoSkillToProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      repoIdParam,
      skillId,
      projectPath,
    }: {
      repoIdParam: string;
      skillId: string;
      projectPath: string;
    }) =>
      invoke("install_repo_skill_to_project", {
        repoIdParam,
        skillId,
        projectPath,
      }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["project-skills", vars.projectPath] });
    },
  });
}
