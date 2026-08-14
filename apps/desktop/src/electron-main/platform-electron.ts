import { app, dialog, shell, type BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
	AppPlatform,
	FileDialogOpts,
	PlatformWindow,
	WindowFrame,
} from "../shared/platform";
import {
	setMacOSVibrancy as applyMacOSVibrancy,
	syncMacOSChromeFromSettings as applyMacOSChromeSync,
} from "./window-effects-macos";

/**
 * AppPlatform for the Electron host. macOS vibrancy + chrome appearance are
 * handled via Electron's built-in APIs (`win.setVibrancy`, `nativeTheme.themeSource`)
 * — no FFI, no custom dylib.
 */

function wrapElectronWindow(win: BrowserWindow): PlatformWindow {
	return {
		minimize: () => win.minimize(),
		maximize: () => win.maximize(),
		unmaximize: () => win.unmaximize(),
		isMaximized: () => win.isMaximized(),
		show: () => win.show(),
		getFrame: (): WindowFrame => {
			const b = win.getBounds();
			return { x: b.x, y: b.y, width: b.width, height: b.height };
		},
		setFrame: (frame: WindowFrame) => {
			win.setBounds({
				x: frame.x,
				y: frame.y,
				width: frame.width,
				height: frame.height,
			});
		},
		// macOS "zoom" (green-button behavior) is close enough to Electron's
		// `maximize()` that we let the generic fallback handle it rather than
		// calling into AppKit. Phase 3 can revisit if we want the exact AppKit
		// semantics back.
		toggleMacOSZoom: () => false,
	};
}

async function openPathAtLine(path: string, line: number, column = 1): Promise<boolean> {
	if (process.platform !== "darwin") return false;
	const appFolders = ["/Applications", join(app.getPath("home"), "Applications")];
	const editor = ["Cursor", "Visual Studio Code", "Windsurf", "Zed"].find((name) =>
		appFolders.some((folder) => existsSync(join(folder, `${name}.app`))),
	);
	if (!editor) return false;
	return new Promise((resolve) => {
		execFile("open", ["-a", editor, "--args", "--goto", `${path}:${line}:${column}`], (error) => resolve(!error));
	});
}

function expandStartingFolder(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	if (raw.startsWith("~/")) {
		return `${app.getPath("home")}${raw.slice(1)}`;
	}
	if (raw === "~") return app.getPath("home");
	return raw;
}

export function createElectronPlatform(
	getWindow: () => BrowserWindow,
): AppPlatform {
	return {
		quit: () => app.quit(),
		openExternal: (url: string) => shell.openExternal(url),
		openPath: async (path: string) => {
			const error = await shell.openPath(path);
			if (error) throw new Error(error);
		},
		openPathAtLine,
		showItemInFolder: (path: string) => shell.showItemInFolder(path),
		trashItem: (path: string) => shell.trashItem(path),
		pickFolder: async (opts?: FileDialogOpts) => {
			const parent = getWindow();
			const result = await dialog.showOpenDialog(parent, {
				title: opts?.title,
				// `createDirectory` adds the "New Folder" button on macOS;
				// `promptToCreate` lets the user type a non-existent path on Windows.
				properties: ["openDirectory", "createDirectory", "promptToCreate"],
				defaultPath: expandStartingFolder(opts?.startingFolder ?? "~/"),
			});
			if (result.canceled) return null;
			return result.filePaths[0] ?? null;
		},
		pickFile: async (opts?: FileDialogOpts) => {
			const parent = getWindow();
			const result = await dialog.showOpenDialog(parent, {
				title: opts?.title,
				properties: ["openFile"],
				defaultPath: expandStartingFolder(opts?.startingFolder ?? "~/"),
			});
			if (result.canceled) return null;
			return result.filePaths[0] ?? null;
		},
		getMainWindow: () => wrapElectronWindow(getWindow()),
		syncMacOSChromeFromSettings: () => {
			applyMacOSChromeSync();
		},
		setMacOSVibrancy: (enabled: boolean) => {
			return applyMacOSVibrancy(getWindow(), enabled);
		},
	};
}
