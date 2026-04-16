# Development Guide

This document contains developer-focused setup, build, and debugging instructions for Skiller.

## Prerequisites

- [Bun](https://bun.sh/) (recommended) or Node.js 18+
- Project dependencies installed via package manager

## Local Setup

```bash
# Install dependencies
bun install
```

## Run Modes

```bash
# Desktop app with bundled views (Electrobun watches main-process code)
bun run dev

# Desktop app + Vite HMR (recommended for frontend iteration)
bun run dev:hmr

# Vite web UI only (no full desktop RPC/preload behavior)
bun run dev:vite

# HMR mode with webview DevTools auto-opened
bun run dev:debug
```

## Type Checking

```bash
bunx tsc --noEmit
```

## Production Build

```bash
# Production web bundle output in dist/
bun run build
```

## Prerequisites for macOS distribution

```bash
# create-dmg — used by scripts/repack-dmg.sh to produce the styled
# drag-to-Applications DMG that replaces Electrobun's default layout.
brew install create-dmg
```

## Distribution builds per platform

Electrobun **does not cross-compile** — you must run the build on the target OS ([source](https://blackboard.sh/electrobun/docs/guides/cross-platform-development)). This repo exposes one script per platform:

| Host OS | Command | Output in `artifacts/` |
| --- | --- | --- |
| macOS (Apple Silicon) | `bun run dist:mac` | `stable-macos-arm64-Skiller.dmg` (signed + notarized when `.env` is configured) |
| Windows x64 | `bun run dist:win` | `stable-win-x64-Skiller*` (`.exe` + self-extractor) |
| Linux x64 | `bun run dist:linux` | `stable-linux-x64-Skiller*` |

There are two ways to produce all three without owning three machines:

### Option 1 — GitHub Actions matrix (zero local setup)

`.github/workflows/release.yml` fans out to `macos-14`, `windows-latest`, and `ubuntu-latest` runners. Tag a release and GitHub builds and publishes everything:

```bash
# Bump version in package.json, commit, then:
git tag v0.1.9
git push origin v0.1.9
```

Required repo **Secrets** (Settings → Secrets and variables → Actions) for macOS notarization:

- `ELECTROBUN_DEVELOPER_ID` — `Developer ID Application: … (TEAM_ID)`
- `ELECTROBUN_APPLEAPIISSUER` — Issuer UUID from App Store Connect → Users and Access → Integrations → App Store Connect API
- `ELECTROBUN_APPLEAPIKEY` — Key ID (10 chars) from the same page
- `ELECTROBUN_APPLEAPIKEY_P8` — paste the entire contents of `AuthKey_XXXXXXXXXX.p8` (multi-line secret). The workflow writes it to `$RUNNER_TEMP/AuthKey.p8` and exports `ELECTROBUN_APPLEAPIKEYPATH` automatically — you do NOT set `ELECTROBUN_APPLEAPIKEYPATH` yourself.

Windows/Linux jobs don't need secrets; an unsigned `.exe` will just show a SmartScreen warning the first time a user runs it.

### Option 2 — Local Windows VM (Parallels / UTM / Hyper-V)

Inside a Windows 10/11 VM:

```powershell
# Prereqs: Git, Bun, Visual Studio Build Tools (Desktop development with C++), cmake
git clone https://github.com/beautyfree/skiller-skills-desktop-manager
cd skiller-skills-desktop-manager
bun install
bun run dist:win
```

Artifacts end up in `artifacts/`. Copy them back out of the VM.

### Windows code signing (optional)

Without a code-signing certificate, the `.exe` runs fine but Windows SmartScreen shows a one-time "unrecognized app" warning to the user. To remove that:

- Standard OV certificate (~$200/year) — reputation is built over time; warnings may still appear for new signatures.
- EV certificate (~$400/year) — instant SmartScreen reputation, hardware token required.

Electrobun doesn't bake Windows signing into `electrobun build`; run `signtool` on the produced `.exe` as a post-build step.

## macOS code signing and notarization

Signing is **opt-in via environment variables** (Electrobun reads them when you run `electrobun build`). Without them, builds stay unsigned, same as before.

### One-shot distributable build

Once `.env` is populated (see below), produce a DMG that launches on any Mac without Gatekeeper warnings:

```bash
bun run dist:mac
```

Output: `artifacts/stable-macos-arm64-Skiller.dmg` — signed **and** notarized. Send it to anyone.

Verify locally:

```bash
spctl -a -vvv -t install artifacts/stable-macos-arm64-Skiller.dmg   # expect: "source=Notarized Developer ID"
xcrun stapler validate artifacts/stable-macos-arm64-Skiller.dmg      # expect: "The validate action worked!"
```

### Why the DMG is hand-styled

Electrobun's built-in DMG writer ships an unstyled window (tiny default icon, no background, no layout). Two problems this caused:

1. Users said the Skiller.app icon inside the DMG "looks suspiciously small" — Finder defaulted to 48px icon view.
2. Running the app directly from `/Volumes/Skiller/Skiller.app` crashed instantly with `RenameAcrossMountPoints`: Electrobun's self-extracting launcher writes into `~/Library/Application Support/com.beautyfree.skiller/...` and then tries to `renameSync` a directory whose source derives from `process.execPath` — when the app runs from a read-only DMG volume, source and destination are on different filesystems, so `rename` fails.

`scripts/repack-dmg.sh` calls `create-dmg` to produce a DMG with a 128px icon, a dark background featuring two light "cards" under the app and Applications icons (so Finder's default label text stays readable regardless of macOS theme), a bright white arrow, and the volume named "Install Skiller" — visually forcing the user to drag the app to `/Applications` before running it. This is the same pattern Electron apps use. The DMG is re-signed and re-notarized after repackaging; Electrobun's own `createDmg` is disabled in `electrobun.config.ts`.

### Environment variables

**1. Apple Developer Program** — enroll at [developer.apple.com](https://developer.apple.com). Install **Developer ID Application** certificate in Keychain (Xcode → Settings → Accounts → Manage Certificates, or create in the Developer portal).

**2. Identity string** — run:

```bash
security find-identity -v -p codesigning
```

Copy the full name of `Developer ID Application: … (TEAM_ID)` — that is `ELECTROBUN_DEVELOPER_ID`.

**3. Sign only** (Gatekeeper may still warn until notarized):

```bash
export ELECTROBUN_DEVELOPER_ID="Developer ID Application: Your Name (XXXXXXXXXX)"
bun run build
bunx electrobun build --env=stable
```

**4. Notarization** (recommended for distribution; staples ticket so users avoid quarantine friction) — use **either** App Store Connect API key **or** Apple ID app-specific password:

- **API key (preferred for CI):** set `ELECTROBUN_APPLEAPIISSUER`, `ELECTROBUN_APPLEAPIKEY`, `ELECTROBUN_APPLEAPIKEYPATH` (path to `.p8` file).
- **Apple ID:** set `ELECTROBUN_APPLEID`, `ELECTROBUN_APPLEIDPASS` ([app-specific password](https://support.apple.com/en-us/102654)), `ELECTROBUN_TEAMID`.

With Developer ID plus one of the notarization credential sets, `electrobun.config.ts` enables `notarize` automatically.

Artifacts: `artifacts/stable-macos-*-Skiller.dmg` and related files under `artifacts/`.

### Troubleshooting notarization

If `notarization failed ... status: Invalid`, Apple returns a JSON log listing which binaries are unsigned or missing a secure timestamp. Common causes in this project:

- A `.dylib` you added to `src/bun/` is not signed by the Developer ID with `--timestamp`. Add a codesign step to your build script (see `scripts/build-macos-effects.sh` for the pattern) so every custom binary is signed before Electrobun bundles it.
- `.env` missing one of the three API-key vars (Issuer, Key ID, Key path). All three must be present together, and the `.p8` file must be readable.

## Webview DevTools / Blank Screen Debugging

Electrobun exposes `BrowserView.openDevTools()` for the main webview.

- Automatic: run `bun run dev:debug`
- Or set environment flags:
  - `AGENTSKILLS_DEVTOOLS=1`
  - `ELECTROBUN_OPEN_DEVTOOLS=1`
- On macOS, you can also try right-click in webview and choose Inspect Element when available.

If UI renders in browser but not in desktop shell:

1. Run `bun run dev:vite`
2. Open the printed localhost URL in a regular browser
3. Compare behavior to isolate shell/runtime issues from frontend bundle issues

## Auto-updates

Electrobun's [built-in Updater](https://blackboard.sh/electrobun/docs/apis/updater) is wired up in `src/bun/app-updater.ts`:

- **Config** — `electrobun.config.ts` sets `release.baseUrl` to `https://github.com/beautyfree/skiller-skills-desktop-manager/releases/latest/download`. Override per-build by exporting `ELECTROBUN_UPDATE_BASE_URL=https://your-host/…` before `bun run build:mac`.
- **Artifacts** — `bunx electrobun build --env=stable` emits `stable-<platform>-<arch>-update.json`, `*-Skiller.app.tar.zst`, and `*.patch` into `artifacts/`. The GitHub Actions release workflow uploads every file in `artifacts/` to the Release, so `releases/latest/download/<name>` resolves to the newest version.
- **Runtime** — `initAppUpdater()` runs `Updater.checkForUpdate()` on startup and every 6 hours. Status transitions are projected into an `AppUpdateStatusJson` snapshot and pushed to the webview via the `app_update_status_changed` bun→webview RPC message. Settings renders the current state and exposes **Check for updates** / **Download update** / **Restart & install** buttons.
- **Delta patches** — Electrobun generates per-release `*.patch` files via BSDIFF when `release.baseUrl` is set; typical patch is ~14 KB. If the patch chain is broken the Updater falls back to the full `.app.tar.zst`.

### Testing the updater locally

The Updater skips itself on the `dev` channel, so you need two `stable` builds to watch an update happen:

```bash
# Terminal A: serve artifacts/ over http for the running app to fetch from
cd artifacts && python3 -m http.server 8787
```

```bash
# Terminal B: build version N pointing at the local server
export ELECTROBUN_UPDATE_BASE_URL=http://127.0.0.1:8787
bun run dist:mac
open build/stable-macos-arm64/Skiller.app  # run version N

# Bump package.json version, then build version N+1 without launching it
bun run dist:mac

# The running app should detect the new update.json within 6h (or click
# "Check for updates" in Settings) and offer "Restart & install".
```

## Packaging Notes

Packaging and desktop distribution follow [Electrobun docs](https://electrobun.dev/docs).

Primary project configuration files:

- `electrobun.config.ts`
- `vite.config.ts`
- `package.json`

