/**
 * electron-builder `afterAllArtifactBuild` hook.
 *
 * Swaps the ELF runtime at the head of every produced AppImage with the
 * static runtime from https://github.com/AppImage/type2-runtime. That runtime
 * ships with squashfuse compiled in, so the resulting AppImage launches on
 * systems that have libfuse2, libfuse3, or no FUSE at all — which matters
 * most for Arch-based distros (CachyOS, Manjaro, EndeavourOS) where libfuse2
 * is not preinstalled.
 *
 * AppImage layout (type 2):
 *   [ ELF runtime (~180 KB) | squashfs FS image ('hsqs' magic) ]
 *
 * We locate the squashfs magic, drop everything before it, prepend the new
 * runtime. Then we recompute sha512 + size and patch `latest-linux.yml` so
 * electron-updater's signature check keeps passing.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import YAML from "yaml";

const STATIC_RUNTIME_URL =
	"https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64";
const RUNTIME_CACHE_DIR = join(process.cwd(), "build-resources");
const RUNTIME_CACHE_PATH = join(RUNTIME_CACHE_DIR, "appimage-runtime-x86_64");

/** Little-endian squashfs magic: "hsqs" (0x68 0x73 0x71 0x73). */
const SQUASHFS_MAGIC = Buffer.from([0x68, 0x73, 0x71, 0x73]);

async function downloadStaticRuntime() {
	if (existsSync(RUNTIME_CACHE_PATH)) {
		return RUNTIME_CACHE_PATH;
	}
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
			`[patch-appimage] ${basename(ymlPath)} not found — skipping manifest update`,
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

export default async function afterAllArtifactBuild(buildResult) {
	const appImages = (buildResult?.artifactPaths ?? []).filter((p) =>
		p.endsWith(".AppImage"),
	);
	if (appImages.length === 0) {
		return [];
	}

	for (const appImagePath of appImages) {
		const patched = await patchAppImage(appImagePath);
		const ymlPath = join(dirname(appImagePath), "latest-linux.yml");
		await updateLatestLinuxYaml(ymlPath, basename(appImagePath), patched);
	}

	// Don't advertise additional artifacts — we mutated existing ones in place.
	return [];
}
