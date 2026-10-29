"""Draws the high-voltage (mains) wiring diagram as an SVG, same size as the low-voltage one (2000 x 1414).

    python3 tools/diagrams/highvoltage.py /tmp/wiring-high-voltage.svg
    node tools/diagrams/render.cjs /tmp/wiring-high-voltage.svg docs/wiring-high-voltage.png

The parts come unchanged from hv_parts/parts.py (parts sheet) and hv_parts/boiler_top.py (boiler from the top).
Wires are drawn one component at a time (steps 1-8), then the numbers, the toggle ramps and the legend.
The text is sized for the DejaVu Sans fonts; other fonts may not fit."""
import os, re, sys

out = sys.argv[1]
HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hv_parts') + os.sep
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ---- load the approved part drawings into one namespace
NS = {'__file__': HERE + 'parts.py'}
src = open(HERE + 'parts.py').read()
prelude = src[:src.index('# ================================================================== the sheet')]
sys_argv = sys.argv
exec(compile(prelude, 'parts.py', 'exec'), NS)
add, text, g, eg = NS['add'], NS['text'], NS['g'], NS['eg']
NS['EDGE'] = '#5b636d'

bsrc = open(HERE + 'boiler_top.py').read()
d0 = bsrc.index("'''", bsrc.index("DEFS = '<defs>'")) + 3
d1 = bsrc.index("'''", d0)
bt_defs = bsrc[d0:d1].replace('</defs>', '')
_b0 = bsrc.index('def red_wire(d):')
body = bsrc[_b0:bsrc.index('def card(', _b0)]
for i in sorted(set(re.findall(r'id="([^"]+)"', bt_defs)), key=len, reverse=True):
    bt_defs = bt_defs.replace(f'id="{i}"', f'id="bt-{i}"'); body = body.replace(f'url(#{i})', f'url(#bt-{i})')
exec(compile(body, 'boiler_top.py', 'exec'), NS)
DEFS = NS['DEFS'].replace('</defs>', bt_defs + '</defs>')

W, H = 2000, 1414
INK, SUB = '#1f2328', '#59636e'

FS = 20                                                   # one label size for the whole schematic
def name(x, y, s, anchor='middle', size=FS):
    text(x, y, s, size, '700', anchor, '#3b4250')

import base64
LOGO = base64.b64encode(open(os.path.join(REPO, 'docs', 'logo-light.png'), 'rb').read()).decode()
NOTEXT = lambda *a, **k: None

# ---- title: the logo with dark letters (logo-light.png is the one for white backgrounds)
add(f'<image href="data:image/png;base64,{LOGO}" x="48" y="22" width="235" height="65"/>')
text(294, 67, 'WIRING (HIGH-VOLTAGE SIDE)', 30, '700')
text(60, 96, 'Mains 120 / 230 V · connection points numbered', 16, '400', 'start', SUB)

# ---- SSR, top left, turned so its AC side (1, 2) faces right
add('<g transform="translate(508 153) rotate(90) scale(0.9)">'); NS['ssr'](); add('</g>')
name(418, 312, 'SSR-40 DA')

# ---- selector switch (knob), top centre, mirrored: steam side (2, A) on the right like the original
SS, SX, SY = 1.5, 927.5, 19
NS['text'] = NOTEXT
add(f'<g transform="translate({SX + 165 * SS} {SY}) scale({-SS} {SS})">'); NS['selector'](); add('</g>')
NS['text'] = text
for n, x, y in (('1', 178, 14), ('2', 178, 47), ('A', 178, 117), ('3', -13, 9), ('4', -13, 57), ('B', -13, 117)):
    text(SX + x * SS, SY + y * SS, n, FS, '700', 'middle', INK)
add(f'<rect x="848" y="{SY + 148 * SS + 20}" width="384" height="24" rx="4" fill="#ffff00"/>')   # yellow highlight, like the warning
text(1040, SY + 148 * SS + 37, 'MAIN: ALL ON/OFF, BREW, STEAM', FS, '700', 'middle', '#ff0000')   # fits between the red B wire and the green-LED wire

# ---- pump, top right, terminals up
add('<g transform="translate(1449 318) rotate(-90)">'); NS['pump'](); add('</g>')
name(1579, 198, 'PUMP', 'start')

# ---- AC dimmer, left
g(96, 437, 1.0); NS['dimmer'](); eg()
name(246, 562, 'AC DIMMER 4A')

