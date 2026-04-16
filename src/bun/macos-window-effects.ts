/**
 * Native NSVisualEffectView + traffic-light alignment via FFI.
 * Pattern from https://github.com/mayfer/electrobun-macos-native-blur
 */
import type { BrowserWindow } from "electrobun/bun";
import { dlopen, FFIType } from "bun:ffi";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AppSettingsJson } from "../shared/rpc-schema";
import { readSettings } from "../main/settings";

/** Inset from window left for the traffic-light cluster (visual balance). */
const MAC_TRAFFIC_LIGHTS_X = 14;
/** Vertical alignment of traffic lights from top of titlebar area. */
const MAC_TRAFFIC_LIGHTS_Y = 12;
/** Native drag region starts after traffic lights + padding. */
const MAC_NATIVE_DRAG_REGION_X = 96;
/** Height of draggable band from top edge. */
const MAC_NATIVE_DRAG_REGION_HEIGHT = 32;

const dylibPath = join(import.meta.dir, "libMacWindowEffects.dylib");

/**
 * Toggle native vibrancy at runtime (after settings change). No-op if dylib missing.
 */
export function setMacOSWindowVibrancy(
	mainWindow: BrowserWindow,
	enabled: boolean,
): boolean {
	if (!existsSync(dylibPath)) {
		return false;
	}
	try {
		const lib = dlopen(dylibPath, {
			setWindowVibrancyEnabled: {
				args: [FFIType.ptr, FFIType.bool],
				returns: FFIType.bool,
			},
		});
		return lib.symbols.setWindowVibrancyEnabled(mainWindow.ptr, enabled);
	} catch (error) {
		console.warn("setMacOSWindowVibrancy failed:", error);
		return false;
	}
}

/** 0 = follow system, 1 = light chrome (Aqua), 2 = dark chrome (Dark Aqua). */
export function chromeAppearanceModeFromSettings(
	settings: AppSettingsJson,
): number {
	const t = String(settings.theme ?? "").toLowerCase();
	if (t === "dark") return 2;
	if (t === "light") return 1;
	return 0;
}

/**
 * Sets NSWindow.appearance to match persisted theme so vibrancy/titlebar match in-app UI.
 */
export function setMacOSWindowChromeAppearance(
	mainWindow: BrowserWindow,
	appearanceMode: number,
): boolean {
	if (!existsSync(dylibPath)) {
		return false;
	}
	try {
		const lib = dlopen(dylibPath, {
			setWindowChromeAppearance: {
				args: [FFIType.ptr, FFIType.i32],
				returns: FFIType.bool,
			},
		});
		const mode =
			appearanceMode === 1 ? 1 : appearanceMode === 2 ? 2 : 0;
		return lib.symbols.setWindowChromeAppearance(mainWindow.ptr, mode);
	} catch (error) {
		console.warn("setMacOSWindowChromeAppearance failed:", error);
		return false;
	}
}

export function syncMacOSWindowChromeFromSettings(
	mainWindow: BrowserWindow,
): boolean {
	return setMacOSWindowChromeAppearance(
		mainWindow,
		chromeAppearanceModeFromSettings(readSettings()),
	);
}

/**
 * Toggles NSWindow zoom (green button / title-bar double-click). Prefer over
 * BrowserWindow maximize/unmaximize on macOS — those do not track AppKit zoom state.
 */
export function toggleMacOSWindowZoom(mainWindow: BrowserWindow): boolean {
	if (!existsSync(dylibPath)) {
		return false;
	}
	try {
		const lib = dlopen(dylibPath, {
			toggleWindowZoom: {
				args: [FFIType.ptr],
				returns: FFIType.bool,
			},
		});
		return lib.symbols.toggleWindowZoom(mainWindow.ptr);
	} catch (error) {
		console.warn("toggleMacOSWindowZoom failed:", error);
		return false;
	}
}

export function applyMacOSWindowEffects(
	mainWindow: BrowserWindow,
	options?: { enableVibrancy?: boolean },
): void {
	const enableVibrancy = options?.enableVibrancy !== false;

	if (!existsSync(dylibPath)) {
		console.warn(
			`Native macOS effects lib not found at ${dylibPath}. Run: bun run build:native-effects`,
		);
		return;
	}

	try {
		const lib = dlopen(dylibPath, {
			setWindowVibrancyEnabled: {
				args: [FFIType.ptr, FFIType.bool],
				returns: FFIType.bool,
			},
			enableWindowVibrancy: {
				args: [FFIType.ptr],
				returns: FFIType.bool,
			},
			ensureWindowShadow: {
				args: [FFIType.ptr],
				returns: FFIType.bool,
			},
			setWindowTrafficLightsPosition: {
				args: [FFIType.ptr, FFIType.f64, FFIType.f64],
				returns: FFIType.bool,
			},
			setNativeWindowDragRegion: {
				args: [FFIType.ptr, FFIType.f64, FFIType.f64],
				returns: FFIType.bool,
			},
		});

		const ptr = mainWindow.ptr;
		const vibrancyEnabled = enableVibrancy
			? lib.symbols.enableWindowVibrancy(ptr)
			: false;
		const shadowEnabled = lib.symbols.ensureWindowShadow(ptr);
		const alignButtons = () =>
			lib.symbols.setWindowTrafficLightsPosition(
				ptr,
				MAC_TRAFFIC_LIGHTS_X,
				MAC_TRAFFIC_LIGHTS_Y,
			);
		const alignNativeDragRegion = () =>
			lib.symbols.setNativeWindowDragRegion(
				ptr,
				MAC_NATIVE_DRAG_REGION_X,
				MAC_NATIVE_DRAG_REGION_HEIGHT,
			);

		const buttonsAlignedNow = alignButtons();
		const nativeDragAlignedNow = alignNativeDragRegion();
		setTimeout(() => {
			alignButtons();
			alignNativeDragRegion();
		}, 120);

		// During live resize, AppKit relayouts the titlebar. Re-positioning traffic lights in that
		// phase can still produce visible jitter in hiddenInset windows, so we only keep native drag
		// region in sync with width changes and do not touch button coordinates on resize.
		mainWindow.on("resize", () => {
			alignNativeDragRegion();
		});

		console.log(
			`macOS window effects: vibrancy=${enableVibrancy ? vibrancyEnabled : "off"}, shadow=${shadowEnabled}, trafficLights=${buttonsAlignedNow}, nativeDrag=${nativeDragAlignedNow}`,
		);
	} catch (error) {
		console.warn("Failed to apply native macOS window effects:", error);
	}
}
