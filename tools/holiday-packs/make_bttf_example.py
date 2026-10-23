"""Back to the Future pack pieces from mockups/bttf/BTTFDONE.png (brushed steel cards with
dark readout windows, neon mode buttons): every word, number and control erased, the flux
capacitor window's steel bezel (its inner edge a perfect circle) cut as its own piece, the
picture's own icons and round buttons cut out for the live page, the rest cut into cards,
mode buttons, side menu and page.
Coordinates are CSS px of the picture scaled to 1517x712."""
import sys
import warnings
import cv2
import numpy as np

warnings.filterwarnings('ignore')
SRC, OUT = sys.argv[1], sys.argv[2]
orig = cv2.imread(SRC)
img = orig.copy()
H, W = img.shape[:2]
SX, SY = W / 1517, H / 712
S_ = (SX + SY) / 2
P = lambda x, y: (int(round(x * SX)), int(round(y * SY)))
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
X, Y = xx / SX, yy / SY
lumf = lambda im: 0.299 * im[..., 2].astype(float) + 0.587 * im[..., 1] + 0.114 * im[..., 0]
LOSSLESS = [cv2.IMWRITE_WEBP_QUALITY, 101]


def harmonic_core(src, mask, iters=250):
    known = (mask == 0).astype(np.float32)
    levels = []
    im, kn = src.astype(np.float32), known
    while min(im.shape[:2]) > 24:
        levels.append((im, kn))
        im = cv2.pyrDown(im * kn[..., None])
        kw = cv2.pyrDown(kn)
        im = np.where(kw[..., None] > 1e-3, im / np.maximum(kw[..., None], 1e-3), 0)
        kn = (kw > 0.05).astype(np.float32)
    if not levels:
        levels.append((src.astype(np.float32), known))
        im, kn = levels[0]
    guess = np.where(kn[..., None] > 0, im, im[kn > 0].mean(axis=0) if kn.sum() else 0)
    free_c = kn == 0
    for _ in range(600):
        avg = (np.roll(guess, 1, 0) + np.roll(guess, -1, 0) + np.roll(guess, 1, 1) + np.roll(guess, -1, 1)) / 4
        guess[free_c] = avg[free_c]
    for im_l, kn_l in reversed(levels):
        up = cv2.resize(guess, (im_l.shape[1], im_l.shape[0]), interpolation=cv2.INTER_LINEAR)
        x = np.where(kn_l[..., None] > 0, im_l, up)
        free = kn_l == 0
        for _ in range(iters if im_l is levels[0][0] else 150):
            avg = (np.roll(x, 1, 0) + np.roll(x, -1, 0) + np.roll(x, 1, 1) + np.roll(x, -1, 1)) / 4
            x[free] = avg[free]
        guess = x
    return guess


def harmonic_fill(src, mask, iters=250, grain_sd=2.6):
    guess = harmonic_core(src, mask, iters)
    rng = np.random.default_rng(7)
    grain = cv2.GaussianBlur(rng.normal(0, grain_sd, guess.shape[:2]).astype(np.float32), (0, 0), 0.8)
    out = src.astype(np.float32)
    m = mask > 0
    out[m] = guess[m] + grain[m][:, None]
    return np.clip(out, 0, 255).astype(np.uint8)


def box(x1, y1, x2, y2):
    return (X >= x1) & (X < x2) & (Y >= y1) & (Y < y2)


def disc(cx, cy, r):
    return (X - cx) ** 2 + (Y - cy) ** 2 < r * r


def grow(m, px):
    return cv2.dilate(m.astype(np.uint8), np.ones((px * 2 + 1,) * 2, np.uint8)) > 0


def lit(src, sel, lmin=120):
    """Words, numbers and icons: anything bright (white, neon, cyan, red) in sel."""
    b, g, r = [src[..., i].astype(float) for i in range(3)]
    return sel & ((lumf(src) > lmin) | ((r > 150) & (g < 110)) | ((b > 150) & (r < 120)))


def cfill(sel, iters=250):
    global img
    img = harmonic_fill(img, sel.astype(np.uint8) * 255, iters)


def rgba(name, part, alpha, q=LOSSLESS):
    cv2.imwrite(f'{OUT}/{name}.webp', np.dstack([part, (np.clip(alpha, 0, 1) * 255).astype(np.uint8)]), q)