# ---- front panel LEDs, left of the boiler
for x, y, lens, label in ((625, 632, 'lensG', 'GREEN LED'), (624, 719, 'lensR', 'RED LED')):
    add(f'<g transform="translate({x} {y}) scale(1.3)">'); NS['lamp'](0, 0, lens); add('</g>')
    name(x, y + 42, label)

# ---- boiler from the top, turned 180°: thermostats and the TCO's loose lead face the knob
BX, BY = 887, 431
NS['text'] = NS['BO']['text'] = NOTEXT
add(f'<g transform="translate({BX + 382} {BY + 390}) rotate(180)">')
NS['boiler_top_real'](); NS['water_fitting_left'](); NS['outlet_right'](); NS['heater_terminals_and_stud']()
NS['thermostats_front'](); NS['tco_long'](300, 62, 470, 312)
add('</g>')
NS['text'] = NS['BO']['text'] = text
for bx, temp, nm in ((84, '105 °C', 'BREW'), (230, '125 °C', 'STEAM')):          # labels kept upright
    text(BX + 382 - bx, 350, nm, FS, '700', 'middle', '#3b4250')
    text(BX + 382 - bx, 373, temp, FS, '700', 'middle', '#3b4250')
name(BX + 191, BY + 390 + 34, 'BOILER (FROM THE TOP)')

# ---- ON-OFF-ON toggle, bottom left
TS, TX, TY = 1.2, 170, 877
g(TX, TY, TS); NS['toggle_back'](); eg()
for i, lab in enumerate(("← DE'LONGEZZI", '← COMMON', '← STOCK')):
    text(TX + 160 * TS + 20, TY + (32 + 48 * i) * TS - 7, lab, FS, '700', 'start', INK)
name(TX + 80 * TS, TY - 38, 'ON-OFF-ON TOGGLE (WIRE SIDE)')

# ---- Wago 221 lever connectors instead of the terminal block: HOT above the cord, NEUTRAL below.
# wago() takes the number of slots, so a slot can be added or removed later by changing one number.
WAGO_DEFS = """
<linearGradient id="wg-clear" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e3eaf0"/><stop offset="0.45" stop-color="#f6f9fb"/><stop offset="1" stop-color="#cfd9e2"/></linearGradient>
<linearGradient id="wg-orange" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb062"/><stop offset="0.5" stop-color="#f5801a"/><stop offset="1" stop-color="#c85c00"/></linearGradient>
<linearGradient id="wg-tin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f3f5"/><stop offset="0.5" stop-color="#c3c9cf"/><stop offset="1" stop-color="#8d96a0"/></linearGradient>
"""
WG_H = 28                                                   # one slot

def wago(x, y, n):
    """Wago 221 seen from the top, n slots, wire entries on the left. Returns the entry point of each slot."""
    h = n * WG_H + 8
    add(f'<rect x="{x}" y="{y}" width="120" height="{h}" rx="7" fill="url(#wg-clear)" stroke="#8fa1b0" stroke-width="1.4"/>')
    add(f'<rect x="{x + 50}" y="{y + 6}" width="6" height="{h - 12}" rx="2" fill="url(#wg-tin)" opacity="0.9"/>')   # bus bar inside
    entries = []
    for i in range(n):
        cy = y + 4 + i * WG_H + WG_H / 2
        if i:
            add(f'<line x1="{x + 4}" y1="{cy - WG_H / 2}" x2="{x + 116}" y2="{cy - WG_H / 2}" stroke="#b9c6d1" stroke-width="1"/>')
        add(f'<rect x="{x + 6}" y="{cy - 9}" width="50" height="18" rx="4" fill="#ffffff" opacity="0.55" stroke="#c3cfd9" stroke-width="0.8"/>')
        add(f'<rect x="{x + 16}" y="{cy - 3}" width="38" height="6" rx="2" fill="url(#wg-tin)"/>')                    # clamp
        add(f'<rect x="{x + 1}" y="{cy - 6}" width="11" height="12" rx="3" fill="#3b4048"/>')                          # entry hole
        add(f'<rect x="{x + 60}" y="{cy - 11}" width="56" height="22" rx="6" fill="url(#wg-orange)" stroke="#a34a00" stroke-width="1.1"/>')
        add(f'<rect x="{x + 62}" y="{cy - 9}" width="10" height="18" rx="3" fill="#ffc285" opacity="0.65"/>')        # lever lip
        for gx in (98, 104, 110):                                                                                         # grip ridges
            add(f'<line x1="{x + gx}" y1="{cy - 7}" x2="{x + gx}" y2="{cy + 7}" stroke="#b85400" stroke-width="1.6"/>')
        entries.append((x + 1, cy))
    return entries

