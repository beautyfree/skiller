import { describe, expect, it } from "bun:test";
import { planProviderLibraryCreation } from "dotagents";
import {
	assertGitHubRepositoryName,
	createGitHubSyncRepository,
	planGitHubSyncRepository,
} from "./github-sync";

describe("GitHub sync setup", () => {
	it("accepts a personal or organisation repository name without accepting a URL or shell syntax", () => {
		expect(assertGitHubRepositoryName("skiller-skills")).toBe("skiller-skills");
		expect(assertGitHubRepositoryName("team/skiller-skills")).toBe("team/skiller-skills");
		expect(() => assertGitHubRepositoryName("https://github.com/team/repo")).toThrow();
		expect(() => assertGitHubRepositoryName("repo; command")).toThrow();
		expect(() => assertGitHubRepositoryName("..")).toThrow();
	});

	it("identifies the exact repository name and visibility reviewed before creation", () => {
		const first = planGitHubSyncRepository(" team/skills ", "private");
		const repeated = planGitHubSyncRepository("team/skills", "private");
		expect(first).toEqual(repeated);
		expect(first.planId).toMatch(/^[a-f0-9]{64}$/);
		expect(first.planId).toBe(planProviderLibraryCreation("github", "team/skills", "private").planId);
		expect(planGitHubSyncRepository("team/skills", "public").planId).not.toBe(first.planId);
	});

	it("rejects a changed repository plan before invoking GitHub", async () => {
		const plan = planGitHubSyncRepository("team/skills", "private");
		await expect(createGitHubSyncRepository({ ...plan, visibility: "public" }, 'unused')).rejects.toThrow("changed after review");
	});
});
