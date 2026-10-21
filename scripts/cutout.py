#!/usr/bin/env python3
"""
cutout.py — prepare a picture for silkify.

Produces a PNG no larger than --max pixels on its long side, with a transparent background
when the picture sits on a plain one. Requires Pillow and numpy; --keep-largest also needs scipy.
The camera's EXIF orientation is applied first, as a browser would.

  # plain background (white studio shot, paper, black velvet): key it out
  python3 scripts/cutout.py pear.jpg pear.png

  # pick the background colour yourself; also key the cast shadow inside a box
  python3 scripts/cutout.py hare.jpg hare.png --bg "#e3d7c3" --shadow-box 1160,1160,1900,1900

  # keep the whole rectangle (a painting, a poster): silkify turns it into a cushion
  python3 scripts/cutout.py mona.jpg mona.png --rect

  # a dark logo on white: the insides of O, B, e are enclosed, so key every white pixel
  python3 scripts/cutout.py logo.jpg logo.png --no-flood

  # a scan whose border is not the background (a black scan edge): crop to the paper first
  python3 scripts/cutout.py scan.jpg out.png --crop 60,60,1860,1960

How the key works
  1. background colour = median of the border pixels (or --bg)
  2. distance of every pixel to it, in a perceptual-ish RGB metric, scaled 0..1; inside
     --shadow-box, darker pixels with the backdrop's hue (a cast shadow) count as background too
  3. only pixels CONNECTED to the border are background candidates (so white eyes, a white
     label, a pale highlight inside the subject survive); --no-flood keys globally. When a
     sizeable enclosed area matches the background (the counters of a wordmark), a hint says so
  4. alpha ramps from 0 at --tolerance to 1 at --tolerance + --softness, then a small
     Gaussian feather (--feather px) smooths the outline
  5. edge colours are "un-mixed" from the background, so no halo of the old backdrop remains
  6. the result is cropped to the subject (+ --margin) and downscaled
"""
import argparse
import sys

import numpy as np
from PIL import Image, ImageFilter, ImageOps, UnidentifiedImageError

try:
    from scipy import ndimage
except ImportError:  # pragma: no cover
    ndimage = None


