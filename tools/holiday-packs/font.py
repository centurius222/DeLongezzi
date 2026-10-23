"""Time Circuits font plus the shapes it lacks, drawn in its own style (slanted segments):
'-' (its middle segment), '.', ':' and the degree sign."""
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
f = TTFont('BTTFTimeCircuitsUPDATEDAGAINIMSORRY.ttf')
glyf, hmtx, cmap = f['glyf'], f['hmtx'], f['cmap']
SL = 162 / 680                      # the segments' slant (x per y)
def poly(pen, pts):
    pen.moveTo(pts[0])
    for p in pts[1:]: pen.lineTo(p)
    pen.closePath()
def box(pen, x, y, w, h):            # a slanted box
    poly(pen, [(round(x + y * SL), y), (round(x + w + y * SL), y), (round(x + w + (y + h) * SL), y + h), (round(x + (y + h) * SL), y + h)])
def add(name, code, adv, draw):
    pen = TTGlyphPen(None); draw(pen)
    g = pen.glyph(); g.recalcBounds(glyf)
    glyf[name] = g
    hmtx[name] = (adv, g.xMin)
    f.setGlyphOrder(f.getGlyphOrder() + [name]) if name not in f.getGlyphOrder() else None
    for t in cmap.tables:
        if t.isUnicode(): t.cmap[code] = name
# '-': the 8's middle segment
e8 = glyf['eight']; co = e8.getCoordinates(glyf)[0]; ends = e8.endPtsOfContours
mid = list(co[ends[1] + 1:ends[2] + 1])
add('hyphen', 0x2D, 551, lambda p: poly(p, [tuple(map(int, q)) for q in mid]))
add('minus', 0x2212, 551, lambda p: poly(p, [tuple(map(int, q)) for q in mid]))
add('period', 0x2E, 190, lambda p: box(p, 20, 3, 78, 75))
add('colon', 0x3A, 230, lambda p: (box(p, 40, 150, 78, 75), box(p, 40, 470, 78, 75)))
def deg(p):
    x, y, w, h, t = 40, 470, 190, 244, 52
    box(p, x, y + h - t, w, t); box(p, x, y, w, t)            # top and bottom
    box(p, x, y + t, t, h - 2 * t); box(p, x + w - t, y + t, t, h - 2 * t)
add('degree', 0xB0, 300, deg)
f['maxp'].numGlyphs = len(f.getGlyphOrder())
for rec in f['name'].names:
    if rec.nameID in (1, 4, 6): rec.string = 'BTTF Time Circuits DeLongezzi'
f.save('timecircuits.ttf')
print('saved', sorted(chr(c) for c in f.getBestCmap()))
