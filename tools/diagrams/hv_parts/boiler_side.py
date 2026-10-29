"""DeLonghi ECP boiler, side and top view, drawn after the builder's reference (guides/boiler.jpeg)."""
import sys

out = sys.argv[1]
W, H = 1240, 640
SANS = "'DejaVu Sans', 'Segoe UI', Arial, sans-serif"
INK, SUB, EDGE = '#1f2328', '#59636e', '#5b636d'
el = []
def add(s): el.append(s)

def text(x, y, s, size=13, weight='400', anchor='start', fill=INK):
    add(f'<text x="{x}" y="{y}" font-family="{SANS}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}" fill="{fill}">{s}</text>')

DEFS = '''<defs>
<linearGradient id="castV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3e7eb"/><stop offset="0.55" stop-color="#c3c9cf"/><stop offset="1" stop-color="#9ea6ae"/></linearGradient>
<linearGradient id="castH" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a7afb7"/><stop offset="0.3" stop-color="#e6eaed"/><stop offset="0.75" stop-color="#c7cdd3"/><stop offset="1" stop-color="#959ea7"/></linearGradient>
<linearGradient id="panel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef1f3"/><stop offset="1" stop-color="#cdd3d8"/></linearGradient>
<linearGradient id="topface" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f6f8"/><stop offset="1" stop-color="#d5dade"/></linearGradient>
<linearGradient id="flange" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9ecef"/><stop offset="0.5" stop-color="#cfd4d9"/><stop offset="1" stop-color="#a9b0b8"/></linearGradient>
<linearGradient id="group" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6f777f"/><stop offset="0.35" stop-color="#a3aab2"/><stop offset="1" stop-color="#5f666e"/></linearGradient>
<linearGradient id="brass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a5c0e"/><stop offset="0.4" stop-color="#f3cf6b"/><stop offset="0.7" stop-color="#d4a640"/><stop offset="1" stop-color="#7d520c"/></linearGradient>
<linearGradient id="steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7d8590"/><stop offset="0.45" stop-color="#eef1f4"/><stop offset="1" stop-color="#6e7781"/></linearGradient>
<linearGradient id="steelv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f3f5"/><stop offset="1" stop-color="#8d96a0"/></linearGradient>
<linearGradient id="dark" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2a2d31"/><stop offset="0.45" stop-color="#5a6069"/><stop offset="1" stop-color="#22252a"/></linearGradient>
<linearGradient id="cream" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#bdb59d"/><stop offset="0.45" stop-color="#f2ecd8"/><stop offset="1" stop-color="#a9a189"/></linearGradient>
<radialGradient id="dome" cx="0.42" cy="0.38" r="0.7"><stop offset="0" stop-color="#eef1f3"/><stop offset="0.7" stop-color="#c9cfd5"/><stop offset="1" stop-color="#a3abb3"/></radialGradient>
<radialGradient id="brassR" cx="0.4" cy="0.35" r="0.75"><stop offset="0" stop-color="#f6dc85"/><stop offset="0.6" stop-color="#cf9c33"/><stop offset="1" stop-color="#7d520c"/></radialGradient>
<linearGradient id="bakelite" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a6a4a"/><stop offset="1" stop-color="#5b412a"/></linearGradient>
</defs>'''

