# Skiller — agent guidance

Skiller is a **cross-platform desktop app** (Electron) for installing, syncing, and editing **AI agent skills** across many agents (Claude Code, Cursor, Copilot CLI, etc.). Bundle ID: `com.beautyfree.skiller`.

## Stack

| Layer | Tech |
| --- | --- |
| Main / native | **Electron** (`src/electron-main/index.ts`), Node 20 |
| UI | **React 19**, **Vite 7** (root `src/mainview`), **Tailwind CSS 4**, **react-router-dom** |
| API | **tRPC** over HTTP on 127.0.0.1 + `ipcMain` push channel for main→renderer events |
| Build | **electron-vite** (dev + bundling) + **electron-builder** (packaging, signing, auto-updates) |
| Updater | **electron-updater** (GitHub Releases, `latest-*.yml` + blockmaps) |

## Repository layout

| Path | Role |
| --- | --- |
| `src/electron-main/` | Electron main process: `BrowserWindow`, tray, tRPC server, macOS vibrancy, platform adapter |
| `src/preload/` | `contextBridge` — exposes `window.api.{invoke,on,platform}` to the renderer |
| `src/main/` | Platform-agnostic main-side code: skill watcher, tRPC router, marketplace cache, app-updater wrapper, settings, scanner |
| `src/mainview/` | Vite app: `App.tsx`, pages, components, `index.html`, CSS tokens |
| `src/shared/` | Types / RPC schema shared between main and renderer (including `AppPlatform` interface) |
| `agents/` | Bundled agent metadata (copied into the app via `electron-builder.yml` `extraResources`) |
| `assets/icons/` | **Runtime icons**: `AppIcon.iconset/`, `app.icns`, `app.ico`, `app/icon-512.png` |
| `assets/icons/Skiller.icon/` | **Source only** (Icon Composer): `scripts/build-app-icons.py` reads `Assets/Image.png` via `icon.json` |
| `build-resources/` | `entitlements.mac.plist` for Hardened Runtime |
| `scripts/` | `build-app-icons.py`, `normalize-skiller-icon-layer.py`, `repack-dmg.sh` |
| `docs/DEVELOPMENT.md` | Setup, HMR, signing, CI, DMG repack — **read before changing release/signing** |
| `DESIGN.md` | UI tokens and product design notes |

Do **not** hand-edit generated icons under `AppIcon.iconset/`, `app.icns`, `app.ico`, or `app/icon-512.png` — regenerate from source (below).

## Commands

```bash
bun install
```

**Development**

- `bun run dev` — electron-vite dev: watches main + preload, spawns Vite on port **5180** for the renderer with HMR. Opens an Electron window loading the Vite URL.
- `bun run dev:debug` — Same as `dev` with `AGENTSKILLS_DEVTOOLS=1` (renderer DevTools on-open).

**Checks**

- `bun run typecheck` — `tsc --noEmit` for renderer + `tsc -p tsconfig.node.json --noEmit` for main/preload.

**Production bundle (web + main + preload)**

- `bun run build` — `electron-vite build` → `out/{main,preload,renderer}/`. Consumed by `electron-builder`.

**Platform installers** (run **on the target OS**; electron-builder doesn't cross-compile native modules)

- `bun run dist:mac` — `electron-vite build && electron-builder --mac && bash scripts/repack-dmg.sh`
- `bun run dist:win` — `electron-vite build && electron-builder --win`
- `bun run dist:linux` — `electron-vite build && electron-builder --linux`

See `docs/DEVELOPMENT.md` for signing env vars and artifact locations.

## Releases

Releases are driven by **[release-please](https://github.com/googleapis/release-please)** and **conventional commits**.

- Every commit to `main` should use a conventional prefix: `feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `chore:`, `ci:`, `build:`, `test:`, `style:`, `revert:`. Breaking changes: add `!` (`feat!:`) or a `BREAKING CHANGE:` footer.
- `.github/workflows/release-please.yml` watches `main` and opens a **Release PR** that bumps `package.json`, updates `CHANGELOG.md`, and drafts the GitHub Release notes from commit messages.
- Merging the Release PR pushes a `vX.Y.Z` tag → `.github/workflows/release.yml` builds the installers (macOS / Windows / Linux) and attaches them to the same release.
- `electron-updater` reads release metadata for auto-updates on launch.

Version source of truth: `package.json` + `.release-please-manifest.json`. Never bump manually — let release-please do it.

## Icons

1. Edit canonical layer: `assets/icons/Skiller.icon/Assets/Image.png` (optionally run `python3 scripts/normalize-skiller-icon-layer.py`).
2. Regenerate platform assets: `python3 scripts/build-app-icons.py`  
   Refreshes `AppIcon.iconset/`, `app.ico`, `app.icns`, `app/icon-512.png`.  
   macOS **DMG** styling uses `assets/icons/app.icns` via `scripts/repack-dmg.sh`.

## Conventions for agents

- Prefer **Bun** for scripts and local runs (`bun`, `bunx`). Electron main itself runs on Node (Electron's bundled Node 20) — use Node-compatible APIs only.
- **UI strings** for user-facing copy: add keys under `src/mainview/i18n/` (English in `en.ts`); keep code comments in **English**.
- Match existing patterns: `@/` imports from `src/mainview` (see `electron.vite.config.ts` / `tsconfig.json`).
- Avoid scope creep: do not change `node_modules/` or unrelated marketing-only paths unless the task requires it.
- After RPC or shared-type changes, ensure **both** main handlers (`src/main/rpc-handlers.ts`) and renderer callers stay aligned (`src/shared/` or local schema modules).
- Native Node modules (`better-sqlite3`) need `electron-builder install-app-deps` to rebuild against Electron's ABI. `bun install` on its own won't do it.

## Environment variables (non-exhaustive)

| Variable | Purpose |
| --- | --- |
| `AGENTSKILLS_TRPC_PORT` | tRPC HTTP port (default `17888`; falls through to +48 on conflict) |
| `AGENTSKILLS_DEVTOOLS` | Auto-open renderer DevTools on launch (dev only) |
| `AGENTSKILLS_DISABLE_WINDOW_BLUR` | `1` → force vibrancy off on macOS even if settings say on |
| `CSC_NAME`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS signing + notarization. See `docs/DEVELOPMENT.md`. |

## Further reading

- `README.md` — product overview and install links.
- `docs/DEVELOPMENT.md` — dev, DMG, updater, GitHub Actions release, and **GitHub Pages** for the `docs/` landing.
