/**
 * AppPlatform implementation for the Electrobun host. Kept so the pre-migration
 * `bun run dev` / `bun run dist:mac` pipelines keep working while the Electron
 * version is built out in parallel. Deleted together with the rest of src/bun/
 * at the end of Phase 5.
 */
import type { BrowserWindow } from "electrobun/bun";
import { Utils } from "electrobun";
import type {
	AppPlatform,
	FileDialogOpts,
	PlatformWindow,
	WindowFrame,
} from "../shared/platform";
import {
	setMacOSWindowVibrancy,
	syncMacOSWindowChromeFromSettings,
	toggleMacOSWindowZoom,
} from "./macos-window-effects";

function wrapElectrobunWindow(win: BrowserWindow): PlatformWindow {
	return {
		minimize: () => win.minimize(),
		maximize: () => win.maximize(),
		unmaximize: () => win.unmaximize(),
		isMaximized: () => win.isMaximized(),
		show: () => win.show(),
		getFrame: (): WindowFrame => {
			const f = win.getFrame();
			return { x: f.x, y: f.y, width: f.width, height: f.height };
		},
		setFrame: (frame: WindowFrame) => {
			win.setFrame(frame.x, frame.y, frame.width, frame.height);
		},
		toggleMacOSZoom: () => {
			if (process.platform !== "darwin") return false;
			return toggleMacOSWindowZoom(win);
		},
	};
}

export function createElectrobunPlatform(
	getWindow: () => BrowserWindow,
): AppPlatform {
	return {
		quit: () => Utils.quit(),
		openExternal: (url: string) => {
			// Electrobun returns a boolean status; we discard it to match the
			// AppPlatform contract (Promise<void> | void).
			Utils.openExternal(url);
		},
		showItemInFolder: (path: string) => Utils.showItemInFolder(path),
		pickFolder: async (opts?: FileDialogOpts) => {
			const paths = await Utils.openFileDialog({
				canChooseFiles: false,
				canChooseDirectory: true,
				allowsMultipleSelection: false,
				startingFolder: opts?.startingFolder ?? "~/",
			});
			return paths[0] ?? null;
		},
		getMainWindow: () => wrapElectrobunWindow(getWindow()),
		syncMacOSChromeFromSettings: () => {
			if (process.platform !== "darwin") return;
			syncMacOSWindowChromeFromSettings(getWindow());
		},
		setMacOSVibrancy: (enabled: boolean) => {
			if (process.platform !== "darwin") return false;
			return setMacOSWindowVibrancy(getWindow(), enabled);
		},
	};
}