WX = 1776
HOT_N, NEU_N = 8, 4
hot = wago(WX, 318, HOT_N)
neu = wago(WX, 590, NEU_N)
name(WX + 74, 306, 'LINE (WAGO)')
name(WX + 60, 734, 'NEUTRAL (WAGO)')

# ---- stock terminal block (kept), top right, turned so L, G, N sit side by side; the cord comes in from the back (top edge)
TBS, TBX, TBY = 0.44, 1889, 229.8
NS['TB']['text'] = NOTEXT                                                          # its L/G/N letters are redrawn upright below
add(f'<g transform="translate({TBX} {TBY}) rotate(-90) scale({TBS})">'); NS['TB']['terminal_block'](); add('</g>')
NS['TB']['text'] = text
TB_TOP = {k: (TBX + yc * TBS, TBY - 181 * TBS) for k, yc in (('L', 35), ('G', 119), ('N', 203))}   # cord side
TB_BOT = {k: (TBX + yc * TBS, TBY + 1 * TBS) for k, yc in (('L', 35), ('G', 119), ('N', 203))}     # machine side

def cord_top(cx, y_tip, s):
    """the power cord, plug pointing up out of the sheet; returns where its wires come out"""
    add(f'<g transform="matrix(0 {s} {s} 0 {cx - 50 * s} {y_tip})">')
    for y in (20, 46):
        add(f'<rect x="0" y="{y}" width="42" height="14" rx="2" fill="url(#steelv)" stroke="#6e7781" stroke-width="1.2"/>')
        add(f'<circle cx="12" cy="{y + 7}" r="3.2" fill="#ffffff" stroke="#6e7781" stroke-width="1"/>')
    add('<path d="M42 70 H12 A7 7 0 0 0 12 84 H42 Z" fill="url(#steelv)" stroke="#6e7781" stroke-width="1.2"/>')
    add('<rect x="36" y="6" width="96" height="88" rx="16" fill="url(#rubber)" stroke="#0d0f11" stroke-width="1.5"/>')
    add('<rect x="36" y="6" width="12" height="88" rx="6" fill="#1a1c20"/>')
    for i in range(5):
        add(f'<rect x="{74 + i * 11}" y="14" width="5" height="72" rx="2.5" fill="#0f1114" opacity="0.65"/>')
    add('<path d="M132 26 L184 38 L184 62 L132 74 Z" fill="url(#rubber)" stroke="#0d0f11" stroke-width="1.2"/>')
    for x in (146, 158, 170):
        add(f'<line x1="{x}" y1="{29 + (x - 132) * 0.23}" x2="{x}" y2="{71 - (x - 132) * 0.23}" stroke="#0b0c0e" stroke-width="2"/>')
    add('</g>')
    return cx, y_tip + 184 * s

