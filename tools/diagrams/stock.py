"""Draws docs/stock-wiring.png: the stock DeLonghi ECP wiring in its four switch positions, laid out
like u/Apprehensive_Sir_202's KiCad schematic (Reddit, ECP3630), redrawn with our own colours and symbols.

    python3 tools/diagrams/stock.py stock-wiring.svg
    node tools/diagrams/render.cjs stock-wiring.svg docs/stock-wiring.png

Nets: LINE -> pump 1, 105 C thermostat pin 2, switch A, red LED;  NEUTRAL -> switch 3;
switch B -> fuse -> heater 2, red LED;  heater 1 -> 125 C thermostat pin 2, green LED (other side to A);
105 C pin 1 -> 125 C pin 1 -> switch 2;  pump 2 -> switch 4.
Switch: OFF nothing, ON 3-B, BREW 3-4-B, STEAM 3-B and 2-A.
"""
import sys

out = sys.argv[1]
W, H = 2000, 1780
SANS = "'DejaVu Sans', 'Segoe UI', Arial, sans-serif"
MONO = "'DejaVu Sans Mono', Consolas, Menlo, monospace"
INK, SUB = '#1f2328', '#59636e'
C = {'L': '#d92d20', 'N': '#2b2b2b', 'B': '#8e4ec6', 'H': '#d6409f', 'G': '#0f9f8f', 'P': '#3e63dd', 'link': '#f97316'}
el = []
def add(s): el.append(s)

def text(x, y, s, size=13, weight='400', anchor='start', fill=INK, font=SANS):
    add(f'<text x="{x:.1f}" y="{y:.1f}" font-family="{font}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}" fill="{fill}">{s}</text>')

