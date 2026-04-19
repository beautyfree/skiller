#!/usr/bin/env bash
#
# Post-extract helper for the Skiller tar.xz Linux build.
#
# Why this exists: Electron's setuid sandbox wants `chrome-sandbox` owned by
# root with mode 4755. .deb and AppImage builds handle this automatically
# (postinst / runtime respectively); the tar.xz has no install step, so we
# ship this script to do the same dance on demand.
#
# Usage (from inside the extracted directory):
#   ./install.sh
#
# What it does:
#   1. Sets SUID on chrome-sandbox (needs sudo).
#   2. Writes a `.desktop` entry pointing at the local `skiller` binary so
#      the app appears in your app launcher.
#   3. Copies the icon into `~/.local/share/icons`.
#
# To undo everything, run `./install.sh --uninstall`.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$APP_DIR/skiller"
SANDBOX="$APP_DIR/chrome-sandbox"
ICON_SRC="$APP_DIR/resources/app.asar.unpacked/assets/icons/app/icon-512.png"
DESKTOP_DIR="$HOME/.local/share/applications"
DESKTOP_FILE="$DESKTOP_DIR/skiller.desktop"
ICON_DIR="$HOME/.local/share/icons"
ICON_DEST="$ICON_DIR/skiller.png"

if [[ ! -x "$BIN" ]]; then
	echo "error: $BIN not found or not executable — run this script from inside the extracted Skiller directory" >&2
	exit 1
fi

if [[ "${1:-}" == "--uninstall" ]]; then
	rm -f "$DESKTOP_FILE" "$ICON_DEST"
	echo "✓ removed $DESKTOP_FILE and $ICON_DEST"
	echo "  (chrome-sandbox SUID bit is harmless — left in place)"
	exit 0
fi

# 1) chrome-sandbox SUID — needs root
if [[ -f "$SANDBOX" ]]; then
	current_mode=$(stat -c '%a' "$SANDBOX" 2>/dev/null || stat -f '%Lp' "$SANDBOX")
	current_owner=$(stat -c '%U' "$SANDBOX" 2>/dev/null || stat -f '%Su' "$SANDBOX")
	if [[ "$current_mode" != "4755" || "$current_owner" != "root" ]]; then
		echo "→ setting SUID on $SANDBOX (needs sudo)…"
		sudo chown root:root "$SANDBOX"
		sudo chmod 4755 "$SANDBOX"
	else
		echo "✓ chrome-sandbox already configured"
	fi
fi

# 2) Desktop entry
mkdir -p "$DESKTOP_DIR"
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Name=Skiller
Comment=Manage AI agent skills across Claude Code, Cursor, Copilot, and more
Exec="$BIN" %U
Icon=skiller
Terminal=false
Type=Application
Categories=Development;
StartupWMClass=Skiller
EOF
echo "✓ wrote $DESKTOP_FILE"

# 3) Icon
if [[ -f "$ICON_SRC" ]]; then
	mkdir -p "$ICON_DIR"
	cp "$ICON_SRC" "$ICON_DEST"
	echo "✓ wrote $ICON_DEST"
else
	echo "! icon source not found at $ICON_SRC — skipping (app will use a fallback icon)"
fi

# Best-effort: ask the DE to refresh its caches. No error if the tools aren't
# installed — the .desktop file still works on next login.
if command -v update-desktop-database >/dev/null 2>&1; then
	update-desktop-database -q "$DESKTOP_DIR" || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
	gtk-update-icon-cache -q -t "$ICON_DIR" 2>/dev/null || true
fi

echo
echo "All set. Launch Skiller from your app menu, or run: \"$BIN\""
