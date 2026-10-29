"""High-voltage parts of the DeLonghi ECP mod, drawn as close to the real parts as possible (no wiring)."""
import os, sys

out = sys.argv[1]
W, H = 2000, 1960
SANS = "'DejaVu Sans', 'Segoe UI', Arial, sans-serif"
MONO = "'DejaVu Sans Mono', Consolas, Menlo, monospace"
INK, SUB = '#1f2328', '#59636e'
el = []
def add(s): el.append(s)

def text(x, y, s, size=13, weight='400', anchor='start', fill=INK, font=SANS, rot=None, italic=False, spacing=None):
    t = f' transform="rotate({rot} {x} {y})"' if rot is not None else ''
    st = ' font-style="italic"' if italic else ''
    ls = f' letter-spacing="{spacing}"' if spacing else ''
    add(f'<text x="{x}" y="{y}" font-family="{font}" font-size="{size}" font-weight="{weight}" '
        f'text-anchor="{anchor}" fill="{fill}"{t}{st}{ls}>{s}</text>')

def g(x, y, s=1.0):
    add(f'<g transform="translate({x} {y}) scale({s})">')

def eg():
    add('</g>')

DEFS = '''<defs>
<linearGradient id="alu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f6f8"/><stop offset="0.5" stop-color="#d2d7dc"/><stop offset="1" stop-color="#a3abb4"/></linearGradient>
<linearGradient id="aluh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a9b1ba"/><stop offset="0.4" stop-color="#eef1f4"/><stop offset="1" stop-color="#9aa3ad"/></linearGradient>
<linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.33" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.12"/></linearGradient>
<linearGradient id="steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8d96a0"/><stop offset="0.45" stop-color="#f1f3f5"/><stop offset="1" stop-color="#7d8590"/></linearGradient>
<linearGradient id="steelv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f3f5"/><stop offset="0.5" stop-color="#c6ccd3"/><stop offset="1" stop-color="#8d96a0"/></linearGradient>
<radialGradient id="chrome" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#c9ced4"/><stop offset="1" stop-color="#6e7781"/></radialGradient>
<linearGradient id="brass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9c6b12"/><stop offset="0.45" stop-color="#f3cf6b"/><stop offset="1" stop-color="#8a5c0e"/></linearGradient>
<linearGradient id="brassv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6d98a"/><stop offset="0.5" stop-color="#d9a93a"/><stop offset="1" stop-color="#9c6b12"/></linearGradient>
<linearGradient id="copper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0b27a"/><stop offset="0.5" stop-color="#c9773a"/><stop offset="1" stop-color="#8a4b1c"/></linearGradient>
<linearGradient id="rubber" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4f57"/><stop offset="0.35" stop-color="#2a2d32"/><stop offset="1" stop-color="#121417"/></linearGradient>
<linearGradient id="nylon" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e6e2d8"/></linearGradient>
<linearGradient id="maroon" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a1473a"/><stop offset="1" stop-color="#5e2017"/></linearGradient>
<linearGradient id="bakelite" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a6a4a"/><stop offset="1" stop-color="#5b412a"/></linearGradient>
<linearGradient id="ssr" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d8d2c4"/><stop offset="0.5" stop-color="#ebe6dc"/><stop offset="1" stop-color="#cbc4b4"/></linearGradient>
<linearGradient id="ssrbay" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bdb5a5"/><stop offset="1" stop-color="#a39a88"/></linearGradient>
<linearGradient id="pcb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2466b3"/><stop offset="1" stop-color="#174b8c"/></linearGradient>
<linearGradient id="term" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2b72d6"/><stop offset="0.5" stop-color="#4a92f2"/><stop offset="1" stop-color="#1f5bb3"/></linearGradient>
<linearGradient id="ytape" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f8de62"/><stop offset="1" stop-color="#cfa520"/></linearGradient>
<linearGradient id="bobbin" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1f4fb8"/><stop offset="0.45" stop-color="#4d82ef"/><stop offset="1" stop-color="#1a43a0"/></linearGradient>
<linearGradient id="ecapG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3fbf74"/><stop offset="1" stop-color="#17643a"/></linearGradient>
<linearGradient id="ecapK" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a616b"/><stop offset="1" stop-color="#14171b"/></linearGradient>
<linearGradient id="xcap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ee5b4f"/><stop offset="1" stop-color="#a8261d"/></linearGradient>
<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6dc85"/><stop offset="1" stop-color="#b08a1e"/></linearGradient>
<linearGradient id="grip" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7d8590"/><stop offset="0.5" stop-color="#f6f8fa"/><stop offset="1" stop-color="#7d8590"/></linearGradient>
<linearGradient id="pumpbody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c0503a"/><stop offset="0.5" stop-color="#8f2b1c"/><stop offset="1" stop-color="#5e1a10"/></linearGradient>
<linearGradient id="ceramic" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e3e0d8"/></linearGradient>
<radialGradient id="lensR" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#ffd2c9"/><stop offset="0.35" stop-color="#ff4a2e"/><stop offset="1" stop-color="#8f1408"/></radialGradient>
<radialGradient id="lensG" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#d6ffd9"/><stop offset="0.35" stop-color="#2fd35a"/><stop offset="1" stop-color="#0d6b26"/></radialGradient>
<radialGradient id="ledoff" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#8b939e"/><stop offset="0.5" stop-color="#3a3f45"/><stop offset="1" stop-color="#15171a"/></radialGradient>
<pattern id="weave" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="6" height="6" fill="#f3efe4"/><line x1="0" y1="0" x2="0" y2="6" stroke="#ddd5c2" stroke-width="2"/></pattern>
</defs>'''

