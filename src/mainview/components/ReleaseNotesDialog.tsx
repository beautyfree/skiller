import { useEffect, useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReleaseNote } from "@/shared/release-notes";
import { Button } from "@/mainview/components/ui/button";
import { cn, nativeSelectClass } from "@/mainview/lib/utils";

type Props = {
	open: boolean;
	notes: ReleaseNote[];
	initialVersion: string | null;
	onClose: () => void;
};

const markdownPlugins = [remarkGfm];

const releaseNoteMarkdownComponents = {
	p: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
	a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
		<a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
			{children}
		</a>
	),
	strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-[590] text-foreground">{children}</strong>,
	em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
	code: ({ children }: { children?: React.ReactNode }) => (
		<code className="rounded bg-black/[0.04] px-1 py-0.5 font-mono text-xs text-foreground dark:bg-white/[0.06]">
			{children}
		</code>
	),
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
						<div className="relative min-w-[6.75rem]">
							<select
								value={note.version}
								onChange={(event) => setSelectedVersion(event.target.value)}
								aria-label={t("releaseNotes.versionLabel")}
								className={cn(nativeSelectClass, "w-full px-3.5 pr-9 text-xs font-medium tabular-nums")}
							>
								{notes.map((entry) => <option key={entry.version} value={entry.version}>v{entry.version}</option>)}
							</select>
							<ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/80" aria-hidden />
						</div>
						<Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("releaseNotes.close")}><X className="size-4" /></Button>
					</div>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto border-y border-border/60 px-6 py-5">
					{note.sections.length > 0 ? (
						<div className="space-y-5">
							{note.sections.map((section) => (
								<section key={section.title}>
									<h3 className="text-sm font-medium">{section.title}</h3>
									<ul className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">
										{section.changes.map((change, index) => (
											<li key={`${change}-${index}`} className="flex gap-2">
												<span className="mt-0.5 text-primary">•</span>
												<ReactMarkdown remarkPlugins={markdownPlugins} components={releaseNoteMarkdownComponents}>
													{change}
												</ReactMarkdown>
											</li>
										))}
									</ul>
								</section>
							))}
						</div>
					) : <p className="text-sm text-muted-foreground">{t("releaseNotes.empty")}</p>}
				</div>
				<div className="flex shrink-0 justify-end px-6 py-4"><Button onClick={onClose}>{t("releaseNotes.done")}</Button></div>
			</div>
		</div>
	);
}
