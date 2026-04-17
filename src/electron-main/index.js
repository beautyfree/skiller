/**
 * Electron main process entrypoint (Phase 1 minimal shell).
 *
 * Only opens a window and loads the renderer — tRPC, IPC, tray, updater, and
 * macOS window effects come in Phase 2+. Kept intentionally tiny so we can
 * verify electron-vite HMR wiring before porting anything else.
 */
import { app, BrowserWindow, shell } from "electron";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { join } from "node:path";
const DEFAULT_WINDOW_FRAME = { width: 1440, height: 900 };
function createMainWindow() {
    const win = new BrowserWindow({
        title: "Skiller",
        width: DEFAULT_WINDOW_FRAME.width,
        height: DEFAULT_WINDOW_FRAME.height,
        x: 120,
        y: 100,
        show: false,
        autoHideMenuBar: true,
        // Cross-platform titlebar polish comes in Phase 3 (macOS) / Phase 4 (win/linux).
        // For Phase 1 we keep the native frame so the window is usable on every OS.
        webPreferences: {
            preload: join(__dirname, "../preload/index.js"),
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    win.on("ready-to-show", () => win.show());
    // External links open in the default browser, not inside the Electron window.
    win.webContents.setWindowOpenHandler(({ url }) => {
        void shell.openExternal(url);
        return { action: "deny" };
    });
    // electron-vite injects ELECTRON_RENDERER_URL in dev mode (Vite dev server).
    // In prod we load the built index.html from the renderer bundle.
    if (is.dev && process.env.ELECTRON_RENDERER_URL) {
        void win.loadURL(process.env.ELECTRON_RENDERER_URL);
    }
    else {
        void win.loadFile(join(__dirname, "../renderer/index.html"));
    }
    return win;
}
void app.whenReady().then(() => {
    electronApp.setAppUserModelId("com.beautyfree.skiller");
    // F12 toggles devtools in dev, Cmd/Ctrl+R reload — @electron-toolkit convenience.
    app.on("browser-window-created", (_event, win) => {
        optimizer.watchWindowShortcuts(win);
    });
    createMainWindow();
    app.on("activate", () => {
        // macOS: dock-click with no open windows recreates one.
        if (BrowserWindow.getAllWindows().length === 0)
            createMainWindow();
    });
});
app.on("window-all-closed", () => {
    // Match current Electrobun behavior (`exitOnLastWindowClosed: false`) — keep
    // the app alive on macOS so the tray stays responsive. On win/linux, quit.
    if (process.platform !== "darwin") {
        app.quit();
    }
});
