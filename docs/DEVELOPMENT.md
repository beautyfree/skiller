# Development Guide

Developer-focused setup, build, and debugging instructions for Skiller.

## Prerequisites

- [Bun](https://bun.sh/) 1.3+ (used for install + script running; Electron itself runs on Node 20 bundled inside Electron)
- macOS 14+ for local macOS release builds (signing, notarization, DMG repacking)
- Windows 10+ for local Windows release builds (or use the GitHub Actions matrix)
- `create-dmg` (`brew install create-dmg`) for macOS DMG repackaging

## Local setup

```bash
bun install
# Rebuild better-sqlite3 against Electron's ABI (only needed if native modules change):
bunx electron-builder install-app-deps
```

## Run modes

```bash
# Full dev: main + preload watch, renderer on Vite HMR port 5180
bun run dev

# Same, but auto-open renderer DevTools on launch
bun run dev:debug

# Build the static bundle into out/ (no packaging)
bun run build

# Preview the built bundle in a packaged-like Electron process
bun run preview
```

## Type checking

```bash
bun run typecheck
# = tsc --noEmit && tsc -p tsconfig.node.json --noEmit
```

The two configs own disjoint parts of the tree:

- `tsconfig.json` → `src/mainview/**` (renderer) + shared types
- `tsconfig.node.json` → `src/electron-main/**` + `src/preload/**` + `src/main/**` + shared types

They share `src/shared/**`; both type-check with `noEmit: true` so overlapping includes are fine.

## Distribution builds per platform

[electron-builder](https://www.electron.build/) packages + signs + notarizes. Native modules (`better-sqlite3`) are rebuilt against Electron's ABI on the target OS, so cross-compilation is not supported — run the appropriate script on the appropriate OS, or use the GitHub Actions matrix.

| Host OS | Command | Output in `artifacts/` |
| --- | --- | --- |
| macOS (Apple Silicon) | `bun run dist:mac` | `Skiller-<version>-macos-arm64.dmg` (signed + notarized, drag-to-Applications layout) |
| Windows x64 | `bun run dist:win` | `Skiller-<version>-win-x64.exe` (NSIS installer) |
| Linux x64 | `bun run dist:linux` | `Skiller-<version>-linux-x86_64.{AppImage,deb}` |

There are two ways to produce all three without owning three machines.

### Option 1 — GitHub Actions matrix (zero local setup)

`.github/workflows/release.yml` fans out to `macos-14`, `windows-latest`, and `ubuntu-latest` runners. Tag a release and GitHub builds and publishes everything:

```bash
git tag v0.2.0
git push origin v0.2.0
```

**Required repo secrets** (Settings → Secrets and variables → Actions):

macOS signing + notarization:

- `MACOS_CERT_P12` — base64-encoded `.p12` export of `Developer ID Application: … (TEAM_ID)`
- `MACOS_CERT_P12_PASSWORD` — password used to export the `.p12`
- `MACOS_KEYCHAIN_PASSWORD` — arbitrary temp-keychain password (generate any string)
- `CSC_NAME` — full identity string (e.g. `Developer ID Application: Your Name (XXXXXXXXXX)`)
- `APPLE_API_ISSUER` — App Store Connect → Users and Access → Integrations → App Store Connect API → Issuer ID
- `APPLE_API_KEY_ID` — 10-char Key ID
- `APPLE_API_KEY_P8` — full contents of the `AuthKey_XXXXXXXXXX.p8` file (multi-line secret)

Windows/Linux jobs don't need secrets — Windows ships as an unsigned NSIS installer (SmartScreen shows a one-time warning on first install).

### Landing site — GitHub Pages

`.github/workflows/pages.yml` publishes the static files in `docs/` to GitHub Pages on pushes to `main` that touch `docs/**`. First-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

### Option 2 — Local Windows VM (Parallels / UTM / Hyper-V)

Inside a Windows 10/11 VM:

```powershell
# Prereqs: Git, Bun, Visual Studio Build Tools (Desktop development with C++), Python 3
git clone https://github.com/beautyfree/skiller-desktop-skills-manager
cd skiller-desktop-skills-manager
bun install
bunx electron-builder install-app-deps
bun run dist:win
```

## macOS code signing and notarization

### Env vars

Electron-builder reads these from `.env` or the shell when you run `bun run dist:mac`. Without them, the build succeeds unsigned — useful for quick local testing, not shippable.

| Variable | Purpose |
| --- | --- |
| `CSC_NAME` | Full Developer ID identity string |
| `APPLE_API_KEY_ID` | 10-char Key ID from App Store Connect |
| `APPLE_API_ISSUER` | Issuer UUID |
| `APPLE_API_KEY` | Absolute path to the `.p8` file (preferred for CI) |
| — or Apple ID fallback — |
| `APPLE_ID` | Developer Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | [App-specific password](https://support.apple.com/en-us/102654) |
| `APPLE_TEAM_ID` | 10-char team ID |

### Flow

1. `electron-vite build` — emits main + preload + renderer into `out/`.
2. `electron-builder --mac` — creates a signed `.app` in `artifacts/mac-arm64/`, then notarizes + staples it using the API-key env vars (handled natively by electron-builder 26+; no custom afterSign hook needed).
3. `scripts/repack-dmg.sh` — wraps the signed app in a styled drag-to-Applications DMG, re-signs the DMG wrapper, notarizes + staples the DMG.

### Verify locally

```bash
spctl -a -vvv -t install artifacts/Skiller-*.dmg    # expect: "source=Notarized Developer ID"
xcrun stapler validate artifacts/Skiller-*.dmg      # expect: "The validate action worked!"
```

### Why the DMG is hand-styled

Electron-builder's built-in DMG writer produces an unstyled window. `scripts/repack-dmg.sh` uses `create-dmg` to get a 128px app icon, a dark background featuring two light "cards" under the app and Applications icons, a bright arrow, and the volume named "Skiller Installer" — the same layout Chrome/Slack use to visually force drag-to-Applications. We produce the styled DMG ourselves because the built-in is cosmetically insufficient (tiny default icon, no background).

Relevant config:

- `electron-builder.yml` → `mac.target: dir` disables electron-builder's own DMG
- `dmg.writeUpdateInfo: false` suppresses the blockmap (we generate that separately from the final DMG)

### Troubleshooting notarization

Apple returns a JSON log listing unsigned binaries or missing secure timestamps when notarization fails. Common causes:

- A native addon (e.g. `better-sqlite3.node`) wasn't codesigned with `--timestamp`. `electron-builder` handles this automatically; if you add new native modules, `bunx electron-builder install-app-deps` on the target OS before dist.
- Missing one of the three API-key vars. All three (`APPLE_API_ISSUER`, `APPLE_API_KEY_ID`, `APPLE_API_KEY`) must be present, and the `.p8` file must exist at the path in `APPLE_API_KEY`.

## Renderer DevTools / blank screen debugging

- Auto-open: `bun run dev:debug` (`AGENTSKILLS_DEVTOOLS=1 electron-vite dev`).
- Right-click → Inspect Element works in dev.
- On macOS Cmd+Alt+I and on Windows/Linux F12 toggle DevTools (see `@electron-toolkit/utils.optimizer.watchWindowShortcuts`).

If UI renders in browser but not in Electron:

1. Open `http://127.0.0.1:5180` in Chrome — if the page renders, the main process crashed and the preload couldn't attach. Check main logs.
2. If renderer works but tRPC calls hang, the main process didn't bind a port — check the `tRPC: http://127.0.0.1:NNNN/trpc` log line.

## Auto-updates

`electron-updater` is wired in `src/main/app-updater.ts`:

- **Config** — `electron-builder.yml` sets `publish.provider: github` pointing at `beautyfree/skiller-desktop-skills-manager`. When you `bun run dist:mac/win/linux`, electron-builder writes `latest-mac.yml` / `latest-linux.yml` / `latest.yml` (for Windows) alongside the DMG/AppImage/EXE. GitHub Actions uploads all of them to the tagged Release.
- **Runtime** — `initAppUpdater()` runs `autoUpdater.checkForUpdates()` on launch and every 6 hours. `autoDownload = false`, so the user clicks **Download update** in Settings → App Updates after an update is announced. Progress + ready state stream to the renderer through the `app_update_status_changed` push channel; the Settings page renders the current state and offers **Restart & install** once the update is downloaded.
- **Delta patches** — electron-builder generates `.blockmap` files automatically when `writeUpdateInfo: false` is not set. We currently ship full DMGs — blockmap-based deltas can be added later when update volume justifies the extra artifacts.
- **Dev** — `app.isPackaged === false` in dev, so the updater short-circuits and stays in the `idle` state. No spam.

### Testing the updater locally

```bash
# Build version N with the real publish URL (GitHub Releases)
bun run dist:mac
open artifacts/Skiller-*.dmg   # install into /Applications, launch

# Bump package.json version and tag + push — CI builds version N+1
git tag v0.2.1
git push origin v0.2.1
```

The installed app should detect the new release within 6h (or via **Check for updates** in Settings → App Updates) and offer **Restart & install** after download completes.

## Packaging notes

Primary project configuration:

- `electron.vite.config.ts` — bundler config (main + preload + renderer all via Vite 7)
- `electron-builder.yml` — packaging, signing, publish config
- `build-resources/entitlements.mac.plist` — Hardened Runtime entitlements
- `package.json` — scripts + `main: out/main/index.js`
