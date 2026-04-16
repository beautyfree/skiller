/**
 * Thin wrapper around Electrobun's built-in Updater. Stores a reactive snapshot
 * that the webview can subscribe to, and pushes updates through the bun → webview
 * `app_update_status_changed` message channel.
 *
 * Flow:
 *   1. On startup we kick off `checkForUpdate()` in the background and schedule
 *      a recheck every 6 hours.
 *   2. The user can trigger `check`, `download`, and `apply` from Settings.
 *   3. Status transitions are surfaced via `onStatusChange` (Electrobun's hook)
 *      and projected into a single AppUpdateStatusJson snapshot.
 */
import { Updater } from "electrobun/bun";
import type {
	UpdateStatusEntry,
	UpdateStatusType,
} from "electrobun/bun";
import type { AppUpdateStatusJson } from "../shared/rpc-schema";

const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

type LocalInfo = Awaited<ReturnType<typeof Updater.getLocallocalInfo>>;

let cachedLocalInfo: LocalInfo | null = null;
let currentStatus: AppUpdateStatusJson | null = null;
let listener: ((status: AppUpdateStatusJson) => void) | null = null;
let recheckTimer: ReturnType<typeof setInterval> | null = null;

async function getLocalInfo(): Promise<LocalInfo> {
	if (!cachedLocalInfo) {
		cachedLocalInfo = await Updater.getLocallocalInfo();
	}
	return cachedLocalInfo;
}

function mapState(
	type: UpdateStatusType,
): AppUpdateStatusJson["state"] {
	switch (type) {
		case "checking":
			return "checking";
		case "no-update":
			return "up-to-date";
		case "update-available":
		case "check-complete":
			return "available";
		case "downloading":
		case "download-starting":
		case "download-progress":
		case "downloading-patch":
		case "downloading-full-bundle":
		case "applying-patch":
		case "decompressing":
		case "extracting":
		case "extracting-version":
		case "checking-local-tar":
		case "local-tar-found":
		case "local-tar-missing":
		case "fetching-patch":
		case "patch-found":
		case "patch-not-found":
		case "applying":
			return "downloading";
		case "patch-applied":
		case "patch-chain-complete":
		case "download-complete":
		case "replacing-app":
		case "launching-new-version":
		case "complete":
			return "ready";
		case "error":
		case "patch-failed":
			return "error";
		case "idle":
		default:
			return "idle";
	}
}

async function buildSnapshot(
	type: UpdateStatusType,
	entry?: UpdateStatusEntry,
): Promise<AppUpdateStatusJson> {
	const info = await getLocalInfo();
	const remote = Updater.updateInfo();
	const progress =
		type === "download-progress" && entry?.details?.progress !== undefined
			? Math.round(entry.details.progress)
			: currentStatus?.progress ?? null;

	const state = mapState(type);
	// `ready` only makes sense if we actually have a pending remote update.
	const normalizedState: AppUpdateStatusJson["state"] =
		state === "ready" && !remote?.updateReady ? "up-to-date" : state;

	return {
		state: normalizedState,
		localVersion: info.version,
		localHash: info.hash,
		channel: info.channel,
		remoteVersion: remote?.version ?? null,
		remoteHash: remote?.hash ?? null,
		progress: state === "downloading" ? progress ?? null : null,
		error: state === "error" ? entry?.message ?? "Update failed" : null,
		lastCheckedAt: currentStatus?.lastCheckedAt ?? null,
	};
}

async function emit(
	type: UpdateStatusType,
	entry?: UpdateStatusEntry,
): Promise<void> {
	currentStatus = await buildSnapshot(type, entry);
	listener?.(currentStatus);
}

export async function initAppUpdater(
	onChange: (status: AppUpdateStatusJson) => void,
): Promise<void> {
	listener = onChange;

	Updater.onStatusChange((entry) => {
		// Fire-and-forget — the snapshot resolves quickly (local file read is cached).
		void emit(entry.status, entry);
	});

	// Seed the first snapshot so the UI has something to render before the
	// initial check completes.
	await emit("idle");

	// Dev builds opt out of the updater entirely (the Updater reports
	// "no-update" immediately on dev channel).
	const info = await getLocalInfo();
	if (info.channel === "dev") return;

	// Initial + periodic checks. Swallow errors — network hiccups shouldn't
	// crash the main process.
	const check = () =>
		checkForUpdate().catch((err) => {
			console.warn("[updater] periodic check failed:", err);
		});
	void check();
	recheckTimer = setInterval(check, RECHECK_INTERVAL_MS);
}

export function getAppUpdateStatus(): AppUpdateStatusJson {
	if (!currentStatus) {
		throw new Error("App updater not initialized yet");
	}
	return currentStatus;
}

export async function checkForUpdate(): Promise<AppUpdateStatusJson> {
	await Updater.checkForUpdate();
	if (currentStatus) {
		currentStatus = { ...currentStatus, lastCheckedAt: Date.now() };
		listener?.(currentStatus);
	}
	return getAppUpdateStatus();
}

export async function downloadUpdate(): Promise<AppUpdateStatusJson> {
	await Updater.downloadUpdate();
	return getAppUpdateStatus();
}

export async function applyUpdate(): Promise<void> {
	if (Updater.updateInfo()?.updateReady) {
		await Updater.applyUpdate();
	}
}

export function stopAppUpdater(): void {
	if (recheckTimer) {
		clearInterval(recheckTimer);
		recheckTimer = null;
	}
	listener = null;
}
