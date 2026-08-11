import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@/mainview/lib/native";

export interface SkillRepo {
  id: string;
  name: string;
  description: string | null;
  repo_url: string;
  local_path: string;
  last_synced: string | null;
  skill_count: number;
}

export interface AddRepoResult {
  repo: SkillRepo;
  skills: import("@/mainview/hooks/useSkills").Skill[];
}

export function useRepos() {
  return useQuery<SkillRepo[]>({
    queryKey: ["repos"],
    queryFn: async () => (await invoke("list_skill_repos")) as SkillRepo[],
    staleTime: 60 * 1000,
  });
}

export function useAddRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (repoUrl: string) =>
      invoke("add_skill_repo", { repoUrl }) as Promise<AddRepoResult>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
    },
  });
}

export function useAddLocalDir() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: string) =>
      invoke("add_local_dir", { path }) as Promise<AddRepoResult>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
    },
  });
}

export function useRemoveRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      invoke("remove_skill_repo", { repoIdParam: repoId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
    },
  });
}

export function useSyncRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (repoIdParam: string) =>
      invoke("sync_skill_repo", { repoIdParam }) as Promise<SkillRepo>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
      queryClient.invalidateQueries({ queryKey: ["repo-skills"] });
    },
  });
}

export function useRepoSkills(repoId: string | null) {
  return useQuery({
    queryKey: ["repo-skills", repoId],
    queryFn: async () =>
      (await invoke("list_repo_skills", { repoIdParam: repoId! })) as import("@/mainview/hooks/useSkills").Skill[],
    enabled: !!repoId,
    staleTime: 30 * 1000,
  });
}

export function useInstallRepoSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      repoIdParam,
      skillId,
      targetAgents,
    }: {
      repoIdParam: string;
      skillId: string;
      targetAgents: string[];
    }) => invoke("install_repo_skill", { repoIdParam, skillId, targetAgents }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
