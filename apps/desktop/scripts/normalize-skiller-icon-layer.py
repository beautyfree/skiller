#!/usr/bin/env python3
"""Rewrite Skiller Icon Composer layer PNG with a standard app-icon safe zone.

Reads the layer (default: assets/icons/Skiller.icon/Assets/Image.png), measures
the bounding box of visible pixels, scales that content so its larger side fits
within CONTENT_MAX_FRACTION of the canvas, and centers it on a transparent
background of the same dimensions as the input.

Run after updating the artwork in Icon Composer when the glyph reads too large
in the Dock or corners should stay transparent (no baked-in black mat).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

CONTENT_MAX_FRACTION = 0.86
ALPHA_BBOX_THRESHOLD = 12


def _alpha_bbox(rgba: Image.Image) -> tuple[int, int, int, int] | None:
    a = rgba.split()[-1]
    binary = a.point(lambda x: 255 if x > ALPHA_BBOX_THRESHOLD else 0)
    return binary.getbbox()


def normalize_layer(rgba: Image.Image) -> Image.Image:
    w, h = rgba.size
    bbox = _alpha_bbox(rgba)
    if bbox is None:
        return Image.new("RGBA", (w, h), (0, 0, 0, 0))

    content = rgba.crop(bbox)
    cw, ch = content.size
    target = int(min(w, h) * CONTENT_MAX_FRACTION)
    scale = min(target / cw, target / ch, 1.0)
    nw = max(1, int(round(cw * scale)))
    nh = max(1, int(round(ch * scale)))
    resized = content.resize((nw, nh), Image.Resampling.LANCZOS)

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    x0 = (w - nw) // 2
    y0 = (h - nh) // 2
    out.paste(resized, (x0, y0), resized)
    return out


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    default = root / "assets" / "icons" / "Skiller.icon" / "Assets" / "Image.png"
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "path",
        nargs="?",
        type=Path,
        default=default,
        help="Layer PNG to normalize in place",
    )
    args = ap.parse_args()
    path: Path = args.path
    if not path.is_file():
        print(f"Missing {path}", file=sys.stderr)
        return 1

    img = Image.open(path).convert("RGBA")
    out = normalize_layer(img)
    out.save(path, "PNG", optimize=True)
    bb = _alpha_bbox(out)
    print(f"Wrote {path} ({path.stat().st_size} bytes)")
    if bb:
        side = max(bb[2] - bb[0], bb[3] - bb[1])
        print(f"  alpha bbox max side {side} / {min(out.size)} = {side / min(out.size):.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
