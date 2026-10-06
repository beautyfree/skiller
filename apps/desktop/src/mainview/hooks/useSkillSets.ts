import { useQuery } from '@tanstack/react-query'
import { invoke } from '@/mainview/lib/native'

export function useSkillSets(enabled = true) {
  return useQuery({
    queryKey: ['skill-presets'],
    queryFn: () => invoke('list_skill_presets'),
    enabled,
  })
}
