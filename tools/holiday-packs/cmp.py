import cv2, numpy as np, sys
# How far each live word in a replica screenshot is from the same word in the picture (both 1517 x 712).
# usage: python3 cmp.py <picture scaled to 1517x712>.png <replica screenshot>.png   (edit the boxes B below)
pic = cv2.imread(sys.argv[1]).astype(int)
rep = cv2.imread(sys.argv[2]).astype(int)
B = {
 'FLOW': (368, 160, 430, 186), 'flow 0.0': (352, 200, 460, 268), 'g/s': (378, 262, 430, 296), '-4.7': (668, 200, 815, 268),
 'Tare': (720, 278, 800, 304),
 'TEMP': (896, 160, 960, 186), '27.2': (878, 198, 1046, 270), '/93C': (1046, 234, 1134, 268),
 'PRESSURE': (1246, 160, 1345, 186), 'pres 0.0': (1236, 200, 1345, 272), '/0.0bar': (1348, 240, 1456, 276),
 'WATER TANK': (366, 338, 482, 364), '100%': (744, 336, 818, 368), 'Temperature': (336, 420, 442, 448),
 '93C': (536, 440, 636, 492), 'Stop at': (336, 500, 404, 524), '36g': (528, 506, 636, 556), 'pill': (536, 557, 628, 580), '9.6bar': (706, 584, 810, 620),
 'STANDBY': (480, 70, 596, 100), 'BREW': (680, 70, 760, 100), 'MANUAL': (860, 70, 965, 100), 'STEAM': (1045, 70, 1135, 100),
 'WATER': (1225, 70, 1318, 100), 'GRIND': (1405, 70, 1500, 100),
 'Profiles': (70, 192, 200, 216), 'System': (70, 430, 250, 452), 'Dashboard': (70, 148, 230, 172), 'credit1': (70, 620, 260, 642), 'credit2': (70, 643, 260, 666),
}
def ink(im, bx):
    x1, y1, x2, y2 = bx
    p = im[y1:y2, x1:x2]; b, g, r = p[..., 0], p[..., 1], p[..., 2]
    L = 0.299 * r + 0.587 * g + 0.114 * b
    m = (L > 150) | ((r > 200) & (g < 120)) | ((b > 200) & (r < 120)) | ((g > 200) & (r < 150))
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)) > 0
    ys, xs = np.nonzero(m)
    if len(xs) < 6: return None
    return (x1 + xs.min(), y1 + ys.min(), x1 + xs.max() + 1, y1 + ys.max() + 1)
print('item          dLeft dTop dRight dBottom   picture box')
for k, bx in B.items():
    a, b_ = ink(pic, bx), ink(rep, bx)
    if a is None or b_ is None: print(k, a, b_); continue
    print('%-12s %5d %4d %6d %7d   %s' % (k, b_[0] - a[0], b_[1] - a[1], b_[2] - a[2], b_[3] - a[3], tuple(int(v) for v in a)))
