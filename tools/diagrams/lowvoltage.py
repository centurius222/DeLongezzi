"""Draws docs/wiring-low-voltage.png, the low-voltage wiring diagram, as an SVG.

    python3 tools/diagrams/lowvoltage.py wiring-low-voltage.svg
    node tools/diagrams/render.cjs wiring-low-voltage.svg docs/wiring-low-voltage.png

Every GPIO comes from the firmware: GM_PRO_LEGO in lib/GaggiMateController/src/ControllerConfig.h,
and TOUCH_PIN in src/display/plugins/WaterLevelPlugin.cpp. Check them there before changing a pin.
The text is sized for the DejaVu Sans fonts; other fonts may not fit the tags.
"""
import base64, math, os, sys

out = sys.argv[1]
W, H = 2000, 1414
SANS = "'DejaVu Sans', 'Segoe UI', Arial, sans-serif"
MONO = "'DejaVu Sans Mono', Consolas, Menlo, monospace"
RED, BLACK, AMBER, HEAT = '#e5484d', '#2b2b2b', '#f5a623', '#ec5d2a'
GREEN, BLUE, PURPLE, TEAL, CYAN, MAINS, GREY = '#30a46c', '#3e63dd', '#8e4ec6', '#12a594', '#0797b9', '#7a1d1d', '#8b949e'
el = []
def add(s): el.append(s)

def text(x, y, s, size=13, weight='400', anchor='start', fill='#1f2328', font=SANS, rot=None, spacing=None):
    t = f' transform="rotate({rot} {x} {y})"' if rot else ''
    ls = f' letter-spacing="{spacing}"' if spacing else ''
    add(f'<text x="{x}" y="{y}" font-family="{font}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}" fill="{fill}"{t}{ls}>{s}</text>')

def pin(x, y):
    add(f'<circle cx="{x}" cy="{y}" r="7" fill="#d4a72c" stroke="#8a6d1a"/><circle cx="{x}" cy="{y}" r="3" fill="#161616"/>')

def screw(x, y, r=9):
    add(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#d9dde3" stroke="#6e7781" stroke-width="1.5"/>'
        f'<line x1="{x - r + 3}" y1="{y}" x2="{x + r - 3}" y2="{y}" stroke="#57606a" stroke-width="2"/>')

def pill(x, y, colour, s, side='R', size=12.5, w=None, fg='#ffffff'):
    w = w or len(s) * 7.8 + 20
    x0 = x - w if side == 'L' else x
    add(f'<rect x="{x0:.1f}" y="{y - 10.5}" width="{w:.1f}" height="21" rx="10.5" fill="{colour}"/>')
    text(x0 + w / 2, y + 4.5, s, size, '700', 'middle', fg)
    return x0, x0 + w