def panel(ox, oy, mode, joins):
    X = lambda x: ox + 20 + (x - 140)
    Y = lambda y: oy + 55 + (y - 115)
    def wire(pts, net, w=3.5):
        p = ' '.join(f'{X(x):.1f},{Y(y):.1f}' for x, y in pts)
        add(f'<polyline points="{p}" fill="none" stroke="{C[net]}" stroke-width="{w}" stroke-linejoin="round" stroke-linecap="round"/>')
    def dot(x, y, net):
        add(f'<circle cx="{X(x):.1f}" cy="{Y(y):.1f}" r="5.5" fill="{C[net]}"/>')
    def nc(x, y):
        add(f'<path d="M{X(x) - 6} {Y(y) - 6} L{X(x) + 6} {Y(y) + 6} M{X(x) + 6} {Y(y) - 6} L{X(x) - 6} {Y(y) + 6}" stroke="#3e63dd" stroke-width="2.5"/>')
    def stub(x1, x2, y):
        add(f'<line x1="{X(x1):.1f}" y1="{Y(y):.1f}" x2="{X(x2):.1f}" y2="{Y(y):.1f}" stroke="#7a1d1d" stroke-width="3"/>')
    def vstub(x, y1, y2):
        add(f'<line x1="{X(x):.1f}" y1="{Y(y1):.1f}" x2="{X(x):.1f}" y2="{Y(y2):.1f}" stroke="#7a1d1d" stroke-width="3"/>')
    def body(x1, y1, x2, y2, fill='#fff6d6'):
        add(f'<rect x="{X(x1):.1f}" y="{Y(y1):.1f}" width="{x2 - x1}" height="{y2 - y1}" rx="5" fill="{fill}" stroke="#7a1d1d" stroke-width="2.5"/>')
    def pinlabel(x, y, s, anchor='middle'):
        text(X(x), Y(y), s, 11, '700', anchor, '#7a1d1d')

    add(f'<rect x="{ox}" y="{oy}" width="960" height="785" rx="14" fill="#fbfcfd" stroke="#d1d9e0" stroke-width="1.5"/>')
    text(ox + 24, oy + 42, mode, 28, '700')
    head_w = {'OFF': 62, 'ON': 47, 'BREW': 93, 'STEAM': 107}[mode]
    text(ox + 24 + head_w + 18, oy + 41, joins, 16, '700', 'start', C['link'] if mode != 'OFF' else SUB)

    # ---- connector under the machine
    body(348, 158, 488, 322, '#ffffff')
    text(X(418), Y(132), 'Connector under', 13, '700', 'middle', '#2b6f86')
    text(X(418), Y(149), 'the machine', 13, '700', 'middle', '#2b6f86')
    for y, n in ((185, 'L'), (227, 'G'), (295, 'N')):
        stub(325, 348, y); stub(488, 510, y)
        text(X(362), Y(y + 5), n, 13, '700', 'middle', '#2b6f86', MONO)
        text(X(474), Y(y + 5), n, 13, '700', 'middle', '#2b6f86', MONO)
    nc(320, 227); nc(516, 227)
    for y, name, net in ((185, 'LINE', 'L'), (295, 'NEUTRAL', 'N')):
        wire([(268, y), (325, y)], net)
        wire([(268, y), (268, y - 34)], net)
        add(f'<polygon points="{X(268)},{Y(y - 44)} {X(268) - 7},{Y(y - 31)} {X(268) + 7},{Y(y - 31)}" fill="{C[net]}"/>')
        text(X(268), Y(y - 50), name, 13, '700', 'middle', C[net])

    # ---- pump
    body(630, 322, 655, 378)
    stub(605, 630, 335); stub(605, 630, 360)
    pinlabel(615, 328, '1'); pinlabel(615, 354, '2')
    text(X(668), Y(355), 'PUMP', 14, '700', 'start', INK)

    # ---- thermostats
    for y0, p1, p2, t in ((415, 430, 465, '105 °C'), (515, 537, 563, '125 °C')):
        body(430, y0, 458, y0 + 65)
        stub(400, 430, p1); stub(400, 430, p2)
        pinlabel(412, p1 - 6, '1'); pinlabel(412, p2 - 6, '2')
        text(X(472), Y(y0 + 27), 'THERMOSTAT', 13, '700', 'start', INK)
        text(X(472), Y(y0 + 47), t, 14, '700', 'start', INK)
    text(X(205), Y(452), 'Top of thermostat', 12, '400', 'middle', '#2b6f86')
    text(X(205), Y(468), 'is pin 1', 12, '400', 'middle', '#2b6f86')
    text(X(205), Y(578), 'Bottom of thermostat', 12, '400', 'middle', '#2b6f86')
    text(X(205), Y(594), 'is pin 2', 12, '400', 'middle', '#2b6f86')

    # ---- selector switch: terminals 1 2 A on the left, 3 4 B on the right
    add(f'<rect x="{X(800)}" y="{Y(186)}" width="165" height="148" rx="8" fill="#ffffff" stroke="{INK}" stroke-width="2.5"/>')
    text(X(882), Y(176), 'SELECTOR SWITCH', 13, '700', 'middle', INK)
    for y, n in ((210, '1'), (243, '2'), (313, 'A')):
        add(f'<line x1="{X(778)}" y1="{Y(y)}" x2="{X(800)}" y2="{Y(y)}" stroke="{INK}" stroke-width="3"/>')
        text(X(790), Y(y - 7), n, 13, '700', 'middle', INK, MONO)
    for y, n in ((205, '3'), (253, '4'), (313, 'B')):
        add(f'<line x1="{X(965)}" y1="{Y(y)}" x2="{X(987)}" y2="{Y(y)}" stroke="{INK}" stroke-width="3"/>')
        text(X(976), Y(y - 7), n, 13, '700', 'middle', INK, MONO)
    nc(772, 210)
    def link(pts):
        p = ' '.join(f'{X(x)},{Y(y)}' for x, y in pts)
        add(f'<polyline points="{p}" fill="none" stroke="{C["link"]}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>')
    if mode in ('ON', 'BREW', 'STEAM'):
        link([(965, 205), (935, 205), (935, 313), (965, 313)])
    if mode == 'BREW':
        link([(935, 253), (965, 253)])
        add(f'<circle cx="{X(935)}" cy="{Y(253)}" r="6" fill="{C["link"]}"/>')
    if mode == 'STEAM':
        link([(800, 243), (830, 243), (830, 313), (800, 313)])

    # ---- LEDs (pointing left, like the original)
    def led(x1, x2, y, colour, name):
        add(f'<polygon points="{X(x2) - 4},{Y(y) - 12} {X(x2) - 4},{Y(y) + 12} {X(x1) + 6},{Y(y)}" fill="{colour}" stroke="{colour}" stroke-width="2"/>')
        add(f'<line x1="{X(x1) + 5}" y1="{Y(y) - 12}" x2="{X(x1) + 5}" y2="{Y(y) + 12}" stroke="{colour}" stroke-width="3"/>')
        for dx in (0, 11):
            ax, ay = X(x1) + 6 + dx, Y(y) + 14
            add(f'<line x1="{ax}" y1="{ay}" x2="{ax - 9}" y2="{ay + 11}" stroke="{colour}" stroke-width="2"/>'
                f'<polygon points="{ax - 12},{ay + 15} {ax - 4},{ay + 11} {ax - 9},{ay + 6}" fill="{colour}"/>')
        text(X((x1 + x2) / 2), Y(y - 22), name, 13, '700', 'middle', INK)
    led(790, 832, 493, '#2da44e', 'GREEN LED')
    led(840, 872, 668, '#e5361b', 'RED LED')

    # ---- heater and fuse
    body(540, 690, 600, 720)
    zig = ' '.join(f'{X(546 + i * 4.8):.1f},{Y(705 + (-6 if i % 2 else 6)):.1f}' for i in range(11))
    add(f'<polyline points="{zig}" fill="none" stroke="#7a1d1d" stroke-width="2"/>')
    vstub(555, 720, 745); vstub(585, 720, 745)
    pinlabel(549, 737, '1', 'end'); pinlabel(592, 737, '2', 'start')
    text(X(612), Y(712), 'HEATING ELEMENT', 14, '700', 'start', INK)
    add(f'<rect x="{X(655)}" y="{Y(783)}" width="40" height="14" rx="3" fill="#ffffff" stroke="#7a1d1d" stroke-width="2.5"/>')
    text(X(675), Y(825), 'FUSE', 13, '700', 'middle', INK)

    # ---- wires
    wire([(510, 185), (577, 185), (577, 335), (605, 335)], 'L')                       # LINE to pump 1
    wire([(577, 335), (283, 335), (283, 668), (840, 668)], 'L')                       # LINE to the red LED
    wire([(283, 478), (395, 478), (395, 465), (400, 465)], 'L')                       # LINE to 105 C pin 2
    wire([(778, 313), (750, 313), (750, 405), (352, 405), (352, 465), (395, 465)], 'L')   # A to 105 C pin 2
    wire([(770, 313), (770, 345), (880, 345), (880, 493), (832, 493)], 'L')          # A to the green LED
    wire([(510, 295), (548, 295), (548, 138), (1010, 138), (1010, 205), (987, 205)], 'N')  # NEUTRAL to 3
    wire([(987, 313), (995, 313), (995, 790), (695, 790)], 'B')                       # B to the fuse
    wire([(872, 668), (995, 668)], 'B')                                               # red LED to B
    wire([(655, 790), (585, 790), (585, 745)], 'B')                                   # fuse to heater 2
    wire([(790, 493), (375, 493), (375, 563), (400, 563)], 'H')                       # green LED to 125 C pin 2
    wire([(390, 563), (390, 610), (340, 610), (340, 790), (555, 790), (555, 745)], 'H')   # 125 C pin 2 to heater 1
    wire([(400, 430), (362, 430), (362, 537), (400, 537)], 'G')                       # 105 C pin 1 to 125 C pin 1
    wire([(362, 537), (362, 648), (725, 648), (725, 243), (778, 243)], 'G')           # to switch 2
    wire([(605, 360), (590, 360), (590, 385), (1020, 385), (1020, 253), (987, 253)], 'P')  # pump 2 to switch 4
    for x, y, net in ((577, 335, 'L'), (283, 478, 'L'), (395, 465, 'L'), (770, 313, 'L'),
                      (362, 537, 'G'), (390, 563, 'H'), (995, 668, 'B')):
        dot(x, y, net)

