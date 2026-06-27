#!/usr/bin/env python3
"""Generate mindbob PWA icons (calm background + simple sprout mark).
Run: python3 scripts/make-icons.py
Regenerate whenever the brand colours change."""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT, exist_ok=True)

BG = (244, 239, 230)       # --bg sand
ACCENT = (201, 163, 106)   # --accent
INK = (74, 64, 52)         # --ink


def draw_sprout(d, cx, cy, s, color):
    w = max(3, int(s * 0.05))
    # stem
    d.line([(cx, cy + s * 0.42), (cx, cy - s * 0.02)], fill=color, width=w)
    # left leaf
    d.arc([cx - s * 0.46, cy - s * 0.18, cx + s * 0.02, cy + s * 0.30],
          start=120, end=250, fill=color, width=w)
    # right leaf
    d.arc([cx - s * 0.02, cy - s * 0.30, cx + s * 0.46, cy + s * 0.18],
          start=-70, end=60, fill=color, width=w)


def make(size, maskable=False):
    img = Image.new("RGB", (size, size), BG)
    d = ImageDraw.Draw(img)
    # subtle ring
    pad = size * (0.30 if maskable else 0.22)
    if not maskable:
        d.ellipse([pad * 0.7, pad * 0.7, size - pad * 0.7, size - pad * 0.7],
                  outline=ACCENT, width=max(3, int(size * 0.015)))
    draw_sprout(d, size / 2, size / 2, size * (0.34 if maskable else 0.42), ACCENT)
    return img


make(192).save(os.path.join(OUT, "icon-192.png"))
make(512).save(os.path.join(OUT, "icon-512.png"))
make(512, maskable=True).save(os.path.join(OUT, "maskable-512.png"))
print("icons written to", os.path.normpath(OUT))
