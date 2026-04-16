import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Electrobun, {
	BrowserView,
	BrowserWindow,
	Tray,
	Updater,
	Utils,
} from "electrobun/bun";
import type { AppRPCSchema } from "../shared/rpc-schema";
import type { BunSideRpc } from "./rpc-handlers";
import { createAppRouter } from "./trpc/router";
import { startTrpcHttpServer } from "./trpc-server";
import { startSkillWatcher } from "../main/watcher";
import {
	applyMacOSWindowEffects,
	syncMacOSWindowChromeFromSettings,
} from "./macos-window-effects";
import { effectiveMacOSWindowBlur } from "./macos-window-preferences";
import { initAppUpdater, stopAppUpdater } from "./app-updater";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Vite dev server — must match vite.config.ts server.port. */
const DEV_SERVER_PORT = 5180;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

/** Bundled view name — matches electrobun.config.ts copy destination (views/mainview/…). */
const MAIN_VIEW = "views://mainview/index.html";

const macosWindowBlur = effectiveMacOSWindowBlur();

/**
 * Official template pattern: in dev channel, load Vite if the dev server responds; else bundled views.
 */
async function getMainViewUrl(): Promise<string> {
	try {
		const channel = await Updater.localInfo.channel();
		if (channel === "dev") {
			try {
				await fetch(DEV_SERVER_URL, { method: "HEAD" });
				console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
				return DEV_SERVER_URL;
			} catch {
				console.log(
					"Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
				);
			}
		}
	} catch (err) {
		console.warn("getMainViewUrl:", err);
	}
	return MAIN_VIEW;
}

/** Initial window frame — wide 16:10 canvas similar to Linear desktop (sidebar + main + room for panels). */
const DEFAULT_WINDOW_FRAME = { x: 120, y: 100, width: 1440, height: 900 } as const;
const TRPC_PORT = Number(process.env.AGENTSKILLS_TRPC_PORT ?? 17888);

let mainWindow: BrowserWindow | undefined;

const rpc = BrowserView.defineRPC<AppRPCSchema>({
	maxRequestTime: 300_000,
	handlers: {
		requests: {} as Parameters<
			typeof BrowserView.defineRPC<AppRPCSchema>
		>[0]["handlers"]["requests"],
		messages: {},
	},
});

const bunSideRpc: BunSideRpc = {
	send: (name, payload) => {
		if (
			name === "skill_update_progress" ||
			name === "repo_progress" ||
			name === "shell_runtime_changed" ||
			name === "trpc_endpoint" ||
			name === "app_update_status_changed"
		) {
			(rpc.send as (n: typeof name, p?: unknown) => void)(name, payload);
		} else {
			(rpc.send as (n: typeof name) => void)(name);
		}
	},
};

const appRouter = createAppRouter({
	getMainWindow: () => {
		if (!mainWindow) throw new Error("Main window is not ready");
		return mainWindow;
	},
	rpc: bunSideRpc,
	ensureSkillWatcherStarted: (reason: string) => {
		void reason;
		if (stopWatcher) return;
		stopWatcher = startSkillWatcher(() => {
			rpc.send("skills_changed");
		});
	},
});

const { server: trpcHttpServer, port: trpcBoundPort } = startTrpcHttpServer(
	appRouter,
	TRPC_PORT,
);
console.log(`tRPC: http://127.0.0.1:${trpcBoundPort}/trpc`);

const mainViewUrl = await getMainViewUrl();

mainWindow = new BrowserWindow({
	title: "Skiller",
	url: mainViewUrl,
	titleBarStyle: "hiddenInset",
	frame: { ...DEFAULT_WINDOW_FRAME },
	rpc,
	...(process.platform === "darwin" ? { transparent: macosWindowBlur } : {}),
});

function sendTrpcEndpointToWebview() {
	bunSideRpc.send("trpc_endpoint", {
		baseUrl: `http://127.0.0.1:${trpcBoundPort}`,
	});
}

// Send as soon as the window exists so the webview can receive the URL before
// the first `invoke()` (React runs before `dom-ready`; only `dom-ready` caused ~8s waits).
sendTrpcEndpointToWebview();
queueMicrotask(sendTrpcEndpointToWebview);
mainWindow.webview.on("dom-ready", sendTrpcEndpointToWebview);

if (process.platform === "darwin") {
	applyMacOSWindowEffects(mainWindow, {
		enableVibrancy: macosWindowBlur,
	});
	syncMacOSWindowChromeFromSettings(mainWindow);
	// Dock icon click: show() only calls makeKey/orderFront and does not deminiaturize.
	Electrobun.events.on("reopen", () => {
		if (!mainWindow) return;
		if (mainWindow.isMinimized()) {
			mainWindow.unminimize();
		}
		mainWindow.show();
	});
}

// WebKit / CEF inspector: set AGENTSKILLS_DEVTOOLS=1 (see README) or use right-click → Inspect Element on macOS.
const wantDevTools =
	process.env.AGENTSKILLS_DEVTOOLS === "1" ||
	process.env.ELECTROBUN_OPEN_DEVTOOLS === "1";
if (wantDevTools) {
	let opened = false;
	const openDevToolsOnce = () => {
		if (opened) return;
		opened = true;
		try {
			mainWindow?.webview.openDevTools();
		} catch (err) {
			console.error("webview.openDevTools failed:", err);
		}
	};
	mainWindow.webview.on("dom-ready", openDevToolsOnce);
	setTimeout(openDevToolsOnce, 2000);
}

mainWindow.on("close", () => {
	rpc.send("close_requested");
});

// Wire the auto-updater — pushes status snapshots to the webview via bun→webview
// RPC so Settings can show progress + "Restart to update" affordance.
void initAppUpdater((status) => {
	bunSideRpc.send("app_update_status_changed", status);
});

let stopWatcher: (() => void) | null = null;

function trayIconPath(): string | undefined {
	const candidates = [
		join(__dirname, "tray", "tray.png"),
		join(__dirname, "tray", "tray-macos.png"),
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

const icon = trayIconPath();
if (icon) {
	const tray = new Tray({
		image: icon,
		template: true,
	});

	tray.setMenu([
		{ label: "Show Skiller", type: "normal", action: "show" },
		{ type: "separator" },
		{ label: "Quit", type: "normal", action: "quit" },
	]);

	tray.on("tray-clicked", (event: unknown) => {
		const data = event as { data?: { action?: string } };
		const action = data?.data?.action ?? "";
		if (action === "show") {
			if (mainWindow?.isMinimized()) {
				mainWindow.unminimize();
			}
			mainWindow?.show();
			return;
		}
		if (action === "quit") {
			Utils.quit();
		}
	});
}

process.on("exit", () => {
	if (stopWatcher) {
		stopWatcher();
	}
	stopAppUpdater();
	try {
		trpcHttpServer.stop();
	} catch {
		/* ignore */
	}
});
