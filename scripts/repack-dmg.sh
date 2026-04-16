#!/usr/bin/env bash
#
# Replace Electrobun's minimal DMG with a properly-styled one using create-dmg
# (brew install create-dmg) so Finder shows a large icon, background image,
# and a clear drag-to-Applications layout.
#
# Why we repack: running Skiller.app directly from the mounted DMG volume
# triggers Electrobun's self-extracting launcher to rename across mount points
# (source is read-only /Volumes/..., destination is ~/Library/Application
# Support/...), which crashes with RenameAcrossMountPoints. The styled DMG is
# our UX defense: users see a single obvious action — drag to /Applications.
#
# Requires: create-dmg (brew install create-dmg).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_NAME="${1:-stable}"
ARCH="$(uname -m)"
BUILD_DIR="$ROOT_DIR/build/${ENV_NAME}-macos-${ARCH}"
APP_PATH="$BUILD_DIR/Skiller.app"
OUT_DMG="$BUILD_DIR/Skiller.dmg"
BG_IMG="$ROOT_DIR/assets/dmg/background.png"
APP_ICON="$ROOT_DIR/assets/icons/app.icns"

if [[ ! -d "$APP_PATH" ]]; then
	echo "error: $APP_PATH not found — run 'bunx electrobun build --env=$ENV_NAME' first" >&2
	exit 1
fi
if ! command -v create-dmg >/dev/null 2>&1; then
	echo "error: create-dmg not installed. Install with: brew install create-dmg" >&2
	exit 1
fi

# Load signing identity from .env (same pattern as electrobun.config.ts)
if [[ -f "$ROOT_DIR/.env" ]]; then
	# shellcheck disable=SC1090
	set -a; . "$ROOT_DIR/.env"; set +a
fi

rm -f "$OUT_DMG"

# Stage into an empty folder so create-dmg treats Skiller.app as a normal
# entry at the DMG root. Copy with xattrs/resource forks intact so the
# embedded code-signature seal stays valid after HFS+ round-trip.
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
/usr/bin/ditto --rsrc "$APP_PATH" "$STAGING/$(basename "$APP_PATH")"

CODESIGN_ARGS=()
if [[ -n "${ELECTROBUN_DEVELOPER_ID:-}" ]]; then
	CODESIGN_ARGS=(--codesign "$ELECTROBUN_DEVELOPER_ID")
fi

# Volume name "Skiller Installer" (not "Skiller") — macOS TCC blocks writes to
# a mounted volume named "Skiller" when the app is also called Skiller.app
# under sandboxed shells; "Skiller Installer" sidesteps that and reinforces UX.
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

# Notarize + staple the new DMG if credentials are available.
if [[ -n "${ELECTROBUN_APPLEAPIKEYPATH:-}" && -n "${ELECTROBUN_APPLEAPIKEY:-}" && -n "${ELECTROBUN_APPLEAPIISSUER:-}" ]]; then
	echo "Notarizing DMG (API key)…"
	xcrun notarytool submit "$OUT_DMG" \
		--key "$ELECTROBUN_APPLEAPIKEYPATH" \
		--key-id "$ELECTROBUN_APPLEAPIKEY" \
		--issuer "$ELECTROBUN_APPLEAPIISSUER" \
		--wait
	xcrun stapler staple "$OUT_DMG"
	echo "Stapled."
elif [[ -n "${ELECTROBUN_APPLEID:-}" && -n "${ELECTROBUN_APPLEIDPASS:-}" && -n "${ELECTROBUN_TEAMID:-}" ]]; then
	echo "Notarizing DMG (Apple ID)…"
	xcrun notarytool submit "$OUT_DMG" \
		--apple-id "$ELECTROBUN_APPLEID" \
		--password "$ELECTROBUN_APPLEIDPASS" \
		--team-id "$ELECTROBUN_TEAMID" \
		--wait
	xcrun stapler staple "$OUT_DMG"
	echo "Stapled."
else
	echo "No notarization credentials in .env — DMG signed but not notarized." >&2
fi

# Keep artifacts/ in sync with what dist:mac advertised.
ARTIFACT_DMG="$ROOT_DIR/artifacts/${ENV_NAME}-macos-${ARCH}-Skiller.dmg"
mkdir -p "$ROOT_DIR/artifacts"
cp "$OUT_DMG" "$ARTIFACT_DMG"
echo "Wrote: $ARTIFACT_DMG"