def tile_rows(region, sx1, sx2, keep=None):
    """Brushed steel rebuilt row by row: each row of region takes the steel of the same row
    from a clean strip (x sx1..sx2), laid side by side and mirrored so it has no seams."""
    global img
    ys, xs = np.nonzero(region)
    y1_, y2_, x1_, x2_ = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    a, c = P(sx1, 0)[0], P(sx2, 0)[0]
    strip = img[y1_:y2_, a:c].astype(np.float32)
    period = np.concatenate([strip, strip[:, ::-1]], axis=1)
    n = (x2_ - x1_) // period.shape[1] + 2
    band = np.tile(period, (1, n, 1))
    off = (x1_ - a) % period.shape[1]
    band = band[:, off:off + (x2_ - x1_)]
    m = region[y1_:y2_, x1_:x2_].copy()
    if keep is not None:
        m &= ~keep[y1_:y2_, x1_:x2_]
    soft = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.2)[..., None]
    cur = img[y1_:y2_, x1_:x2_].astype(np.float32)
    img[y1_:y2_, x1_:x2_] = np.clip(band * soft + cur * (1 - soft), 0, 255).astype(np.uint8)


def copy_rows(dst_y1, dst_y2, src_y1, x1, x2):
    """Rows dst_y1..dst_y2 (x1..x2) take the rows starting at src_y1, faded in at top and bottom."""
    global img
    (a, b_), (c, e_) = P(x1, dst_y1), P(x2, dst_y2)
    sb = P(0, src_y1)[1]
    h = e_ - b_
    patch = img[sb:sb + h, a:c].astype(np.float32)
    al = np.ones((h, 1, 1), np.float32)
    r_ = max(1, int(4 * SY))
    for i in range(r_):
        al[i] = al[-1 - i] = (i + 1) / (r_ + 1)
    img[b_:e_, a:c] = (patch * al + img[b_:e_, a:c] * (1 - al)).astype(np.uint8)


L0 = lumf(orig)
chroma0 = np.max(orig, axis=2).astype(float) - np.min(orig, axis=2)


# ================================================================ the picture's own icons (cut before anything is erased)
def icon(name, x1, y1, x2, y2, bright=110):
    """A glowing icon on a dark ground as its own picture: see-through where the ground was."""
    sel = box(x1, y1, x2, y2)
    on = sel & (L0 > bright)
    ys, xs = np.nonzero(on)
    a, b_, c, e_ = xs.min() - 2, ys.min() - 2, xs.max() + 3, ys.max() + 3
    part = orig[b_:e_, a:c].astype(np.float32)
    Lp = lumf(part)
    lo, hi = np.percentile(Lp, 25), np.percentile(Lp, 97)
    al = np.clip((Lp - lo - 6) / max(hi - lo - 6, 1), 0, 1)
    al = al * al * (3 - 2 * al)
    bg = np.median(part[Lp <= lo], axis=0)
    fg = np.clip((part - (1 - al[..., None]) * bg) / np.maximum(al[..., None], 1e-3), 0, 255)
    fg[al < 0.02] = np.median(fg[al > 0.5], axis=0) if (al > 0.5).any() else 0
    rgba(f'ic_{name}', fg.astype(np.uint8), al)
    print('icon %-12s %5.1f x %4.1f at %6.1f %5.1f' % (name, (c - a) / SX, (e_ - b_) / SY, a / SX, b_ / SY))


for name, bx in {'power': (428, 64, 474, 106), 'brew': (632, 66, 678, 104), 'manual': (822, 64, 862, 106),
                 'steam': (1002, 64, 1046, 104), 'water': (1186, 64, 1222, 106), 'grind': (1374, 64, 1410, 104),
                 'flow': (334, 152, 368, 194), 'temp': (866, 152, 894, 194), 'pressure': (1200, 154, 1248, 192),
                 'tank': (330, 332, 360, 372),
                 'm_dashboard': (28, 142, 66, 172), 'm_pencil': (242, 142, 278, 172),
                 'm_profiles': (28, 190, 66, 216), 'm_history': (28, 226, 66, 256), 'm_analyzer': (28, 263, 66, 295),
                 'm_statistics': (28, 303, 66, 334), 'm_bluetooth': (28, 340, 66, 378), 'm_settings': (28, 383, 66, 415),
                 'm_system': (28, 423, 66, 452)}.items():
    icon(name, *bx)

# ================================================================ side menu: words, icons, NEW tags, credit line
side = np.zeros((H, W), bool)
for c in (203.5, 242.5, 281.5, 321.5, 361.5, 401.5, 440.5):
    side |= grow(lit(img, box(26, c - 18, 262, c + 17), 110), 3)
    side |= grow(box(150, c - 18, 262, c + 17) & (orig[..., 2].astype(int) > orig[..., 1].astype(int) + 30) & (orig[..., 2] > 70), 3)
