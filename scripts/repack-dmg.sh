#!/usr/bin/env bash
#
# Produce a styled drag-to-Applications DMG from electron-builder's unpacked
# .app. Historically this was a workaround for an Electrobun self-extraction
# bug that crashed the app when launched from the DMG volume; under Electron
# the bug doesn't exist, but the styled DMG stays as industry-standard UX
# (see Slack, Chrome, Notion — all do this).
#
# Expected input: artifacts/mac-arm64/Skiller.app (from `electron-builder --mac`
# with mac.target = dir).
# Output: artifacts/Skiller-<version>-macos-arm64.dmg — signed, notarized,
# stapled.
#
# Requires: create-dmg (brew install create-dmg), xcrun, codesign.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH="$(uname -m)"
BUILD_DIR="$ROOT_DIR/artifacts/mac-${ARCH}"
APP_PATH="$BUILD_DIR/Skiller.app"
BG_IMG="$ROOT_DIR/assets/dmg/background.png"
APP_ICON="$ROOT_DIR/assets/icons/app.icns"

# Version from package.json so DMG filename matches electron-updater's expected
# artifactName (see electron-builder.yml `artifactName` field).
VERSION="$(node -p "require('./package.json').version")"
OUT_DMG="$ROOT_DIR/artifacts/Skiller-${VERSION}-macos-${ARCH}.dmg"

if [[ ! -d "$APP_PATH" ]]; then
	echo "error: $APP_PATH not found — run 'electron-builder --mac' first" >&2
	exit 1
fi
if ! command -v create-dmg >/dev/null 2>&1; then
	echo "error: create-dmg not installed. Install with: brew install create-dmg" >&2
	exit 1
fi

# Load signing identity from .env so the DMG itself gets signed (create-dmg
# signs the DMG wrapper separately from the .app inside it).
if [[ -f "$ROOT_DIR/.env" ]]; then
	# shellcheck disable=SC1090
	set -a; . "$ROOT_DIR/.env"; set +a
fi

rm -f "$OUT_DMG"

# Stage with ditto so xattrs and extended resources (code signature seals)
# survive the copy unchanged.
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
/usr/bin/ditto --rsrc "$APP_PATH" "$STAGING/$(basename "$APP_PATH")"

CODESIGN_ARGS=()
if [[ -n "${CSC_NAME:-}" ]]; then
	CODESIGN_ARGS=(--codesign "$CSC_NAME")
fi

echo "Repackaging DMG with styled layout…"
create-dmg \
	--volname "Skiller Installer" \
	--volicon "$APP_ICON" \
	--background "$BG_IMG" \
	--window-pos 200 120 \
	--window-size 600 400 \
	--icon-size 128 \
	--icon "Skiller.app" 150 190 \
	--app-drop-link 450 190 \
	--hide-extension "Skiller.app" \
	--no-internet-enable \
	"${CODESIGN_ARGS[@]}" \
	"$OUT_DMG" \
	"$STAGING"

# Notarize + staple the DMG wrapper. Prefer API-key auth (CI-friendly), fall
# back to Apple ID + app-specific password.
if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_KEY_ISSUER:-}" ]]; then
	echo "Notarizing DMG (API key)…"
	xcrun notarytool submit "$OUT_DMG" \
		--key "$APPLE_API_KEY" \
		--key-id "$APPLE_API_KEY_ID" \
		--issuer "$APPLE_API_KEY_ISSUER" \
		--wait
	xcrun stapler staple "$OUT_DMG"
	echo "Stapled."
elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
	echo "Notarizing DMG (Apple ID)…"
	xcrun notarytool submit "$OUT_DMG" \
		--apple-id "$APPLE_ID" \
		--password "$APPLE_APP_SPECIFIC_PASSWORD" \
		--team-id "$APPLE_TEAM_ID" \
		--wait
	xcrun stapler staple "$OUT_DMG"
	echo "Stapled."
else
	echo "No notarization credentials in .env — DMG signed but not notarized." >&2
fi

echo "Wrote: $OUT_DMG"
