/**
 * App updater — thin adapter over `electron-updater`'s `autoUpdater`.
 *
 * Event translation table (electron-updater → AppUpdateStatusJson.state):
 *   checking-for-update  → "checking"
 *   update-available     → "available"     (user chooses when to download)
 *   update-not-available → "up-to-date"
 *   download-progress    → "downloading"   (with 0–100 progress)
 *   update-downloaded    → "ready"         (updateReady → user can restart)
 *   error                → "error"
 *
 * Requires `publish` config in electron-builder.yml (GitHub provider). In dev
 * the autoUpdater silently no-ops — it detects the lack of app.asar and
 * refuses to run, which is what we want.
 */
import { app } from "electron";
import pkg from "electron-updater";
import type { AppUpdateStatusJson } from "../shared/rpc-schema";

const { autoUpdater } = pkg;

const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FIRST_DOWNLOAD_PROGRESS_TIMEOUT_MS = 90 * 1000;
const STALLED_DOWNLOAD_PROGRESS_TIMEOUT_MS = 5 * 60 * 1000;
const RELEASES_URL = "https://github.com/beautyfree/skiller/releases";

let listener: ((status: AppUpdateStatusJson) => void) | null = null;
let recheckTimer: ReturnType<typeof setInterval> | null = null;
let lastCheckedAt: number | null = null;
let downloadProgress: number | null = null;
let remoteVersion: string | null = null;
let lastError: string | null = null;
let state: AppUpdateStatusJson["state"] = "idle";
let updateDownloaded = false;
let downloadPromise: Promise<string[]> | null = null;
let downloadWatchdog: ReturnType<typeof setTimeout> | null = null;

function manualDownloadUrl(): string | null {
	if (!remoteVersion) return null;
	return `${RELEASES_URL}/tag/v${remoteVersion}`;
}

function clearDownloadWatchdog(): void {
	if (!downloadWatchdog) return;
	clearTimeout(downloadWatchdog);
	downloadWatchdog = null;
}

function armDownloadWatchdog(ms: number, message: string): void {
	clearDownloadWatchdog();
	downloadWatchdog = setTimeout(() => {
		if (state !== "downloading") return;
		lastError = `${message} Download manually from ${manualDownloadUrl() ?? RELEASES_URL}.`;
		setState("error");
	}, ms);
}

function snapshot(): AppUpdateStatusJson {
	return {
		state,
		localVersion: app.getVersion(),
		localHash: "",
		channel: "stable",
		remoteVersion,
		remoteHash: null,
		progress: downloadProgress,
		error: lastError,
		manualDownloadUrl: manualDownloadUrl(),
		lastCheckedAt,
	};
}

function emit(): void {
	if (!listener) return;
	try {
		listener(snapshot());
	} catch (err) {
		console.warn("[updater] listener threw:", err);
	}
}

function setState(next: AppUpdateStatusJson["state"]): void {
	state = next;
	emit();
}

function wireAutoUpdaterEvents(): void {
	autoUpdater.autoDownload = false;
	autoUpdater.autoInstallOnAppQuit = true;

	autoUpdater.on("checking-for-update", () => {
		clearDownloadWatchdog();
		lastCheckedAt = Date.now();
		lastError = null;
		setState("checking");
	});

	autoUpdater.on("update-available", (info) => {
		remoteVersion = info?.version ?? null;
		downloadProgress = null;
		updateDownloaded = false;
		clearDownloadWatchdog();
		setState("available");
	});

	autoUpdater.on("update-not-available", () => {
		clearDownloadWatchdog();
		setState("up-to-date");
	});

	autoUpdater.on("download-progress", (progress) => {
		const pct =
			typeof progress?.percent === "number" && Number.isFinite(progress.percent)
				? Math.max(0, Math.min(100, Math.round(progress.percent)))
				: null;
		downloadProgress = pct;
		if (pct !== null) {
			armDownloadWatchdog(
				STALLED_DOWNLOAD_PROGRESS_TIMEOUT_MS,
				"Update download stalled.",
			);
		}
		setState("downloading");
	});

	autoUpdater.on("update-downloaded", () => {
		clearDownloadWatchdog();
		downloadProgress = 100;
		updateDownloaded = true;
		setState("ready");
	});

	autoUpdater.on("error", (err) => {
		clearDownloadWatchdog();
		lastError = err?.message ?? String(err);
		setState("error");
	});
}

