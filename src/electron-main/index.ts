/**
 * Electron main process entrypoint.
 *
 * Phase 2: real wiring — tRPC HTTP server, skill watcher, tray, IPC push
 * channel to the renderer, and platform adapter. Phase 3 layers in macOS
 * vibrancy/traffic-light polish; Phase 6 replaces the stub updater.
 */
import {
	app,
	BrowserWindow,
	Menu,
	nativeImage,
	shell,
	Tray,
	ipcMain,
} from "electron";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setPackagedResourcesDir, setPackagedViewsDir } from "../main/paths";
import { startSkillWatcher } from "../main/watcher";
import type { AppRPCSchema } from "../shared/rpc-schema";
import type { BunSideRpc } from "../main/rpc-handlers";
import { createAppRouter } from "../main/trpc/router";
import { initAppUpdater, stopAppUpdater } from "../main/app-updater";
import { createElectronPlatform } from "./platform-electron";
import { startTrpcHttpServer } from "./trpc-server";
import {
	effectiveMacOSWindowBlur,
	syncMacOSChromeFromSettings,
} from "./window-effects-macos";

const TRPC_PORT = Number(process.env.AGENTSKILLS_TRPC_PORT ?? 17888);
const DEFAULT_WINDOW_FRAME = {
	x: 120,
	y: 100,
	width: 1440,
	height: 900,
} as const;

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let stopWatcher: (() => void) | null = null;

// --- Packaged-resource paths ---------------------------------------------
// Production: `extraResources` in electron-builder.yml places `agents/` and
// `templates/` next to `app.asar` under `Contents/Resources/`. Dev: run from
// the repo so the fallback inside src/main/paths.ts picks up `./agents`.
if (app.isPackaged) {
	setPackagedResourcesDir(process.resourcesPath);
	setPackagedViewsDir(join(process.resourcesPath, "app"));
} else {
	setPackagedResourcesDir(app.getAppPath());
	setPackagedViewsDir(join(app.getAppPath(), "out/renderer"));
}

// --- Push channel: main → renderer ---------------------------------------
// Electrobun used a typed RPC duplex; in Electron we use webContents.send on
// a single "push" channel and discriminate by message name. The renderer
// bridges these through preload into the existing `listen()` API.
const PUSH_CHANNEL = "skiller:push";

const bunSideRpc: BunSideRpc = {
	send: (name, payload) => {
		const win = mainWindow;
		if (!win || win.isDestroyed()) return;
		win.webContents.send(PUSH_CHANNEL, { name, payload });
	},
};

// --- Platform adapter -----------------------------------------------------
const platform = createElectronPlatform(() => {
	if (!mainWindow) throw new Error("Main window is not ready");
	return mainWindow;
});

// --- tRPC router + HTTP server -------------------------------------------
const appRouter = createAppRouter({
	platform,
	rpc: bunSideRpc,
	ensureSkillWatcherStarted: () => {
		if (stopWatcher) return;
		stopWatcher = startSkillWatcher(() => {
			bunSideRpc.send("skills_changed");
		});
	},
});

let trpcServerPort = TRPC_PORT;
let trpcCloseServer: (() => void) | null = null;

async function initTrpcServer(): Promise<void> {
	const handle = await startTrpcHttpServer(appRouter, TRPC_PORT);
	trpcServerPort = handle.port;
	trpcCloseServer = handle.close;
	console.log(`tRPC: http://127.0.0.1:${trpcServerPort}/trpc`);
}

function sendTrpcEndpointToRenderer(): void {
	bunSideRpc.send("trpc_endpoint", {
		baseUrl: `http://127.0.0.1:${trpcServerPort}`,
	});
}

// --- Window ---------------------------------------------------------------
const TITLE_BAR_HEIGHT = 36;

