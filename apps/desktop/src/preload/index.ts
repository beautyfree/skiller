/**
 * Electron preload — exposes a minimal, typed bridge to the renderer.
 *
 * Phase 1: just platform identification so Layout.tsx can branch titlebar
 * layout without guessing from navigator.userAgent. Real RPC (tRPC subscriptions
 * or ipc.handle callbacks) gets wired in Phase 2.
 */
import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

// Custom API for renderer — kept intentionally small.
const api = {
	platform: process.platform as NodeJS.Platform,
	// Renderer → main request/response shim. Phase 2 will expand this or replace
	// it with a typed tRPC WebSocket bridge.
	invoke: (channel: string, ...args: unknown[]): Promise<unknown> =>
		ipcRenderer.invoke(channel, ...args),
	// Renderer subscribes to main-initiated push events. Phase 2 will map these
	// to the current Electrobun RPC message names (skills_changed, etc).
	on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
		const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
			listener(...args);
		};
		ipcRenderer.on(channel, handler);
		return () => ipcRenderer.off(channel, handler);
	},
} as const;

if (process.contextIsolated) {
	try {
		contextBridge.exposeInMainWorld("electron", electronAPI);
		contextBridge.exposeInMainWorld("api", api);
	} catch (error) {
		console.error("preload: contextBridge exposure failed:", error);
	}
} else {
	// Fallback for the rare sandbox-off case. Keeps types consistent.
	(globalThis as unknown as { electron: typeof electronAPI }).electron =
		electronAPI;
	(globalThis as unknown as { api: typeof api }).api = api;
}

export type PreloadApi = typeof api;