side |= grow(lit(img, box(70, 620, 250, 668), 110) & (L0 > 110), 3)                  # credit line
img = cv2.inpaint(img, side.astype(np.uint8) * 255, 5, cv2.INPAINT_TELEA)
# the open page's glowing plank (Dashboard): kept apart with its word and icons erased;
# the panel below takes its place
PL = (16, 136, 290, 182)
(x1, y1), (x2, y2) = P(*PL[:2]), P(*PL[2:])
pill = orig[y1:y2, x1:x2].copy()
pm = cv2.dilate((lumf(pill) > 125).astype(np.uint8) * 255, np.ones((7, 7), np.uint8))       # the yellow word and white icons
inner_only = np.zeros_like(pm); (ia, ib), (ic, ie) = P(26, 144), P(282, 174)
inner_only[ib - y1:ie - y1, ia - x1:ic - x1] = 255
cv2.imwrite(f'{OUT}/menu_active.webp', cv2.inpaint(pill, pm & inner_only, 5, cv2.INPAINT_TELEA), [cv2.IMWRITE_WEBP_QUALITY, 90])
dy = y2 - y1
patch = img[y2:y2 + dy, x1:x2].astype(float)
al = np.ones((dy, x2 - x1, 1))
ramp = max(1, int(6 * SY))
for i in range(ramp):
    al[i] = al[-1 - i] = (i + 1) / (ramp + 1)
img[y1:y2, x1:x2] = (patch * al + img[y1:y2, x1:x2] * (1 - al)).astype(np.uint8)

# the menu panel: its brushed steel rebuilt from the clean strip right of the words
copy_rows(134, 190, 192, 20, 288)                               # the plank's rows first, from the rows below
tile_rows(box(22, 136, 286, 462), 244, 282)
# ================================================================ mode buttons: labels and icons
tabs = {'standby': (406, 48, 601, 121), 'brew': (605, 48, 787, 121), 'manual': (791, 48, 972, 121),
        'steam': (976, 48, 1155, 121), 'water': (1159, 48, 1338, 121), 'grind': (1342, 48, 1515, 121)}
GLASS = {'standby': (420, 59, 587, 109), 'brew': (619, 59, 773, 109), 'manual': (805, 61, 960, 109),
         'steam': (990, 61, 1140, 109), 'water': (1173, 61, 1322, 109), 'grind': (1355, 61, 1500, 109)}
tm = np.zeros((H, W), bool)
for (x1_, y1_, x2_, y2_) in GLASS.values():
    tm |= grow(box(x1_ + 6, y1_ + 6, x2_ - 6, y2_ - 6) & (L0 > 100), 4) & box(x1_ + 3, y1_ + 3, x2_ - 3, y2_ - 3)
cfill(tm)
tabs_src = img.copy()
# the dimmed look of a mode that is not on: the same button a little darker
dim = (tabs_src.astype(np.float32) * 0.55).astype(np.uint8)


# ================================================================ cards
def blend_in(reg, oy, ox):
    global img
    regd = grow(reg, 3)
    ys, xs = np.nonzero(regd)
    y1_, y2_, x1_, x2_ = ys.min() - 4, ys.max() + 5, xs.min() - 4, xs.max() + 5
    src_p = img[y1_ + oy:y2_ + oy, x1_ + ox:x2_ + ox].astype(np.float32)
    dst_p = img[y1_:y2_, x1_:x2_].astype(np.float32)
    mk = regd[y1_:y2_, x1_:x2_]
    corr = harmonic_core(dst_p - src_p, mk.astype(np.uint8), 300)
    res = np.clip(src_p + corr, 0, 255).astype(np.uint8)
    img[y1_:y2_, x1_:x2_][mk] = res[mk]
    return regd


def steel_fill(sel, zone):
    """Each blob of sel filled with the brushed steel from beside it (the grain runs sideways)."""
    n, lab, st, _ = cv2.connectedComponentsWithStats(sel.astype(np.uint8), connectivity=8)
    clean = zone & ~grow(sel, 3) & ~grow(lit(img, zone, 170), 2)
    for i in range(1, n):
        x, y, w, h, _a = st[i]
        reg = lab == i
        regd = grow(reg, 3)
        ring = regd & ~reg
        ys, xs = np.nonzero(regd)
        ry, rx = np.nonzero(ring)
        best = None
        for ox in [s * v for v in range(w + 8, w + int(300 * SX), 3) for s in (-1, 1)]:
            xs2 = xs + ox
            if xs2.min() < 0 or xs2.max() >= W or not clean[ys, xs2].all():
                continue
            diff = np.abs(img[ry, rx].astype(float) - img[ry, rx + ox].astype(float)).mean()
            if best is None or diff < best[0]:
                best = (diff, ox)
        if best is None:
            print('   steel blob at %d,%d (%dx%d): filled smoothly' % (x / SX, y / SY, w / SX, h / SY))
            cfill(reg)
            continue
        blend_in(reg, 0, best[1])