function createMainWindow(): BrowserWindow {
	const isMac = process.platform === "darwin";
	const wantVibrancy = isMac && effectiveMacOSWindowBlur();

	const win = new BrowserWindow({
		title: "Skiller",
		width: DEFAULT_WINDOW_FRAME.width,
		height: DEFAULT_WINDOW_FRAME.height,
		x: DEFAULT_WINDOW_FRAME.x,
		y: DEFAULT_WINDOW_FRAME.y,
		show: false,
		autoHideMenuBar: true,
		// macOS — traffic-light inset matches the old libMacWindowEffects
		// placement (14x12) so Layout.tsx doesn't need titlebar adjustments.
		...(isMac
			? {
					titleBarStyle: "hiddenInset",
					trafficLightPosition: { x: 14, y: 12 },
					vibrancy: wantVibrancy ? ("sidebar" as const) : undefined,
					visualEffectState: "active" as const,
					transparent: wantVibrancy,
				}
			: {
					// Windows + Linux — hide the native frame but ask Electron to
					// paint native caption buttons (min/max/close) on an overlay.
					// The renderer leaves room for them using CSS env vars:
					//   env(titlebar-area-width), env(titlebar-area-x), etc.
					// `color: '#00000000'` = transparent overlay so our custom
					// drag band shows through and the caption buttons float on top.
					titleBarStyle: "hidden",
					titleBarOverlay: {
						color: "#00000000",
						symbolColor: "#888888",
						height: TITLE_BAR_HEIGHT,
					},
				}),
		webPreferences: {
			preload: join(__dirname, "../preload/index.js"),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	win.on("ready-to-show", () => win.show());

	win.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: "deny" };
	});

	// Push the tRPC endpoint every time a new document becomes interactive so
	// the renderer gets it before the first `invoke()` — mirrors the Electrobun
	// dom-ready flow.
	win.webContents.on("did-finish-load", sendTrpcEndpointToRenderer);

	if (is.dev && process.env.ELECTRON_RENDERER_URL) {
		void win.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		void win.loadFile(join(__dirname, "../renderer/index.html"));
	}

	return win;
}

// --- IPC handlers ---------------------------------------------------------
// Catch-all invoke bridge: renderer calls `window.api.invoke(channel, args)`,
// which forwards to ipcMain. Phase 2 only uses this for ad-hoc calls — the
// main traffic goes through tRPC over HTTP.
ipcMain.handle("skiller:version", () => app.getVersion());

// --- Tray -----------------------------------------------------------------
function trayIconPath(): string | undefined {
	const candidates = [
		join(__dirname, "tray", "tray.png"),
		join(__dirname, "tray", "tray-macos.png"),
		// Fallback to the packaged Resources folder (production).
		join(process.resourcesPath, "tray.png"),
	];
	for (const p of candidates) {
		try {
			readFileSync(p);
			return p;
		} catch {
			/* next */
		}
	}
	return undefined;
}

function setupTray(): void {
	const iconPath = trayIconPath();
	if (!iconPath || !existsSync(iconPath)) return;
	const image = nativeImage.createFromPath(iconPath);
	if (process.platform === "darwin") image.setTemplateImage(true);

	tray = new Tray(image);
	const contextMenu = Menu.buildFromTemplate([
		{
			label: "Show Skiller",
			click: () => {
				if (!mainWindow) return;
				if (mainWindow.isMinimized()) mainWindow.restore();
				mainWindow.show();
			},
		},
		{ type: "separator" },
		{ label: "Quit", click: () => app.quit() },
	]);
	tray.setContextMenu(contextMenu);
	tray.setToolTip("Skiller");
}

// --- App lifecycle --------------------------------------------------------
void app.whenReady().then(async () => {
	electronApp.setAppUserModelId("com.beautyfree.skiller");

	app.on("browser-window-created", (_event, win) => {
		optimizer.watchWindowShortcuts(win);
	});

	await initTrpcServer();

	// Push the user's saved theme into nativeTheme before the first window
	// mounts so the initial paint lands on the correct appearance.
	if (process.platform === "darwin") {
		syncMacOSChromeFromSettings();
	}

	mainWindow = createMainWindow();
	setupTray();

	// Kick off auto-updates. In dev `app.isPackaged === false` and the
	// updater no-ops; in production it polls GitHub Releases every 6h and
	// fans every status change through the shared push channel so Settings
	// can render progress + "Restart & install".
	initAppUpdater((status) => {
		bunSideRpc.send("app_update_status_changed", status);
	});

	app.on("activate", () => {
		if (!mainWindow || mainWindow.isDestroyed()) {
			mainWindow = createMainWindow();
			return;
		}
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.show();
	});
});

// Match Electrobun's `exitOnLastWindowClosed: false` — keep the tray alive on
// macOS when the user closes the last window. On win/linux, quit for parity.
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("before-quit", () => {
	stopAppUpdater();
	if (stopWatcher) {
		stopWatcher();
		stopWatcher = null;
	}
	if (trpcCloseServer) {
		try {
			trpcCloseServer();
		} catch {
			/* ignore */
		}
		trpcCloseServer = null;
	}
});

export type { AppRPCSchema };
