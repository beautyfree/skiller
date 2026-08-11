import { describe, expect, it } from "bun:test";
import * as repos from "./repos";

describe("normalizeSkillRepoUrl", () => {
	it("converts a GitHub tree URL into the cloneable repository URL", () => {
		const normalize = (
			repos as typeof repos & { normalizeSkillRepoUrl?: (url: string) => string }
		).normalizeSkillRepoUrl;
		expect(normalize).toBeDefined();
		if (!normalize) return;

		expect(normalize("https://github.com/emilkowalski/skills/tree/main/ui/animations"))
			.toBe("https://github.com/emilkowalski/skills");
	});
});
