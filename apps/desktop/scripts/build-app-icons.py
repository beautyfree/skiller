#!/usr/bin/env python3
"""Build app icons from the source artwork (Icon Composer export or flat PNG).

The canonical layer `Skiller.icon/Assets/Image.png` should already include a
visual safe zone (see `scripts/normalize-skiller-icon-layer.py`). This script
only resizes to 1024 and emits platform formats — no extra masks or shadows.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

SIZE = 1024


def _resolve_source(source: Path) -> Path:
    """
    Resolve input source to a concrete image file.

    Supports either:
    - plain image file (PNG/JPEG)
    - Icon Composer bundle (.icon) with icon.json + Assets/*
    """
    if source.is_dir() and source.suffix == ".icon":
        icon_json = source / "icon.json"
        assets_dir = source / "Assets"
        if not icon_json.is_file():
            raise FileNotFoundError(f"Missing {icon_json}")
        if not assets_dir.is_dir():
            raise FileNotFoundError(f"Missing {assets_dir}")

        payload = json.loads(icon_json.read_text(encoding="utf-8"))
        image_name = "Image.png"
        try:
            image_name = payload["groups"][0]["layers"][0]["image-name"]
        except (KeyError, IndexError, TypeError):
            pass
        image_path = assets_dir / image_name
        if not image_path.is_file():
            raise FileNotFoundError(f"Missing {image_path}")

        return image_path

    if source.is_file():
        return source

    raise FileNotFoundError(f"Missing source: {source}")


def _square_master(img: Image.Image) -> Image.Image:
    """1024×1024 RGBA master (LANCZOS resize of full canvas)."""
    rgba = img.convert("RGBA")
    if rgba.size == (SIZE, SIZE):
        return rgba
    return rgba.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def build_master_desktop(img: Image.Image) -> Image.Image:
    """Square RGBA master for desktop bundles (.icns, .ico, Linux)."""
    return _square_master(img)


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    icons = root / "assets" / "icons"
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "source",
        nargs="?",
        default=icons / "Skiller.icon",
        type=Path,
        help="Source image file or Icon Composer bundle (.icon)",
    )
    ap.add_argument("--no-icns", action="store_true", help="Skip iconutil .icns")
    args = ap.parse_args()

    try:
        resolved_src = _resolve_source(args.source)
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    source_img = Image.open(resolved_src)

    master = build_master_desktop(source_img)
    # Linux: electrobun.config.ts references this path only.
    master.resize((512, 512), Image.Resampling.LANCZOS).save(
        icons / "app" / "icon-512.png", "PNG"
    )

    iconset = [
        ("icon_16x16.png", 16),
        ("icon_16x16@2x.png", 32),
        ("icon_32x32.png", 32),
        ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128),
        ("icon_128x128@2x.png", 256),
        ("icon_256x256.png", 256),
        ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512),
        ("icon_512x512@2x.png", 1024),
    ]
    for name, dim in iconset:
        master.resize((dim, dim), Image.Resampling.LANCZOS).save(
            icons / "AppIcon.iconset" / name, "PNG"
        )

    master.save(
        icons / "app.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    if not args.no_icns:
        icns_out = icons / "app.icns"
        r = subprocess.run(
            [
                "iconutil",
                "-c",
                "icns",
                str(icons / "AppIcon.iconset"),
                "-o",
                str(icns_out),
            ],
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            print(r.stderr, file=sys.stderr)
            return r.returncode

    print("Wrote icons under", icons)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
