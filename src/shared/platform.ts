/**
 * Platform adapter — lets tRPC handlers call out to the host (Electrobun or
 * Electron) without knowing which one is running. Kept in `src/shared/` so
 * both implementations (`src/bun/platform-electrobun.ts` and
 * `src/electron-main/platform-electron.ts`) depend only on this file.
 */

export interface FileDialogOpts {
	title?: string;
	startingFolder?: string;
}

export interface WindowFrame {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Subset of main-window operations that rpc-handlers actually calls. */
export interface PlatformWindow {
	minimize(): void;
	maximize(): void;
	unmaximize(): void;
	isMaximized(): boolean;
	show(): void;
	getFrame(): WindowFrame;
	setFrame(frame: WindowFrame): void;
	/**
	 * macOS: toggle NSWindow's native "zoom" state (green-button behavior — fills
	 * screen without going to Spaces fullscreen). Returns `true` if the platform
	 * actually handled it; `false` means the caller should fall back to
	 * `maximize()` / `unmaximize()`. Non-macOS implementations always return `false`.
	 */
	toggleMacOSZoom(): boolean;
}

export interface AppPlatform {
	quit(): void;
	openExternal(url: string): Promise<void> | void;
	showItemInFolder(path: string): void;
	/** Single-folder picker. Resolves to absolute path or `null` if cancelled. */
	pickFolder(opts?: FileDialogOpts): Promise<string | null>;
	getMainWindow(): PlatformWindow;
	/**
	 * After settings change (theme, blur). macOS: re-syncs NSWindow appearance
	 * and traffic-light positions; elsewhere: no-op.
	 */
	syncMacOSChromeFromSettings(): void;
	/**
	 * Toggle NSVisualEffectView vibrancy at runtime. Returns `true` if the
	 * vibrancy state actually changed. Non-macOS: always `false`.
	 */
	setMacOSVibrancy(enabled: boolean): boolean;
}