def stub(x1, y, x2, colour):
    add(f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{colour}" stroke-width="4" stroke-linecap="round"/>')

def nc(x, y):
    add(f'<path d="M{x - 5} {y - 5} L{x + 5} {y + 5} M{x + 5} {y - 5} L{x - 5} {y + 5}" stroke="{GREY}" stroke-width="2"/>')

WIRES = []
def wire(pts, colour, trim0=22, trim1=22):
    WIRES.append((pts, colour, trim0, trim1))

def draw_wires():
    # each wire: white halo then colour, so a later wire visibly passes over an earlier one
    for pts, colour, trim0, trim1 in WIRES:
        trimmed = list(pts)
        def pull(a, b, d):
            dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1
            return (a[0] + dx / L * min(d, L - 1), a[1] + dy / L * min(d, L - 1))
        trimmed[0] = pull(pts[0], pts[1], trim0); trimmed[-1] = pull(pts[-1], pts[-2], trim1)
        p = ' '.join(f'{x:.1f},{y:.1f}' for x, y in trimmed)
        add(f'<polyline points="{p}" fill="none" stroke="#ffffff" stroke-width="11" stroke-linejoin="round" stroke-linecap="butt"/>')
        p = ' '.join(f'{x:.1f},{y:.1f}' for x, y in pts)
        add(f'<polyline points="{p}" fill="none" stroke="{colour}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>')

# ---------------------------------------------------------------- title
# title: the logo with dark letters (logo-light.png is the one for white backgrounds), same as the high-voltage diagram
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LOGO = base64.b64encode(open(os.path.join(REPO, 'docs', 'logo-light.png'), 'rb').read()).decode()
add(f'<image href="data:image/png;base64,{LOGO}" x="48" y="22" width="235" height="65"/>')
text(294, 67, 'WIRING (LOW-VOLTAGE SIDE)', 30, '700')
text(60, 96, 'ESP32-S3 N16R8 · every pin from the firmware · tags with the same name are the same wire', 16, '400', 'start', '#59636e')

# ---------------------------------------------------------------- ESP32-S3 board
BX0, BX1, BY0, BY1 = 860, 1180, 200, 990
LPX, RPX = 878, 1162
PY = [300 + i * 29 for i in range(22)]
LEFT = ['3V3', '3V3', 'RST', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7', 'GPIO15', 'GPIO16', 'GPIO17', 'GPIO18', 'GPIO8',
        'GPIO3', 'GPIO46', 'GPIO9', 'GPIO10', 'GPIO11', 'GPIO12', 'GPIO13', 'GPIO14', '5V', 'GND']
RIGHT = ['GND', 'GPIO43', 'GPIO44', 'GPIO1', 'GPIO2', 'GPIO42', 'GPIO41', 'GPIO40', 'GPIO39', 'GPIO38', 'GPIO37',
         'GPIO36', 'GPIO35', 'GPIO0', 'GPIO45', 'GPIO48', 'GPIO47', 'GPIO21', 'GPIO20', 'GPIO19', 'GND', 'GND']
USED_L = {0: AMBER, 3: GREEN, 4: GREEN, 5: GREEN, 11: GREEN, 14: PURPLE, 17: CYAN, 19: HEAT, 20: RED, 21: BLACK}
USED_R = {5: BLUE, 6: BLUE, 17: PURPLE}

def esp_board():
    add(f'<rect x="{BX0}" y="{BY0}" width="{BX1-BX0}" height="{BY1-BY0}" rx="14" fill="#1f2a3d" stroke="#0e1522" stroke-width="2"/>')
    for (x, y) in ((BX0 + 15, BY0 + 15), (BX1 - 15, BY0 + 15), (BX0 + 15, BY1 - 15), (BX1 - 15, BY1 - 15)):
        add(f'<circle cx="{x}" cy="{y}" r="6" fill="#0e1522" stroke="#c9a227" stroke-width="2"/>')
    MX0, MX1, MY0 = 950, 1090, 214
    add(f'<rect x="{MX0}" y="{MY0}" width="{MX1-MX0}" height="248" rx="4" fill="#16202f" stroke="#0b111a"/>')
    ant = ' '.join(f'{MX0 + 12 + i * 9.6},{MY0 + (10 if i % 2 else 34)}' for i in range(13))
    add(f'<polyline points="{ant}" fill="none" stroke="#c9a227" stroke-width="3" stroke-linejoin="round"/>')
    add('<defs><linearGradient id="shield" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e3e7ec"/>'
        '<stop offset="1" stop-color="#9aa3ae"/></linearGradient>'
        '<linearGradient id="steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d96a0"/>'
        '<stop offset="0.45" stop-color="#eef1f4"/><stop offset="1" stop-color="#7d8590"/></linearGradient>'
        '<linearGradient id="steelv" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8d96a0"/>'
        '<stop offset="0.45" stop-color="#eef1f4"/><stop offset="1" stop-color="#7d8590"/></linearGradient></defs>')
    add(f'<rect x="{MX0 + 6}" y="{MY0 + 50}" width="{MX1-MX0-12}" height="190" rx="4" fill="url(#shield)" stroke="#7d8590"/>')
    text((MX0 + MX1) / 2, MY0 + 120, 'ESP32-S3', 13, '700', 'middle', '#3b4250')
    text((MX0 + MX1) / 2, MY0 + 138, 'WROOM-1', 11, '700', 'middle', '#3b4250')
    text((MX0 + MX1) / 2, MY0 + 160, 'N16R8', 12, '400', 'middle', '#3b4250')
    add(f'<rect x="990" y="560" width="16" height="16" rx="2" fill="#f2f2f2" stroke="#999"/><circle cx="998" cy="568" r="4" fill="#ff6ad5"/>')
    for bx, name in ((958, 'BOOT'), (1052, 'RST')):
        add(f'<rect x="{bx}" y="700" width="34" height="26" rx="3" fill="#d9dde3" stroke="#8b939e"/><circle cx="{bx + 17}" cy="713" r="7" fill="#2b2b2b"/>')
        text(bx + 17, 742, name, 10, '400', 'middle', '#c8d1dc')
    add(f'<rect x="968" y="800" width="40" height="30" rx="3" fill="#0b111a"/><rect x="1040" y="796" width="38" height="38" rx="3" fill="#0b111a"/>')
    for ux, name in ((950, 'USB'), (1046, 'UART')):
        add(f'<rect x="{ux}" y="{BY1 - 28}" width="48" height="40" rx="9" fill="#c4c9d0" stroke="#7d8590"/>'
            f'<rect x="{ux + 9}" y="{BY1 - 14}" width="30" height="10" rx="5" fill="#3b4250"/>')
        text(ux + 24, BY1 + 30, name, 11, '700', 'middle', '#59636e')

def esp_pins():
    for i, n in enumerate(LEFT):
        c = USED_L.get(i)
        text(LPX + 14, PY[i] + 4.5, n, 12.5, '700' if c else '400', 'start', '#ffffff' if c else '#7d8796', MONO)
        pin(LPX, PY[i])
    for i, n in enumerate(RIGHT):
        c = USED_R.get(i)
        grey = 10 <= i <= 12
        text(RPX - 14, PY[i] + 4.5, n, 12.5, '700' if c else '400', 'end', '#ffffff' if c else ('#4a5568' if grey else '#7d8796'), MONO)
        pin(RPX, PY[i])
    ya, yb = PY[10] - 9, PY[12] + 9
    add(f'<path d="M{BX1 + 8} {ya} h8 V{yb} h-8" fill="none" stroke="#57606a" stroke-width="2.5"/>')
    text(BX1 + 24, (ya + yb) / 2 + 5, 'used by PSRAM, don\'t wire', 14, '700', 'start', '#24292f')
    # the board's GND pins are all one net, and so are its two 3V3 pins
    text(BX1 + 20, PY[0] + 4, '← all GND pins are joined: use any', 14, '700', 'start', '#24292f')

# ---------------------------------------------------------------- MAX31865 + probe
# The real board (docs/max31865-board.jpg) turned 90 degrees to the left, so the screw terminals face the
# probe and the header faces the ESP32: F+ on top of the terminals, RDY on top of the header.
MXB = (411, 262, 680, 510)
MH = {'RDY': 299, 'CS': 324, 'SDI': 350, 'SDO': 375, 'CLK': 400, '3V3': 425, 'GND': 450, 'VIN': 475}
MT = {'F+': 334, 'RTD+': 369, 'RTD−': 404, 'F−': 439}
SCREW_X = 444
def cap(x0, y0, x1, y1):
    # SMD capacitor standing on end: tin ends, tan body
    add(f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" rx="2" fill="#c9a27a" stroke="#8b6a45" stroke-width="1"/>')
    for ya, yb in ((y0, y0 + 6), (y1 - 6, y1)):
        add(f'<rect x="{x0}" y="{ya}" width="{x1 - x0}" height="{yb - ya}" rx="1.5" fill="#d9dde3" stroke="#8b939e" stroke-width="1"/>')
def max_board():
    x0, y0, x1, y1 = MXB
    add(f'<rect x="{x0}" y="{y0}" width="{x1-x0}" height="{y1-y0}" rx="14" fill="#8b2d93" stroke="#5c1b62" stroke-width="2"/>')
    for cx, cy in ((434, 287), (434, 487)):                       # mounting holes
        add(f'<circle cx="{cx}" cy="{cy}" r="19" fill="#ecd7ee" stroke="#c9a6cc" stroke-width="1.5"/>'
            f'<circle cx="{cx}" cy="{cy}" r="13" fill="#ffffff" stroke="#b98fbd" stroke-width="1.5"/>')
    for cx, cy in ((468, 276), (646, 499)):                       # small gold pads
        add(f'<circle cx="{cx}" cy="{cy}" r="8" fill="#d4a72c" stroke="#8a6d1a"/><circle cx="{cx}" cy="{cy}" r="3.5" fill="#f1d58a"/>')
    add(f'<rect x="414" y="318" width="58" height="139" rx="4" fill="#3ccf5c" stroke="#1f8a37"/>')   # screw terminal
    add(f'<rect x="538" y="366" width="52" height="51" rx="4" fill="#1b1b1b"/>')                      # chip
    for i in range(5):                                                    # chip pads on all four sides
        tx, ty = 543 + i * 10, 371 + i * 10
        add(f'<rect x="{tx - 1.5}" y="362.5" width="3" height="3" fill="#9aa3ad"/><rect x="{tx - 1.5}" y="417.5" width="3" height="3" fill="#9aa3ad"/>'
            f'<rect x="534.5" y="{ty - 1.5}" width="3" height="3" fill="#9aa3ad"/><rect x="590.5" y="{ty - 1.5}" width="3" height="3" fill="#9aa3ad"/>')
    add('<circle cx="544" cy="372" r="2" fill="#6e7781"/>')
    cap(515, 370, 529, 404); cap(578, 325, 591, 357); cap(524, 451, 538, 483); cap(549, 451, 563, 483)
    add('<rect x="579" y="458" width="19" height="22" rx="2" fill="#1b1b1b"/>'                        # regulator
        '<rect x="574" y="461" width="6" height="5" fill="#d9dde3"/><rect x="574" y="472" width="6" height="5" fill="#d9dde3"/>'
        '<rect x="597" y="466" width="6" height="6" fill="#d9dde3"/>')
    text(521, 467, 'MAX31865', 11, '700', 'middle', '#ffffff', SANS, -90)
def max_pins():
    x0, y0, x1, y1 = MXB
    used = {'3V3', 'GND', 'CLK', 'SDO', 'SDI', 'CS'}
    for n, y in MH.items():
        text(x1 - 34, y + 4.5, n, 12.5, '700' if n in used else '400', 'end', '#ffffff' if n in used else '#e3c8e6', MONO)
        pin(x1 - 20, y)
    for y in MT.values():
        add(f'<rect x="414" y="{y - 5}" width="8" height="10" fill="#1f8a37"/>')
        screw(SCREW_X, y, 9)
    # terminal names where the real board prints them
    text(463, 313, 'F+', 10.5, '700', 'middle', '#ffffff')
    text(463, 477, 'F−', 10.5, '700', 'middle', '#ffffff')
    text(495, 383, 'RTD+', 9.5, '700', 'middle', '#ffffff')
    text(495, 399, 'RTD−', 9.5, '700', 'middle', '#ffffff')


def max_tweak():
    # the PT1000A tweak, at the real positions; numbers as in docs/max31865.md
    PAD, PADS, SILK, INK = '#d9dde3', '#8b939e', '#f4e9f5', '#24292f'
    def pad(x0, y0, x1, y1):
        add(f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" rx="2" fill="{PAD}" stroke="{PADS}" stroke-width="1"/>')
    def outline(x0, y0, x1, y1):
        add(f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" rx="3" fill="none" stroke="{SILK}" stroke-width="1.3"/>')
    # "2 Wire" and "2/3 Wire" jumpers (2 Wire stays open)
    outline(481, 330, 508, 367); pad(486, 334, 503, 346.5); pad(486, 350.7, 503, 363.3)
    text(498, 309, '2 Wire', 9.5, '700', 'middle', '#ffffff', SANS, -90)
    outline(481, 403, 508, 440); pad(486, 407.4, 503, 420); pad(486, 423.6, 503, 436.2)
    text(498, 469, '2/3 Wire', 9.5, '700', 'middle', '#ffffff', SANS, -90)
    # 24 / middle / 3 pads, factory trace from 24 to the middle pad
    outline(514, 307, 534, 354)
    pad(517.7, 313.8, 531.2, 323.7); pad(517.7, 327.3, 531.2, 336.3); pad(517.7, 339.4, 531.2, 348.9)
    add('<rect x="523" y="336.3" width="3" height="3.1" fill="#d08a3a"/>')
    add('<rect x="515.4" y="311.2" width="18.2" height="24.7" rx="3" fill="none" stroke="#ffd60a" stroke-width="1.8"/>')
    text(543, 321.5, '3', 9.5, '700', 'middle', '#ffffff')
    text(543.5, 351.5, '24', 9.5, '700', 'middle', '#ffffff')
    add('<line x1="511" y1="337.9" x2="537" y2="337.9" stroke="#eb1e1e" stroke-width="2.5" stroke-linecap="round"/>')
    # reference resistor
    outline(551, 287, 576, 358)
    text(563.5, 314, 'Rref', 9.5, '700', 'middle', '#ffffff')
    add('<rect x="556" y="322" width="16" height="33" rx="2" fill="#1b1b1b"/>'
        '<rect x="556" y="322" width="16" height="6" rx="1.5" fill="#c8ccd2" stroke="#8b939e"/>'
        '<rect x="556" y="349" width="16" height="6" rx="1.5" fill="#c8ccd2" stroke="#8b939e"/>')
    # numbered markers next to each spot, like the guide
    def badge(x, y, n, bg, fg, r=7):
        add(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{bg}" stroke="#111111" stroke-width="1.3"/>')
        text(x, y + 3.6, n, 10, '700', 'middle', fg)
    badge(589, 305, '1', '#ffd60a', '#111111')
    badge(517, 422, '2', '#ffd60a', '#111111')
    badge(544, 336, '3', '#eb1e1e', '#ffffff')
    badge(524.5, 299, '4', '#ffd60a', '#111111')
    # the steps, outside the board
    text(470, 534, 'MAX31865 TWEAK (REQUIRED)', 12.5, '700', 'start', INK)
    steps = (('1', '#ffd60a', '#111111', 'Swap Rref for 4.3 kΩ, 0.1 %'),
             ('2', '#ffd60a', '#111111', 'Solder-bridge "2/3 Wire"'),
             ('3', '#eb1e1e', '#ffffff', 'Cut the trace to 24'),
             ('4', '#ffd60a', '#111111', 'Solder-bridge the two pads in the yellow box'))
    for i, (n, bg, fg, label) in enumerate(steps):
        y = 556 + i * 22
        badge(478, y, n, bg, fg, 8)
        text(492, y + 4.3, label, 12, '700', 'start', INK)
    text(470, 652, 'See README for more detail in the Wiring section', 11.5, '400', 'start', '#59636e')

def probe():
    # PT1000A probe lying left of the terminal block: thread, hex, body, cable, three wires
    add(f'<rect x="120" y="391" width="70" height="18" fill="url(#steel)" stroke="#6e7781"/>')
    for x in range(124, 190, 7):
        add(f'<line x1="{x}" y1="391" x2="{x + 4}" y2="409" stroke="#6e7781" stroke-width="1"/>')
    add(f'<rect x="190" y="388" width="8" height="24" fill="#d08a4b" stroke="#9a5b24"/>')
    add(f'<polygon points="198,384 226,384 232,400 226,416 198,416 192,400" fill="url(#steel)" stroke="#6e7781"/>')
    add(f'<rect x="232" y="392" width="40" height="16" rx="3" fill="url(#steel)" stroke="#6e7781"/>')
    add(f'<rect x="272" y="395" width="70" height="10" rx="5" fill="#d8dee4" stroke="#9aa3ae"/>')
    text(196, 445, 'PT1000A probe', 13, '700', 'middle', '#3b4250')
    text(196, 462, '(M6, 3 wires)', 12, '400', 'middle', '#59636e')
    for y_end, col in ((MT['RTD−'], '#2f6fdd'), (MT['RTD+'], '#d92d20'), (MT['F+'], '#d92d20')):
        add(f'<path d="M342 400 C 385 400, 385 {y_end}, {SCREW_X} {y_end}" fill="none" stroke="{col}" stroke-width="4"/>')

# ---------------------------------------------------------------- water strips
def water():
    # tank with the two copper strips at 2x and their sizes (10 mm wide, 5 mm apart, tank height long)
    add(f'<rect x="40" y="520" width="422" height="300" rx="10" fill="#e6f4fa" stroke="#7cc3dc" stroke-width="2"/>')
    text(56, 546, 'WATER TANK', 13, '700', 'start', '#2b6f86')
    text(56, 562, '(outside wall)', 11, '400', 'start', '#2b6f86')
    # the settings note
    text(56, 596, 'Set the levels in', 11.5, '700', 'start', '#24292f')
    text(56, 612, 'Settings › Calibration', 11.5, '700', 'start', '#24292f')
    text(56, 628, '(Set Empty, Set Full)', 11.5, '700', 'start', '#24292f')
    text(56, 644, "or it won't work.", 11.5, '700', 'start', '#24292f')
    DIM, INK = '#57606a', '#24292f'
    x1 = 225; x2 = x1 + 32; x3 = x2 + 16; x4 = x3 + 32; y0 = 562; y1 = y0 + 200
    for a, b in ((x1, x2), (x3, x4)):
        add(f'<rect x="{a}" y="{y0}" width="{b - a}" height="{y1 - y0}" rx="3" fill="#c97b3d" stroke="#8c4f1e" stroke-width="1.5"/>')
    def head(px, py, dx, dy):                                   # arrowhead at (px, py) pointing along (dx, dy)
        add(f'<path d="M{px} {py} L{px - dx * 7 - dy * 3.5:.1f} {py - dy * 7 + dx * 3.5:.1f} '
            f'L{px - dx * 7 + dy * 3.5:.1f} {py - dy * 7 - dx * 3.5:.1f} Z" fill="{DIM}"/>')
    def line(xa, ya, xb, yb, w=1.5):
        add(f'<line x1="{xa}" y1="{ya}" x2="{xb}" y2="{yb}" stroke="{DIM}" stroke-width="{w}"/>')
    for x in (x1, x2, x3, x4):                                  # widths above
        line(x, y0 - 4, x, y0 - 19, 1)
    for (a, b), shift in (((x1, x2), -10), ((x3, x4), 10)):
        line(a, y0 - 14, b, y0 - 14); head(a, y0 - 14, -1, 0); head(b, y0 - 14, 1, 0)
        text((a + b) / 2 + shift, y0 - 22, '10 mm', 12, '700', 'middle', INK)
    for x in (x2, x3):                                          # gap below, arrows from outside
        line(x, y1 + 4, x, y1 + 28, 1)
    line(x2 - 16, y1 + 18, x3 + 16, y1 + 18); head(x2, y1 + 18, 1, 0); head(x3, y1 + 18, -1, 0)
    text((x2 + x3) / 2, y1 + 44, '5 mm', 12, '700', 'middle', INK)
    for y in (y0, y1):                                          # length on the right
        line(x4 + 4, y, x4 + 30, y, 1)
    line(x4 + 22, y0, x4 + 22, y1); head(x4 + 22, y0, 0, -1); head(x4 + 22, y1, 0, 1)
    mid = (y0 + y1) / 2
    for i, t in enumerate(('About 1 inch', 'short of the', "tank's top", 'and bottom.')):
        text(x4 + 34, mid - 38 + i * 16, t, 11.5, '700', 'start', INK)
    text(x4 + 34, mid + 34, "Doesn't need", 11.5, '400', 'start', '#3b4250')
    text(x4 + 34, mid + 50, 'to be exact.', 11.5, '400', 'start', '#3b4250')
    text(x4 + 34, mid + 76, 'As you can see', 11.5, '700', 'start', INK)
    text(x4 + 34, mid + 92, 'in photo 6.', 11.5, '700', 'start', INK)
    # strip 1 to GND (from its bottom), strip 2 to GPIO12 (wire drawn with the others)
    add(f'<line x1="{x1}" y1="{y1 - 20}" x2="{x1 - 45}" y2="{y1 - 20}" stroke="{BLACK}" stroke-width="4"/>')
    pill(x1 - 47, y1 - 20, BLACK, 'GND', 'L')
    add(f'<polyline points="{x3 + 24},{y1} {x3 + 24},{PY[17]} 462,{PY[17]}" fill="none" stroke="{CYAN}" stroke-width="4" stroke-linejoin="round"/>')

# ---------------------------------------------------------------- SSR
SSRB = (470, 828, 660, 1012)
def ssr():
    x0, y0, x1, y1 = SSRB
    add(f'<rect x="{x0}" y="{y0}" width="{x1-x0}" height="{y1-y0}" rx="8" fill="#e9e2d4" stroke="#9c9381" stroke-width="2"/>')
    text((x0 + x1) / 2, y0 + 98, 'SSR-40 DA', 15, '700', 'middle', '#b42318')
    text((x0 + x1) / 2, y0 + 116, 'heater relay', 11, '400', 'middle', '#59636e')
def ssr_pins():
    x0, y0, x1, y1 = SSRB
    for (sx, sy, n) in ((x0 + 30, PY[19], '1'), (x0 + 30, y1 - 30, '2'), (x1 - 30, PY[19], '3 +'), (x1 - 30, y1 - 30, '4 −')):
        screw(sx, sy, 12)
        text(sx, sy - 18, n, 12, '700', 'middle', '#57606a', MONO)

# ---------------------------------------------------------------- 5 V supply
PSB = (380, 1105, 720, 1265)          # the real board, same drawing as psu() in hv_parts/parts.py (340 x 160)
PSU_DEFS = '<defs><linearGradient id="psu-pcb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2466b3"/><stop offset="1" stop-color="#174b8c"/></linearGradient><linearGradient id="psu-xcap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ee5b4f"/><stop offset="1" stop-color="#a8261d"/></linearGradient><linearGradient id="psu-copper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0b27a"/><stop offset="0.5" stop-color="#c9773a"/><stop offset="1" stop-color="#8a4b1c"/></linearGradient><linearGradient id="psu-ecapG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3fbf74"/><stop offset="1" stop-color="#17643a"/></linearGradient><radialGradient id="psu-chrome" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#c9ced4"/><stop offset="1" stop-color="#6e7781"/></radialGradient><linearGradient id="psu-ecapK" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a616b"/><stop offset="1" stop-color="#14171b"/></linearGradient><linearGradient id="psu-ytape" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f8de62"/><stop offset="1" stop-color="#cfa520"/></linearGradient><linearGradient id="psu-bobbin" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1f4fb8"/><stop offset="0.45" stop-color="#4d82ef"/><stop offset="1" stop-color="#1a43a0"/></linearGradient></defs>'
def supply():
    x0, y0, x1, y1 = PSB
    add(PSU_DEFS)
    add(f'<g transform="translate({x0} {y0})">')
    add('<rect x="0" y="0" width="340" height="160" rx="6" fill="url(#psu-pcb)" stroke="#0f3566" stroke-width="1.5"/>')
    for hx, hy in ((14, 14), (326, 14), (14, 146), (326, 146)):
        add(f'<circle cx="{hx}" cy="{hy}" r="8" fill="#d9dde3" stroke="#8b939e" stroke-width="1"/><circle cx="{hx}" cy="{hy}" r="4" fill="#ffffff"/>')
    for (px, py, n, anchor, dx) in ((16, 62, 'L', 'start', 12), (16, 98, 'N', 'start', 12), (324, 62, '+5V', 'end', -12), (324, 98, 'GND', 'end', -12)):
        add(f'<circle cx="{px}" cy="{py}" r="7" fill="#d9dde3" stroke="#8b939e" stroke-width="1"/><circle cx="{px}" cy="{py}" r="3" fill="#5a616b"/>')
        text(px + dx, py + 3.5, n, 9, '700', anchor, '#ffffff')
    # input: X2 capacitor and the common-mode choke
    add('<rect x="44" y="102" width="44" height="30" rx="3" fill="url(#psu-xcap)" stroke="#7a1a13" stroke-width="1"/>')
    add('<rect x="44" y="18" width="50" height="48" rx="6" fill="#2a2d31" stroke="#111" stroke-width="1"/>')
    for i in range(7):
        add(f'<rect x="{50 + i * 6}" y="24" width="3.5" height="36" rx="1.5" fill="url(#psu-copper)"/>')
    add('<rect x="48" y="40" width="42" height="4" fill="#2a2d31"/>')
    # bulk capacitor (green) seen from the top
    add('<circle cx="124" cy="44" r="27" fill="url(#psu-ecapG)" stroke="#0f4a29" stroke-width="1.2"/>')
    add('<circle cx="124" cy="44" r="20" fill="url(#psu-chrome)" stroke="#7d8590" stroke-width="1"/>')
    add('<path d="M124 28 V60 M110 36 L138 52 M110 52 L138 36" stroke="#8b939e" stroke-width="1.6"/>')
    add('<path d="M100 32 A27 27 0 0 1 112 19" fill="none" stroke="#cfe9d8" stroke-width="5" opacity="0.7"/>')
    add('<circle cx="124" cy="112" r="14" fill="url(#psu-ecapK)" stroke="#000" stroke-width="1"/><circle cx="124" cy="112" r="10" fill="url(#psu-chrome)"/>')
    # transformer: yellow tape, black ferrite core, blue bobbin
    add('<rect x="160" y="24" width="88" height="112" rx="4" fill="#24272c" stroke="#0d0f11" stroke-width="1"/>')
    add('<rect x="168" y="38" width="72" height="84" rx="3" fill="url(#psu-ytape)" stroke="#a8850f" stroke-width="1"/>')
    add('<rect x="186" y="38" width="36" height="84" rx="4" fill="url(#psu-bobbin)" stroke="#123c8a" stroke-width="1"/>')
    for y in (30, 130):
        add(f'<rect x="164" y="{y - 3}" width="80" height="6" rx="2" fill="#3a3e44"/>')
    # output side: caps, diode, small parts
    add('<circle cx="268" cy="38" r="15" fill="url(#psu-ecapK)" stroke="#000" stroke-width="1"/><circle cx="268" cy="38" r="10.5" fill="url(#psu-chrome)"/>')
    add('<circle cx="268" cy="124" r="14" fill="url(#psu-ecapK)" stroke="#000" stroke-width="1"/><circle cx="268" cy="124" r="9.5" fill="url(#psu-chrome)"/>')
    add('<rect x="254" y="72" width="28" height="16" rx="2" fill="#1b1b1b"/><rect x="282" y="76" width="7" height="8" fill="#c8ccd2"/>')
    for x, y in ((104, 140), (140, 140), (304, 80), (230, 142)):
        add(f'<rect x="{x}" y="{y}" width="14" height="8" rx="1" fill="#1b1b1b"/><rect x="{x}" y="{y}" width="3" height="8" fill="#c8ccd2"/><rect x="{x + 11}" y="{y}" width="3" height="8" fill="#c8ccd2"/>')
    text(170, 152, '5V 2A', 8, '700', 'middle', '#cfe0f5')
    add('</g>')
    text((x0 + x1) / 2, y1 + 22, '5 V 2 A SUPPLY (120/230 V in)', 12, '700', 'middle', '#1f2328')
    text((x0 + x1) / 2, y1 + 38, 'feeds every +5V and GND tag', 11, '400', 'middle', '#59636e')
def supply_pins():
    x0, y0, x1, y1 = PSB
    for y in (y0 + 62, y0 + 98):                     # L, N on the left; +5V, GND on the right
        pin(x0 + 16, y); pin(x1 - 16, y)

# ---------------------------------------------------------------- TXS0102 + ADS1115 + pressure sensor
TXB = (1300, 330, 1440, 500)
TA = {'GND': 358, 'OE': 387, 'VA': 416, 'A1': 445, 'A2': 474}
TB = {'GND': 358, 'G': 387, 'VB': 416, 'B1': 445, 'B2': 474}
def txs():
    x0, y0, x1, y1 = TXB
    add(f'<rect x="{x0}" y="{y0}" width="{x1-x0}" height="{y1-y0}" rx="8" fill="#8b2d93" stroke="#5c1b62" stroke-width="2"/>')
    text((x0 + x1) / 2, y0 + 20, 'TXS0102', 13, '700', 'middle', '#ffffff')
    text((x0 + x1) / 2, y1 - 8, '3.3 V ↔ 5 V', 10, '400', 'middle', '#e3c8e6')
def txs_pins():
    x0, y0, x1, y1 = TXB
    for n, y in TA.items():
        text(x0 + 32, y + 4.5, n, 12.5, '700', 'start', '#ffffff', MONO); pin(x0 + 18, y)
    for n, y in TB.items():
        text(x1 - 32, y + 4.5, n, 12.5, '700' if n != 'G' else '400', 'end', '#ffffff' if n != 'G' else '#e3c8e6', MONO); pin(x1 - 18, y)

ADB = (1640, 360, 1740, 680)
AD = {'VDD': 387, 'GND': 416, 'SCL': 445, 'SDA': 474, 'ADDR': 503, 'ALRT': 532, 'A0': 561, 'A1': 590, 'A2': 619, 'A3': 648}
def ads():
    x0, y0, x1, y1 = ADB
    add(f'<rect x="{x0}" y="{y0}" width="{x1-x0}" height="{y1-y0}" rx="8" fill="#7b2a8e" stroke="#4f1a5c" stroke-width="2"/>')
    text(x1 - 16, (y0 + y1) / 2, 'ADS1115', 13, '700', 'middle', '#ffffff', SANS, -90)
def ads_pins():
    x0, y0, x1, y1 = ADB
    used = {'VDD', 'GND', 'SCL', 'SDA', 'ADDR', 'A0'}
    for n, y in AD.items():
        text(x0 + 32, y + 4.5, n, 12.5, '700' if n in used else '400', 'start', '#ffffff' if n in used else '#e3c8e6', MONO)
        pin(x0 + 18, y)

def pressure():
    sx, sy = 1830, 800
    add(f'<rect x="{sx - 30}" y="{sy - 56}" width="60" height="78" rx="9" fill="url(#steelv)" stroke="#6e7781"/>')
    add(f'<polygon points="{sx-36},{sy+22} {sx+36},{sy+22} {sx+42},{sy+36} {sx+36},{sy+50} {sx-36},{sy+50} {sx-42},{sy+36}" fill="url(#steelv)" stroke="#6e7781"/>')
    add(f'<rect x="{sx - 16}" y="{sy + 50}" width="32" height="22" fill="url(#steelv)" stroke="#6e7781"/>')
    add(f'<path d="M{sx} {sy - 56} L{sx} {sy - 96}" stroke="#1b1b1b" stroke-width="10" stroke-linecap="round"/>')
    text(sx, sy + 98, 'PRESSURE SENSOR', 12, '700', 'middle', '#3b4250')
    text(sx, sy + 114, '0–1.6 MPa · 0.5–4.5 V', 11, '400', 'middle', '#59636e')
    return sx, sy - 96

# ---------------------------------------------------------------- dimmer
DMB = (940, 1100, 1360, 1236)
DM = {'DIM': 1114, 'Z-C': 1143, 'VCC': 1172, 'GND': 1201}
DA = {'OUT': 1128, 'L': 1168, 'N': 1208}
def dimmer():
    x0, y0, x1, y1 = DMB
    add(f'<rect x="{x0}" y="{y0}" width="{x1-x0}" height="{y1-y0}" rx="8" fill="#1f4e8c" stroke="#123056" stroke-width="2"/>')
    # parts on the board: optocouplers, triac with its tab, small chips
    add(f'<rect x="{x0 + 92}" y="{y0 + 22}" width="44" height="34" rx="3" fill="#f4f4f4" stroke="#9aa3ae"/>')
    add(f'<rect x="{x0 + 92}" y="{y0 + 70}" width="44" height="34" rx="3" fill="#1b1b1b"/>')
    add(f'<rect x="{x0 + 176}" y="{y0 + 30}" width="62" height="58" rx="3" fill="#1b1b1b"/><rect x="{x0 + 184}" y="{y0 + 38}" width="46" height="18" rx="2" fill="#9aa3ae"/>')
    add(f'<rect x="{x0 + 262}" y="{y0 + 30}" width="26" height="16" rx="2" fill="#2b2b2b"/><rect x="{x0 + 262}" y="{y0 + 58}" width="26" height="16" rx="2" fill="#2b2b2b"/>')
    add(f'<rect x="{x1 - 52}" y="{DA["OUT"] - 20}" width="38" height="120" rx="4" fill="#2c6fd1" stroke="#16407d"/>')
    text(x0 + 200, y1 - 14, 'AC DIMMER 4A', 12, '700', 'middle', '#ffffff')
def dimmer_pins():
    x0, y0, x1, y1 = DMB
    for n, y in DM.items():
        text(x0 + 32, y + 4.5, n, 12.5, '700', 'start', '#ffffff', MONO); pin(x0 + 18, y)
    for n, y in DA.items():
        screw(x1 - 33, y, 9); text(x1 - 60, y + 4.5, n, 12.5, '700', 'end', '#ffffff', MONO)

# ================================================================ draw: boards, wires, pins, tags
esp_board(); max_board(); ssr(); supply(); txs(); ads(); dimmer()
probe(); water()
sxw, syw = pressure()

# signal wires (all routes orthogonal; PY index = ESP row)
mx1 = MXB[2] - 20
wire([(mx1, MH['SDO']), (720, MH['SDO']), (720, PY[3]), (LPX, PY[3])], GREEN)
wire([(mx1, MH['SDI']), (760, MH['SDI']), (760, PY[4]), (LPX, PY[4])], GREEN)
wire([(mx1, MH['CLK']), (740, MH['CLK']), (740, PY[5]), (LPX, PY[5])], GREEN)
wire([(mx1, MH['CS']), (848, MH['CS']), (848, PY[11]), (LPX, PY[11])], GREEN)
wire([(LPX, PY[14]), (770, PY[14]), (770, DM['Z-C']), (DMB[0] + 18, DM['Z-C'])], PURPLE)
wire([(462, PY[17]), (LPX, PY[17])], CYAN, trim0=0)
wire([(SSRB[2] - 30, PY[19]), (LPX, PY[19])], HEAT, trim0=40)
wire([(RPX, PY[17]), (1250, PY[17]), (1250, 1068), (918, 1068), (918, DM['DIM']), (DMB[0] + 18, DM['DIM'])], PURPLE)
wire([(RPX, PY[5]), (TXB[0] + 18, TA['A1'])], BLUE)
wire([(RPX, PY[6]), (TXB[0] + 18, TA['A2'])], BLUE)
wire([(TXB[2] - 18, TB['B1']), (1500, TB['B1']), (1560, AD['SDA']), (ADB[0] + 18, AD['SDA'])], BLUE)
wire([(TXB[2] - 18, TB['B2']), (1500, TB['B2']), (1560, AD['SCL']), (ADB[0] + 18, AD['SCL'])], BLUE)
wire([(sxw, syw), (sxw, 712), (1600, 712), (1600, AD['A0']), (ADB[0] + 18, AD['A0'])], TEAL)
draw_wires()

esp_pins(); max_pins(); max_tweak(); ssr_pins(); supply_pins(); txs_pins(); ads_pins(); dimmer_pins()

# power and mains tags: short stub + named tag (same name = same wire)
def ptag(x_pin, y, x_end, colour, s, side, w=None, fg='#ffffff'):
    stub(x_pin, y, x_end, colour)
    pill(x_end + (2 if side == 'R' else -2), y, colour, s, side, w=w, fg=fg)
ptag(LPX, PY[0], 858, AMBER, '+3.3V · EITHER PIN', 'L', w=159)
ptag(LPX, PY[20], 836, RED, '+5V', 'L')
ptag(LPX, PY[21], 836, BLACK, 'GND', 'L')
ptag(mx1, MH['3V3'], 676, AMBER, '+3.3V', 'R', w=52)        # the builder feeds the 3V3 pin, VIN stays empty
ptag(mx1, MH['GND'], 676, BLACK, 'GND', 'R')
nc(mx1 + 14, MH['VIN']); nc(mx1 + 14, MH['RDY'])
ptag(SSRB[2] - 30, SSRB[3] - 30, 690, BLACK, 'GND', 'R')
for y, s in ((PY[19], 'CONTINUES IN HIGH-VOLTAGE DIAGRAM'), (SSRB[3] - 30, 'CONTINUES IN HIGH-VOLTAGE DIAGRAM')):
    ptag(SSRB[0] + 30, y, 430, MAINS, s, 'L', w=306)
ptag(PSB[0] + 16, PSB[1] + 62, 366, '#d92d20', 'CONTINUES IN HIGH-VOLTAGE DIAGRAM', 'L', w=306)
ptag(PSB[0] + 16, PSB[1] + 98, 366, '#2b2b2b', 'CONTINUES IN HIGH-VOLTAGE DIAGRAM', 'L', w=306)
text(211, PSB[1] + 84, '120 / 230 V', 12, '700', 'middle', '#1f2328')
ptag(PSB[2] - 16, PSB[1] + 62, 736, RED, '+5V', 'R')
ptag(PSB[2] - 16, PSB[1] + 98, 736, BLACK, 'GND', 'R')
ptag(TXB[0] + 18, TA['GND'], 1278, BLACK, 'GND', 'L')
ptag(TXB[0] + 18, TA['OE'], 1278, AMBER, '+3.3V', 'L')
ptag(TXB[0] + 18, TA['VA'], 1278, AMBER, '+3.3V', 'L')
ptag(TXB[2] - 18, TB['GND'], 1462, BLACK, 'GND', 'R')
nc(TXB[2] - 4, TB['G'])
ptag(TXB[2] - 18, TB['VB'], 1462, RED, '+5V', 'R')
ptag(ADB[0] + 18, AD['VDD'], 1618, RED, '+5V', 'L')
ptag(ADB[0] + 18, AD['GND'], 1618, BLACK, 'GND', 'L')
ptag(ADB[0] + 18, AD['ADDR'], 1618, BLACK, 'GND', 'L')
for n in ('ALRT', 'A1', 'A2', 'A3'):
    nc(ADB[0] + 4, AD[n])
# pressure sensor power wires
add(f'<path d="M{sxw} {syw} C {sxw} {syw - 40}, {sxw + 40} 646, {sxw + 70} 646" fill="none" stroke="{RED}" stroke-width="4"/>')
add(f'<path d="M{sxw} {syw} C {sxw} {syw - 20}, {sxw + 40} 676, {sxw + 70} 676" fill="none" stroke="{BLACK}" stroke-width="4"/>')
pill(sxw + 72, 646, RED, '+5V', 'R'); pill(sxw + 72, 676, BLACK, 'GND', 'R')
ptag(DMB[0] + 18, DM['VCC'], 905, RED, '+5V', 'L')
ptag(DMB[0] + 18, DM['GND'], 905, BLACK, 'GND', 'L')
for n, col, fg in (('OUT', '#9bb52a', '#1f2328'), ('L', '#d92d20', '#ffffff'), ('N', '#2b2b2b', '#ffffff')):
    ptag(DMB[2] - 33, DA[n], 1392, col, 'CONTINUES IN HIGH-VOLTAGE DIAGRAM', 'R', w=306, fg=fg)
text(1547, (DA['L'] + DA['N']) / 2 + 4, '120 / 230 V', 12, '700', 'middle', '#1f2328')


# power box: where every power tag comes from
PX0, PY0b = 60, 124
add(f'<rect x="{PX0}" y="{PY0b}" width="770" height="132" rx="12" fill="#f6f8fa" stroke="#d1d9e0"/>')
text(PX0 + 20, PY0b + 28, 'POWER', 14, '700')
pill(PX0 + 20, PY0b + 56, RED, '+5V')
text(PX0 + 104, PY0b + 61, 'from the 5 V supply, powers almost everything: ESP32 5V pin, dimmer, ADS1115,', 13, '400', 'start', '#3b4250')
text(PX0 + 104, PY0b + 78, 'TXS0102 VB and the pressure sensor', 13, '400', 'start', '#3b4250')
pill(PX0 + 20, PY0b + 104, AMBER, '+3.3V')
text(PX0 + 104, PY0b + 109, 'comes out of the ESP32 board (either 3V3 pin): MAX31865 3V3, TXS0102 VA and OE', 13, '400', 'start', '#3b4250')
# legend
LX0, LY0 = 1530, 105
add(f'<rect x="{LX0}" y="{LY0}" width="430" height="220" rx="12" fill="#f6f8fa" stroke="#d1d9e0"/>')
text(LX0 + 20, LY0 + 32, 'HOW TO READ IT', 14, '700')
pill(LX0 + 20, LY0 + 62, RED, '+5V'); pill(LX0 + 84, LY0 + 62, AMBER, '+3.3V'); pill(LX0 + 162, LY0 + 62, BLACK, 'GND')
text(LX0 + 226, LY0 + 67, 'same name = joined', 13, '400', 'start', '#3b4250')
pill(LX0 + 20, LY0 + 100, MAINS, 'HIGH VOLTAGE', w=128)
text(LX0 + 160, LY0 + 105, '120 V US / 230 V EU', 13, '400', 'start', '#3b4250')
nc(LX0 + 30, LY0 + 136); text(LX0 + 48, LY0 + 141, 'not connected', 13, '400', 'start', '#3b4250')
text(LX0 + 20, LY0 + 178, 'Wires that cross without a dot are not joined.', 13, '400', 'start', '#3b4250')
text(LX0 + 20, LY0 + 200, 'All GND tags join at the supply\'s GND.', 13, '400', 'start', '#3b4250')

svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
       f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + ''.join(el) + '</svg>')
open(out, 'w').write(svg)
print('ok', len(svg))