def parse_color(s):
    s = s.lstrip('#')
    return np.array([int(s[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def border_median(rgb, width=4):
    edges = np.concatenate([
        rgb[:width].reshape(-1, 3), rgb[-width:].reshape(-1, 3),
        rgb[:, :width].reshape(-1, 3), rgb[:, -width:].reshape(-1, 3),
    ])
    return np.median(edges, axis=0)


def distance(rgb, bg):
    rm = (rgb[..., 0] + bg[0]) / 2
    # "redmean" weighting: cheap, and much closer to perception than plain RGB distance
    d = rgb - bg
    w = np.stack([2 + rm / 256, np.full_like(rm, 4.0), 2 + (255 - rm) / 256], axis=-1)
    return np.sqrt((w * d * d).sum(-1)) / (3 * 255)


def chroma_distance(rgb, bg):
    # brightness-independent: a cast shadow has the backdrop's hue, only darker
    c = rgb / np.maximum(rgb.sum(-1, keepdims=True), 1)
    return np.abs(c - bg / bg.sum()).sum(-1)


def connected_to_border(mask):
    if ndimage is not None:
        lab, _ = ndimage.label(mask)
        ids = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        ids = ids[ids > 0]
        return np.isin(lab, ids)
    # numpy-only fallback: grow from the border until it stops changing
    reach = np.zeros_like(mask)
    reach[0], reach[-1], reach[:, 0], reach[:, -1] = mask[0], mask[-1], mask[:, 0], mask[:, -1]
    while True:
        grown = reach.copy()
        grown[1:] |= reach[:-1]; grown[:-1] |= reach[1:]; grown[:, 1:] |= reach[:, :-1]; grown[:, :-1] |= reach[:, 1:]
        grown &= mask
        if (grown == reach).all():
            return reach
        reach = grown


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('src')
    p.add_argument('dst')
    p.add_argument('--max', type=int, default=1024, help='long side of the output, px (default 1024)')
    p.add_argument('--crop', help='crop the input first: x0,y0,x1,y1 in source pixels')
    p.add_argument('--rect', action='store_true', help='no cutout: keep the rectangle (silkify makes a cushion)')
    p.add_argument('--bg', help='background colour, e.g. "#ffffff" (default: median of the border)')
    p.add_argument('--tolerance', type=float, default=0.10, help='distance below which a pixel is background (0..1)')
    p.add_argument('--softness', type=float, default=0.06, help='width of the alpha ramp above the tolerance')
    p.add_argument('--feather', type=float, default=1.0, help='Gaussian blur of the alpha, px at output size')
    p.add_argument('--margin', type=float, default=0.03, help='empty border kept around the subject, fraction of its long side')
    p.add_argument('--shadow-box', help='x0,y0,x1,y1 (input pixels): inside it, darker pixels of the backdrop\'s hue are background too — a cast shadow')
    p.add_argument('--shadow-chroma', type=float, default=0.03, help='chromaticity distance that still counts as the backdrop\'s hue (default 0.03)')
    p.add_argument('--no-flood', action='store_true', help='key every matching pixel, not only those touching the border')
    p.add_argument('--keep-largest', action='store_true', help='drop islands: keep only the largest opaque component')
    a = p.parse_args(argv)
    if a.keep_largest and ndimage is None:
        print('--keep-largest needs scipy: pip install scipy (or crop the islands away with --crop)', file=sys.stderr)
        return 2

    try:
        im = ImageOps.exif_transpose(Image.open(a.src)).convert('RGBA')   # as a browser shows it
    except FileNotFoundError:
        print(f'{a.src}: no such file', file=sys.stderr)
        return 2
    except (UnidentifiedImageError, OSError) as e:
        ext = a.src.lower().rsplit('.', 1)[-1]
        hint = {
            'svg': 'an SVG needs no cut-out: silkify takes it directly (image: "logo.svg") and rasterises it; '
                   'or export a PNG first (rsvg-convert -w 1024 logo.svg > logo.png)',
            'heic': 'convert it to JPEG or PNG first (macOS: sips -s format png in.heic --out in.png), or pip install pillow-heif',
            'heif': 'convert it to JPEG or PNG first (macOS: sips -s format png in.heif --out in.png), or pip install pillow-heif',
            'avif': 'convert it to PNG first, or use a Pillow built with AVIF support',
        }.get(ext, 'Pillow cannot read this file: save it as PNG, JPEG or WebP first')
        print(f'{a.src}: not a picture Pillow can open ({e.__class__.__name__}). {hint}', file=sys.stderr)
        return 2
    ox = oy = 0
    if a.crop:
        box = tuple(int(v) for v in a.crop.split(','))
        im = im.crop(box)
        ox, oy = box[0], box[1]

    if a.rect:
        im.thumbnail((a.max, a.max), Image.LANCZOS)
        im.convert('RGB').save(a.dst, optimize=True)
        print(f'{a.dst}: {im.width}x{im.height} (rectangle, no cutout)')
        return 0

    # work at (at most) twice the output size: enough detail for the key, fast enough for numpy
    work = im.copy()
    work.thumbnail((a.max * 2, a.max * 2), Image.LANCZOS)
    arr = np.asarray(work).astype(np.float32)
    rgb, alpha0 = arr[..., :3], arr[..., 3] / 255

    bg = parse_color(a.bg) if a.bg else border_median(rgb)
    d = distance(rgb, bg)
    if a.shadow_box:
        k = work.width / (im.width)                    # input pixels → working pixels
        x0, y0, x1, y1 = (float(v) for v in a.shadow_box.split(','))
        x0, x1 = int((x0 - ox) * k), int((x1 - ox) * k)
        y0, y1 = int((y0 - oy) * k), int((y1 - oy) * k)
        sub = (slice(max(0, y0), max(0, y1)), slice(max(0, x0), max(0, x1)))
        lum = rgb[sub].sum(-1) / bg.sum()
        darker = (lum <= 1.02) & (lum >= 0.5)   # a cast shadow is darker than the backdrop, never near-black
        near = chroma_distance(rgb[sub], bg) < a.shadow_chroma
        d[sub] = np.where(darker & near, 0.0, d[sub])
    ramp = np.clip((d - a.tolerance) / max(a.softness, 1e-4), 0, 1)
    candidate = d < a.tolerance + a.softness
    enclosed = 0.0
    if not a.no_flood:
        reach = connected_to_border(candidate)
        enclosed = float((candidate & ~reach & (d < a.tolerance)).mean())   # backdrop-coloured, but walled in
        candidate = reach
    alpha = np.where(candidate, ramp, 1.0) * alpha0

    if a.keep_largest:
        lab, n = ndimage.label(alpha > 0.5)
        if n > 1:
            sizes = ndimage.sum(np.ones_like(alpha), lab, index=np.arange(1, n + 1))
            keep = ndimage.binary_dilation(lab == (np.argmax(sizes) + 1), iterations=3)
            alpha = alpha * keep

    # un-mix the old background from semi-transparent edge pixels: c = (obs − (1 − α)·bg) / α
    safe = np.maximum(alpha, 0.05)[..., None]
    rgb = np.clip((rgb - (1 - safe) * bg) / safe, 0, 255)
    rgb = np.where(alpha[..., None] > 0.98, arr[..., :3], rgb)

    out = Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), 'RGBA')

    # crop to the subject with a margin, then downscale and feather at the final size
    ys, xs = np.nonzero(alpha > 0.5)
    if not len(xs):
        print('nothing left after the key: lower --tolerance or pass --bg', file=sys.stderr)
        return 1
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    m = int(max(x1 - x0, y1 - y0) * a.margin)
    out = out.crop((max(0, x0 - m), max(0, y0 - m), min(out.width, x1 + m), min(out.height, y1 + m)))
    out.thumbnail((a.max, a.max), Image.LANCZOS)
    if a.feather > 0:
        r, g, b, al = out.split()
        out = Image.merge('RGBA', (r, g, b, al.filter(ImageFilter.GaussianBlur(a.feather))))
    out.save(a.dst, optimize=True)
    print(f'{a.dst}: {out.width}x{out.height}, background {"#%02x%02x%02x" % tuple(int(c) for c in bg)}')
    if enclosed > 0.002:
        print(f'note: {enclosed:.1%} of the picture has the background colour but is enclosed by the subject, so it was kept '
              'opaque. If those are holes (the insides of O, B, e in a wordmark), run again with --no-flood.', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