# ------------------------------------------------------------------ approved parts, kept exactly as drawn in
# boiler_side.py (boiler with thermostats) and terminal_block.py (terminal block); their gradient ids get a prefix
import re as _re
def _component(path, prefix, start, end, extra):
    src = open(path).read()
    d0 = src.index("DEFS = \'\'\'") + len("DEFS = \'\'\'")
    d1 = src.index("\'\'\'", d0)
    defs = src[d0:d1]
    body = src[src.index(start):src.index(end)]
    for i in sorted(set(_re.findall(r'id="([^"]+)"', defs)), key=len, reverse=True):
        defs = defs.replace(f'id="{i}"', f'id="{prefix}{i}"')
        body = body.replace(f'url(#{i})', f'url(#{prefix}{i})')
    ns = {'add': add, 'text': text, 'INK': INK, 'SUB': SUB, 'SANS': SANS}
    ns.update(extra)
    exec(body, ns)
    return defs.replace('<defs>', '').replace('</defs>', ''), ns
_HERE = os.path.dirname(os.path.abspath(__file__)) + os.sep
_bo_defs, BO = _component(_HERE + 'boiler_side.py', 'bo-', 'def boiler_side():', 'def card(', {'EDGE': '#5b636d'})
_tb_defs, TB = _component(_HERE + 'terminal_block.py', 'tb-', 'def screw(', 'def card(', {'NYL': '#a39a86'})
DEFS = DEFS.replace('</defs>', _bo_defs + _tb_defs + '</defs>')

# ------------------------------------------------------------------ small shared parts
def screw(x, y, r=9, cross=False):
    add(f'<circle cx="{x}" cy="{y}" r="{r}" fill="url(#chrome)" stroke="#6e7781" stroke-width="1.2"/>')
    add(f'<line x1="{x - r + 3}" y1="{y}" x2="{x + r - 3}" y2="{y}" stroke="#57606a" stroke-width="{max(1.5, r / 5)}"/>')
    if cross:
        add(f'<line x1="{x}" y1="{y - r + 3}" x2="{x}" y2="{y + r - 3}" stroke="#57606a" stroke-width="{max(1.5, r / 5)}"/>')

def lug(x, y, d):
    """spade terminal whose tip is at (x, y), pointing d (L/R/U/D)"""
    if d in 'LR':
        x0 = x if d == 'L' else x - 20
        add(f'<rect x="{x0}" y="{y - 6}" width="20" height="12" rx="2" fill="url(#steelv)" stroke="#6e7781" stroke-width="1.2"/>')
        add(f'<circle cx="{x0 + 10}" cy="{y}" r="2.6" fill="#4a5059"/>')
    else:
        y0 = y if d == 'U' else y - 20
        add(f'<rect x="{x - 6}" y="{y0}" width="12" height="20" rx="2" fill="url(#steel)" stroke="#6e7781" stroke-width="1.2"/>')
        add(f'<circle cx="{x}" cy="{y0 + 10}" r="2.6" fill="#4a5059"/>')

# ------------------------------------------------------------------ 1. power cord (US plug)
def power_cord():
    for y in (20, 46):                                                     # flat blades with holes
        add(f'<rect x="0" y="{y}" width="42" height="14" rx="2" fill="url(#steelv)" stroke="#6e7781" stroke-width="1.2"/>')
        add(f'<circle cx="12" cy="{y + 7}" r="3.2" fill="#ffffff" stroke="#6e7781" stroke-width="1"/>')
    add('<path d="M42 70 H12 A7 7 0 0 0 12 84 H42 Z" fill="url(#steelv)" stroke="#6e7781" stroke-width="1.2"/>')   # round ground pin
    add('<rect x="36" y="6" width="96" height="88" rx="16" fill="url(#rubber)" stroke="#0d0f11" stroke-width="1.5"/>')
    add('<rect x="36" y="6" width="12" height="88" rx="6" fill="#1a1c20"/>')
    for i in range(5):
        add(f'<rect x="{74 + i * 11}" y="14" width="5" height="72" rx="2.5" fill="#0f1114" opacity="0.65"/>')
    add('<rect x="50" y="10" width="76" height="12" rx="6" fill="#ffffff" opacity="0.07"/>')
    add('<path d="M132 26 L184 38 L184 62 L132 74 Z" fill="url(#rubber)" stroke="#0d0f11" stroke-width="1.2"/>')
    for x in (146, 158, 170):
        add(f'<line x1="{x}" y1="{29 + (x - 132) * 0.23}" x2="{x}" y2="{71 - (x - 132) * 0.23}" stroke="#0b0c0e" stroke-width="2"/>')
    add('<path d="M184 50 C 226 50, 236 74, 276 74" fill="none" stroke="#1b1d20" stroke-width="18" stroke-linecap="round"/>')
    add('<path d="M184 45 C 224 45, 236 68, 276 68" fill="none" stroke="#3d4249" stroke-width="3" stroke-linecap="round" opacity="0.8"/>')
    add('<rect x="270" y="63" width="12" height="22" rx="4" fill="#15171a"/>')
    for y_end, col, edge in ((34, '#2b2b2b', '#111111'), (74, '#f4f4f2', '#b8b8b2'), (114, '#2fa84f', '#1b6b31')):
        path = f'M282 74 C 306 74, 310 {y_end}, 336 {y_end} L 362 {y_end}'
        add(f'<path d="{path}" fill="none" stroke="{edge}" stroke-width="11" stroke-linecap="butt"/>')
        add(f'<path d="{path}" fill="none" stroke="{col}" stroke-width="8" stroke-linecap="butt"/>')
        add(f'<rect x="362" y="{y_end - 3.5}" width="20" height="7" rx="2" fill="url(#copper)"/>')
    text(388, 38, 'LINE', 12, '700', 'start', '#2b2b2b')
    text(388, 78, 'NEUTRAL', 12, '700', 'start', '#57606a')
    text(388, 118, 'GND', 12, '700', 'start', '#1b6b31')

