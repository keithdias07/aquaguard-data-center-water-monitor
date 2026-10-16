"""Generate the AquaGuard extension icons (16, 32, 48, 128 px).

Run from the extension folder:  python assets/generate_icons.py
Requires Pillow (already installed with Streamlit).

The icon is drawn once at high resolution and scaled down, which gives smooth
anti-aliased edges at every size. Same design as assets/icon.svg.
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw

SIZES = (16, 32, 48, 128)
SCALE = 8  # draw at 8x, then downsample
NAVY = (11, 26, 46, 255)
BORDER = (31, 74, 114, 255)
TOP = (103, 232, 249)  # cyan
BOTTOM = (37, 99, 235)  # blue

OUT_DIR = Path(__file__).resolve().parent.parent / "icons"


def drop_mask(size: int) -> Image.Image:
    """Water-drop shape: a circle plus a triangle tangent to it."""
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    cx, r = size / 2, size * 0.26
    cy = size * 0.60
    d = r * 2.05  # distance from circle centre to the tip
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
    tx = r * math.sqrt(1 - (r / d) ** 2)
    ty = cy - r * r / d
    draw.polygon([(cx, cy - d), (cx - tx, ty), (cx + tx, ty)], fill=255)
    return mask


def vertical_gradient(size: int) -> Image.Image:
    grad = Image.new("RGBA", (size, size))
    px = grad.load()
    for y in range(size):
        t = y / (size - 1)
        color = tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)) + (255,)
        for x in range(size):
            px[x, y] = color
    return grad


def render(size: int) -> Image.Image:
    big = size * SCALE
    icon = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(icon)
    radius = big * 0.22
    border = max(SCALE, big // 32)
    draw.rounded_rectangle((0, 0, big - 1, big - 1), radius=radius, fill=BORDER)
    draw.rounded_rectangle(
        (border, border, big - 1 - border, big - 1 - border), radius=radius - border, fill=NAVY
    )
    icon.paste(vertical_gradient(big), (0, 0), drop_mask(big))
    # small highlight on the drop for depth (skipped at 16 px where it is noise)
    if size >= 32:
        hl = ImageDraw.Draw(icon)
        cx, cy, r = big * 0.43, big * 0.62, big * 0.07
        hl.ellipse((cx - r, cy - r * 1.4, cx + r, cy + r * 1.4), fill=(255, 255, 255, 70))
    return icon.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = OUT_DIR / f"icon{size}.png"
        render(size).save(path, optimize=True)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
