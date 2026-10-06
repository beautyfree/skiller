import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, X } from 'lucide-react';
import { Button } from './ui/button';
import MarkdownContent from './MarkdownContent';
import { FileChangePreview } from './FileChangePreview';
import { invoke, revealItemInDir } from '@/mainview/lib/native';
import type { Skill } from '@/mainview/hooks/useSkills';

export function AgentSkillComparisonDialog({ skill, agentSlug, agentName, onClose }: {
  skill: Skill; agentSlug: string; agentName: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [replacementError, setReplacementError] = useState<string>();
  const [backupPath, setBackupPath] = useState<string>();
  useEffect(() => { dialog.current?.showModal(); }, []);
  const [tab, setTab] = useState<'agent' | 'diff' | 'library'>('diff');
  const [file, setFile] = useState('SKILL.md');
  const params = { skillId: skill.id, agentSlug, librarySourcePath: skill.canonical_path };
  const query = useQuery({ queryKey: ['agent-skill-comparison', params], queryFn: () => invoke('compare_agent_skill', params), retry: false });
  const summary = query.data?.comparison;
  const files = summary ? [...summary.changed_files, ...summary.only_on_computer, ...summary.only_in_library].sort() : [];
  const selectedFile = files.includes(file) ? file : files[0];
  const preview = useQuery({
    queryKey: ['agent-skill-file-diff', params, selectedFile, query.dataUpdatedAt],
    queryFn: () => invoke('compare_agent_skill', { ...params, file: selectedFile }),
    enabled: !!summary && !query.isFetching && tab === 'diff' && !!selectedFile, retry: false,
  });
  const content = tab === 'library' ? summary?.library_skill_md : summary?.local_skill_md;
  const truncated = tab === 'library' ? summary?.library_skill_md_truncated : summary?.local_skill_md_truncated;
  async function replace() {
    if (!query.data?.replacement || replacing) return;
    setReplacing(true);
    setReplacementError(undefined);
    try {
      const result = await invoke('replace_agent_skill', { ...params, ...query.data.replacement });
      setBackupPath(result.backupPath);
      setConfirm(false);
      await query.refetch();
      await queryClient.invalidateQueries({ queryKey: ['skills'] });
    } catch (error) { setReplacementError(error instanceof Error ? error.message : String(error)); }
    finally { setReplacing(false); }
  }
  return <dialog ref={dialog} aria-label={`Compare ${skill.name} in ${agentName}`} onClose={onClose}
    onCancel={event => { if (replacing) event.preventDefault(); }}
    onClick={event => { if (event.target === event.currentTarget && !replacing) dialog.current?.close(); }}
    className="m-auto w-[min(56rem,calc(100vw-2rem))] border-0 bg-transparent p-0 text-foreground backdrop:bg-black/50">
    <div className="glass-elevated flex max-h-[85dvh] flex-col rounded-2xl p-5">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0"><h2 className="truncate text-base font-semibold">{skill.name}</h2><p className="text-xs text-muted-foreground">{agentName} · Library comparison</p></div>
        <div className="flex gap-1"><Button variant="ghost" size="icon-sm" aria-label="Refresh comparison" disabled={query.isFetching || replacing} onClick={() => { setConfirm(false); setReplacementError(undefined); query.refetch(); }}><RefreshCw className="size-4" /></Button><Button autoFocus variant="ghost" size="icon-sm" aria-label="Close comparison" disabled={replacing} onClick={() => dialog.current?.close()}><X className="size-4" /></Button></div>
      </header>
      {query.data && <div className="my-3 space-y-1 text-[11px] text-muted-foreground">
        <button className="block max-w-full truncate text-left hover:text-foreground" onClick={() => revealItemInDir(query.data!.agentPath)}>{agentName}: {query.data.agentPath}</button>
        <button className="block max-w-full truncate text-left hover:text-foreground" onClick={() => revealItemInDir(query.data!.libraryPath)}>Library: {query.data.libraryPath}</button>
        <p>{query.data.sameSource ? 'Reads the same library source.' : files.length ? `${summary!.changed_files.length} changed · ${summary!.only_on_computer.length} only in agent · ${summary!.only_in_library.length} only in library` : 'Separate copy · Package files are identical.'}</p>
      </div>}
      <div role="group" aria-label="Agent and library comparison" className="my-3 flex gap-2">
        {(['agent', 'diff', 'library'] as const).map(item => <Button key={item} size="sm" variant={tab === item ? 'secondary' : 'ghost'} aria-pressed={tab === item} onClick={() => setTab(item)}>{{ agent: agentName, diff: 'Diff', library: 'Library' }[item]}</Button>)}
      </div>
      <div className="min-h-0 overflow-auto space-y-3">
        {query.isFetching ? <p role="status" className="text-xs text-muted-foreground">Comparing package files…</p> : query.error ? <p role="alert" className="text-sm text-destructive">{query.error.message}</p> : tab === 'diff' ? files.length ? <>
          <div className="flex flex-wrap gap-1.5" aria-label="Changed package files">{files.map(path => <Button key={path} size="xs" variant={selectedFile === path ? 'secondary' : 'outline'} aria-pressed={selectedFile === path} onClick={() => setFile(path)}>{path} · {summary!.only_on_computer.includes(path) ? 'Only in agent' : summary!.only_in_library.includes(path) ? 'Only in library' : 'Changed'}</Button>)}</div>
          <p className="text-xs text-muted-foreground">− Library · + {agentName}</p>
          {preview.isFetching ? <p role="status" className="text-xs text-muted-foreground">Loading file differences…</p> : preview.error ? <p role="alert" className="text-xs text-destructive">{preview.error.message}</p> : preview.data?.filePreview?.diff ? <FileChangePreview diff={preview.data.filePreview.diff} /> : preview.data?.filePreview?.image_data_url ? <img src={preview.data.filePreview.image_data_url} alt={selectedFile} className="max-h-80 max-w-full" /> : <p className="text-xs text-muted-foreground">{preview.data?.filePreview?.unavailable_reason}</p>}
        </> : <p className="text-sm text-muted-foreground">No differences in this package.</p> : <>
          {content ? <MarkdownContent content={content} /> : <p className="text-xs text-muted-foreground">Instructions could not be previewed.</p>}
          {truncated && <p className="text-xs text-muted-foreground">Preview truncated. Open the source folder to read the complete file.</p>}
        </>}
      </div>
      <footer className="mt-4 space-y-2 border-t border-border pt-3">
        {replacementError && <p role="alert" className="text-xs text-destructive">{replacementError}</p>}
        {backupPath && <button className="text-left text-xs text-muted-foreground hover:text-foreground" onClick={() => revealItemInDir(backupPath)}>Previous version kept here: {backupPath}</button>}
        {confirm && <p className="text-xs text-muted-foreground">Replace the entire package in {agentName}? The current version will move to Trash.</p>}
        {!query.isFetching && files.length > 0 && !query.data?.replacement && query.data?.replacementBlocked && <p className="text-xs text-muted-foreground">{query.data.replacementBlocked}</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" size="sm" disabled={replacing} onClick={() => confirm ? setConfirm(false) : dialog.current?.close()}>{confirm ? 'Cancel' : 'Keep current version'}</Button>
          {files.length > 0 && query.data?.replacement && <Button size="sm" disabled={query.isFetching || replacing} onClick={() => confirm ? void replace() : setConfirm(true)}>{replacing ? 'Replacing…' : confirm ? `Replace in ${agentName}` : 'Use library version'}</Button>}
        </div>
      </footer>
    </div>
  </dialog>;
}