export function initAppUpdater(
	onStatus: (status: AppUpdateStatusJson) => void,
): void {
	listener = onStatus;

	// In dev `app.isPackaged` is false — autoUpdater refuses to run. Skip wiring
	// so we don't spam the console with "Skipping check for updates" messages.
	if (!app.isPackaged) {
		setState("idle");
		return;
	}

	wireAutoUpdaterEvents();

	// Fire-and-forget initial check, then poll every 6h. Downloads are always
	// user-initiated to avoid uncontrolled release traffic spikes.
	void autoUpdater.checkForUpdates().catch((err) => {
		lastError = err?.message ?? String(err);
		setState("error");
	});

	recheckTimer = setInterval(
		() => {
			void autoUpdater.checkForUpdates().catch((err) => {
				lastError = err?.message ?? String(err);
				setState("error");
			});
		},
		RECHECK_INTERVAL_MS,
	);
}

export function stopAppUpdater(): void {
	if (recheckTimer) {
		clearInterval(recheckTimer);
		recheckTimer = null;
	}
	clearDownloadWatchdog();
	listener = null;
}

// ---------------------------------------------------------------------------
// tRPC-facing API (matches the signatures rpc-handlers.ts expects).
// ---------------------------------------------------------------------------

export function getAppUpdateStatus(): AppUpdateStatusJson {
	return snapshot();
}

export async function checkForUpdate(): Promise<AppUpdateStatusJson> {
	if (!app.isPackaged) return snapshot();
	try {
		await autoUpdater.checkForUpdates();
	} catch (err) {
		lastError = (err as Error)?.message ?? String(err);
		setState("error");
	}
	return snapshot();
}

export async function downloadUpdate(): Promise<AppUpdateStatusJson> {
	// In dev the autoUpdater is a no-op — surface that as a clear error state
	// so the UI shows something instead of the button silently re-enabling.
	if (!app.isPackaged) {
		lastError =
			"Updates only work in a packaged build (bun run dist:mac / :win / :linux).";
		setState("error");
		return snapshot();
	}
	console.log("[updater] downloadUpdate() invoked; state=", state);
	// Optimistic transition so the renderer UI reflects work-in-progress even
	// before the first `download-progress` event fires (those can lag 2–3s on
	// slow networks).
	downloadProgress = null;
	setState("downloading");
	armDownloadWatchdog(
		FIRST_DOWNLOAD_PROGRESS_TIMEOUT_MS,
		"Update download did not start reporting progress.",
	);
	// Important UX behavior: return immediately so renderer request doesn't sit
	// in pending for minutes on large updates. Progress/finish/error keeps coming
	// through updater events pushed via `app_update_status_changed`.
	if (!downloadPromise) {
		downloadPromise = autoUpdater.downloadUpdate();
		void downloadPromise
			.then((result) => {
				console.log("[updater] downloadUpdate() resolved with:", result);
				clearDownloadWatchdog();
				// If update-downloaded event didn't fire yet (race on some
				// platforms), force the state transition from the resolved promise.
				if (state !== "ready") {
					updateDownloaded = true;
					downloadProgress = 100;
					setState("ready");
				}
			})
			.catch((err) => {
				console.warn("[updater] downloadUpdate() rejected:", err);
				clearDownloadWatchdog();
				lastError = (err as Error)?.message ?? String(err);
				setState("error");
			})
			.finally(() => {
				downloadPromise = null;
			});
	} else {
		console.log("[updater] download already in progress");
	}
	return snapshot();
}

export async function applyUpdate(): Promise<void> {
	if (!updateDownloaded) return;
	// quitAndInstall(isSilent, forceRunAfter). Default silent=false gives the
	// user the OS confirmation dialog; forceRunAfter=true relaunches the new
	// version automatically.
	autoUpdater.quitAndInstall(false, true);
}
