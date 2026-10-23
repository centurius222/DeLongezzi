# Fits a circle to a ring's inner edge (the brew button's decoration): prints its centre and radius.
# usage: python3 ringfit.py <picture>   (set the first guess cx, cy and the radius range below)
import sys, cv2, numpy as np, math
img = cv2.imread(sys.argv[1]); H, W = img.shape[:2]; SX, SY = W / 1517, H / 712
Lf = (0.299 * img[..., 2] + 0.587 * img[..., 1] + 0.114 * img[..., 0]).astype(np.float32)
def edge(CX, CY, thr):
    rs = np.arange(50, 90, 0.25); ks = np.arange(0, 360, 1.0)
    T_, Rr = np.meshgrid(np.radians(ks), rs, indexing='ij')
    Lp = cv2.remap(Lf, ((CX + np.cos(T_) * Rr) * SX).astype(np.float32), ((CY + np.sin(T_) * Rr) * SY).astype(np.float32), cv2.INTER_LINEAR)
    e = np.full(360, np.nan)
    for k in range(360):
        l = Lp[k]; up = np.where(l > thr)[0]
        # the last dark run before the steel: first bright after a dark stretch past r=60
        dark = np.where(l < 40)[0]
        dark = dark[rs[dark] > 58] if len(dark) else dark
        if not len(dark): continue
        j = dark[-1] if False else dark[0]
        u = np.where(l[j:] > thr)[0]
        if len(u): e[k] = rs[j + u[0]]
    return e
CX, CY = 572.0, 236.0
for thr in (90, 120):
    cx, cy = CX, CY
    for it in range(6):
        e = edge(cx, cy, thr); ok = ~np.isnan(e)
        ks = np.radians(np.arange(360))[ok]; r_ = e[ok]
        xs = cx + np.cos(ks) * r_; ys = cy + np.sin(ks) * r_
        A = np.c_[2 * xs, 2 * ys, np.ones(len(xs))]; bb = xs ** 2 + ys ** 2
        sol, *_ = np.linalg.lstsq(A, bb, rcond=None)
        for _ in range(4):
            R = math.sqrt(sol[2] + sol[0] ** 2 + sol[1] ** 2); res = np.hypot(xs - sol[0], ys - sol[1]) - R
            good = np.abs(res) < max(1.0, 2 * np.std(res))
            sol, *_ = np.linalg.lstsq(A[good], bb[good], rcond=None)
        cx, cy = sol[0], sol[1]; R = math.sqrt(sol[2] + cx ** 2 + cy ** 2)
    e = edge(cx, cy, thr)
    print('thr %d centre %.2f %.2f R %.2f used %d/%d sd %.2f' % (thr, cx, cy, R, good.sum(), ok.sum(), np.std(res[good])))
    print('  ', ' '.join('%d:%.1f' % (k, np.nanmedian(e[k:k + 30])) for k in range(0, 360, 30)))