def boiler_side():
    # group head under the flange
    add(f'<path d="M36 308 H344 V340 Q344 352 332 352 H48 Q36 352 36 340 Z" fill="url(#group)" stroke="{EDGE}" stroke-width="1.6"/>')
    add('<rect x="44" y="312" width="292" height="6" fill="#ffffff" opacity="0.18"/>')
    # flange: lower plate and upper ledge
    add(f'<rect x="2" y="276" width="396" height="34" rx="9" fill="url(#flange)" stroke="{EDGE}" stroke-width="1.6"/>')
    add('<path d="M14 284 H168 M232 284 H386" stroke="#8d96a0" stroke-width="1.5"/>')
    add(f'<path d="M186 292 H214 L211 304 H189 Z" fill="#dfe3e7" stroke="{EDGE}" stroke-width="1.2"/>')
    add(f'<rect x="20" y="256" width="360" height="24" rx="11" fill="url(#flange)" stroke="{EDGE}" stroke-width="1.6"/>')
    # body with its sloped top
    body = 'M50 262 L50 168 Q50 138 80 134 L236 139 L326 164 Q346 170 346 188 L346 262 Z'
    add(f'<path d="{body}" fill="url(#castH)" stroke="{EDGE}" stroke-width="1.8"/>')
    add('<path d="M56 166 Q56 146 82 142 L234 147 L322 171 Q336 176 338 186 L56 178 Z" fill="url(#topface)" opacity="0.9"/>')
    add('<path d="M52 178 L344 190" stroke="#9aa2aa" stroke-width="1.6"/>')
    add(f'<rect x="80" y="192" width="222" height="64" rx="6" fill="url(#panel)" stroke="#a9b0b8" stroke-width="1.3"/>')
    add('<rect x="84" y="196" width="214" height="10" rx="4" fill="#ffffff" opacity="0.45"/>')
    # side port (steam outlet): hex nut and round boss
    add(f'<path d="M318 196 L340 190 L352 196 V258 L340 264 L318 258 Z" fill="url(#steel)" stroke="{EDGE}" stroke-width="1.5"/>')
    add('<path d="M330 193 V261" stroke="#8d96a0" stroke-width="1.2"/>')
    add(f'<rect x="350" y="198" width="58" height="58" rx="8" fill="url(#steelv)" stroke="{EDGE}" stroke-width="1.5"/>')
    add('<path d="M372 198 V256" stroke="#8d96a0" stroke-width="1.2"/>')
    add(f'<ellipse cx="408" cy="227" rx="8" ry="28" fill="url(#steelv)" stroke="{EDGE}" stroke-width="1.5"/>')
    add('<ellipse cx="410" cy="227" rx="4.5" ry="17" fill="#3b4048"/>')
    # brass water fitting with its red O-ring
    add(f'<path d="M78 116 L90 110 H150 L162 116 V134 H78 Z" fill="url(#brass)" stroke="#6b4a0e" stroke-width="1.4"/>')
    add('<path d="M98 111 V134 M142 111 V134" stroke="#9c6b12" stroke-width="1.2"/>')
    add('<rect x="84" y="94" width="72" height="16" rx="8" fill="#b23a2c" stroke="#6e1d14" stroke-width="1.3"/>')
    add('<rect x="90" y="96" width="60" height="4" rx="2" fill="#e0705f" opacity="0.7"/>')
    add(f'<rect x="96" y="76" width="48" height="20" rx="3" fill="url(#brass)" stroke="#6b4a0e" stroke-width="1.3"/>')
    add(f'<rect x="86" y="66" width="68" height="12" rx="6" fill="url(#brass)" stroke="#6b4a0e" stroke-width="1.3"/>')
    add(f'<rect x="91" y="28" width="58" height="40" rx="4" fill="url(#brass)" stroke="#6b4a0e" stroke-width="1.3"/>')
    add('<path d="M106 30 V66 M134 30 V66" stroke="#b8862a" stroke-width="1.2"/>')
    add(f'<rect x="103" y="6" width="34" height="24" rx="2" fill="url(#brass)" stroke="#6b4a0e" stroke-width="1.3"/>')
    for y in range(9, 29, 4):
        add(f'<path d="M103 {y} L137 {y + 2}" stroke="#7d520c" stroke-width="1.1"/>')
    # heater terminals: dark and cream insulators, steel spades
    add(f'<rect x="183" y="126" width="30" height="16" rx="4" fill="url(#dark)" stroke="#15171a" stroke-width="1.2"/>')
    add(f'<rect x="187" y="78" width="22" height="50" rx="2" fill="url(#steel)" stroke="{EDGE}" stroke-width="1.3"/>')
    add('<path d="M187 84 L193 78 H203 L209 84" fill="none" stroke="#5b636d" stroke-width="1"/>')
    add('<circle cx="198" cy="106" r="3.2" fill="#3b4048"/>')
    add(f'<rect x="241" y="142" width="32" height="22" rx="4" fill="url(#dark)" stroke="#15171a" stroke-width="1.2"/>')
    add(f'<rect x="244" y="124" width="26" height="20" rx="3" fill="url(#cream)" stroke="#8a8370" stroke-width="1.2"/>')
    add(f'<rect x="246" y="76" width="22" height="50" rx="2" fill="url(#steel)" stroke="{EDGE}" stroke-width="1.3"/>')
    add('<path d="M246 82 L252 76 H262 L268 82" fill="none" stroke="#5b636d" stroke-width="1"/>')
    add('<circle cx="257" cy="104" r="3.2" fill="#3b4048"/>')
    add(f'<rect x="222" y="134" width="18" height="10" rx="2" fill="url(#brass)" stroke="#6b4a0e" stroke-width="1"/>')
    # ground stud in front of the terminals
    add(f'<rect x="200" y="132" width="13" height="42" rx="3" fill="url(#steel)" stroke="{EDGE}" stroke-width="1.3"/>')
    add('<rect x="202" y="134" width="3" height="38" fill="#ffffff" opacity="0.5"/>')
    for y in range(138, 160, 4):
        add(f'<path d="M200 {y} L213 {y + 2}" stroke="#7d8590" stroke-width="1"/>')

