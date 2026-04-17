/**
 * App-updater stub for the Electron host.
 *
 * Phase 6 replaces this with `electron-updater` (autoUpdater, background
 * check interval, GitHub Releases publish config). Until then we ship
 * predictable no-ops so the tRPC handlers and Settings UI render without
 * errors and feature-flag themselves off cleanly.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppUpdateStatusJson } from "../shared/rpc-schema";

function readLocalVersion(): string {
	try {
		const here = dirname(fileURLToPath(import.meta.url));
		const pkg = JSON.parse(
			readFileSync(join(here, "..", "..", "package.json"), "utf-8"),
		) as { version?: string };
		return pkg.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

function idleStatus(): AppUpdateStatusJson {
	return {
		state: "idle",
		localVersion: readLocalVersion(),
		localHash: "",
		channel: "stable",
		remoteVersion: null,
		remoteHash: null,
		progress: null,
		error: null,
		lastCheckedAt: null,
	};
}

export function getAppUpdateStatus(): AppUpdateStatusJson {
	return idleStatus();
}

export async function checkForUpdate(): Promise<AppUpdateStatusJson> {
	return idleStatus();
}

export async function downloadUpdate(): Promise<AppUpdateStatusJson> {
	return idleStatus();
}

export async function applyUpdate(): Promise<void> {
	// no-op until Phase 6 wires electron-updater
}