def window_fill(sel):
    """Readout windows: the glowing digits go, the dark glass stays (smooth, no grain)."""
    global img
    img = harmonic_fill(img, grow(sel, 2).astype(np.uint8) * 255, 300, grain_sd=1.2)


# the round buttons: one kept as the live buttons' face, its sign erased; all four erased
BTN = (361.5, 472.5, 24.5)
(a, b_), (c, e_) = P(BTN[0] - BTN[2] - 1, BTN[1] - BTN[2] - 1), P(BTN[0] + BTN[2] + 1, BTN[1] + BTN[2] + 1)
face = harmonic_fill(orig, grow(disc(BTN[0], BTN[1], 14) & (L0 > 110), 2).astype(np.uint8) * 255)[b_:e_, a:c]
m4 = np.zeros((H * 4, W * 4), np.uint8)
cv2.circle(m4, (int(round(BTN[0] * SX * 4)), int(round(BTN[1] * SY * 4))), int(round(BTN[2] * S_ * 4)), 255, -1)
a_b = cv2.resize(m4, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
rgba('btn', face, a_b[b_:e_, a:c], [cv2.IMWRITE_WEBP_QUALITY, 95])

# the water bar's neon stripes: a seamless strip (it repeats along the live bar)
(a, b_), (c, e_) = P(360, 371), P(560, 391)
strip = orig[b_:e_, a:c].astype(np.float32)
fw = int(30 * SX)
w_ = strip.shape[1] - fw
tile = strip[:, :w_].copy()
ramp_ = np.linspace(0, 1, fw)[None, :, None]
tile[:, :fw] = strip[:, w_:] * (1 - ramp_) + strip[:, :fw] * ramp_
cv2.imwrite(f'{OUT}/bar.webp', tile.astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 92])
print('bar tile %.1f x %.1f' % (w_ / SX, (e_ - b_) / SY))

# glowing digits in their dark windows: the digits and their red (or cyan) glow go
b0_, g0_, r0_ = [orig[..., i].astype(float) for i in range(3)]
glow_r = (r0_ > g0_ + 16) & (r0_ > 42) | (L0 > 90)
glow_c = (b0_ > r0_ + 16) & (b0_ > 50) | (L0 > 90)
win = np.zeros((H, W), bool)
for bx in [(352, 200, 458, 268), (668, 200, 815, 268), (878, 196, 1112, 276), (1236, 198, 1362, 276),
           (536, 440, 636, 492), (528, 506, 636, 556)]:
    win |= box(*bx) & glow_r
win |= box(702, 582, 810, 622) & glow_c
window_fill(win)
# words, units, captions and controls on the steel
steel = np.zeros((H, W), bool)
for bx in [(332, 150, 446, 196), (380, 262, 424, 294),                               # FLOW, g/s
           (862, 150, 956, 196), (1046, 234, 1134, 268),                             # TEMP, / 93°C
           (1198, 152, 1340, 196),                                                   # PRESSURE
           (328, 330, 482, 374), (744, 336, 816, 368),                               # WATER TANK, 100%
           (336, 420, 440, 448), (337, 500, 402, 524)]:                              # Temperature, Stop at
    steel |= grow(lit(img, box(*bx), 110), 3)
steel |= grow(box(676, 268, 808, 310) & ((L0 > 100) | (chroma0 > 80)), 2) & box(672, 264, 812, 313)   # Tare
steel |= grow(box(528, 556, 634, 588) & ((L0 > 60) | (chroma0 > 50)), 2)                    # the on/off pill
for bcx, bcy in ((361.5, 472.5), (776.5, 471.5), (364.5, 548.5), (777.5, 546.5)):
    steel |= disc(bcx, bcy, 26.5)
steel |= box(338, 586, 646, 618)                                                   # slider and its track
steel_fill(steel & ~box(1340, 150, 1510, 300), box(322, 145, 1510, 645))
# the controls card: its brushed steel rebuilt from the clean strip between the - buttons and the
# readouts; the slider rows first take the rows above them; the readout windows stay
copy_rows(582, 626, 542, 326, 698)
WINS = box(534, 438, 638, 494) | box(526, 504, 638, 558) | box(700, 580, 812, 624)
tile_rows(box(326, 418, 820, 636), 400, 526, keep=WINS)
win2 = np.zeros((H, W), bool)
b1_, g1_, r1_ = [img[..., i].astype(float) for i in range(3)]
for bx in [(536, 440, 636, 492), (528, 506, 636, 556)]:
    win2 |= box(*bx) & ((r1_ > g1_ + 16) & (r1_ > 42) | (lumf(img) > 90))