# ------------------------------------------------------------------ 2. terminal block (stock, under the machine)
def terminal_block():
    add('<rect x="-10" y="-10" width="160" height="216" rx="6" fill="#2b2d31"/>')                 # machine base, dark
    add('<rect x="0" y="0" width="140" height="196" rx="8" fill="url(#nylon)" stroke="#b9b4a8" stroke-width="1.5"/>')
    for i, (y, n) in enumerate(((34, 'L'), (98, 'G'), (162, 'N'))):
        add(f'<rect x="8" y="{y - 26}" width="124" height="52" rx="9" fill="#ffffff" stroke="#d3cdbf" stroke-width="1.3"/>')
        for x in (38, 102):
            add(f'<circle cx="{x}" cy="{y}" r="16" fill="#e7e2d6" stroke="#cfc8b8" stroke-width="1"/>')
            screw(x, y, 11, cross=False)
        add(f'<rect x="64" y="{y - 22}" width="12" height="44" rx="3" fill="#efebe2" stroke="#d3cdbf" stroke-width="1"/>')
        text(-20, y + 5, n, 14, '700', 'end', INK)
    add('<circle cx="70" cy="98" r="5" fill="#2b2d31"/>')

# ------------------------------------------------------------------ 3. selector switch (the knob)
def selector():
    add('<rect x="0" y="0" width="165" height="148" rx="12" fill="#2b2f36" stroke="#14171c" stroke-width="2"/>')
    kx, ky = 82.5, 74
    add(f'<circle cx="{kx}" cy="{ky}" r="62" fill="url(#chrome)" stroke="#57606a" stroke-width="2"/>')
    add(f'<circle cx="{kx}" cy="{ky}" r="52" fill="none" stroke="#9aa3ad" stroke-width="1.5"/>')
    add(f'<rect x="{kx - 13}" y="{ky - 56}" width="26" height="112" rx="10" fill="url(#grip)" stroke="#6e7781" stroke-width="1.5"/>')
    add(f'<rect x="{kx - 3}" y="{ky - 50}" width="6" height="12" rx="2" fill="#2b2f36"/>')
    for n, x, y in (('1', -22, 24), ('2', -22, 57), ('A', -22, 127), ('3', 187, 19), ('4', 187, 67), ('B', 187, 127)):
        left = x < 0
        lug(x, y, 'L' if left else 'R')
        text(x + (9 if left else -9), y - 10, n, 13, '700', 'middle', INK, MONO)

# ------------------------------------------------------------------ 4. indicator LEDs
def lamp(x, y, lens):
    add(f'<rect x="{x - 26}" y="{y - 2}" width="52" height="4" fill="#9aa3ad"/>')
    add(f'<circle cx="{x}" cy="{y}" r="17" fill="url(#chrome)" stroke="#57606a" stroke-width="1.5"/>')
    add(f'<circle cx="{x}" cy="{y}" r="12" fill="url(#{lens})" stroke="#3b1d14" stroke-width="1"/>')
    add(f'<ellipse cx="{x - 4}" cy="{y - 5}" rx="4" ry="2.5" fill="#ffffff" opacity="0.8"/>')

