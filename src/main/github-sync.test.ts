import { describe, expect, it } from "bun:test";
import { assertGitHubRepositoryName } from "./github-sync";

describe("GitHub sync setup", () => {
	it("accepts a personal or organisation repository name without accepting a URL or shell syntax", () => {
		expect(assertGitHubRepositoryName("skiller-skills")).toBe("skiller-skills");
		expect(assertGitHubRepositoryName("team/skiller-skills")).toBe("team/skiller-skills");
		expect(() => assertGitHubRepositoryName("https://github.com/team/repo")).toThrow();
		expect(() => assertGitHubRepositoryName("repo; command")).toThrow();
	});
});
