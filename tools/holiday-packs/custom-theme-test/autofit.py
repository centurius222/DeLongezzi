"""Auto-fit test: finds a picture's windows, compares them with the master (Western, western1.png),
and prints the shifts (CSS px of the picture at 1517 x 712). usage: autofit.py <picture> [...]"""
import cv2, numpy as np, sys, json, os
G = os.path.join(os.environ.get('MOCKUPS', 'mockups'), 'gpt') + '/'
def blobs(path):
    c = cv2.resize(cv2.imread(path), (1517, 712), interpolation=cv2.INTER_AREA)
    L = 0.299 * c[..., 2] + 0.587 * c[..., 1] + 0.114 * c[..., 0]
    m = ((L < 38) * 255).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=4)
    return [tuple(int(v) for v in st[i][:4]) for i in range(1, n) if st[i][4] > 1500 and st[i][1] > 140]
REF = {'tab1': (343, 158, 529, 208), 'flow': (358, 281, 494, 344), 'weight': (683, 276, 817, 343),
       'temp': (878, 283, 1161, 359),
       'ctl1': (537, 485, 666, 527), 'ctl2': (537, 540, 664, 584), 'chart': (862, 392, 1496, 637),
       'clock': (932, 653, 1321, 700)}
def match(bs, box, tol=45):
    x1, y1, x2, y2 = box; cx, cy, w, h = (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1
    best = None
    for b in bs:
        bw, bh = b[2], b[3]
        if not (0.6 * w < bw < 1.5 * w and 0.5 * h < bh < 1.8 * h): continue
        dx, dy = b[0] + bw / 2 - cx, b[1] + bh / 2 - cy
        if abs(dx) > tol or abs(dy) > tol: continue
        if best is None or abs(dx) + abs(dy) < abs(best[0]) + abs(best[1]): best = (dx, dy)
    return best
MASTER = {k: v for k, v in REF.items()}
def fit(path):
    bs = blobs(path); d = {k: match(bs, v) for k, v in MASTER.items()}
    med = lambda ks, i: float(np.median([d[k][i] for k in ks if d[k]])) if any(d[k] for k in ks) else 0.0
    return {'found': {k: (None if v is None else [round(v[0], 1), round(v[1], 1)]) for k, v in d.items()},
            'x': med(list(MASTER), 0), 'tabsY': med(['tab1'], 1), 'topY': med(['flow', 'weight', 'temp'], 1),
            'tankY': (med(['flow', 'weight', 'temp'], 1) + med(['ctl1', 'ctl2'], 1)) / 2,  # tank: between the two (its window merges with its card)
            'controlsY': med(['ctl1', 'ctl2'], 1), 'chartY': med(['chart'], 1),
            'clock': d['clock'] is not None, 'clockY': med(['clock'], 1)}
if __name__ == '__main__':
    for f in sys.argv[1:]:
        print(f, json.dumps(fit(G + f)))


# ---------------------------------------------------------------- more fit points: brew circle, icons, menu panel, credit plate
def _img(path):
    return cv2.resize(cv2.imread(path), (1517, 712), interpolation=cv2.INTER_AREA)

def brew_circle(c):
    g = cv2.cvtColor(c, cv2.COLOR_BGR2GRAY)[200:420, 480:720]
    cs = cv2.HoughCircles(cv2.GaussianBlur(g, (5, 5), 1.5), cv2.HOUGH_GRADIENT, dp=1, minDist=200,
                          param1=90, param2=30, minRadius=60, maxRadius=95)
    if cs is None: return None
    x, y, r = cs[0][0]
    return [float(x) + 480, float(y) + 200, float(r)]

def icon_in(c, x1, y1, x2, y2):
    """The biggest bright (line-art) blob in a box: an icon; [x1, y1, x2, y2] or None."""
    x1, y1, x2, y2 = [int(round(v)) for v in (x1, y1, x2, y2)]
    sub = c[max(0, y1):y2, max(0, x1):x2]
    if sub.size == 0: return None
    L = 0.299 * sub[..., 2] + 0.587 * sub[..., 1] + 0.114 * sub[..., 0]
    m = cv2.dilate((L > 140).astype(np.uint8), np.ones((3, 3), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    h, w = m.shape
    cand = [st[i] for i in range(1, n) if st[i][4] > 40 and st[i][2] < 60 and st[i][3] < 60
            and st[i][2] >= 12 and st[i][3] >= 12 and st[i][0] > 0 and st[i][1] > 0 and st[i][0] + st[i][2] < w and st[i][1] + st[i][3] < h]   # whole, not cut by the box
    if not cand: return None
    b = max(cand, key=lambda s: s[4])
    return [x1 + int(b[0]), y1 + int(b[1]), x1 + int(b[0] + b[2]), y1 + int(b[1] + b[3])]

PLATE = [None]
def panels(bs):
    menu = [b for b in bs if b[0] < 60 and 200 < b[2] < 320 and 250 < b[3] < 420]
    menu = max(menu, key=lambda b: b[2] * b[3]) if menu else None
    credit = None
    if menu:
        cands = [b for b in bs if 5 < b[0] < 70 and b[2] > 180 and 45 < b[3] < 120 and menu[1] + menu[3] - 5 < b[1] < menu[1] + menu[3] + 60]
        credit = min(cands, key=lambda b: b[1]) if cands else None
    plate = None
    if menu:
        pl = [b for b in bs if b[0] < 70 and b[2] > 200 and 25 < b[3] < 70 and b[1] + b[3] <= menu[1] + 8 and b[1] >= menu[1] - 90]
        plate = max(pl, key=lambda b: b[1]) if pl else None
    PLATE[0] = [plate[0], plate[1], plate[0] + plate[2], plate[1] + plate[3]] if plate else None
    return ([menu[0], menu[1], menu[0] + menu[2], menu[1] + menu[3]] if menu else None,
            [credit[0], credit[1], credit[0] + credit[2], credit[1] + credit[3]] if credit else None)

def fit_all(path):
    f = fit(path)
    c = _img(path); bs = blobs(path)
    f['brew'] = brew_circle(c)
    sx, top, ctl, tank = f['x'], f['topY'], f['controlsY'], f['tankY']
    f['icons'] = {
        'flow': icon_in(c, 335 + sx, 222 + top, 420 + sx, 300 + top),
        'temp': icon_in(c, 858 + sx, 222 + top, 940 + sx, 305 + top),
        'pressure': icon_in(c, 1196 + sx, 222 + top, 1275 + sx, 305 + top),
        'tank': icon_in(c, 336 + sx, 380 + tank, 395 + sx, 470 + tank),
        'controls': icon_in(c, 336 + sx, 460 + ctl, 395 + sx, 550 + ctl),
    }
    f['menu'], f['creditPlate'] = panels(bs)
    if f['icons']['tank']:   # the tank card: from its icon (its window merges with the card)
        f['tankY'] = (f['icons']['tank'][1] + f['icons']['tank'][3]) / 2 - 422.5
    f['dashPlate'] = PLATE[0]
    return f

def labels_printed(path, icons):
    """True when the picture already prints the words next to its icons (FLOW, TEMP ...):
    bright strokes spread across the space right of at least two icons."""
    c = _img(path); hits = 0
    for k in ('flow', 'temp', 'pressure', 'tank'):
        ic = icons.get(k)
        if not ic: continue
        x1, y1, x2, y2 = ic[2] + 4, ic[1], ic[2] + 110, ic[3]
        sub = c[y1:y2, x1:x2]
        L = 0.299 * sub[..., 2] + 0.587 * sub[..., 1] + 0.114 * sub[..., 0]
        cols = (L > 150).any(axis=0)
        if cols.sum() > 40: hits += 1          # letters across 40+ px: a word
    return hits >= 2
