#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_FILE="$ROOT_DIR/native/macos/window-effects.mm"
OUT_FILE="$ROOT_DIR/src/bun/libMacWindowEffects.dylib"

if [[ "$(uname -s)" != "Darwin" ]]; then
	mkdir -p "$(dirname "$OUT_FILE")"
	: >"$OUT_FILE"
	echo "Created placeholder native macOS effects dylib: $OUT_FILE"
	exit 0
fi

if [[ ! -f "$SRC_FILE" ]]; then
	echo "Missing source file: $SRC_FILE"
	exit 1
fi

mkdir -p "$(dirname "$OUT_FILE")"
xcrun clang++ -dynamiclib -fobjc-arc -framework Cocoa "$SRC_FILE" -o "$OUT_FILE"
echo "Built native macOS effects: $OUT_FILE"

# Load ELECTROBUN_DEVELOPER_ID from .env if it isn't already in the environment,
# so the dylib is signed with a secure timestamp — required for notarization.
if [[ -z "${ELECTROBUN_DEVELOPER_ID:-}" && -f "$ROOT_DIR/.env" ]]; then
	# shellcheck disable=SC1090
	set -a; . "$ROOT_DIR/.env"; set +a
fi

if [[ -n "${ELECTROBUN_DEVELOPER_ID:-}" ]]; then
	codesign --force --options runtime --timestamp \
		--sign "$ELECTROBUN_DEVELOPER_ID" "$OUT_FILE"
	echo "Codesigned (Developer ID + timestamp): $OUT_FILE"
else
	# No Developer ID available — ad-hoc sign so local dev builds still load the dylib.
	codesign --force --sign - "$OUT_FILE"
	echo "Ad-hoc signed (set ELECTROBUN_DEVELOPER_ID in .env to Developer-ID-sign): $OUT_FILE"
fi