# ------------------------------------------------------------------ 5. boiler
def boiler():
    add('<rect x="0" y="250" width="440" height="34" rx="9" fill="url(#aluh)" stroke="#8d96a0" stroke-width="1.5"/>')
    for hx in (26, 414):
        add(f'<circle cx="{hx}" cy="267" r="12" fill="#dfe3e7" stroke="#8d96a0" stroke-width="1.2"/>'
            f'<circle cx="{hx}" cy="267" r="7" fill="#ffffff" stroke="#8d96a0" stroke-width="1.2"/>')
    dome = 'M 52 254 C 52 168, 84 112, 136 94 L 304 94 C 356 112, 388 168, 388 254 Z'
    add(f'<path d="{dome}" fill="url(#alu)" stroke="#8d96a0" stroke-width="1.6"/>')
    add(f'<path d="{dome}" fill="url(#sheen)"/>')
    for y, inset in ((150, 34), (196, 18), (236, 8)):
        add(f'<path d="M {52 + inset} {y} Q 220 {y + 14} {388 - inset} {y}" fill="none" stroke="#b9c1c9" stroke-width="2"/>')
    add('<ellipse cx="220" cy="96" rx="84" ry="14" fill="url(#aluh)" stroke="#8d96a0" stroke-width="1.4"/>')
    for bx in (150, 290):                                                   # thermostat mounting bosses
        add(f'<circle cx="{bx}" cy="200" r="27" fill="url(#aluh)" stroke="#8d96a0" stroke-width="1.5"/>'
            f'<circle cx="{bx}" cy="200" r="19" fill="none" stroke="#b9c1c9" stroke-width="2"/>'
            f'<circle cx="{bx}" cy="200" r="4" fill="#8d96a0"/>')
    # brass water fitting with its red gasket
    add('<ellipse cx="220" cy="89" rx="28" ry="6.5" fill="#b5523b" stroke="#7a2e1f" stroke-width="1"/>')
    add('<path d="M198 86 L198 60 L206 52 L234 52 L242 60 L242 86 Z" fill="url(#brass)" stroke="#7a5410" stroke-width="1.2"/>')
    add('<line x1="210" y1="54" x2="210" y2="86" stroke="#b8862a" stroke-width="1"/><line x1="230" y1="54" x2="230" y2="86" stroke="#b8862a" stroke-width="1"/>')
    add('<rect x="207" y="14" width="26" height="40" rx="3" fill="url(#brass)" stroke="#7a5410" stroke-width="1.2"/>')
    for y in (22, 30, 38):
        add(f'<line x1="207" y1="{y}" x2="233" y2="{y}" stroke="#9c6b12" stroke-width="1.5"/>')
    add('<ellipse cx="220" cy="14" rx="13" ry="3.5" fill="#6b4a0e"/>')
    # ground stud with nut and washer
    add('<rect x="124" y="70" width="10" height="34" fill="url(#steel)" stroke="#6e7781" stroke-width="1"/>')
    for y in range(74, 100, 4):
        add(f'<line x1="124" y1="{y}" x2="134" y2="{y + 2}" stroke="#7d8590" stroke-width="1"/>')
    add('<ellipse cx="129" cy="106" rx="16" ry="4" fill="url(#steelv)" stroke="#6e7781" stroke-width="1"/>')
    add('<path d="M117 94 L141 94 L141 103 L117 103 Z" fill="url(#steel)" stroke="#6e7781" stroke-width="1"/>')
    # heater terminals: two spades on white insulators
    for tx, ty in ((288, 98), (320, 108)):
        add(f'<rect x="{tx - 13}" y="{ty - 8}" width="26" height="16" rx="5" fill="url(#ceramic)" stroke="#a9a49a" stroke-width="1.2"/>')
        add(f'<rect x="{tx - 5}" y="{ty - 36}" width="10" height="30" rx="2" fill="url(#steel)" stroke="#6e7781" stroke-width="1.2"/>')
        add(f'<circle cx="{tx}" cy="{ty - 26}" r="2.5" fill="#4a5059"/>')

# ------------------------------------------------------------------ 6. thermostat
def thermostat(temp):
    add('<rect x="10" y="30" width="80" height="30" rx="5" fill="url(#bakelite)" stroke="#3b2a1a" stroke-width="1.5"/>')
    add('<rect x="4" y="54" width="92" height="10" rx="3" fill="url(#steelv)" stroke="#6e7781" stroke-width="1"/>')
    for hx in (12, 88):
        add(f'<circle cx="{hx}" cy="59" r="2.6" fill="#ffffff" stroke="#6e7781" stroke-width="0.8"/>')
    add('<rect x="22" y="6" width="56" height="26" rx="8" fill="url(#steelv)" stroke="#6e7781" stroke-width="1.5"/>')
    add('<rect x="22" y="6" width="56" height="8" rx="4" fill="#ffffff" opacity="0.35"/>')
    text(50, 24, temp, 11, '700', 'middle', '#3b4250')
    lug(-14, 42, 'L'); lug(114, 42, 'R')
    add('<rect x="-2" y="38" width="14" height="8" fill="#5b412a"/><rect x="88" y="38" width="14" height="8" fill="#5b412a"/>')

# ------------------------------------------------------------------ 7. TCO thermal fuse
def tco():
    for x in (0, 228):
        add(f'<rect x="{x}" y="22" width="36" height="18" rx="4" fill="url(#steelv)" stroke="#6e7781" stroke-width="1.2"/>')
        for dx in (10, 24):
            add(f'<line x1="{x + dx}" y1="23" x2="{x + dx}" y2="39" stroke="#8d96a0" stroke-width="2"/>')
    add('<rect x="32" y="18" width="200" height="26" rx="12" fill="url(#weave)" stroke="#cfc6b0" stroke-width="1.4"/>')
    add('<rect x="96" y="12" width="72" height="38" rx="15" fill="url(#weave)" stroke="#cfc6b0" stroke-width="1.4"/>')
    add('<rect x="34" y="20" width="196" height="7" rx="4" fill="#ffffff" opacity="0.45"/>')
    add('<rect x="118" y="2" width="28" height="58" rx="4" fill="url(#steel)" stroke="#6e7781" stroke-width="1.2"/>')
    screw(132, 10, 6, cross=True)
    text(132, 78, '216 °C', 11, '700', 'middle', SUB)

