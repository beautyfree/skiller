export type ReleaseNoteSection = {
	title: string;
	changes: string[];
};

export type ReleaseNote = {
	version: string;
	date: string | null;
	sections: ReleaseNoteSection[];
};

export function parseChangelog(markdown: string, limit = 20): ReleaseNote[] {
	const matches = [...markdown.matchAll(/^## \[?([^\]\s]+)\]?(?:\([^\n)]*\))?\s*(?:\((\d{4}-\d{2}-\d{2})\))?\s*$/gm)];
	return matches.slice(0, limit).map((match, index) => {
		const bodyStart = (match.index ?? 0) + match[0].length;
		const bodyEnd = matches[index + 1]?.index ?? markdown.length;
		const body = markdown.slice(bodyStart, bodyEnd);
		const sectionMatches = [...body.matchAll(/^###\s+(.+?)\s*$/gm)];
		const sections = sectionMatches.flatMap((section, sectionIndex) => {
			const start = (section.index ?? 0) + section[0].length;
			const end = sectionMatches[sectionIndex + 1]?.index ?? body.length;
			const seenChanges = new Set<string>();
			const changes = body
				.slice(start, end)
				.split("\n")
				.filter((line) => /^\s*[-*]\s+/.test(line))
				.map((line) => normalizeReleaseNoteLine(line))
				.filter((change) => {
					const key = change.toLowerCase();
					if (seenChanges.has(key)) return false;
					seenChanges.add(key);
					return true;
				});
			return changes.length > 0 ? [{ title: section[1].trim(), changes }] : [];
		});
		return { version: match[1], date: match[2] ?? null, sections };
	});
}

export function findReleaseNote(notes: ReleaseNote[], version: string): ReleaseNote | null {
	return notes.find((note) => note.version === version) ?? null;
}

/** First launch is intentionally quiet; only an actual version transition opens the dialog. */
export function shouldShowReleaseNotes(
	previousVersion: string | null,
	currentVersion: string,
	notes: ReleaseNote[],
): boolean {
	return previousVersion !== null && previousVersion !== currentVersion && findReleaseNote(notes, currentVersion) !== null;
}

function normalizeReleaseNoteLine(line: string): string {
	return line
		.replace(/^\s*[-*]\s+/, "")
		.replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
		.replace(/\s+\([a-f0-9]{7,}\)$/i, "")
		.trim();
}
