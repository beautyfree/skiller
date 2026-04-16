import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";

export function expandHome(path: string): string {
	if (path.startsWith("~/")) {
		const stripped = path.slice(2).replace(/\//g, sep);
		return join(homedir(), stripped);
	}
	return path;
}

export function resolveCanonical(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

export function isSymlink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

const COPY_MAX_DEPTH = 64;

export function copyDirRecursive(src: string, dest: string, depth = 0): void {
	if (depth > COPY_MAX_DEPTH) {
		throw new Error(`copyDirRecursive: max depth (${COPY_MAX_DEPTH}) exceeded`);
	}
	const source = resolveCanonical(src);
	mkdirSync(dest, { recursive: true });
	for (const name of readdirSync(source)) {
		const from = join(source, name);
		const to = join(dest, name);
		const st = statSync(from);
		if (st.isDirectory()) {
			copyDirRecursive(from, to, depth + 1);
		} else {
			copyFileSync(from, to);
		}
	}
}

export function linkOrCopy(original: string, link: string): void {
	try {
		if (process.platform === "win32") {
			symlinkSync(original, link, "junction");
		} else {
			symlinkSync(original, link, "dir");
		}
	} catch {
		copyDirRecursive(original, link);
	}
}

export function removePath(path: string): void {
	if (!existsSync(path)) return;
	const st = lstatSync(path);
	if (st.isDirectory()) {
		rmSync(path, { recursive: true, force: true });
	} else {
		rmSync(path, { force: true });
	}
}

export function ensureParent(path: string): void {
	mkdirSync(dirname(path), { recursive: true });
}

export function writeFileEnsured(path: string, content: string): void {
	ensureParent(path);
	writeFileSync(path, content, "utf-8");
}
