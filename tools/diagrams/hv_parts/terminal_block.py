"""The machine's stock 3-way terminal block (white nylon, two screws per way), drawn like the boiler."""
import sys

out = sys.argv[1]
W, H = 1240, 560
SANS = "'DejaVu Sans', 'Segoe UI', Arial, sans-serif"
INK, SUB, NYL = '#1f2328', '#59636e', '#a39a86'
el = []
def add(s): el.append(s)

def text(x, y, s, size=13, weight='400', anchor='start', fill=INK):
    add(f'<text x="{x}" y="{y}" font-family="{SANS}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}" fill="{fill}">{s}</text>')

DEFS = '''<defs>
<linearGradient id="nylonV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdfcf8"/><stop offset="0.55" stop-color="#efebe1"/><stop offset="1" stop-color="#d9d2c1"/></linearGradient>
<linearGradient id="nylonH" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d9d2c1"/><stop offset="0.3" stop-color="#f7f4ec"/><stop offset="1" stop-color="#d4ccba"/></linearGradient>
<radialGradient id="nylonR" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#eee9de"/><stop offset="1" stop-color="#cfc7b4"/></radialGradient>
<radialGradient id="brassR" cx="0.4" cy="0.35" r="0.75"><stop offset="0" stop-color="#f6dc85"/><stop offset="0.6" stop-color="#cf9c33"/><stop offset="1" stop-color="#7d520c"/></radialGradient>
<linearGradient id="brassV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3d679"/><stop offset="0.5" stop-color="#d4a640"/><stop offset="1" stop-color="#8a5c0e"/></linearGradient>
<radialGradient id="chrome" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#c9ced4"/><stop offset="1" stop-color="#6e7781"/></radialGradient>
</defs>'''

def screw(x, y, angle):
    add(f'<circle cx="{x}" cy="{y}" r="25" fill="#d8d0bf"/>')                                   # tower foot
    add(f'<circle cx="{x}" cy="{y}" r="22" fill="url(#nylonR)" stroke="{NYL}" stroke-width="1.4"/>')
    add(f'<circle cx="{x}" cy="{y}" r="14.5" fill="url(#brassR)" stroke="#7a5410" stroke-width="1.2"/>')
    add(f'<circle cx="{x}" cy="{y}" r="11" fill="url(#chrome)" stroke="#6e7781" stroke-width="1.2"/>')
    add(f'<g transform="rotate({angle} {x} {y})"><rect x="{x - 9}" y="{y - 1.8}" width="18" height="3.6" rx="1.2" fill="#4a5059"/>'
        f'<rect x="{x - 9}" y="{y - 1.8}" width="18" height="1.2" fill="#2b2f36"/></g>')
    add(f'<ellipse cx="{x - 4}" cy="{y - 5}" rx="3.5" ry="2" fill="#ffffff" opacity="0.75"/>')

def wire_entry(x, y, side):
    # brass tube end showing at the side of the block, where the wire goes in
    x0 = x - 6 if side == 'L' else x - 10
    add(f'<rect x="{x0}" y="{y - 12}" width="16" height="24" rx="4" fill="url(#brassV)" stroke="#7a5410" stroke-width="1.2"/>')
    add(f'<rect x="{x0 + (2 if side == "L" else 6)}" y="{y - 6}" width="8" height="12" rx="3" fill="#3a2c10"/>')

def terminal_block():
    cells = (('L', 0, (18, -32)), ('G', 84, (-40, 12)), ('N', 168, (28, -8)))
    for y0 in (70, 154):                                             # webs that join the ways
        add(f'<rect x="58" y="{y0 - 8}" width="64" height="30" rx="6" fill="url(#nylonH)" stroke="{NYL}" stroke-width="1.4"/>')
    for name, y0, angles in cells:
        yc = y0 + 35
        add(f'<rect x="0" y="{y0}" width="180" height="70" rx="13" fill="url(#nylonV)" stroke="{NYL}" stroke-width="1.6"/>')
        add(f'<rect x="8" y="{yc - 8}" width="164" height="16" rx="5" fill="#cfa84a" opacity="0.26"/>')   # brass tube inside
        add(f'<rect x="6" y="{y0 + 4}" width="168" height="9" rx="4.5" fill="#ffffff" opacity="0.6"/>')
        add(f'<rect x="76" y="{yc - 12}" width="28" height="24" rx="6" fill="#e6e0d2" stroke="#cdc5b2" stroke-width="1"/>')
        screw(46, yc, angles[0]); screw(134, yc, angles[1])
        wire_entry(0, yc, 'L'); wire_entry(180, yc, 'R')
        text(-34, yc + 6, name, 17, '700', 'middle', INK)
    # mounting hole in the web between G and N
    add(f'<circle cx="90" cy="161" r="10" fill="#efe9dd" stroke="{NYL}" stroke-width="1.3"/>')
    add('<circle cx="90" cy="161" r="6" fill="#2b2d31"/><circle cx="88" cy="159" r="1.6" fill="#6e7781"/>')

def card(x, y, w, h, title, sub):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="#fbfcfd" stroke="#d1d9e0" stroke-width="1.5"/>')
    text(x + 22, y + 34, title, 17, '700')
    text(x + 22, y + 56, sub, 13, '400', 'start', SUB)

card(20, 20, 1200, 520, 'TERMINAL BLOCK', 'stock, bottom of the machine · white nylon, 3 ways (line, ground, neutral), 2 screws each')
add('<g transform="translate(500 110) scale(1.6)">'); terminal_block(); add('</g>')

svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">' + DEFS +
       f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + ''.join(el) + '</svg>')
open(out, 'w').write(svg)
print('ok', len(svg))
