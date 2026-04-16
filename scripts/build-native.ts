#!/usr/bin/env bun
/**
 * Cross-platform entry for building native sidecars.
 *
 * - On macOS: shells out to `scripts/build-macos-effects.sh`, which compiles
 *   `libMacWindowEffects.dylib` and Developer-ID-codesigns it when available.
 * - On other platforms: writes a zero-byte placeholder so the existing Electrobun
 *   copy config stays valid and callers can blindly `bun run build:native`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const dylibPath = join(repoRoot, "src/bun/libMacWindowEffects.dylib");

if (process.platform === "darwin") {
	const result = spawnSync("bash", [join(here, "build-macos-effects.sh")], {
		stdio: "inherit",
		cwd: repoRoot,
	});
	process.exit(result.status ?? 1);
}

mkdirSync(dirname(dylibPath), { recursive: true });
if (!existsSync(dylibPath)) {
	writeFileSync(dylibPath, "");
}
console.log(
	`Non-macOS host (${process.platform}); skipped NSVisualEffectView dylib. Placeholder: ${dylibPath}`,
);