window_fill(win2)
# '/ 0.0 bar' sits on the gauge: only its cyan letters go
cfill(grow(lit(img, box(1348, 240, 1456, 276), 110) & ~(lumf(img) > 200) | (grow((orig[..., 0] > 150) & (orig[..., 2] < 120) & box(1348, 240, 1456, 276), 2)), 1))
# the water bar
cfill(box(330, 366, 816, 396))

# ================================================================ chart: the panel filled
panel = box(852, 339, 1498, 638)
panel_c = np.median(orig[box(1100, 480, 1300, 600) & (L0 < 60)], axis=0)
print('chart panel colour', panel_c.astype(int)[::-1])
tmp = img.copy()
tmp[~panel] = panel_c
filled = harmonic_fill(tmp, panel.astype(np.uint8) * 255, grain_sd=1.2)
img[panel] = filled[panel]

# ================================================================ the brew button's decoration: the flux capacitor's steel bezel
CX, CY, R_h = 571.5, 235.5, 70.6          # the window's inner edge (fit spread 0.6)
ROUT = 87.0                               # the bezel's outer edge, bolts included
d = np.sqrt((X - CX) ** 2 + (Y - CY) ** 2)
ringband = np.clip(d - R_h + 0.5, 0, 1) * np.clip(ROUT + 0.5 - d, 0, 1)
alpha = ringband.astype(np.float32)
HALF = 100
(a1, b1), (a2, b2) = P(CX - HALF, CY - HALF), P(CX + HALF, CY + HALF)
rgba('ring', img[b1:b2, a1:a2], alpha[b1:b2, a1:a2], [cv2.IMWRITE_WEBP_QUALITY, 92])
k_ = 50 / R_h
print('rim: left/top %.2f%%  size %.2f%%' % (50 - HALF * k_, 2 * HALF * k_))
print('button centre in the picture %.1f %.1f, hole diameter %.1f' % (CX, CY, 2 * R_h))
cfill(d < ROUT + 0.5)


# ================================================================ pieces
def cut(name, src, x1, y1, x2, y2, margin=10, fade=5):
    (a, b_), (c, e_) = P(max(0, x1 - margin), max(0, y1 - margin)), P(min(1517, x2 + margin), min(712, y2 + margin))
    part = src[b_:e_, a:c]
    if margin:
        h, w = part.shape[:2]
        al_ = np.ones((h, w), np.float32)
        f = max(1, int(fade * SX))
        for i in range(f):
            v = (i + 1) / (f + 1)
            al_[i, :] = np.minimum(al_[i, :], v); al_[-1 - i, :] = np.minimum(al_[-1 - i, :], v)
            al_[:, i] = np.minimum(al_[:, i], v); al_[:, -1 - i] = np.minimum(al_[:, -1 - i], v)
        part = np.dstack([part, (al_ * 255).astype(np.uint8)])
    cv2.imwrite(f'{OUT}/{name}.webp', part, [cv2.IMWRITE_WEBP_QUALITY, 88])


cards = {'flow': (320, 140, 828, 322), 'temp': (843, 140, 1168, 322), 'pressure': (1180, 140, 1512, 322),
         'tank': (320, 326, 828, 402), 'controls': (320, 408, 828, 645), 'chart': (840, 328, 1512, 648)}
for kname, bx in cards.items():
    cut(f'card_{kname}', img, *bx)
for kname, bx in tabs.items():
    cut(f'tab_{kname}', tabs_src, *bx, margin=4, fade=2)
    cut(f'tab_{kname}_dim', dim, *bx, margin=4, fade=2)
cut('side', img, 0, 0, 290, 712, margin=0)
m = np.zeros((H, W), bool)
for bx in list(cards.values()) + list(tabs.values()):
    m |= box(bx[0] - 4, bx[1] - 4, bx[2] + 4, bx[3] + 4)
page = harmonic_fill(img, m.astype(np.uint8) * 255, iters=150)
cut('page', page, 290, 0, 1517, 712, margin=0)
cv2.imwrite(f'{OUT}/../check_clean.png', cv2.resize(img, (1373, 644), interpolation=cv2.INTER_AREA))
print('pieces written')
