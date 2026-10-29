#!/usr/bin/env python3
"""Cut the item renders out of their flat teal studio background.

Usage: python3 tools/cutout.py <src_dir> <out_dir>
Expects <src_dir>/{perfume,passport,console,kit,organizer,towel,jewelry,divider}.jpg
Writes <out_dir>/<item>.png (512 px, transparent) for every tray icon, including
`lid` (cropped from the top of jewelry.jpg) and `jewelry` (the open box only).
"""
import sys
import os
import numpy as np
import cv2

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
WORK = 1400   # long side used for segmentation
SIZE = 512    # output canvas

# (source file, crop box as fractions x0,y0,x1,y1 or None)
JOBS = {
    'perfume': ('perfume', None),
    'passport': ('passport', None),
    'console': ('console', None),
    'kit': ('kit', None),
    'organizer': ('organizer', None),
    'towel': ('towel', None),
    'jewelry': ('jewelry', None),
    'lid': ('jewelry', None),
    'divider': ('divider', None),
}


def chroma(img):
    s = img.sum(axis=2, keepdims=True) + 1e-6
    return img / s, s[..., 0]


def hull_mask(shape, pts):
    m = np.zeros(shape, np.uint8)
    if len(pts) >= 3:
        cv2.fillConvexPoly(m, cv2.convexHull(pts[:, ::-1].astype(np.int32)), 1)
    return m > 0