# ------------------------------------------------------------------ 8. pump
def pump():
    add('<rect x="0" y="38" width="40" height="18" rx="6" fill="url(#nylon)" stroke="#9aa3ad" stroke-width="1.5"/>')
    add('<rect x="36" y="30" width="52" height="34" rx="8" fill="url(#nylon)" stroke="#9aa3ad" stroke-width="1.5"/>')
    add('<rect x="82" y="0" width="150" height="116" rx="14" fill="url(#pumpbody)" stroke="#3b0f08" stroke-width="2"/>')
    for i in range(5):
        add(f'<line x1="{102 + i * 26}" y1="8" x2="{102 + i * 26}" y2="108" stroke="#6e2014" stroke-width="2" opacity="0.6"/>')
    add('<rect x="90" y="6" width="134" height="12" rx="6" fill="#ffffff" opacity="0.12"/>')
    add('<rect x="228" y="38" width="10" height="60" rx="3" fill="#2b2b2b"/>')
    lug(254, 48, 'R'); lug(254, 88, 'R')

# ------------------------------------------------------------------ 9. ON-OFF-ON toggle (ZENGTAI 303)
def toggle_front():
    add('<path d="M59 98 L71 98 L61 12 L49 13 Z" fill="url(#steel)" stroke="#6e7781" stroke-width="1.2"/>')
    add('<circle cx="55" cy="12" r="7.5" fill="url(#chrome)" stroke="#6e7781" stroke-width="1.2"/>')
    add('<rect x="44" y="90" width="42" height="26" rx="3" fill="url(#steel)" stroke="#6e7781" stroke-width="1.2"/>')
    for y in range(94, 114, 4):
        add(f'<line x1="45" y1="{y}" x2="85" y2="{y + 1.5}" stroke="#8d96a0" stroke-width="1"/>')
    add('<path d="M34 112 L96 112 L100 118 L96 124 L34 124 L30 118 Z" fill="url(#steel)" stroke="#6e7781" stroke-width="1.2"/>')
    add('<rect x="10" y="124" width="110" height="20" rx="4" fill="url(#steelv)" stroke="#6e7781" stroke-width="1.2"/>')
    add('<rect x="14" y="127" width="16" height="9" rx="2" fill="#e5484d"/><rect x="100" y="127" width="16" height="9" rx="2" fill="#e5484d"/>')
    add('<rect x="10" y="142" width="7" height="58" fill="url(#steel)" stroke="#6e7781" stroke-width="1"/><rect x="113" y="142" width="7" height="58" fill="url(#steel)" stroke="#6e7781" stroke-width="1"/>')
    add('<path d="M16 142 H114 V204 A6 6 0 0 1 108 210 H22 A6 6 0 0 1 16 204 Z" fill="url(#maroon)" stroke="#3b1209" stroke-width="1.5"/>')
    add('<rect x="22" y="150" width="86" height="50" rx="2" fill="#f4e86e" stroke="#a8961c" stroke-width="1"/>')
    text(65, 163, 'ON ⇐ OFF ⇒ ON', 8.5, '700', 'middle', '#1f2328')
    text(65, 175, 'ZENGTAI', 8, '700', 'middle', '#1f2328', spacing=1.5)
    text(27, 186, '303', 6.5, '400', 'start', '#1f2328'); text(65, 186, '15A 250VAC', 6.5, '400', 'middle', '#1f2328')
    text(65, 195, '10A 380VAC', 6.5, '400', 'middle', '#1f2328'); text(101, 192, 'CE', 7, '700', 'middle', '#1f2328')
    for x in (34, 65, 96):
        add(f'<rect x="{x - 10}" y="208" width="20" height="16" rx="3" fill="url(#brassv)" stroke="#8a5c0e" stroke-width="1"/>')
        screw(x, 216, 6.5, cross=True)

def toggle_back():
    add('<rect x="-6" y="22" width="10" height="116" rx="2" fill="url(#steelv)" stroke="#6e7781" stroke-width="1"/>'
        '<rect x="156" y="22" width="10" height="116" rx="2" fill="url(#steelv)" stroke="#6e7781" stroke-width="1"/>')
    add('<rect x="0" y="0" width="160" height="160" rx="10" fill="url(#maroon)" stroke="#3b1209" stroke-width="1.6"/>')
    for x in (56, 104):
        add(f'<line x1="{x}" y1="10" x2="{x}" y2="150" stroke="#4d170f" stroke-width="2.5" opacity="0.7"/>')
    for cx in (32, 80, 128):
        for cy in (32, 80, 128):
            add(f'<rect x="{cx - 15}" y="{cy - 15}" width="30" height="30" rx="4" fill="url(#brassv)" stroke="#8a5c0e" stroke-width="1.2"/>')
            screw(cx, cy, 9.5, cross=True)

