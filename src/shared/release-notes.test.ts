import { describe, expect, it } from "bun:test";
import { findReleaseNote, parseChangelog, shouldShowReleaseNotes } from "./release-notes";

const changelog = `# Changelog

## [1.2.0](https://example.test) (2026-07-31)

### Features

* **skills:** add release notes ([abc1234](https://example.test/commit/abc1234))

### Bug Fixes

* repair updater

## [1.1.0] (2026-07-01)

### Features

* previous feature
`;

describe("release notes", () => {
	it("parses version, date, sections and human-readable changes", () => {
		const notes = parseChangelog(changelog);
		expect(notes[0]).toEqual({
			version: "1.2.0",
			date: "2026-07-31",
			sections: [
				{ title: "Features", changes: ["**skills:** add release notes"] },
				{ title: "Bug Fixes", changes: ["repair updater"] },
			],
		});
	});

	it("limits history and safely reports a missing version", () => {
		const notes = parseChangelog(changelog, 1);
		expect(notes).toHaveLength(1);
		expect(findReleaseNote(notes, "9.9.9")).toBeNull();
	});

	it("deduplicates equivalent changelog entries created by a commit and its merge", () => {
		const notes = parseChangelog(`## [1.2.0] (2026-07-31)

### Features

* **ui:** polish the release dialog
* **UI:** polish the release dialog
`);
		expect(notes[0]?.sections[0]?.changes).toEqual(["**ui:** polish the release dialog"]);
	});

	it("opens only after a real upgrade with notes", () => {
		const notes = parseChangelog(changelog);
		expect(shouldShowReleaseNotes(null, "1.2.0", notes)).toBe(false);
		expect(shouldShowReleaseNotes("1.2.0", "1.2.0", notes)).toBe(false);
		expect(shouldShowReleaseNotes("1.1.0", "1.2.0", notes)).toBe(true);
		expect(shouldShowReleaseNotes("1.1.0", "9.9.9", notes)).toBe(false);
	});
});
