import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@/mainview/lib/native';
import { useSkillSets } from '@/mainview/hooks/useSkillSets';
import type { Skill } from '@/mainview/hooks/useSkills';
import type { MarketplaceSkillJson } from '@/shared/rpc-schema';
import { Button } from './ui/button';
import { nativeSelectClass } from '@/mainview/lib/utils';

export default function MarketplacePackPicker({ skill, localSkill, onClose }: { skill: MarketplaceSkillJson; localSkill?: Skill; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const sets = useSkillSets();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [installedId, setInstalledId] = useState(localSkill?.id);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const add = useMutation({
    mutationFn: async () => {
      const skillId = installedId ?? await invoke('install_from_marketplace', { skill, targetAgents: [] });
      setInstalledId(skillId);
      const inventory = await invoke('scan_all_skills');
      client.setQueryData(['skills'], inventory);
      const current = inventory.find(item => item.id === skillId);
      if (!current) throw new Error('Installed skill was not found; reload Library');
      return id ? invoke('set_skill_preset_member', { id, skillId, sourcePath: current.canonical_path, enabled: true })
        : invoke('save_skill_preset', { name, skillIds: [skillId] });
    },
    onSuccess: async pack => { await client.invalidateQueries({ queryKey: ['skill-presets'] }); onClose(); navigate(`/skill-sets/${pack.id}`); },
  });
  return <dialog ref={dialog} onClose={onClose} onCancel={event => { if (add.isPending) event.preventDefault(); }} aria-labelledby="marketplace-pack-title" className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card p-5 text-foreground shadow-2xl backdrop:bg-black/50">
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); add.mutate(); }}>
      <h2 id="marketplace-pack-title" className="text-sm font-semibold">Add to pack</h2>
      <p className="truncate text-xs text-muted-foreground">{skill.name}</p>
      <label className="flex flex-col gap-2 text-xs">Pack<select className={nativeSelectClass} value={id} disabled={add.isPending || sets.isPending || sets.isError} onChange={event => { setId(event.target.value); add.reset(); }}><option value="">New pack</option>{sets.data?.map(pack => <option key={pack.id} value={pack.id}>{pack.name}</option>)}</select></label>
      {!id && <label className="flex flex-col gap-2 text-xs">Pack name<input autoFocus required maxLength={80} value={name} disabled={add.isPending} onChange={event => setName(event.target.value)} className="h-9 rounded-md border border-border bg-muted/15 px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="Name your pack" /></label>}
      {!installedId && <p className="text-xs text-muted-foreground">This skill will be installed into Library.</p>}
      {(add.error || sets.error) && <p role="alert" className="text-xs text-destructive">{(add.error || sets.error)?.message}{installedId && ' The skill is in Library.'}</p>}
      <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="outline" disabled={add.isPending} onClick={() => dialog.current?.close()}>Cancel</Button><Button type="submit" size="sm" disabled={add.isPending || sets.isPending || sets.isError || (!id && !name.trim())}>{add.isPending ? 'Adding…' : 'Add to pack'}</Button></div>
    </form>
  </dialog>;
}
