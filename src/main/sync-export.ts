import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { assertPortableRelativePath, assertSyncStableId } from "./sync-profile";
import { scanTextForSecrets, type SyncSecretFinding } from "./sync-secret-scan";

const MAX_FILES_PER_SKILL = 1_000;
const MAX_BYTES_PER_SKILL = 10 * 1024 * 1024;
const excludedDirectoryNames = new Set([".git", "node_modules"]);

export type SyncExportFile = {
	relativePath: string;
	size: number;
	sha256: string;
};

export type SyncExportFinding = SyncSecretFinding & {
	relativePath: string;
};

export type BundledSkillExportPlan = {
	id: string;
	sourcePath: string;
	bundledPath: string;
	sha256: string;
	files: SyncExportFile[];
	excludedPaths: string[];
	secretFindings: SyncExportFinding[];
};

/**
 * Builds a read-only export plan. It deliberately rejects symlinks so that a
 * selected skill cannot smuggle unrelated files out of the user's home tree.
 */
export function planBundledSkillExport(id: string, sourcePath: string): BundledSkillExportPlan {
	assertSyncStableId(id);
	const root = realpathSync(sourcePath);
	if (!lstatSync(root).isDirectory()) throw new Error(`Sync source is not a directory: ${sourcePath}`);

	const files: SyncExportFile[] = [];
	const excludedPaths: string[] = [];
	const secretFindings: SyncExportFinding[] = [];
	let totalBytes = 0;

	const visit = (directory: string): void => {
		for (const name of readdirSync(directory).sort()) {
			const absolutePath = join(directory, name);
			const relativePath = relative(root, absolutePath).replace(/\\/g, "/");
			assertPortableRelativePath(relativePath);
			const entry = lstatSync(absolutePath);
			if (entry.isSymbolicLink()) throw new Error(`Sync export rejects symlink: ${relativePath}`);
			if (entry.isDirectory()) {
				if (excludedDirectoryNames.has(name)) {
					excludedPaths.push(relativePath);
					continue;
				}
				visit(absolutePath);
				continue;
			}
			if (!entry.isFile()) throw new Error(`Sync export rejects unsupported file: ${relativePath}`);
			if (files.length >= MAX_FILES_PER_SKILL) throw new Error(`Sync export exceeds ${MAX_FILES_PER_SKILL} files`);

			const content = readFileSync(absolutePath);
			totalBytes += content.length;
			if (totalBytes > MAX_BYTES_PER_SKILL) throw new Error(`Sync export exceeds ${MAX_BYTES_PER_SKILL} bytes`);
			if (!content.includes(0)) {
				for (const finding of scanTextForSecrets(content.toString("utf8"))) {
					secretFindings.push({ ...finding, relativePath });
				}
			}
			files.push({
				relativePath,
				size: content.length,
				sha256: createHash("sha256").update(content).digest("hex"),
			});
		}
	};

	visit(root);
	if (!files.some((file) => basename(file.relativePath) === "SKILL.md")) {
		throw new Error(`Sync export requires SKILL.md: ${sourcePath}`);
	}
	const sha256 = createHash("sha256")
		.update([...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath)).map((file) => `${file.relativePath}\0${file.sha256}`).join("\n"))
		.digest("hex");
	return {
		id,
		sourcePath: root,
		bundledPath: `skills/${id}`,
		sha256,
		files,
		excludedPaths,
		secretFindings,
	};
}