def boiler_top():
    plate = 'M30 6 Q190 -4 352 6 Q374 8 376 30 Q384 200 376 360 Q374 382 352 384 Q190 392 30 384 Q8 382 6 360 Q-2 200 6 30 Q8 8 30 6 Z'
    add(f'<rect x="-6" y="172" width="14" height="46" rx="3" fill="url(#flange)" stroke="{EDGE}" stroke-width="1.4"/>')
    add(f'<rect x="374" y="172" width="14" height="46" rx="3" fill="url(#flange)" stroke="{EDGE}" stroke-width="1.4"/>')
    add(f'<rect x="168" y="380" width="46" height="12" rx="3" fill="url(#flange)" stroke="{EDGE}" stroke-width="1.4"/>')
    add(f'<path d="{plate}" fill="url(#flange)" stroke="{EDGE}" stroke-width="1.8"/>')
    for hx, hy in ((36, 36), (346, 36), (36, 354), (346, 354)):
        add(f'<circle cx="{hx}" cy="{hy}" r="17" fill="#e4e8eb" stroke="#a9b0b8" stroke-width="1.2"/>'
            f'<circle cx="{hx}" cy="{hy}" r="11" fill="#ffffff" stroke="{EDGE}" stroke-width="1.6"/>')
    add(f'<circle cx="191" cy="195" r="182" fill="url(#castV)" stroke="{EDGE}" stroke-width="1.8"/>')
    add('<circle cx="191" cy="195" r="170" fill="none" stroke="#e9ecef" stroke-width="5"/>')
    add(f'<circle cx="191" cy="195" r="160" fill="url(#dome)" stroke="#9aa2aa" stroke-width="1.5"/>')
    add('<path d="M70 110 Q70 70 110 66 L272 66 Q312 70 312 110 L312 300 Q300 330 191 334 Q82 330 70 300 Z" fill="#c9cfd5" stroke="#9aa2aa" stroke-width="1.4"/>')
    add('<path d="M160 120 Q118 190 150 300 M222 120 Q264 190 232 300" fill="none" stroke="#aeb5bd" stroke-width="10" stroke-linecap="round" opacity="0.7"/>')
    add('<path d="M160 120 Q118 190 150 300 M222 120 Q264 190 232 300" fill="none" stroke="#e6eaed" stroke-width="3" stroke-linecap="round" opacity="0.8"/>')
    # brass hex fitting
    hx, hy, r = 191, 100, 36
    pts = ' '.join(f'{hx + r * c:.1f},{hy + r * s:.1f}' for c, s in ((0, -1), (0.866, -0.5), (0.866, 0.5), (0, 1), (-0.866, 0.5), (-0.866, -0.5)))
    add(f'<polygon points="{pts}" fill="url(#brassR)" stroke="#6b4a0e" stroke-width="1.5"/>')
    add(f'<circle cx="{hx}" cy="{hy}" r="22" fill="#b23a2c" stroke="#6e1d14" stroke-width="1.3"/>')
    add(f'<circle cx="{hx}" cy="{hy}" r="15" fill="url(#brassR)" stroke="#6b4a0e" stroke-width="1.2"/>')
    add(f'<circle cx="{hx}" cy="{hy}" r="9" fill="#d9a93a" stroke="#6b4a0e" stroke-width="1.2"/>')
    add(f'<circle cx="{hx}" cy="{hy}" r="4" fill="#5a3d08"/>')
    # heater terminals (spades seen from above) and the brass ring between them
    for ty, base in ((152, 'url(#dark)'), (216, 'url(#dark)')):
        add(f'<circle cx="290" cy="{ty + 4}" r="15" fill="{base}" stroke="#15171a" stroke-width="1.2"/>')
        add(f'<rect x="276" y="{ty - 6}" width="22" height="16" rx="2" fill="url(#steelv)" stroke="{EDGE}" stroke-width="1.3"/>')
        add(f'<circle cx="287" cy="{ty + 2}" r="2.4" fill="#3b4048"/>')
    add('<circle cx="292" cy="186" r="11" fill="url(#brassR)" stroke="#6b4a0e" stroke-width="1.3"/><circle cx="292" cy="186" r="5" fill="#e9ecef" stroke="#6b4a0e" stroke-width="1"/>')
    # ground stud
    add(f'<circle cx="104" cy="196" r="13" fill="#d5dade" stroke="#9aa2aa" stroke-width="1.2"/>')
    add(f'<circle cx="104" cy="196" r="8" fill="url(#steelv)" stroke="{EDGE}" stroke-width="1.3"/>')
    # side port, angled, at the lower left
    add('<g transform="translate(106 326) rotate(35)">'
        f'<rect x="-22" y="0" width="44" height="22" rx="3" fill="url(#steel)" stroke="{EDGE}" stroke-width="1.4"/>'
        f'<rect x="-20" y="20" width="40" height="40" rx="4" fill="url(#steel)" stroke="{EDGE}" stroke-width="1.4"/>'
        '<rect x="-16" y="56" width="32" height="6" rx="2" fill="#3b4048"/></g>')


