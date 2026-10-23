"""Every control's ink box (card-local CSS px) against the card's edges, the two windows'
rims and each other: at least 1 px clear everywhere; the values inside their windows.
usage: python3 check_gaps.py <out dir of ink.js> '<the JSON line ink.js printed>'
The FRAME and window boxes below are the Western controls card's (card-local px at 520 x 184):
measure your own card picture with grid.py and put its edges in."""
import cv2, numpy as np, json, sys, glob, os
D = sys.argv[1]; card = json.loads(sys.argv[2])['card']
CW, CH = card[2], card[3]
fx = lambda x: (x + 10) * (CW + 20) / 540 - 10      # the card picture stretches with the card
fy = lambda y: (y + 10) * (CH + 20) / 204 - 10
sc = lambda b: (fx(b[0]), fy(b[1]), fx(b[2]), fy(b[3]))
FRAME = (17.5, 12.5, 502.0, 170.0)                    # the copper frame's inner edge
W1 = (211.0, 20.0, 343.0, 67.5)                        # window rims (outer), and inside them
W1i = (214.0, 23.0, 340.0, 64.5)
W2 = (216.0, 74.0, 338.0, 120.0)
W2i = (219.0, 77.0, 335.0, 117.0)
FRAME, W1, W1i, W2, W2i = map(sc, (FRAME, W1, W1i, W2, W2i))
print('card %.0f x %.0f' % (CW, CH))
box = {}
for k in ['cap1', 'dec1', 'inc1', 'val1', 'cap2', 'dec2', 'inc2', 'val2', 'pill', 'range', 'bar']:
    a = cv2.imread(f'{D}/ink_{k}_a.png').astype(int); b = cv2.imread(f'{D}/ink_{k}_b.png').astype(int)
    m = np.abs(a - b).max(2) > 60
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)) > 0
    ys, xs = np.nonzero(m)
    if not len(xs): print(k, 'not visible'); continue
    box[k] = (xs.min() - 12, ys.min() - 12, xs.max() + 1 - 12, ys.max() + 1 - 12)
bad = 0
def gap(a, b):   # clear space between two boxes (negative = overlap)
    return max(b[0] - a[2], a[0] - b[2], b[1] - a[3], a[1] - b[3])
for k, v in box.items():
    msg = []
    if v[0] - FRAME[0] < 1 or FRAME[2] - v[2] < 1 or v[1] - FRAME[1] < 1 or FRAME[3] - v[3] < 1: msg.append('touches frame')
    if k == 'val1':
        if v[0] - W1i[0] < 1 or W1i[2] - v[2] < 1 or v[1] - W1i[1] < 1 or W1i[3] - v[3] < 1: msg.append('not inside window 1')
    elif k == 'val2':
        if v[0] - W2i[0] < 1 or W2i[2] - v[2] < 1 or v[1] - W2i[1] < 1 or W2i[3] - v[3] < 1: msg.append('not inside window 2')
    else:
        for n, w in (('window 1', W1), ('window 2', W2)):
            if gap(v, w) < 1: msg.append('touches ' + n)
    for k2, v2 in box.items():
        if k2 != k and gap(v, v2) < 1: msg.append('touches ' + k2)
    bad += bool(msg)
    print('%-6s x %6.1f-%6.1f  y %6.1f-%6.1f  %s' % (k, v[0], v[2], v[1], v[3], ', '.join(msg) or 'ok'))
print('ALL CLEAR' if not bad else '%d problem(s)' % bad)