# ------------------------------------------------------------------ 10. SSR-40 DA (Fotek)
def ssr():
    add('<rect x="0" y="0" width="150" height="200" rx="6" fill="url(#ssr)" stroke="#a39a88" stroke-width="1.5"/>')
    for x0, y0 in ((8, 4), (92, 4), (8, 146), (92, 146)):
        add(f'<rect x="{x0}" y="{y0}" width="50" height="50" rx="5" fill="url(#ssrbay)" stroke="#968c78" stroke-width="1"/>')
        cx, cy = x0 + 25, y0 + 25
        add(f'<rect x="{cx - 17}" y="{cy - 15}" width="34" height="30" rx="3" fill="url(#steelv)" stroke="#6e7781" stroke-width="1"/>')
        screw(cx, cy, 12.5, cross=True)
    add('<path d="M62 0 V26 A13 13 0 0 0 88 26 V0 Z" fill="#f6f8fa" stroke="#a39a88" stroke-width="1.2"/>')
    add('<path d="M62 200 V174 A13 13 0 0 1 88 174 V200 Z" fill="#f6f8fa" stroke="#a39a88" stroke-width="1.2"/>')
    add('<rect x="5" y="57" width="140" height="86" rx="2" fill="#fbfbf8" stroke="#d6d0c2" stroke-width="1"/>')
    text(10, 69, '1', 8, '400', 'start', '#3b4250'); text(140, 69, '2', 8, '400', 'end', '#3b4250')
    text(75, 68, '~  24 - 380VAC  ~', 7.5, '700', 'middle', '#2b2b2b')
    add('<path d="M24 71 V75 H126 V71" fill="none" stroke="#2b2b2b" stroke-width="0.8"/>')
    text(10, 91, 'FOTEK', 14, '700', 'start', '#d0281f', spacing=0.5)
    text(118, 91, 'CE', 14, '400', 'middle', '#2b2b2b')
    text(10, 106, 'SSR-40 DA', 12.5, '700', 'start', '#2b2b2b', italic=True)
    text(10, 115, 'Solid State Module', 6.8, '400', 'start', '#3b4250')
    text(10, 122, 'Made in china', 6.3, '400', 'start', '#3b4250')
    text(116, 118, '✔RoHS', 8, '700', 'middle', '#3b4250')
    add('<path d="M18 131 V128 H58" fill="none" stroke="#2b2b2b" stroke-width="0.8"/><path d="M92 128 H105" fill="none" stroke="#2b2b2b" stroke-width="0.8"/>')
    add('<rect x="58" y="122" width="34" height="12" rx="6" fill="#fbfbf8" stroke="#2b2b2b" stroke-width="0.9"/>')
    text(75, 131, 'Input', 7.5, '400', 'middle', '#2b2b2b')
    add('<circle cx="114" cy="128" r="6.5" fill="url(#ledoff)" stroke="#2b2b2b" stroke-width="0.6"/>')
    text(10, 142, '4', 8, '400', 'start', '#3b4250'); text(140, 142, '3', 8, '400', 'end', '#3b4250')
    text(75, 142, '−   3 - 32VDC   +', 7.5, '700', 'middle', '#2b2b2b')

# ------------------------------------------------------------------ 11. AC dimmer 4A
def dimmer():
    add('<rect x="0" y="0" width="300" height="100" rx="5" fill="url(#pcb)" stroke="#0f3566" stroke-width="1.5"/>')
    add('<rect x="4" y="12" width="16" height="76" rx="2" fill="#1b1e22"/>')
    for i, n in enumerate(('DIM', 'Z-C', 'VCC', 'GND')):
        y = 24 + i * 17.5
        add(f'<rect x="-24" y="{y - 2.5}" width="34" height="5" rx="1" fill="url(#gold)" stroke="#8a6d1a" stroke-width="0.6"/>')
        text(25, y + 3, n, 7, '700', 'start', '#ffffff', MONO)
    add('<rect x="54" y="52" width="32" height="28" rx="2" fill="#f2f2ef" stroke="#c9c9c4" stroke-width="1"/>')
    for y in (58, 74):
        add(f'<rect x="50" y="{y - 2}" width="5" height="4" fill="#c8ccd2"/><rect x="85" y="{y - 2}" width="5" height="4" fill="#c8ccd2"/>')
    add('<circle cx="60" cy="58" r="1.8" fill="#9aa3ad"/>')
    add('<rect x="56" y="16" width="28" height="24" rx="2" fill="#1b1b1b"/>')
    for y in (22, 34):
        add(f'<rect x="52" y="{y - 2}" width="5" height="4" fill="#c8ccd2"/><rect x="83" y="{y - 2}" width="5" height="4" fill="#c8ccd2"/>')
    add('<rect x="112" y="18" width="24" height="18" rx="2" fill="#1b1b1b"/><rect x="118" y="36" width="12" height="5" fill="#c8ccd2"/>')
    add('<rect x="150" y="38" width="34" height="30" rx="2" fill="#1b1b1b"/><rect x="184" y="42" width="12" height="22" rx="1" fill="url(#steelv)" stroke="#8b939e" stroke-width="0.8"/>')
    add('<rect x="142" y="44" width="9" height="5" fill="#c8ccd2"/><rect x="142" y="58" width="9" height="5" fill="#c8ccd2"/>')
    for x, y in ((104, 58), (104, 72), (124, 60), (204, 16), (204, 30), (164, 16)):
        add(f'<rect x="{x}" y="{y}" width="14" height="8" rx="1" fill="#1b1b1b"/><rect x="{x}" y="{y}" width="3" height="8" fill="#c8ccd2"/><rect x="{x + 11}" y="{y}" width="3" height="8" fill="#c8ccd2"/>')
    for x, y in ((128, 76), (204, 74)):
        add(f'<rect x="{x}" y="{y}" width="12" height="8" rx="1" fill="#c9a27a"/><rect x="{x}" y="{y}" width="3" height="8" fill="#c8ccd2"/><rect x="{x + 9}" y="{y}" width="3" height="8" fill="#c8ccd2"/>')
    text(150, 91, 'AC Dimmer Module 4A', 7.5, '400', 'middle', '#cfe0f5')
    add('<rect x="224" y="2" width="72" height="96" rx="4" fill="url(#term)" stroke="#123c80" stroke-width="1.2"/>')
    for i, n in enumerate(('OUT', 'L', 'N')):
        y = 18 + i * 32
        add(f'<rect x="252" y="{y - 12}" width="26" height="24" rx="3" fill="#1b4fa3"/>')
        screw(265, y, 10)
        add(f'<rect x="291" y="{y - 6}" width="6" height="12" rx="1" fill="#0d2a5c"/>')
        text(244, y + 3, n, 7.5, '700', 'end', '#ffffff', MONO)

