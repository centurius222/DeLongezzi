"""Boiler from the top, laid out like the builder's photo photo:
heater terminals and ground stud at the top, TCO running down the right side in its sleeve with the clip
bracket, thermostats on the front edge, water fitting with its hose on the left, outlet on the right."""
import os, re, sys

out = sys.argv[1]
W, H = 1240, 760
SANS = "'DejaVu Sans', 'Segoe UI', Arial, sans-serif"
INK, SUB, EDGE = '#1f2328', '#59636e', '#5b636d'
el = []
def add(s): el.append(s)

def text(x, y, s, size=13, weight='400', anchor='start', fill=INK, font=SANS):
    add(f'<text x="{x}" y="{y}" font-family="{font}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}" fill="{fill}">{s}</text>')

# ---- approved pieces: thermostat (boiler_side.py) and the gradients the boiler uses
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'boiler_side.py')).read()
d0 = src.index("DEFS = '''") + len("DEFS = '''"); d1 = src.index("'''", d0)
bo_defs = src[d0:d1]
body = src[src.index('def boiler_side():'):src.index('def card(')]
for i in sorted(set(re.findall(r'id="([^"]+)"', bo_defs)), key=len, reverse=True):
    bo_defs = bo_defs.replace(f'id="{i}"', f'id="bo-{i}"'); body = body.replace(f'url(#{i})', f'url(#bo-{i})')
BO = {'add': add, 'text': text, 'INK': INK, 'SUB': SUB, 'SANS': SANS, 'EDGE': EDGE}
exec(body, BO)

DEFS = '<defs>' + bo_defs.replace('<defs>', '').replace('</defs>', '') + '''
<linearGradient id="sleeve" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d9dee3" stop-opacity="0.95"/><stop offset="0.35" stop-color="#fbfcfd" stop-opacity="0.92"/><stop offset="1" stop-color="#c9d0d6" stop-opacity="0.95"/></linearGradient>
<linearGradient id="fuse" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8d96a0"/><stop offset="0.45" stop-color="#d7dce1"/><stop offset="1" stop-color="#7d8590"/></linearGradient>
<linearGradient id="clipg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4f57"/><stop offset="0.5" stop-color="#2b2f35"/><stop offset="1" stop-color="#1a1d21"/></linearGradient>
<linearGradient id="strap" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1e2125"/><stop offset="0.5" stop-color="#40454c"/><stop offset="1" stop-color="#1a1d21"/></linearGradient>
<linearGradient id="rubber" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4f57"/><stop offset="0.35" stop-color="#2a2d32"/><stop offset="1" stop-color="#121417"/></linearGradient>
<linearGradient id="rubberH" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#121417"/><stop offset="0.45" stop-color="#3a3f46"/><stop offset="1" stop-color="#121417"/></linearGradient>
<linearGradient id="brassV2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6dc85"/><stop offset="0.5" stop-color="#d4a640"/><stop offset="1" stop-color="#8a5c0e"/></linearGradient>
<radialGradient id="chrome" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#c9ced4"/><stop offset="1" stop-color="#6e7781"/></radialGradient>
</defs>'''

def red_wire(d):
    add(f'<path d="{d}" fill="none" stroke="#8f1f16" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>')
    add(f'<path d="{d}" fill="none" stroke="#e5352a" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>')
    add(f'<path d="{d}" fill="none" stroke="#ff8a7f" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.8" transform="translate(-2 -2)"/>')

def hexagon(cx, cy, r, fill, stroke):
    pts = ' '.join(f'{cx + r * c:.1f},{cy + r * s:.1f}' for c, s in ((1, 0), (0.5, 0.866), (-0.5, 0.866), (-1, 0), (-0.5, -0.866), (0.5, -0.866)))
    add(f'<polygon points="{pts}" fill="{fill}" stroke="{stroke}" stroke-width="1.3"/>')