def lug(x, y, d):
    """spade terminal whose tip is at (x, y), pointing d (L/R)"""
    x0 = x if d == 'L' else x - 20
    add(f'<rect x="{x0}" y="{y - 6}" width="20" height="12" rx="2" fill="url(#steelv)" stroke="#6e7781" stroke-width="1.2"/>')
    add(f'<circle cx="{x0 + 10}" cy="{y}" r="2.6" fill="#4a5059"/>')

def thermostat(temp):
    # same drawing as on the parts sheet
    add('<rect x="10" y="30" width="80" height="30" rx="5" fill="url(#bakelite)" stroke="#3b2a1a" stroke-width="1.5"/>')
    add('<rect x="4" y="54" width="92" height="10" rx="3" fill="url(#steelv)" stroke="#6e7781" stroke-width="1"/>')
    for hx in (12, 88):
        add(f'<circle cx="{hx}" cy="59" r="2.6" fill="#ffffff" stroke="#6e7781" stroke-width="0.8"/>')
    add('<rect x="22" y="6" width="56" height="26" rx="8" fill="url(#steelv)" stroke="#6e7781" stroke-width="1.5"/>')
    add('<rect x="22" y="6" width="56" height="8" rx="4" fill="#ffffff" opacity="0.35"/>')
    text(50, 24, temp, 11, '700', 'middle', '#3b4250')
    lug(-14, 42, 'L'); lug(114, 42, 'R')
    add('<rect x="-2" y="38" width="14" height="8" fill="#5b412a"/><rect x="88" y="38" width="14" height="8" fill="#5b412a"/>')

def boiler_assembly():
    """side view, front face toward us: everything that gets a wire is visible"""
    boiler_side()
    add('<g transform="translate(95.5 200) scale(0.75)">'); thermostat('105 °C'); add('</g>')
    add('<g transform="translate(211.5 200) scale(0.75)">'); thermostat('125 °C'); add('</g>')
    text(133, 201.5, 'BREW', 8, '700', 'middle', '#3b4250')
    text(249, 201.5, 'STEAM', 8, '700', 'middle', '#3b4250')

def card(x, y, w, h, title, sub):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="#fbfcfd" stroke="#d1d9e0" stroke-width="1.5"/>')
    text(x + 22, y + 34, title, 17, '700')
    text(x + 22, y + 56, sub, 13, '400', 'start', SUB)

card(20, 20, 1200, 600, 'BOILER WITH THERMOSTATS', 'side view, front face toward you: every connection point is visible')
S, OX, OY = 1.3, 330, 110
add(f'<g transform="translate({OX} {OY}) scale({S})">'); boiler_assembly(); add('</g>')
P = lambda x, y: (OX + x * S, OY + y * S)
x1, y1 = P(198, 76); x2, y2 = P(257, 74)
text((x1 + x2) / 2, y1 - 40, 'heater terminals', 14, '400', 'middle', SUB)
for lx, ly in ((x1, y1), (x2, y2)):
    add(f'<line x1="{(x1 + x2) / 2 + (-14 if lx == x1 else 14)}" y1="{y1 - 34}" x2="{lx}" y2="{ly - 4}" stroke="#8b949e" stroke-width="1.2"/>')
sx, sy = P(206, 162)
add(f'<line x1="{OX - 30}" y1="{sy}" x2="{sx - 8}" y2="{sy}" stroke="#8b949e" stroke-width="1.2"/>')
add(f'<circle cx="{sx}" cy="{sy}" r="3" fill="#8b949e"/>')
text(OX - 38, sy + 5, 'ground stud', 14, '400', 'end', SUB)

svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">' + DEFS +
       f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + ''.join(el) + '</svg>')
open(out, 'w').write(svg)
print('ok', len(svg))
