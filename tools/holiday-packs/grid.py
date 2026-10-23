# A gridded close-up of a picture, in CSS px of the picture scaled to 1517 x 712, to read edges.
# usage: PIC=<picture> python3 grid.py x1 y1 x2 y2 zoom out.png [grid step]
import cv2, numpy as np, sys, os
im = cv2.imread(os.environ['PIC']); H, W = im.shape[:2]
SX, SY = W / 1517, H / 712
X1, Y1, X2, Y2, k = [float(v) for v in sys.argv[1:6]]
out = sys.argv[6]; step = int(sys.argv[7]) if len(sys.argv) > 7 else 5
x1, y1, x2, y2 = [int(round(v)) for v in (X1 * SX, Y1 * SY, X2 * SX, Y2 * SY)]
kk = k / SX
c = cv2.resize(im[y1:y2, x1:x2], None, fx=kk, fy=kk, interpolation=cv2.INTER_CUBIC)
pad = 34
cv = np.full((c.shape[0] + pad, c.shape[1] + pad, 3), 255, np.uint8); cv[pad:, pad:] = c
for gx in range(int(np.ceil(X1 / step) * step), int(X2) + 1, step):
    p = int(round((gx * SX - x1) * kk)) + pad
    if p >= cv.shape[1]: continue
    major = gx % (step * 2) == 0
    cv[pad:, p] = (255, 0, 0) if major else (0, 200, 0)
    if major: cv2.putText(cv, str(gx), (p - 12, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)
for gy in range(int(np.ceil(Y1 / step) * step), int(Y2) + 1, step):
    p = int(round((gy * SY - y1) * kk)) + pad
    if p >= cv.shape[0]: continue
    major = gy % (step * 2) == 0
    cv[p, pad:] = (255, 0, 0) if major else (0, 200, 0)
    if major: cv2.putText(cv, str(gy), (1, p + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)
cv2.imwrite(out, cv)