# ---- title, credit, colour key
text(40, 56, 'STOCK DELONGHI ECP WIRING (BEFORE THE MOD)', 30, '700')
text(40, 88, 'The original selector switch in its four positions. Laid out like u/Apprehensive_Sir_202’s schematic '
     '(Reddit, ECP3630), redrawn.', 15, '400', 'start', SUB)
kx = 40
for net, name in (('L', 'LINE'), ('N', 'NEUTRAL'), ('B', 'switch B side'), ('H', 'heater side'),
                  ('G', 'between thermostats'), ('P', 'pump to switch 4'), ('link', 'joined inside the switch')):
    add(f'<line x1="{kx}" y1="128" x2="{kx + 34}" y2="128" stroke="{C[net]}" stroke-width="{6 if net == "link" else 4}" stroke-linecap="round"/>')
    text(kx + 44, 133, name, 14, '700', 'start', INK)
    kx += 44 + len(name) * 8.6 + 34
panel(20, 170, 'OFF', 'switch joins nothing')
panel(1020, 170, 'ON', 'switch joins 3–B')
panel(20, 975, 'STEAM', 'switch joins 3–B and 2–A')
panel(1020, 975, 'BREW', 'switch joins 3–4–B')

svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
       f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + ''.join(el) + '</svg>')
open(out, 'w').write(svg)
print('ok', len(svg))