# ------------------------------------------------------------------ 12. 5 V 2 A supply (open frame)
def psu():
    add('<rect x="0" y="0" width="340" height="160" rx="6" fill="url(#pcb)" stroke="#0f3566" stroke-width="1.5"/>')
    for hx, hy in ((14, 14), (326, 14), (14, 146), (326, 146)):
        add(f'<circle cx="{hx}" cy="{hy}" r="8" fill="#d9dde3" stroke="#8b939e" stroke-width="1"/><circle cx="{hx}" cy="{hy}" r="4" fill="#ffffff"/>')
    for (px, py, n, anchor, dx) in ((16, 62, 'L', 'start', 12), (16, 98, 'N', 'start', 12), (324, 62, '+5V', 'end', -12), (324, 98, 'GND', 'end', -12)):
        add(f'<circle cx="{px}" cy="{py}" r="7" fill="#d9dde3" stroke="#8b939e" stroke-width="1"/><circle cx="{px}" cy="{py}" r="3" fill="#5a616b"/>')
        text(px + dx, py + 3.5, n, 9, '700', anchor, '#ffffff')
    # input: X2 capacitor and the common-mode choke
    add('<rect x="44" y="102" width="44" height="30" rx="3" fill="url(#xcap)" stroke="#7a1a13" stroke-width="1"/>')
    add('<rect x="44" y="18" width="50" height="48" rx="6" fill="#2a2d31" stroke="#111" stroke-width="1"/>')
    for i in range(7):
        add(f'<rect x="{50 + i * 6}" y="24" width="3.5" height="36" rx="1.5" fill="url(#copper)"/>')
    add('<rect x="48" y="40" width="42" height="4" fill="#2a2d31"/>')
    # bulk capacitor (green) seen from the top
    add('<circle cx="124" cy="44" r="27" fill="url(#ecapG)" stroke="#0f4a29" stroke-width="1.2"/>')
    add('<circle cx="124" cy="44" r="20" fill="url(#chrome)" stroke="#7d8590" stroke-width="1"/>')
    add('<path d="M124 28 V60 M110 36 L138 52 M110 52 L138 36" stroke="#8b939e" stroke-width="1.6"/>')
    add('<path d="M100 32 A27 27 0 0 1 112 19" fill="none" stroke="#cfe9d8" stroke-width="5" opacity="0.7"/>')
    add('<circle cx="124" cy="112" r="14" fill="url(#ecapK)" stroke="#000" stroke-width="1"/><circle cx="124" cy="112" r="10" fill="url(#chrome)"/>')
    # transformer: yellow tape, black ferrite core, blue bobbin
    add('<rect x="160" y="24" width="88" height="112" rx="4" fill="#24272c" stroke="#0d0f11" stroke-width="1"/>')
    add('<rect x="168" y="38" width="72" height="84" rx="3" fill="url(#ytape)" stroke="#a8850f" stroke-width="1"/>')
    add('<rect x="186" y="38" width="36" height="84" rx="4" fill="url(#bobbin)" stroke="#123c8a" stroke-width="1"/>')
    for y in (30, 130):
        add(f'<rect x="164" y="{y - 3}" width="80" height="6" rx="2" fill="#3a3e44"/>')
    # output side: caps, diode, small parts
    add('<circle cx="268" cy="38" r="15" fill="url(#ecapK)" stroke="#000" stroke-width="1"/><circle cx="268" cy="38" r="10.5" fill="url(#chrome)"/>')
    add('<circle cx="268" cy="124" r="14" fill="url(#ecapK)" stroke="#000" stroke-width="1"/><circle cx="268" cy="124" r="9.5" fill="url(#chrome)"/>')
    add('<rect x="254" y="72" width="28" height="16" rx="2" fill="#1b1b1b"/><rect x="282" y="76" width="7" height="8" fill="#c8ccd2"/>')
    for x, y in ((104, 140), (140, 140), (304, 80), (230, 142)):
        add(f'<rect x="{x}" y="{y}" width="14" height="8" rx="1" fill="#1b1b1b"/><rect x="{x}" y="{y}" width="3" height="8" fill="#c8ccd2"/><rect x="{x + 11}" y="{y}" width="3" height="8" fill="#c8ccd2"/>')
    text(170, 152, '5V 2A', 8, '700', 'middle', '#cfe0f5')