def boiler_top_real():
    # plate and dome (same drawing as the approved top view)
    add(f'<rect x="-6" y="172" width="14" height="46" rx="3" fill="url(#bo-flange)" stroke="{EDGE}" stroke-width="1.4"/>')
    add(f'<rect x="374" y="172" width="14" height="46" rx="3" fill="url(#bo-flange)" stroke="{EDGE}" stroke-width="1.4"/>')
    plate = 'M30 6 Q190 -4 352 6 Q374 8 376 30 Q384 200 376 360 Q374 382 352 384 Q190 392 30 384 Q8 382 6 360 Q-2 200 6 30 Q8 8 30 6 Z'
    add(f'<path d="{plate}" fill="url(#bo-flange)" stroke="{EDGE}" stroke-width="1.8"/>')
    for hx, hy in ((36, 36), (346, 36), (36, 354), (346, 354)):
        add(f'<circle cx="{hx}" cy="{hy}" r="17" fill="#e4e8eb" stroke="#a9b0b8" stroke-width="1.2"/>'
            f'<circle cx="{hx}" cy="{hy}" r="11" fill="#ffffff" stroke="{EDGE}" stroke-width="1.6"/>')
    add(f'<circle cx="191" cy="195" r="182" fill="url(#bo-castV)" stroke="{EDGE}" stroke-width="1.8"/>')
    add('<circle cx="191" cy="195" r="170" fill="none" stroke="#e9ecef" stroke-width="5"/>')
    add(f'<circle cx="191" cy="195" r="160" fill="url(#bo-dome)" stroke="#9aa2aa" stroke-width="1.5"/>')
    add('<path d="M70 110 Q70 70 110 66 L272 66 Q312 70 312 110 L312 300 Q300 330 191 334 Q82 330 70 300 Z" fill="#c9cfd5" stroke="#9aa2aa" stroke-width="1.4"/>')
    add('<path d="M160 120 Q118 190 150 300 M222 120 Q264 190 232 300" fill="none" stroke="#aeb5bd" stroke-width="10" stroke-linecap="round" opacity="0.7"/>')
    add('<path d="M160 120 Q118 190 150 300 M222 120 Q264 190 232 300" fill="none" stroke="#e6eaed" stroke-width="3" stroke-linecap="round" opacity="0.8"/>')

def outlet_right():
    # brass outlet on the right side
    add(f'<rect x="358" y="282" width="18" height="36" rx="3" fill="url(#bo-steel)" stroke="{EDGE}" stroke-width="1.3"/>')
    add('<path d="M374 278 L392 278 L398 300 L392 322 L374 322 Z" fill="url(#brassV2)" stroke="#6b4a0e" stroke-width="1.3"/>')
    add('<rect x="396" y="286" width="34" height="28" rx="5" fill="url(#brassV2)" stroke="#6b4a0e" stroke-width="1.3"/>')
    add('<path d="M406 286 V314 M418 286 V314" stroke="#b8862a" stroke-width="1.1"/>')
    add('<ellipse cx="430" cy="300" rx="4" ry="12" fill="#c9952f" stroke="#6b4a0e" stroke-width="1.1"/><ellipse cx="431" cy="300" rx="2" ry="6" fill="#4a3608"/>')

def water_fitting_left():
    # water fitting on the left: brass nipple in a black rubber elbow, hose to the left, stub down
    add('<rect x="-12" y="248" width="26" height="86" rx="6" fill="url(#rubberH)" stroke="#0d0f11" stroke-width="1.2"/>')
    add('<rect x="-14" y="326" width="30" height="12" rx="4" fill="url(#bo-steelv)" stroke="#6e7781" stroke-width="1"/>')
    add('<rect x="-110" y="206" width="120" height="44" rx="10" fill="url(#rubber)" stroke="#0d0f11" stroke-width="1.2"/>')
    add('<rect x="-104" y="210" width="108" height="8" rx="4" fill="#ffffff" opacity="0.08"/>')
    add('<circle cx="22" cy="228" r="31" fill="url(#rubber)" stroke="#0d0f11" stroke-width="1.3"/>')
    add('<circle cx="22" cy="228" r="21" fill="#c9ced4" stroke="#6e7781" stroke-width="1"/>')
    for a in (0, 120, 240):                                                   # the clip ring's slots
        add(f'<g transform="rotate({a} 22 228)"><rect x="18" y="206" width="8" height="7" fill="#2a2d32"/></g>')
    add('<circle cx="22" cy="228" r="13" fill="url(#bo-brassR)" stroke="#6b4a0e" stroke-width="1.2"/>')
    add('<circle cx="19" cy="224" r="3" fill="#fff4cc" opacity="0.8"/>')

def heater_terminals_and_stud():
    for tx, ty in ((132, 72), (204, 60)):
        add(f'<circle cx="{tx}" cy="{ty + 4}" r="21" fill="url(#bo-dark)" stroke="#15171a" stroke-width="1.3"/>')
        add(f'<rect x="{tx - 16}" y="{ty - 8}" width="32" height="22" rx="3" fill="url(#bo-steelv)" stroke="{EDGE}" stroke-width="1.4"/>')
        add(f'<circle cx="{tx - 4}" cy="{ty + 3}" r="3.4" fill="#3b4048"/>')

