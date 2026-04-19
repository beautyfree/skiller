#!/usr/bin/env node
/**
 * Standalone CLI — patches every `*.AppImage` in the given directory to use
 * the static runtime from AppImage/type2-runtime, then rewrites matching
 * entries in `latest-linux.yml` so electron-updater's sha512 check still
 * passes.
 *
 * Usage:
 *   node scripts/patch-appimage-runtime.mjs <artifacts-dir>
 *
 * Designed to run AFTER `electron-builder --linux` has finished producing
 * both the AppImage and the update manifest (electron-builder's own
 * `afterAllArtifactBuild` hook fires before the manifest is written, so we
 * invoke this at the `dist:linux` npm-script level instead).
 *
 * Why we patch: the stock AppImage runtime electron-builder ships dynamically
 * links against libfuse.so.2. Arch-based distros (CachyOS, Manjaro,
 * EndeavourOS) ship fuse3 by default, so double-clicking a stock AppImage
 * there fails with "dlopen failed for libfuse.so.2". The static runtime
 * bundles squashfuse, falls back to extract-and-run where kernel FUSE is
 * unavailable, and works on every distro.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import YAML from "yaml";

const STATIC_RUNTIME_URL =
	"https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64";
const RUNTIME_CACHE_DIR = join(process.cwd(), "build-resources");
const RUNTIME_CACHE_PATH = join(RUNTIME_CACHE_DIR, "appimage-runtime-x86_64");

/** Little-endian squashfs magic: "hsqs" (0x68 0x73 0x71 0x73). */
const SQUASHFS_MAGIC = Buffer.from([0x68, 0x73, 0x71, 0x73]);

async function downloadStaticRuntime() {
	if (existsSync(RUNTIME_CACHE_PATH)) return RUNTIME_CACHE_PATH;
	await mkdir(RUNTIME_CACHE_DIR, { recursive: true });
	console.log(
		`[patch-appimage] downloading static runtime from ${STATIC_RUNTIME_URL}`,
	);
	const res = await fetch(STATIC_RUNTIME_URL);
	if (!res.ok) {
		throw new Error(
			`[patch-appimage] failed to download static runtime: HTTP ${res.status}`,
		);
	}
	const buf = Buffer.from(await res.arrayBuffer());
	await writeFile(RUNTIME_CACHE_PATH, buf);
	await chmod(RUNTIME_CACHE_PATH, 0o755);
	return RUNTIME_CACHE_PATH;
}

async function patchAppImage(appImagePath) {
	const runtimePath = await downloadStaticRuntime();
	const [runtime, original] = await Promise.all([
		readFile(runtimePath),
		readFile(appImagePath),
	]);

	const squashfsOffset = original.indexOf(SQUASHFS_MAGIC);
	if (squashfsOffset === -1) {
		throw new Error(
			`[patch-appimage] squashfs magic not found in ${appImagePath}`,
		);
	}
	console.log(
		`[patch-appimage] ${basename(appImagePath)}: squashfs@${squashfsOffset}, runtime=${runtime.length}B (was ${squashfsOffset}B)`,
	);

	const patched = Buffer.concat([runtime, original.subarray(squashfsOffset)]);
	await writeFile(appImagePath, patched);
	await chmod(appImagePath, 0o755);
	return patched;
}

async function updateLatestLinuxYaml(ymlPath, appImageName, patched) {
	if (!existsSync(ymlPath)) {
		console.log(
			`[patch-appimage] ${basename(ymlPath)} not found — skipping manifest update (auto-update will not work on Linux)`,
		);
		return;
	}
	const raw = await readFile(ymlPath, "utf-8");
	const manifest = YAML.parse(raw);
	const sha512 = createHash("sha512").update(patched).digest("base64");
	const size = patched.length;

	let changed = false;
	for (const file of manifest?.files ?? []) {
		if (file?.url === appImageName) {
			file.sha512 = sha512;
			file.size = size;
			changed = true;
		}
	}
	if (manifest?.path === appImageName) {
		manifest.sha512 = sha512;
		changed = true;
	}

	if (changed) {
		await writeFile(ymlPath, YAML.stringify(manifest));
		console.log(
			`[patch-appimage] rewrote ${basename(ymlPath)} with new sha512/size`,
		);
	} else {
		console.warn(
			`[patch-appimage] ${basename(ymlPath)} had no entry for ${appImageName}`,
		);
	}
}

async function main() {
	const dir = resolve(process.argv[2] ?? "artifacts");
	if (!existsSync(dir)) {
		console.log(
			`[patch-appimage] directory ${dir} does not exist — nothing to do`,
		);
		return;
	}
	const entries = await readdir(dir);
	const appImages = entries
		.filter((e) => e.endsWith(".AppImage"))
		.map((e) => join(dir, e));
	if (appImages.length === 0) {
		console.log(`[patch-appimage] no .AppImage files in ${dir}`);
		return;
	}

	for (const appImagePath of appImages) {
		const patched = await patchAppImage(appImagePath);
		const ymlPath = join(dirname(appImagePath), "latest-linux.yml");
		await updateLatestLinuxYaml(ymlPath, basename(appImagePath), patched);
	}
}

void main().catch((err) => {
	console.error("[patch-appimage] FAILED:", err);
	process.exit(1);
});