# ================================================================== the sheet
def card(x, y, w, h, title, sub):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="#fbfcfd" stroke="#d1d9e0" stroke-width="1.5"/>')
    text(x + 22, y + 34, title, 17, '700')
    text(x + 22, y + 56, sub, 13, '400', 'start', SUB)

text(40, 56, 'HIGH-VOLTAGE PARTS (DRAWN, NOT WIRED YET)', 30, '700')
text(40, 88, 'Each part drawn to look like the real one, in one style. Wiring comes next.', 15, '400', 'start', SUB)

C = [25, 515, 1005, 1495]
R = [110, 530, 1110, 1530]
CW, CH = 470, 400

card(C[0], R[0], CW, CH, 'POWER CORD', '3-prong plug · US colours')
g(C[0] + 16, R[0] + 168, 1.0); power_cord(); eg()

card(C[1], R[0], CW, CH, 'TERMINAL BLOCK', 'bottom of the machine · line, ground, neutral')
g(C[1] + 127, R[0] + 92, 1.2); TB['terminal_block'](); eg()

card(C[2], R[0], CW, CH, 'SELECTOR SWITCH', "the machine's knob, works as stock")
g(C[2] + 104, R[0] + 112, 1.6); selector(); eg()

card(C[3], R[0], CW, CH, 'INDICATOR LEDS', 'front panel lights')
g(C[3], R[0], 1.0)
add('<g transform="translate(130 225) scale(2.6)">'); lamp(0, 0, 'lensG'); eg()
add('<g transform="translate(340 225) scale(2.6)">'); lamp(0, 0, 'lensR'); eg()
text(130, 310, 'GREEN', 14, '700', 'middle'); text(340, 310, 'RED', 14, '700', 'middle')
eg()

card(C[0], R[1], CW * 3 + 40, 560, 'BOILER WITH THERMOSTATS', '105 °C brew and 125 °C steam thermostats on the front · heater terminals and ground stud on top')
TS = 1.3
TX, TY = C[0] + 725 - 209 * TS, R[1] + 64
g(TX, TY, TS); BO['boiler_assembly'](); eg()
P = lambda x, y: (TX + x * TS, TY + y * TS)
(x1, y1), (x2, y2) = P(198, 76), P(257, 74)
text((x1 + x2) / 2, y1 - 40, 'heater terminals', 14, '400', 'middle', SUB)
for lx, ly in ((x1, y1), (x2, y2)):
    add(f'<line x1="{(x1 + x2) / 2 + (-14 if lx == x1 else 14)}" y1="{y1 - 34}" x2="{lx}" y2="{ly - 4}" stroke="#8b949e" stroke-width="1.2"/>')
sx, sy = P(206, 162)
add(f'<line x1="{TX - 30}" y1="{sy}" x2="{sx - 8}" y2="{sy}" stroke="#8b949e" stroke-width="1.2"/>')
add(f'<circle cx="{sx}" cy="{sy}" r="3" fill="#8b949e"/>')
text(TX - 38, sy + 5, 'ground stud', 14, '400', 'end', SUB)

card(C[3], R[1], CW, 560, 'TCO', 'thermal fuse, 216 °C · safety cutoff')
g(C[3] + 30, R[1] + 250, 1.6); tco(); eg()

card(C[0], R[2], CW * 2 + 20, CH, 'ON-OFF-ON TOGGLE', 'ZENGTAI 303 · 3 poles, 9 screws · front and wire side')
g(C[0] + 206, R[2] + 66, 1.3); toggle_front(); eg()
g(C[0] + 560, R[2] + 96, 1.65); toggle_back(); eg()
text(C[0] + 290, R[2] + 388, 'front', 13, '400', 'middle', SUB)
text(C[0] + 692, R[2] + 388, 'wire side', 13, '400', 'middle', SUB)

card(C[2], R[2], CW, CH, 'SSR-40 DA', 'heater relay')
g(C[2] + 122, R[2] + 74, 1.5); ssr(); eg()

card(C[3], R[2], CW, CH, 'PUMP', 'vibration pump')
g(C[3] + 40, R[2] + 150, 1.4); pump(); eg()

card(C[0], R[3], CW * 2 + 20, CH, 'AC DIMMER 4A', 'runs the pump')
g(C[0] + 150, R[3] + 120, 2.2); dimmer(); eg()

card(C[2], R[3], CW * 2 + 20, CH, '5 V 2 A SUPPLY', 'open frame · powers the board')
g(C[2] + 140, R[3] + 72, 2.0); psu(); eg()

svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">' + DEFS +
       f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + ''.join(el) + '</svg>')
open(out, 'w').write(svg)
print('ok', len(svg))
