# Skiller — agent guidance

Skiller is a **cross-platform desktop app** (Electrobun) for installing, syncing, and editing **AI agent skills** across many agents (Claude Code, Cursor, Copilot CLI, etc.). Bundle ID: `com.beautyfree.skiller`.

## Stack

| Layer | Tech |
| --- | --- |
| Main / native | **Bun** + **Electrobun** (`src/bun/index.ts`) |
| UI | **React 19**, **Vite 7** (root `src/mainview`), **Tailwind CSS 4**, **react-router-dom** |
| API | **tRPC** (`@trpc/server` in Bun, `@trpc/client` + TanStack Query in the webview) |
| Config | `electrobun.config.ts` (loads `.env` for signing vars) |

## Repository layout

| Path | Role |
| --- | --- |
| `src/bun/` | Electrobun main process: `BrowserWindow`, tray, updater wiring, tRPC HTTP server, skill watcher |
| `src/mainview/` | Vite app: `App.tsx`, pages, components, `index.html`, CSS tokens |
| `src/shared/` | Types / RPC schema shared between Bun and webview (import from both sides as needed) |
| `src/main/` | Node-agnostic skill watcher and related main-side helpers |
| `agents/` | Bundled agent metadata (copied into app via `electrobun.config.ts` `copy`) |
| `assets/icons/` | **Runtime icons**: `AppIcon.iconset/`, `app.icns`, `app.ico`, `app/icon-512.png` |
| `assets/icons/Skiller.icon/` | **Source only** (Icon Composer): `scripts/build-app-icons.py` reads `Assets/Image.png` via `icon.json` |
| `scripts/` | `build-app-icons.py`, `normalize-skiller-icon-layer.py`, `repack-dmg.sh`, native build helpers |
| `docs/DEVELOPMENT.md` | Setup, HMR, signing, CI, DMG repack — **read before changing release/signing** |
| `DESIGN.md` | UI tokens and product design notes |

Do **not** hand-edit generated icons under `AppIcon.iconset/`, `app.icns`, `app.ico`, or `app/icon-512.png` — regenerate from source (below).

## Commands

```bash
bun install
```

**Development**

- `bun run dev` — Electrobun dev + watch (runs `build:native-effects` first on macOS).
- `bun run dev:hmr` — Concurrent Vite (port **5180**) + `electrobun dev` for UI hot reload.
- `bun run dev:debug` — Same as HMR path with webview DevTools (`AGENTSKILLS_DEVTOOLS=1`).

**Checks**

- `bunx tsc --noEmit` — typecheck (also part of `bun run build`).

**Production web bundle**

- `bun run build` — `build:native-effects` + `tsc` + `vite build` → `dist/` (then copied into the app bundle per `electrobun.config.ts`).

**Platform installers** (run **on the target OS**; Electrobun does not cross-compile)

- `bun run dist:mac` / `dist:win` / `dist:linux` — see `docs/DEVELOPMENT.md` for artifacts and secrets.

## Icons

1. Edit canonical layer: `assets/icons/Skiller.icon/Assets/Image.png` (optionally run `python3 scripts/normalize-skiller-icon-layer.py`).
2. Regenerate platform assets: `python3 scripts/build-app-icons.py`  
   Refreshes `AppIcon.iconset/`, `app.ico`, `app.icns`, `app/icon-512.png`.  
   macOS **DMG** styling uses `assets/icons/app.icns` via `scripts/repack-dmg.sh`.

## Conventions for agents

- Prefer **Bun** for scripts and local runs (`bun`, `bunx`).
- **UI strings** for user-facing copy: add keys under `src/mainview/i18n/` (English in `en.ts`); keep code comments in **English**.
- Match existing patterns: `@/` imports from `src/mainview` (see `vite.config.ts` / `tsconfig.json`).
- Avoid scope creep: do not change `node_modules/` or unrelated marketing-only paths unless the task requires it.
- After RPC or shared-type changes, ensure **both** Bun handlers and webview callers stay aligned (`src/shared/` or local schema modules).

## Environment variables (non-exhaustive)

| Variable | Purpose |
| --- | --- |
| `AGENTSKILLS_TRPC_PORT` | tRPC HTTP port (default `17888`) |
| `AGENTSKILLS_DEVTOOLS` / `ELECTROBUN_OPEN_DEVTOOLS` | Open webview DevTools |
| `ELECTROBUN_*` | Signing, notarization, update base URL — see `docs/DEVELOPMENT.md` and `electrobun.config.ts` |

## Further reading

- `README.md` — product overview and install links.
- `docs/DEVELOPMENT.md` — deep dive on dev, DMG, updater, and GitHub Actions release.