def hv_wire(d, col, edge, w=5):
    add(f'<path d="{d}" fill="none" stroke="{edge}" stroke-width="{w + 2.2}" stroke-linecap="round" stroke-linejoin="round"/>')
    add(f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>')
BLACK_W, GREEN_W, WHITE_W = ('#2b2b2b', '#111111'), ('#2fa84f', '#1b6b31'), ('#d0d5db', '#8b939e')

for k in ('L', 'G', 'N'):
    text(TB_BOT[k][0] - 7, 249, k, FS, '700', 'end', INK)
fx, fy = cord_top(1927.5, -3, 0.55)
for (k, dx), wc in zip((('L', -5), ('G', 0), ('N', 5)), (BLACK_W, GREEN_W, WHITE_W)):
    ex, ey = TB_TOP[k]
    hv_wire(f'M{fx + dx} {fy} C {fx + dx} {fy + 22}, {ex} {ey - 26}, {ex} {ey + 3}', *wc, w=4)
text(fx - 32, 48, 'POWER CORD', FS, '700', 'end', '#3b4250')

# block (machine side) → Wagos and boiler ground; feeds enter the Wagos' top slots from the left
(hx, hy), (nx, ny) = hot[0], neu[0]
lx, ly = TB_BOT['L']
hv_wire(f'M{lx} {ly - 3} L {lx} 254 Q {lx} 262 {lx - 8} 262 L {WX - 6} 262 Q {WX - 14} 262 {WX - 14} 270 '
        f'L {WX - 14} {hy - 8} Q {WX - 14} {hy} {WX - 6} {hy} L {hx + 6} {hy}', *BLACK_W)
gx, gy = TB_BOT['G']                                                              # ground runs to 22, drawn with the wires
nx0, ny0 = TB_BOT['N']
hv_wire(f'M{nx0} {ny0 - 3} L {nx0} 570 Q {nx0} 578 {nx0 - 8} 578 L {WX - 12} 578 Q {WX - 20} 578 {WX - 20} 586 '
        f'L {WX - 20} {ny - 8} Q {WX - 20} {ny} {WX - 12} {ny} L {nx + 6} {ny}', *WHITE_W)
for ex, ey in ((hx, hy), (nx, ny)):                                                  # stripped ends seen through the clear body
    add(f'<rect x="{ex + 4}" y="{ey - 2.2}" width="16" height="4.4" rx="1.5" fill="url(#copper)"/>')

# ---- 5 V supply, right
g(1677, 755, 0.72); NS['psu'](); eg()
name(1677 + 170 * 0.72, 755 + 160 * 0.72 + 26, '5 V 2 A SUPPLY')

# ---- wires, step 1: the knob (one color per connection; line black, neutral grey)
def run(pts, col, edge, w=5, r=9):
    """orthogonal wire through pts with rounded corners, white halo so a crossing wire shows a gap"""
    d = f'M{pts[0][0]} {pts[0][1]}'
    for i in range(1, len(pts) - 1):
        (x0, y0), (x1, y1), (x2, y2) = pts[i - 1], pts[i], pts[i + 1]
        ax = (x1 - x0) and (1 if x1 > x0 else -1); ay = (y1 - y0) and (1 if y1 > y0 else -1)
        bx = (x2 - x1) and (1 if x2 > x1 else -1); by = (y2 - y1) and (1 if y2 > y1 else -1)
        d += f' L {x1 - ax * r} {y1 - ay * r} Q {x1} {y1} {x1 + bx * r} {y1 + by * r}'
    d += f' L {pts[-1][0]} {pts[-1][1]}'
    add(f'<path d="{d}" fill="none" stroke="#ffffff" stroke-width="{w + 8}" stroke-linecap="round" stroke-linejoin="round"/>')
    hv_wire(d, col, edge, w)

ORANGE, RED_W, PINK = ('#f76b15', '#a8410a'), ('#e5484d', '#9b2226'), ('#d6409f', '#8e1f63')
BROWN, BLUE, TEAL = ('#a0522d', '#5c2e14'), ('#3e63dd', '#1f3a8a'), ('#0f9d8f', '#0a5f57')   # 4 and 3 keep the machine's own wire colors
LUG_L, LUG_R = SX + (165 - 184) * SS, SX + (165 + 19) * SS          # just inside the knob's lug tips
KY = lambda yo: SY + yo * SS
hot_slot = lambda i: hot[i]
neu_slot = lambda i: neu[i]

# knob 2 → both thermostats' inner spades (19, 20): drop into the gap between them, short link across
run([(LUG_R, KY(57)), (1262, KY(57)), (1262, 320), (1112, 320), (1112, 399.5)], *ORANGE)
hv_wire('M1097 399.5 L1127 399.5', *ORANGE)
add('<circle cx="1112" cy="399.5" r="6" fill="#f76b15" stroke="#a8410a" stroke-width="1.2"/>')
# knob A ← line (HOT Wago)
ax0, ay0 = hot_slot(1)
run([(ax0 + 6, ay0), (1290, ay0), (1290, KY(127)), (LUG_R, KY(127))], *BLACK_W)
# knob B → TCO loose lead (17)
run([(LUG_L, KY(127)), (842, KY(127)), (842, 290), (969, 290), (969, 313)], *RED_W)
# knob 4 → toggle STOCK 2 (32): the original wire that went to the pump
t32x, t32y = TX + 80 * TS, TY + 128 * TS
run([(LUG_L, KY(67)), (826, KY(67)), (826, 1110), (t32x, 1110), (t32x, t32y + 18)], *BROWN)
# knob 3 ← neutral (NEUTRAL Wago)
nx1, ny1 = neu_slot(1)
run([(nx1 + 6, ny1), (1588, ny1), (1588, 880), (810, 880), (810, KY(19)), (LUG_L, KY(19))], *BLUE)

# ---- wires, step 2: thermostats and heater
YELLOW = ('#e8b300', '#8a6a00')
# brew thermostat outer spade (21) ← line (HOT Wago)
bx0, by0 = hot_slot(2)
run([(bx0 + 6, by0), (1238, by0)], *BLACK_W)
# steam thermostat outer spade (18) → toggle STOCK 3 (33): over the TCO sleeve, down outside the boiler (left of the grey)
t33x, t33y = TX + 128 * TS, TY + 128 * TS
run([(992, 407), (794, 407), (794, 1095), (t33x, 1095), (t33x, t33y + 18)], *YELLOW)
# heater terminal (24) → toggle COMMON 3 (30)
t30x, t30y = TX + 128 * TS, TY + 80 * TS
run([(1150, 745), (1300, 745), (1300, 1060), (376, 1060), (376, t30y), (t30x + 18, t30y)], *TEAL)

# ---- wires, step 3: SSR (AC side; its screws sit at x 482, wires end at the screw head)
PURPLE = ('#8e4ec6', '#4f2a7a')
# SSR 1 ← line (HOT Wago): down the right side of the boiler, under it, up its left side
sx0, sy0 = hot_slot(3)
run([(sx0 + 6, sy0), (1404, sy0), (1404, 896), (778, 896), (778, 183), (494, 183)], *BLACK_W)
# SSR 2 → toggle DE'LONGEZZI 3 (27): into the top row from the right, like 30
t27x, t27y = TX + 128 * TS, TY + 32 * TS
run([(494, 258), (720, 258), (720, 880), (376, 880), (376, t27y), (t27x + 18, t27y)], *PURPLE)

# ---- wires, step 4: pump (spade tabs point up, tips at y 64) and AC dimmer (wires enter its terminal block at x 391)
CYAN, SKY = ('#00b4d8', '#00708a'), ('#9ad0f5', '#4a8db8')
# pump 9 → toggle COMMON 2 (29): over the top, down the left of the pump, along the bottom, up between 31 and 32
t29x, t29y = TX + 80 * TS, TY + 80 * TS
run([(1537, 70), (1537, 20), (1420, 20), (1420, 1128), ((TX + 32 * TS + t29x) / 2, 1128),
     ((TX + 32 * TS + t29x) / 2, t29y), (t29x - 18, t29y)], *SKY)
# pump 8 → toggle COMMON 1 (28): same way, outside the 9 wire, into 28 from the left
t28x, t28y = TX + 32 * TS, TY + 80 * TS
run([(1497, 70), (1497, 36), (1436, 36), (1436, 1144), (140, 1144), (140, t28y), (t28x - 18, t28y)], *CYAN)
# dimmer OUT (38) → toggle DE'LONGEZZI 1 (25): up over the dimmer, down the far left, into 25 from the left
t25x, t25y = TX + 32 * TS, TY + 32 * TS
run([(391, 455), (480, 455), (480, 410), (48, 410), (48, t25y), (t25x - 18, t25y)], *PINK)
# dimmer L (39) ← line (HOT Wago): down beside the SSR wire, under the boiler, up the left side
dx0, dy0 = hot_slot(4)
run([(dx0 + 6, dy0), (1452, dy0), (1452, 912), (762, 912), (762, 487), (391, 487)], *BLACK_W)
# dimmer N (40) ← neutral (NEUTRAL Wago): outside the knob-3 neutral, same way
nx2, ny2 = neu_slot(2)
run([(nx2 + 6, ny2), (1604, ny2), (1604, 928), (746, 928), (746, 519), (391, 519)], *WHITE_W)

# ---- wires, step 5: LEDs (stock wires, unchanged); a second wire on a terminal ends at its number
# green LED → knob A (7): up the left, under badge 17 across the TCO lead, under the knob label into 7
run([(592, 632), (540, 632), (540, 344), (988, 344), (988, 300), (1238, 300), (1238, 225.6)], *BLACK_W)
# green LED → steam thermostat outer spade (18): between the purple and the dimmer wires, across the TCO sleeve
run([(658, 632), (733, 632), (733, 391), (992, 391)], *YELLOW)
# red LED → knob B (5): around the green LED, up past the SSR, over to 5 from above
run([(591, 719), (524, 719), (524, 320), (600, 320), (600, 150), (872, 150), (872, 191.5)], *RED_W)
# red LED → line (HOT Wago): down the same way as the dimmer wires, under the boiler, up the right side
lx5, ly5 = hot_slot(5)
run([(657, 719), (733, 719), (733, 944), (1468, 944), (1468, ly5), (lx5 + 6, ly5)], *BLACK_W)

# ---- wires, step 6: 5 V supply (wires soldered to its L and N pads at x 1688)
# supply L (15) ← line (HOT Wago): inside the two neutrals, then across them into L
sx7, sy7 = hot_slot(7)
run([(sx7 + 6, sy7), (1572, sy7), (1572, 799.6), (1686, 799.6)], *BLACK_W)
# supply N (16) → knob B (5): up the right side, under the pump, between the knob and its label, into 5 from below
run([(1686, 825.6), (1530, 825.6), (1530, 330), (1310, 330), (1310, 253), (872, 253), (872, 227.5)], *RED_W)

# ---- wires, step 7: ground, block G (11) → boiler clip nut (22): under the HOT Wago, across the right side, over the outlet pipe
run([(gx, gy - 3), (gx, 562), (1490, 562), (1490, 509), (1092, 509)], *GREEN_W)

# ---- wires, step 8: toggle feeds
# toggle STOCK 1 (31) ← line (HOT Wago): down the right side, along the very bottom, up into 31
tx6, ty6 = hot_slot(6)
t31x, t31y = TX + 32 * TS, TY + 128 * TS
run([(tx6 + 6, ty6), (1506, ty6), (1506, 1176), (t31x, 1176), (t31x, t31y + 18)], *BLACK_W)
# toggle DE'LONGEZZI 2 (26) ← neutral (NEUTRAL Wago): outside the other neutrals, along the bottom, up the far left,
# over the toggle (its title moved up) and down into 26
nx3, ny3 = neu_slot(3)
t26x, t26y = TX + 80 * TS, TY + 32 * TS
run([(nx3 + 6, ny3), (1620, ny3), (1620, 1192), (24, 1192), (24, 860), (t26x, 860), (t26x, t26y - 18)], *WHITE_W)

# ---- connection point numbers: black circle, white number; clockwise from the SSR
def badge(x, y, n, r=18, size=FS):
    add(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#111111" stroke="#ffffff" stroke-width="2.2"/>')
    text(x, y + size * 0.36, str(n), size, '700', 'middle', '#ffffff')

toggle_xy = [(TX + c * TS, TY + r * TS) for r in (32, 80, 128) for c in (32, 80, 128)]
POINTS = [
    (530, 183), (530, 258),                                          # 1-2   SSR 1, 2
    (872, SY + 19 * SS), (872, SY + 67 * SS), (872, SY + 127 * SS),  # 3-5   knob 3, 4, B
    (1230, SY + 57 * SS), (1230, SY + 127 * SS),                     # 6-7   knob 2, A
    (1468, 66), (1566, 66),                                          # 8-9   pump
    (TB_BOT['L'][0], 272), (TB_BOT['G'][0], 272), (TB_BOT['N'][0], 272),   # 10-12 block L, G, N (on their wires)
    (1917, 434), (1917, 650),                                        # 13-14 HOT, NEUTRAL Wago
    (1656, 792), (1656, 834),                                        # 15-16 supply L, N
    (944, 316),                                                      # 17    TCO loose lead
    (1002, 399.5), (1079.5, 399.5), (1144.5, 399.5), (1225.5, 399.5),        # 18-21 steam, brew thermostat spades
    (1081, 509),                                                     # 22    ground on the clip nut
    (1065, 800), (1137, 788),                                        # 23-24 heater terminals
] + toggle_xy + [                                                    # 25-33 toggle screws, row by row
    (571, 632), (679, 632), (570, 719), (678, 719),                  # 34-37 green, red LED
    (413, 455), (451, 487), (413, 519),                              # 38-40 dimmer OUT, L, N
]
# toggle contacts: each middle (COMMON) pin flips to the pin above or below (dashed), lever in the middle = off
for cx in (TX + 32 * TS, TX + 80 * TS, TX + 128 * TS):
    for (y0, y1), dash in (((TY + 80 * TS - 13, TY + 32 * TS + 12.6), ' stroke-dasharray="4 3"'), ((TY + 80 * TS + 13, TY + 128 * TS - 12.6), ' stroke-dasharray="4 3"')):
        d = f'M{cx + 8} {y0} L{cx - 8} {y1}'
        add(f'<path d="{d}" stroke="#ffffff" stroke-width="7" stroke-linecap="round"/>')
        add(f'<path d="{d}" stroke="#111111" stroke-width="3"{dash}/>')
for i, (x, y) in enumerate(POINTS, 1):
    badge(x, y, i)

# ---- low-voltage sides: a tag where each part's low-voltage wires leave this drawing (mirrors the low-voltage diagram's tags)
LV = '#1f2a44'
def lv_tag(x, y, w=298, h=54):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{LV}"/>')
    text(x + w / 2, y + h / 2 - 3, 'CONTINUES IN', FS, '700', 'middle', '#ffffff')
    text(x + w / 2, y + h / 2 + 21, 'LOW-VOLTAGE DIAGRAM', FS, '700', 'middle', '#ffffff')
def lv_line(d):
    add(f'<path d="{d}" fill="none" stroke="{LV}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>')
# SSR DC side (4 −, 3 +): both screws into one tag on its left
lv_line('M354 183 L318 183 M354 258 L318 258')
lv_tag(20, 172, h=97)
# dimmer header pins (DIM, Z-C, VCC, GND): comb down to a tag under its name
lv_line('M72 458.5 H60 M72 476 H60 M72 493.5 H60 M72 511 H60 M60 458.5 V603 H72')
lv_tag(72, 576)
# supply +5V and GND pads: comb down to a tag under its name
lv_line('M1910 799.6 H1950 M1910 825.6 H1950 M1950 799.6 V912')
lv_tag(1672, 912)

# ---- legend: the builder's notes from the original drawing, renumbered
WARN = '#d0281f'
add('<rect x="32" y="1216" width="1350" height="28" rx="4" fill="#ffff00"/>')          # yellow highlight behind the warning
text(40, 1236, "DON'T UNPLUG EVERYTHING AT ONCE: MOVE ONE WIRE AT A TIME. YOU WON'T NEED TO CUT OR CHANGE EVERY WIRE.", FS, '700', 'start', '#ff0000')
g(44, 1252, 0.3); NS['toggle_back'](); eg()
text(106, 1274, 'CHECK WITH A MULTIMETER WHICH', FS, '700', 'start', INK)
text(106, 1298, 'PINS CONNECT IN EACH SWITCH POSITION', FS, '700', 'start', INK)
badge(58, 1330, 17)
text(82, 1337, 'TCO', FS, '700', 'start', WARN)
badge(151, 1330, 23)
text(179, 1337, "LEAVE IT AS ORIGINAL. IT'S THE SAFETY CUTOFF", FS, '700', 'start', WARN)
text(40, 1376, 'LEDS: IN STOCK MODE THEY WORK AS BEFORE.', FS, '700', 'start', INK)
text(40, 1400, "IN DE'LONGEZZI MODE, THE SCREEN REPLACES THE GREEN LED.", FS, '700', 'start', INK)
for y, n, note in ((1268, 4, 'ORIGINAL WIRE (BROWN IN MY MACHINE), NORMALLY GOES STRAIGHT TO THE PUMP'),
                   (1308, 3, 'ORIGINAL WIRE (BLUE IN MY MACHINE), NORMALLY GOES TO THE TERMINAL BLOCK'),
                   (1348, 5, 'ORIGINAL, THE ONLY TERMINAL WITH 2 WIRES (BLACK AND RED IN MY MACHINE)')):
    badge(1000, y - 7, n)
    text(1028, y, note, FS, '700', 'start', INK)
# toggle ramps key: a small solid and dashed ramp from one middle pin
add('<path d="M1012 1381 L988 1368" stroke="#111111" stroke-width="3" stroke-dasharray="4 3"/>'
    '<path d="M1012 1381 L988 1394" stroke="#111111" stroke-width="3" stroke-dasharray="4 3"/>'
    '<circle cx="1012" cy="1381" r="4" fill="#111111"/>')
text(1028, 1388, 'TOGGLE SWITCH: FLIPS UP OR DOWN, LEVER IN MIDDLE = PUMP AND HEATER OFF', FS, '700', 'start', INK)

DEFS = DEFS.replace('</defs>', WAGO_DEFS + '</defs>')
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">' + DEFS +
       f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + ''.join(NS['el']) + '</svg>')
open(out, 'w').write(svg)
print('ok', len(svg))