def thermostats_front():
    for cx, temp, name in ((84, '105 °C', 'BREW'), (230, '125 °C', 'STEAM')):
        add(f'<g transform="translate({cx - 37.5} 366) scale(0.75)">'); BO['thermostat'](temp); add('</g>')
        text(cx, 428, name, 9, '700', 'middle', '#3b4250')

def tco_long(x, y0, y1, cy):
    """TCO down the right side: clear sleeve from y0 to y1, the fuse inside near the top, clip at cy"""
    red_wire(f'M{x} {y0 + 8} C {x} {y0 - 26}, {x - 56} {y0 - 32}, {x - 76} {y0 - 6}')                  # to the heater terminal
    red_wire(f'M{x} {y1 - 6} L {x} {y1 + 40}')
    add(f'<rect x="{x - 12}" y="{y0}" width="24" height="{y1 - y0}" rx="11" fill="url(#sleeve)" stroke="#aeb6be" stroke-width="1.3"/>')
    add(f'<rect x="{x - 5}" y="{y0 + 8}" width="10" height="{y1 - y0 - 16}" rx="5" fill="#e5352a" opacity="0.28"/>')
    add(f'<rect x="{x - 6.5}" y="{y0 + 70}" width="13" height="38" rx="4" fill="url(#fuse)" opacity="0.6"/>')
    add(f'<rect x="{x - 8}" y="{y0 + 5}" width="4" height="{y1 - y0 - 10}" rx="2" fill="#ffffff" opacity="0.7"/>')
    # clip bracket: black plate screwed to the boiler, strap around the sleeve
    add(f'<path d="M{x - 92} {cy - 26} H{x - 8} V{cy + 28} H{x - 46} V{cy + 40} H{x - 74} V{cy + 28} H{x - 92} Z" fill="url(#clipg)" stroke="#0e1012" stroke-width="1.2"/>')
    hexagon(x - 70, cy, 13, 'url(#chrome)', '#57606a')
    add(f'<circle cx="{x - 70}" cy="{cy}" r="5.5" fill="url(#bo-steelv)" stroke="#6e7781" stroke-width="1"/>')
    add(f'<rect x="{x - 18}" y="{cy - 24}" width="42" height="50" rx="4" fill="url(#strap)" stroke="#0e1012" stroke-width="1.2"/>')
    add(f'<path d="M{x - 3} {cy - 22} V{cy + 24} M{x + 9} {cy - 22} V{cy + 24}" stroke="#9aa2aa" stroke-width="1.1" opacity="0.7"/>')

def card(x, y, w, h, title, sub):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="#fbfcfd" stroke="#d1d9e0" stroke-width="1.5"/>')
    text(x + 22, y + 34, title, 17, '700')
    text(x + 22, y + 56, sub, 13, '400', 'start', SUB)

card(20, 20, 1200, 720, 'BOILER FROM THE TOP', 'laid out like your photo · TCO down the right side, held by its clip · ground on the clip nut · thermostats on the front edge')
S, OX, OY = 1.15, 470, 120
P = lambda x, y: (OX + x * S, OY + y * S)
add(f'<g transform="translate({OX} {OY}) scale({S})">')
boiler_top_real()
water_fitting_left()
outlet_right()
heater_terminals_and_stud()
thermostats_front()
tco_long(300, 62, 470, 312)
add('</g>')

def callout(px, py, tx, ty, label, anchor):
    lx, ly = P(px, py)
    add(f'<line x1="{lx}" y1="{ly}" x2="{tx + (8 if anchor == "end" else -8)}" y2="{ty - 4}" stroke="#8b949e" stroke-width="1.2"/>')
    add(f'<circle cx="{lx}" cy="{ly}" r="3" fill="#8b949e"/>')
    if label:
        text(tx, ty, label, 14, '400', anchor, SUB)
callout(132, 66, 330, 150, 'heater terminals', 'end')
callout(204, 54, 330, 150, '', 'end')
gx, gy = P(230, 312)                                                        # ground: bent leader, clear of the hose stub
add(f'<polyline points="608,686 650,686 650,530 {gx},{gy}" fill="none" stroke="#8b949e" stroke-width="1.2"/>')
add(f'<circle cx="{gx}" cy="{gy}" r="3" fill="#8b949e"/>')
text(600, 691, 'ground: on the clip nut', 14, '400', 'end', SUB)
callout(300, 180, 1000, 300, 'TCO in its sleeve', 'start')
callout(308, 300, 1000, 470, 'clip', 'start')

svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">' + DEFS +
       f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + ''.join(el) + '</svg>')
open(out, 'w').write(svg)
print('ok', len(svg))
