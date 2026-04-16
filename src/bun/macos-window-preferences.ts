import { readSettings } from "../main/settings";
import type { AppSettingsJson } from "../shared/rpc-schema";

export function isMacOSWindowBlurLockedOffByEnv(): boolean {
	return process.env.AGENTSKILLS_DISABLE_WINDOW_BLUR === "1";
}

/** Effective vibrancy from an in-memory settings object (e.g. the payload being saved). */
export function effectiveMacOSWindowBlurFromSettings(
	settings: AppSettingsJson,
): boolean {
	if (process.platform !== "darwin") return false;
	if (isMacOSWindowBlurLockedOffByEnv()) return false;
	return settings.macos_window_blur !== false;
}

/** Effective vibrancy: macOS only, not forced off by env, and enabled in settings (default on). */
export function effectiveMacOSWindowBlur(): boolean {
	if (process.platform !== "darwin") return false;
	if (isMacOSWindowBlurLockedOffByEnv()) return false;
	return readSettings().macos_window_blur !== false;
}
