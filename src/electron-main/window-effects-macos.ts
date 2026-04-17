import { nativeTheme, type BrowserWindow } from "electron";
import { readSettings } from "../main/settings";
import type { AppSettingsJson } from "../shared/rpc-schema";

/**
 * macOS window polish backed by Electron's built-in APIs (no FFI, no dylib).
 *
 * Replaces `src/bun/macos-window-effects.ts` which called into a custom
 * NSVisualEffectView bridge via `bun:ffi`. Electron ships equivalents:
 *   - `new BrowserWindow({ vibrancy, visualEffectState, trafficLightPosition })`
 *   - `win.setVibrancy('sidebar' | null)`
 *   - `nativeTheme.themeSource = 'light' | 'dark' | 'system'`
 */

export function isMacOSWindowBlurLockedOffByEnv(): boolean {
	return process.env.AGENTSKILLS_DISABLE_WINDOW_BLUR === "1";
}

export function effectiveMacOSWindowBlurFromSettings(
	settings: AppSettingsJson,
): boolean {
	if (process.platform !== "darwin") return false;
	if (isMacOSWindowBlurLockedOffByEnv()) return false;
	return settings.macos_window_blur !== false;
}

export function effectiveMacOSWindowBlur(): boolean {
	if (process.platform !== "darwin") return false;
	if (isMacOSWindowBlurLockedOffByEnv()) return false;
	return readSettings().macos_window_blur !== false;
}

function themeFromSettings(settings: AppSettingsJson): "light" | "dark" | "system" {
	const t = String(settings.theme ?? "").toLowerCase();
	if (t === "dark") return "dark";
	if (t === "light") return "light";
	return "system";
}

/**
 * Apply `nativeTheme.themeSource` so the window's chrome (titlebar, scrollbars,
 * native controls) matches the in-app theme preference. `themeSource` is global
 * on Electron — every BrowserWindow gets it — so we set once per settings write.
 */
export function syncMacOSChromeFromSettings(): void {
	if (process.platform !== "darwin") return;
	nativeTheme.themeSource = themeFromSettings(readSettings());
}

/**
 * Toggle NSVisualEffectView vibrancy at runtime. Returns `true` whenever the
 * state actually changed so the caller can fan the new value back to the
 * renderer (see `write_settings` in rpc-handlers).
 */
export function setMacOSVibrancy(
	win: BrowserWindow,
	enabled: boolean,
): boolean {
	if (process.platform !== "darwin") return false;
	try {
		// `setVibrancy(null)` removes the effect without destroying the window.
		win.setVibrancy(enabled ? "sidebar" : null);
		return true;
	} catch (err) {
		console.warn("setMacOSVibrancy failed:", err);
		return false;
	}
}
