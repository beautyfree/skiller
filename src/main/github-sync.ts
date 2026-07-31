import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** A personal repo or owner/repo; no shell interpolation is ever used. */
export function assertGitHubRepositoryName(value: string): string {
	const name = value.trim();
	if (!/^(?:[A-Za-z0-9-]+\/)?[A-Za-z0-9._-]{1,100}$/.test(name)) {
		throw new Error("GitHub repository must be `name` or `owner/name`");
	}
	return name;
}

/**
 * Uses the user's existing GitHub CLI session. Skiller deliberately never sees
 * or stores a GitHub token; `gh` owns authentication and creates the repo only
 * after an explicit UI action.
 */
export async function createGitHubSyncRepository(
	repository: string,
	visibility: "private" | "public",
): Promise<string> {
	const name = assertGitHubRepositoryName(repository);
	try {
		await execFileAsync("gh", ["repo", "create", name, `--${visibility}`, "--disable-wiki"]);
		const { stdout } = await execFileAsync("gh", ["repo", "view", name, "--json", "sshUrl", "--jq", ".sshUrl"]);
		const remote = stdout.trim();
		if (!/^git@github\.com:[^\s]+\.git$/.test(remote)) {
			throw new Error("GitHub CLI did not return an SSH remote URL");
		}
		return remote;
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Could not create GitHub repository via gh: ${detail}`);
	}
}
