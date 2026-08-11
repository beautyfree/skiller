import { readSettings } from "./settings";
import type { AppSettingsJson } from "../shared/rpc-schema";

/**
 * Settings-only helpers for the macOS window blur preference. No FFI, no
 * window bindings — pure reads so both the main process and the platform
 * adapter can use them without dragging in a host dependency.
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
