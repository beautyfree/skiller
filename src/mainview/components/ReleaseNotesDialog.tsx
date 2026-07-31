import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReleaseNote } from "@/shared/release-notes";
import { Button } from "@/mainview/components/ui/button";

type Props = {
	open: boolean;
	notes: ReleaseNote[];
	initialVersion: string | null;
	onClose: () => void;
};

export default function ReleaseNotesDialog({ open, notes, initialVersion, onClose }: Props) {
	const { t } = useTranslation();
	const initial = initialVersion && notes.some((note) => note.version === initialVersion)
		? initialVersion
		: notes[0]?.version ?? "";
	const [selectedVersion, setSelectedVersion] = useState(initial);

	useEffect(() => setSelectedVersion(initial), [initial]);
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open, onClose]);

	const note = useMemo(
		() => notes.find((entry) => entry.version === selectedVersion) ?? notes[0] ?? null,
		[notes, selectedVersion],
	);
	if (!open || !note) return null;

	return (
		<div className="modal-shell fixed inset-0 z-[110] flex items-center justify-center bg-black/25 dark:bg-black/40 animate-backdrop-in" onMouseDown={onClose}>
			<div role="dialog" aria-modal="true" aria-labelledby="release-notes-title" className="modal-panel-flex flex h-[min(78dvh,42rem)] w-[min(42rem,calc(100vw-2rem))] flex-col rounded-3xl outline-none animate-modal-in glass-elevated" onMouseDown={(event) => event.stopPropagation()}>
				<div className="flex shrink-0 items-start justify-between gap-3 px-6 pb-3 pt-5">
					<div>
						<p className="text-xs font-medium uppercase tracking-wider text-primary">{t("releaseNotes.eyebrow")}</p>
						<h2 id="release-notes-title" className="mt-1 text-lg font-semibold">Skiller {note.version}</h2>
						{note.date && <p className="mt-0.5 text-xs text-muted-foreground">{note.date}</p>}
					</div>
					<div className="flex items-center gap-2">
						<select value={note.version} onChange={(event) => setSelectedVersion(event.target.value)} aria-label={t("releaseNotes.versionLabel")} className="h-8 max-w-28 rounded-md border border-border bg-background px-2 text-xs">
							{notes.map((entry) => <option key={entry.version} value={entry.version}>v{entry.version}</option>)}
						</select>
						<Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("releaseNotes.close")}><X className="size-4" /></Button>
					</div>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto border-y border-border/60 px-6 py-5">
					{note.sections.length > 0 ? <div className="space-y-5">{note.sections.map((section) => <section key={section.title}><h3 className="text-sm font-medium">{section.title}</h3><ul className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">{section.changes.map((change, index) => <li key={`${change}-${index}`} className="flex gap-2"><span className="text-primary">•</span><span>{change}</span></li>)}</ul></section>)}</div> : <p className="text-sm text-muted-foreground">{t("releaseNotes.empty")}</p>}
				</div>
				<div className="flex shrink-0 justify-end px-6 py-4"><Button onClick={onClose}>{t("releaseNotes.done")}</Button></div>
			</div>
		</div>
	);
}