def split_jewelry(name, small, f, fg, alpha, hsv, bh):
    """The design shows the lid floating over the box; separate the two."""
    H, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    gold = (H >= 8) & (H <= 36) & (S > 40) & (V > 60)
    n, lbl, stats, cent = cv2.connectedComponentsWithStats(gold.astype(np.uint8), connectivity=8)
    frame_id = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    frame = lbl == frame_id
    lid = hull_mask(fg.shape, np.argwhere(frame))
    ys = np.where(lid.any(axis=1))[0]
    top, bot = ys.min(), ys.max()
    lid_tight = lid.copy()
    lid = cv2.dilate(lid.astype(np.uint8), np.ones((19, 19), np.uint8)) > 0
    knob = np.zeros_like(frame)
    for i in range(1, n):
        if i == frame_id or stats[i, cv2.CC_STAT_AREA] < 30:
            continue
        cx, cy = cent[i]
        if lid[int(cy), int(cx)] and cy < top + (bot - top) * 0.62:
            knob |= hull_mask(fg.shape, np.argwhere(lbl == i))
    knob = cv2.dilate(knob.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
    solid = cv2.dilate((frame | knob).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    if name == 'lid':
        lid = cv2.dilate(lid_tight.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
        glass = lid & ~solid
        a = np.where(solid & lid, 1.0, np.where(glass, 0.42, 0.0)).astype(np.float32)
        a = cv2.GaussianBlur(a, (0, 0), 1.0)
        pale = np.array([255, 247, 228], np.float32)          # BGR pale cyan
        f2 = np.where(glass[..., None], f * 0.25 + pale * 0.75, f)
        return a, f2
    # vivid purple plastic below the lid's middle = the box's back rim seen through the glass
    purple = (H >= 120) & (H <= 172) & (S > 110) & (V > 70)
    rows = np.arange(fg.shape[0])[:, None]
    back = purple & lid & (rows > (top + bot) / 2) & ~cv2.dilate(frame.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    outside = (fg > 0) & ~lid & (rows > top + (bot - top) * 0.6)
    pts = np.argwhere(outside | back)
    # isometric box: rebuild the back corner hidden behind the lid, B = L_top + R_top - F_top
    body = np.argwhere(outside)
    xl, xr = body[:, 1].min(), body[:, 1].max()
    left = body[body[:, 1] <= xl + 4]; right = body[body[:, 1] >= xr - 4]
    l_top, l_bot = left[:, 0].min(), left[:, 0].max()
    r_top = right[:, 0].min()
    f_bot = body[:, 0].max(); f_x = body[body[:, 0] >= f_bot - 3][:, 1].mean()
    f_top = f_bot - (l_bot - l_top)
    b_y = l_top + r_top - f_top + 6
    b_x = xl + xr - f_x
    pts = np.vstack([pts, [[int(b_y), int(b_x)], [int(b_y) + 10, int(b_x) - 14], [int(b_y) + 10, int(b_x) + 14]]])
    box = hull_mask(fg.shape, pts)
    box = cv2.erode(box.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    near_bg = (np.abs(H - bh[0]) <= 10) & (S < bh[1] * 2.2)
    holes = box & ((frame & lid) | knob | (near_bg & lid))
    holes = cv2.dilate(holes.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    holes &= box
    fixed = cv2.inpaint(small, holes.astype(np.uint8) * 255, 9, cv2.INPAINT_TELEA).astype(np.float32)
    a = np.where(box, np.maximum(alpha, holes.astype(np.float32)), 0).astype(np.float32)
    a = np.where(box & (fg > 0), 1.0, a)
    a = cv2.GaussianBlur(a, (0, 0), 0.9)
    return a, fixed


def cut(name, src, crop):
    bgr = cv2.imread(os.path.join(SRC, src + '.jpg'), cv2.IMREAD_COLOR)
    h, w = bgr.shape[:2]
    if crop:
        x0, y0, x1, y1 = crop
        bgr = bgr[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)]
        h, w = bgr.shape[:2]
    k = WORK / max(h, w)
    small = cv2.resize(bgr, (int(w * k), int(h * k)), interpolation=cv2.INTER_AREA)
    sh, sw = small.shape[:2]
    f = small.astype(np.float32)

    # background reference from the outer border
    border = np.concatenate([f[:8].reshape(-1, 3), f[-8:].reshape(-1, 3), f[:, :8].reshape(-1, 3), f[:, -8:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    ch, lum = chroma(f)
    bch, blum = chroma(bg[None, None, :])
    dch = np.linalg.norm(ch - bch, axis=2)
    ratio = lum / blum[0, 0]
    # teal-ish and not brighter than the backdrop → backdrop or its soft shadow
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV).astype(np.float32)
    bh = np.median(np.concatenate([hsv[:8].reshape(-1, 3), hsv[-8:].reshape(-1, 3)]), axis=0)
    hue_ok = np.abs(hsv[..., 0] - bh[0]) <= 6
    s_ratio = hsv[..., 1] / max(bh[1], 1)
    v_ratio = hsv[..., 2] / max(bh[2], 1)
    shadowish = hue_ok & (s_ratio < 1.75) & (v_ratio > 0.38) & (v_ratio < 1.1)
    cand = ((dch < 0.045) & (ratio > 0.42) & (ratio < 1.12)) | shadowish

    # stop the flood at hard edges (object outlines), let it through soft shadows
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).astype(np.float32)
    gx = cv2.Sobel(lab, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(lab, cv2.CV_32F, 0, 1, ksize=3)
    grad = np.sqrt((gx ** 2 + gy ** 2).sum(axis=2))
    cand &= grad < 70

    n, lbl = cv2.connectedComponents(cand.astype(np.uint8), connectivity=4)
    edge_lbls = set(np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))) - {0}
    bgmask = np.isin(lbl, list(edge_lbls))

    # GrabCut refinement seeded by the flood result
    gc = np.full((sh, sw), cv2.GC_PR_FGD, np.uint8)
    sure_bg = cv2.erode(bgmask.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    sure_fg = cv2.erode((~bgmask).astype(np.uint8), np.ones((21, 21), np.uint8)) > 0
    gc[bgmask] = cv2.GC_PR_BGD
    gc[sure_bg] = cv2.GC_BGD
    gc[sure_fg] = cv2.GC_FGD
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(small, gc, None, bgd, fgd, 4, cv2.GC_INIT_WITH_MASK)
    fg = ((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD)).astype(np.uint8)

    # peel soft-shadow pixels still stuck to the outline
    for _ in range(14):
        ring = fg.astype(bool) & (cv2.dilate((1 - fg).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0)
        peel = ring & shadowish
        if not peel.any():
            break
        fg = (fg.astype(bool) & ~peel).astype(np.uint8)

    # keep the biggest blobs only (drop specks), fill holes that are not backdrop-coloured
    n, lbl, stats, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
    if n > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]
        keep = [i + 1 for i, a in enumerate(areas) if a >= max(areas) * 0.04]
        fg = np.isin(lbl, keep).astype(np.uint8)

    alpha = cv2.GaussianBlur(fg.astype(np.float32), (0, 0), 1.1)
    alpha = np.clip((alpha - 0.08) / 0.84, 0, 1)

    if name in ('jewelry', 'lid'):
        alpha, f = split_jewelry(name, small, f, fg, alpha, hsv, bh)

    # despill: remove backdrop colour mixed into soft edge pixels
    a3 = np.clip(alpha, 0.02, 1)[..., None]
    f = np.clip((f - (1 - a3) * bg) / a3, 0, 255)
    edge = (alpha > 0.02) & (alpha < 0.98)
    f[edge] = f[edge] * 0.85 + small.astype(np.float32)[edge] * 0.15

    # crop to content, centre on a square canvas
    ys, xs = np.where(alpha > 0.05)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgba = np.dstack([f, alpha * 255]).astype(np.uint8)[y0:y1, x0:x1]
    ch_, cw_ = rgba.shape[:2]
    pad = 0.04
    s = (SIZE * (1 - 2 * pad)) / max(ch_, cw_)
    rgba = cv2.resize(rgba, (max(1, int(cw_ * s)), max(1, int(ch_ * s))), interpolation=cv2.INTER_AREA)
    canvas = np.zeros((SIZE, SIZE, 4), np.uint8)
    oy, ox = (SIZE - rgba.shape[0]) // 2, (SIZE - rgba.shape[1]) // 2
    canvas[oy:oy + rgba.shape[0], ox:ox + rgba.shape[1]] = rgba
    cv2.imwrite(os.path.join(OUT, name + '.png'), canvas)
    return canvas


for name, (src, crop) in JOBS.items():
    c = cut(name, src, crop)
    print(name, 'ok', int((c[..., 3] > 128).mean() * 100), '% coverage')
