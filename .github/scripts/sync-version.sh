#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Sync version references across release-related files.

Usage:
  ./.github/scripts/sync-version.sh <version>

Examples:
  ./.github/scripts/sync-version.sh 0.1.2
  ./.github/scripts/sync-version.sh v0.1.2
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "${1:-}" ]]; then
  echo "[sync-version] ERROR: missing version argument" >&2
  usage
  exit 1
fi

VERSION="${1#v}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "[sync-version] ERROR: invalid version '$1' (expected X.Y.Z or vX.Y.Z)" >&2
  exit 1
fi

TAG="v${VERSION}"

python3 - "$VERSION" "$TAG" <<'PY'
import pathlib
import re
import sys

version = sys.argv[1]
tag = sys.argv[2]
root = pathlib.Path.cwd()

targets = [
    (
        "package.json",
        [
            (r'("version"\s*:\s*")[^"]+(")', rf"\g<1>{version}\g<2>"),
        ],
    ),
    (
        "Casks/skiller.rb",
        [
            (r'(?m)(^\s*version\s*")[^"]+(")', rf"\g<1>{version}\g<2>"),
        ],
    ),
    (
        "README.md",
        [
            (
                r'(https://raw\.githubusercontent\.com/beautyfree/skiller-skills-desktop-manager/)v[0-9]+\.[0-9]+\.[0-9]+(/install\.sh)',
                rf"\g<1>{tag}\g<2>",
            ),
            (
                r'(https://raw\.githubusercontent\.com/beautyfree/skiller-skills-desktop-manager/)v[0-9]+\.[0-9]+\.[0-9]+(/install\.ps1)',
                rf"\g<1>{tag}\g<2>",
            ),
        ],
    ),
    (
        "install.sh",
        [
            (
                r'(?m)(VERSION\s+- Install a specific version \(e\.g\. ")([0-9]+\.[0-9]+\.[0-9]+)(" or "v)([0-9]+\.[0-9]+\.[0-9]+)("\), default: latest)',
                rf"\g<1>{version}\g<3>{version}\g<5>",
            ),
            (
                r'(?m)(VERSION\s+Install specific version tag \(e\.g\. )([0-9]+\.[0-9]+\.[0-9]+)( or v)([0-9]+\.[0-9]+\.[0-9]+)(\), default: latest)',
                rf"\g<1>{version}\g<3>{version}\g<5>",
            ),
            (
                r'(?m)(\| VERSION=)([0-9]+\.[0-9]+\.[0-9]+)( bash)',
                rf"\g<1>{version}\g<3>",
            ),
        ],
    ),
    (
        "install.ps1",
        [
            (
                r'(?m)(#\s+\$Version\s*=\s*")([0-9]+\.[0-9]+\.[0-9]+)(")',
                rf"\g<1>{version}\g<3>",
            ),
        ],
    ),
]

for rel_path, replacements in targets:
    path = root / rel_path
    text = path.read_text(encoding="utf-8")
    updated = text
    for pattern, replacement in replacements:
        updated = re.sub(pattern, replacement, updated)
    if updated != text:
        path.write_text(updated, encoding="utf-8")
        print(f"[sync-version] updated {rel_path}")
    else:
        print(f"[sync-version] no change {rel_path}")
PY

echo "[sync-version] running consistency check..."
"$ROOT_DIR/.github/scripts/check-version-sync.sh"
echo "[sync-version] done: ${VERSION} (${TAG})"
