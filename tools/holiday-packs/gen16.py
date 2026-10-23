#!/usr/bin/env python3
"""Builds web/holidays/western/theme.css for the 16:10 Western (picture 1587 x 991, shown whole, scaled evenly).

Everything is placed in picture pixels:  U(n) = n picture px,  PX(n) / PY(n) = a point on the
picture, measured from the page's top-left (the picture is centred, bars round it)."""
import re, sys

import base64, json, os

W, H = 1587, 991
# python3 gen16.py         -> the Western pack (web/holidays/western/theme.css)
# python3 gen16.py custom  -> the custom themes' master (web/src/customTheme.css): the same layout
#                             for any picture made on the template, moved by the theme's nudges
# python3 gen16.py pack <id> <picture> [#neon]
#                          -> a new built-in pack web/holidays/<id>/ from a picture on the template:
#                             the picture shrunk to 1587 x 991 WebP (quality 40, like the other
#                             packs), the tab icons, and a theme.css in the picture's colour (neon,
#                             default #ff9a1a). Then add <id> to web/src/utils/holidays.js, build,
#                             flash, and upload it with scripts/upload_holidays.py.
MODE = sys.argv[1] if len(sys.argv) > 1 else 'western'
CUSTOM = MODE in ('custom', 'pack')  # the template's layout with the custom themes' defaults
PACK_ID = sys.argv[2] if MODE == 'pack' else None
NEON = sys.argv[4] if MODE == 'pack' and len(sys.argv) > 4 else '#ff9a1a'
ROOT = {'custom': ":root[data-custom-theme]", 'pack': f":root[data-holiday='{PACK_ID}']"}.get(MODE, ":root[data-holiday='western']")
# The Manual screen, menu open OR collapsed (phones often keep it collapsed): a collapsed menu
# shows the same rows, its labels drawn from the links' aria-labels.
G = f"{ROOT}:has([data-slot='manual'])"
HERE = os.path.dirname(os.path.abspath(__file__))
PACK = os.path.join(HERE, '..', '..', 'web', 'holidays', 'western')

def icon(name):
    # the pack's upload inlines its art; the custom master is built into the app, so inline it here
    if MODE != 'custom':
        return f"url('art/{name}.webp')"
    data = open(os.path.join(PACK, 'art', f'{name}.webp'), 'rb').read()
    return f"url('data:image/webp;base64,{base64.b64encode(data).decode()}')"

def U(n): return f'calc({n} * var(--u))'
def PX(n): return f'calc(var(--ox) + {n} * var(--u))'
def PY(n): return f'calc(var(--oy) + {n} * var(--u))'

def box(x, y, w, h, fixed=True):
    if fixed:
        return f'position: fixed !important; left: {PX(x)}; top: {PY(y)}; width: {U(w)}; height: {U(h)};'
    return f'position: absolute !important; left: {U(x)}; top: {U(y)}; width: {U(w)}; height: {U(h)};'

def expand(s):
    # U(12.5) / PX(3) / PY(4) inside the rule text
    s = re.sub(r'\bU\(([-\d.]+)\)', lambda m: U(m.group(1)), s)
    s = re.sub(r'\bPX\(([-\d.]+)\)', lambda m: PX(m.group(1)), s)
    s = re.sub(r'\bPY\(([-\d.]+)\)', lambda m: PY(m.group(1)), s)
    return s

rules = []
def r(sel, body):
    sels = ',\n'.join(f'{G} {s.strip()}' for s in sel.split('|'))
    rules.append(f'{sels} {{ {expand(body)} }}')

# ------------------------------------------------------------------ page, picture, bars
# the page exactly the shown screen (phones: not the taller screen behind the address bar), with
# the bars' colours. The picture is pinned to the screen exactly where the boxes are (the same
# --ox/--oy/--u, not 'background-attachment: fixed', which follows the taller screen): on the page
# it came apart from the boxes while a zoomed-in phone page was dragged (user 2026-10-07).
r("[data-slot='page']", f"""height: 100vh; height: 100dvh !important; isolation: isolate;
  background: var(--bars) !important;""")
r("[data-slot='page']::before", """content: ''; position: fixed; z-index: -1; pointer-events: none;
  left: var(--ox); top: var(--oy); width: calc(1587 * var(--u)); height: calc(991 * var(--u));
  background: var(--pack-picture) 0 0 / 100% 100% no-repeat;""")
r("[data-slot='content'] | [data-slot='content'] *:has(> [data-slot='manual'])", "overflow: hidden !important;")
r("[data-slot='card']", "border: 0 !important; background: transparent !important; box-shadow: none !important; overflow: visible !important; padding: 0 !important; color: var(--skin-text);")
r("[data-unclip] | [data-part='columns'] > section | [data-part='metrics-row']", "overflow: visible !important;")
r("[data-piece]", "display: none;")
# small phones put a blurred cover over the page while the menu is open (the phone drawer); the menu
# is part of the picture here, so no cover
r("[data-slot='page'] > .backdrop-blur-sm", "display: none !important;")

# ------------------------------------------------------------------ side menu (panel inside the rope: 25..300 x 200..680)
r("[data-slot='sidebar']", f"""{box(0, 0, 340, 991)} padding: 0 !important; border: 0 !important;
  background: transparent !important; overflow: visible !important; color: var(--skin-text);""")
r("[data-slot='sidebar'] [data-slot='logo']", "height: U(190) !important;")
r("[data-slot='sidebar'] [data-slot='logo'] > img", "visibility: hidden;")
r("[data-slot='sidebar'] hr | [data-part='social'] | [data-part='collapse'] | [data-part='credit'] | [data-slot='menu-foot']", "display: none !important;")
r("[data-slot='sidebar'] [data-menu]", "height: U(54) !important; margin: 0 0 0 U(32) !important; width: U(266) !important;")
r("[data-slot='sidebar'] [data-menu] > a", """height: 100% !important; min-height: 0 !important;
  padding: 0 0 0 U(14) !important; gap: U(16) !important; font-size: U(24) !important; line-height: 1 !important;
  color: #ecd6ae !important; background: transparent !important; box-shadow: none !important; white-space: nowrap;""")
r("[data-slot='sidebar'] [data-slot='logo']", "width: 100% !important;")
r("[data-slot='sidebar'][data-collapsed] [data-menu] > a", "width: 100% !important; justify-content: flex-start !important; aspect-ratio: auto !important;")
r("[data-slot='sidebar'][data-collapsed] [data-menu] > a::after", "content: attr(aria-label); white-space: nowrap;")
r("[data-menu] > a[aria-current='page']", "color: #ffe6b8 !important; text-shadow: 0 0 6px rgba(255, 160, 60, 0.6);")
r("[data-slot='sidebar'] [data-menu] > a > svg", "width: U(30); height: U(30); flex: none; color: #f0d9ae;")
# the dashboard row's pencil (not the row's own link, which is a .btn too)
r("[data-slot='sidebar'] [data-menu] > :not(a) .btn | [data-slot='sidebar'] [data-menu] > .btn:not(a) | [data-slot='sidebar'] [data-menu] [role='button']",
  "background: transparent !important; border: 0 !important; box-shadow: none !important; color: #f0d9ae !important; width: U(36) !important; min-width: 0 !important; height: U(36) !important; min-height: 0 !important; padding: 0 !important;")
r("[data-slot='sidebar'] [data-menu] > :not(a) .btn svg | [data-slot='sidebar'] [data-menu] [role='button'] svg", "width: U(20); height: U(20);")
# the dashboard pencil's menu: opens to the right of the pencil, on a solid panel, over the page
r("[data-slot='sidebar'] [data-menu] .dropdown-content", """left: 0 !important; right: auto !important; top: 100% !important; z-index: 20;
  min-width: U(220); background: #24150c !important; color: #f3dcb2 !important; border: 1px solid rgba(230, 196, 140, 0.6);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.6) !important; font-size: U(22);""")
r("[data-slot='sidebar'] .indicator", "display: inline-flex; align-items: center; gap: U(10);")
r("[data-slot='sidebar'] .indicator-item", """position: static !important; transform: none !important; translate: none !important; order: 2;
  padding: 0 U(6) !important; border-radius: U(7); font-size: U(15); line-height: U(22); font-weight: 800; height: auto !important;
  background: #9e3a12 !important; color: #fff !important; box-shadow: 0 0 8px rgba(255, 110, 30, 0.6);""")

# ------------------------------------------------------------------ mode tabs on the 6 plates (y 175..242)
# the tab row is a real box round the six plates (iPhones don't let you tap buttons that hang
# outside a zero-size fixed box)
r("[data-slot='menu']", f"{box(355, 172, 1225, 74)} background: transparent !important; box-shadow: none !important; padding: 0 !important; overflow: visible !important; z-index: 2;")
TABS = [('standby', 360, 572, 'ic_power'), ('brew', 573, 779, 'ic_brew'), ('manual', 781, 986, 'ic_manual'),
        ('steam', 988, 1192, 'ic_steam'), ('water', 1194, 1396, 'ic_water'), ('grind', 1398, 1576, 'ic_grind')]
r("[data-slot='mode-tab'] | [data-slot='mode-tab'][data-active]", """--neon: #ff9a1a;
  display: inline-flex !important; align-items: center; justify-content: center; margin: 0 !important; padding: 0 !important;
  font-size: U(25) !important; font-weight: 700 !important; text-transform: uppercase; white-space: nowrap;
  color: #fff6ea !important; -webkit-text-stroke: U(2.2) var(--neon); paint-order: stroke fill;
  text-shadow: 0 0 2px var(--neon), 0 0 7px var(--neon), 0 0 14px var(--neon), 0 0 24px color-mix(in srgb, var(--neon) 60%, transparent) !important;
  border: 0 !important; background: transparent !important; box-shadow: none !important; min-height: 0 !important; min-width: 0 !important;""")
r("[data-slot='mode-tab']::before", """content: ''; flex: none; width: U(34); height: U(34); margin-right: U(10);
  background: #fff6ea; -webkit-mask: var(--tab-icon) center / contain no-repeat; mask: var(--tab-icon) center / contain no-repeat;
  filter: drop-shadow(0 0 2px var(--neon)) drop-shadow(0 0 6px var(--neon)) drop-shadow(0 0 12px var(--neon));""")
r("[data-slot='mode-tab'] > svg | [data-slot='mode-tab'] > img", "display: none !important;")
for tab, x0, x1, ic in TABS:
    r(f"[data-tab='{tab}']", f"{box(x0 - 355, 177 - 172, x1 - x0, 64, fixed=False)} flex: none !important; --tab-icon: {icon(ic)};")

# ------------------------------------------------------------------ readouts (shared look)
r("[data-part='hint']", "display: none !important;")
r("[data-card='flow'] [data-part='metric'] | [data-card='temp'] [data-part='metric'] | [data-card='pressure'] [data-part='metric']", "display: contents !important;")
r("""[data-part='metric'] > [data-part='value'] | [data-part='metric'] > [data-part='caption'] | [data-metric='flow'] > [data-part='sub']
   | [data-metric='weight'] > [data-part='sub'] | [data-card='flow'] > [data-slot='brew'] | [data-card='tank'] [data-part='pct']
   | [data-card='tank'] [data-part='caption'] | [data-card='tank'] div:has(> [data-slot='tank-bar'])""",
  "position: absolute !important; margin: 0 !important; padding: 0 !important; transform: none;")
r("[data-part='metric'] > [data-part='caption'] | [data-card='tank'] [data-part='caption']", """font-size: U(24) !important; font-weight: 700 !important;
  letter-spacing: 0.04em; line-height: 1 !important; text-transform: uppercase; color: var(--skin-caption) !important; white-space: nowrap;""")
r("[data-part='metric'] > [data-part='caption'] svg", "display: none !important;")
r("[data-part='metric'] > [data-part='value']", "display: flex; align-items: center; justify-content: center; white-space: nowrap;")
# --numk: the custom themes' "Big numbers size" (Settings), 1 = 100 %
r("[data-part='metric'] [data-part='value'] > span:first-child", """font-size: calc(56 * var(--numk, 1) * var(--u)) !important; font-weight: 600; line-height: 1;
  color: var(--skin-led) !important; text-shadow: var(--skin-led-glow); -webkit-text-stroke: U(3) var(--skin-led-edge); paint-order: stroke fill;""")
r("[data-part='metric'] [data-part='value'] > span + span | [data-part='metric'] [data-part='value'] > span + span > span",
  "font-size: U(26) !important; font-weight: 500; color: var(--skin-text) !important;")
r("[data-part='metric'] [data-part='value'] > span + span > span", "margin: 0 U(5) !important;")
# a little darkness inside the value windows, over the printed art
r("[data-card='temp']::before | [data-card='pressure']::before | [data-card='flow']::before | [data-card='flow']::after", "content: ''; position: absolute; pointer-events: none; border-radius: U(8); background: rgba(10, 5, 2, var(--shade, 0.28));")

# ------------------------------------------------------------------ flow row: flow window | rope ring | weight window  (card 355..1447 x 255..467)
r("[data-card='flow']", box(355, 255, 1092, 212))
r("[data-card='flow']::before", f"left: {U(40)}; top: {U(50)}; width: {U(274)}; height: {U(124)};")
r("[data-card='flow']::after", f"left: {U(708)}; top: {U(50)}; width: {U(334)}; height: {U(124)};")
r("[data-caption='flow']", f"left: {U(128)}; top: {U(68)};")
r("[data-caption='weight']", f"left: {U(795)}; top: {U(68)};")
r("[data-metric='flow'] > [data-part='value']", f"left: {U(40)}; top: {U(88)}; width: {U(200)}; height: {U(80)};")
r("[data-metric='flow'] > [data-part='sub']", f"""left: {U(222)}; top: {U(122)}; width: {U(80)}; height: {U(30)};
  display: flex; align-items: center; font-size: U(24) !important; color: var(--skin-caption) !important; transform: none !important;""")
# the same height as flow's, so both numbers sit level under their labels
r("[data-metric='weight'] > [data-part='value']", f"left: {U(725)}; top: {U(88)}; width: {U(300)}; height: {U(80)};")
# the rope ring's inner circle, fitted on the picture: centre 873.5, 412.5, radius 147
r("[data-card='flow'] > [data-slot='brew']", f"left: {U(873.5 - 355 - 142)}; top: {U(412.5 - 255 - 142)}; z-index: 1;")
# --gm-cup: the plain cup (no video) sized to the button; the page sets it from its own size, which
# on a phone was far bigger than this button (the cup looked zoomed)
r("[data-card='flow'] > [data-slot='brew'] > button", f"width: {U(284)} !important; height: {U(284)} !important; min-width: 0 !important; min-height: 0 !important; box-shadow: none !important; --gm-cup: {U(284 * 0.78)} !important;")
# Tare on the plate under the ring (745..990 x 587..657)
r("[data-metric='weight'] > [data-part='sub']", f"left: {U(752 - 355)}; top: {U(592 - 255)}; width: {U(232)}; height: {U(60)}; display: flex;")
r("[data-metric='weight'] > [data-part='sub'] button | [data-metric='weight'] > [data-part='sub'] button:disabled", """width: 100%; height: 100%; min-height: 0;
  border: 0 !important; border-radius: 999px !important; background: transparent !important; box-shadow: none !important;
  opacity: 1 !important; font-size: U(24); font-weight: 800; gap: U(8);
  --neon: #ff9a1a; color: #fff6ea !important; -webkit-text-stroke: U(2) var(--neon); paint-order: stroke fill;
  text-shadow: 0 0 2px var(--neon), 0 0 7px var(--neon), 0 0 14px var(--neon) !important;""")
r("[data-metric='weight'] > [data-part='sub'] button svg", "display: none !important;")
r("[data-metric='weight'] > [data-part='sub'] button", "letter-spacing: 0.08em; text-transform: uppercase;")

# ------------------------------------------------------------------ temperature (365..717 x 487..660) and pressure (1027..1447 x 485..660)
r("[data-card='temp']", box(365, 487, 352, 173))
r("[data-card='temp']::before", f"left: {U(34)}; top: {U(66)}; width: {U(296)}; height: {U(80)};")
r("[data-caption='temp']", f"left: {U(72)}; top: {U(47)};")
r("[data-metric='temp'] > [data-part='value']", f"left: {U(34)}; top: {U(70)}; width: {U(296)}; height: {U(74)};")
r("[data-card='pressure']", box(1027, 485, 420, 175))
r("[data-card='pressure']::before", f"left: {U(32)}; top: {U(68)}; width: {U(238)}; height: {U(78)};")
r("[data-caption='pressure']", f"left: {U(90)}; top: {U(47)};")
r("[data-metric='pressure'] > [data-part='value']", f"left: {U(32)}; top: {U(70)}; width: {U(238)}; height: {U(74)};")
r("[data-metric='pressure'] [data-part='value'] > span + span", "font-size: U(22) !important;")

# ------------------------------------------------------------------ water tank: the tall bar on the right (1462..1570 x 250..662, channel 1490..1545)
r("[data-card='tank']", f"{box(1462, 250, 108, 412)} flex: none !important;")
r("[data-card='tank'] [data-part='caption']", "display: none !important;")
r("[data-card='tank'] [data-part='pct']", f"""left: {U(22)}; top: {U(22)}; width: {U(64)}; height: {U(30)};
  display: flex; align-items: center; justify-content: center; font-size: U(19) !important; font-weight: 800; color: #ffc36a !important;
  background: rgba(20, 10, 4, 0.75); border-radius: U(6);""")
r("[data-card='tank'] div:has(> [data-slot='tank-bar'])", f"""left: {U(55 - 165)}; top: {U(228 - 16)}; width: {U(330)}; height: {U(32)} !important;
  transform: rotate(-90deg) !important; border-radius: 999px !important; background: #1a0d05 !important;
  box-shadow: 0 0 0 1.5px rgba(220, 180, 120, 0.7), 0 0 8px rgba(255, 150, 40, 0.45);""")
r("[data-card='tank'] [data-slot='tank-bar']", "border-radius: 999px !important; background: repeating-linear-gradient(135deg, #ffb347 0 9px, #9c5410 9px 18px) !important;")

# ------------------------------------------------------------------ controls (352..913 x 680..910; plates 560..715 x 710..770 and 780..840)
r("[data-card='controls']", box(352, 680, 561, 230))
r("[data-card='controls'] [data-part='stepper'] | [data-card='controls'] [data-part='stepper'] > div:last-child", "display: contents !important;")
r("""[data-card='controls'] [data-part='stepper'] > [data-part='caption'] | [data-card='controls'] button.btn-circle
   | [data-card='controls'] [data-part='stepper']:first-child [data-part='stepper-value'] | [data-card='controls'] [data-part='stepper-toggle']
   | [data-card='controls'] [data-part='pressure-row']""", "position: absolute !important; margin: 0 !important;")
r("[data-card='controls'] [data-part='stepper'] > [data-part='caption']", "left: U(66); font-size: U(19) !important; font-weight: 600; line-height: 1; color: var(--skin-caption) !important; white-space: nowrap;")
r("[data-card='controls'] [data-part='stepper']:first-child > [data-part='caption']", "top: U(50);")
r("[data-card='controls'] [data-part='stepper'] + [data-part='stepper'] > [data-part='caption']", "top: U(120);")
r("[data-card='controls'] button.btn-circle", """width: U(46) !important; height: U(46) !important; min-height: 0 !important; min-width: 0 !important; padding: 0 !important;
  border: 2px solid rgba(230, 196, 140, 0.85) !important; color: #fff3dc !important; background: radial-gradient(#3a2414, #150b05) !important;""")
r("[data-card='controls'] button.btn-circle > svg", "width: U(24); height: U(24);")
for label, cy in (('Temperature', 60), ('Stop at', 130)):
    r(f"[aria-label='Decrease {label}']", f"left: {U(408 - 23)}; top: {U(cy - 23)};")
    r(f"[aria-label='Increase {label}']", f"left: {U(478 - 23)}; top: {U(cy - 23)};")
r("[data-card='controls'] [data-part='stepper']:first-child [data-part='stepper-value']", f"left: {U(212)}; top: {U(32)}; width: {U(147)}; height: {U(56)}; display: flex; align-items: center; justify-content: center;")
r("[data-card='controls'] [data-part='stepper-toggle']", f"left: {U(212)}; top: {U(102)}; width: {U(147)}; height: {U(56)}; min-height: 0 !important; padding: 0 !important; display: flex !important; flex-direction: row !important; align-items: center; justify-content: center; background: transparent !important; border: 0 !important; box-shadow: none !important;")
r("[data-card='controls'] [data-part='stepper-value']", """font-size: U(40) !important; font-weight: 600 !important; line-height: 1 !important;
  color: var(--skin-led) !important; text-shadow: var(--skin-led-glow); -webkit-text-stroke: U(2) var(--skin-led-edge); paint-order: stroke fill;""")
r("[data-card='controls'] [data-part='stepper-value'] > span", "font-size: U(24) !important; color: var(--skin-led) !important; -webkit-text-stroke: U(1) var(--skin-led-edge);")
r("[data-card='controls'] [data-part='stepper-pill']", """position: absolute; left: 50%; top: calc(100% + U(2)); translate: -50% 0;
  margin: 0 !important; padding: 0 U(6) !important; background: transparent !important; color: var(--skin-caption) !important;
  font-size: U(15) !important; line-height: 1.1 !important; white-space: nowrap; min-height: 0 !important; height: auto !important;""")
r("[data-card='controls'] [data-part='pressure-row']", f"left: {U(40)}; top: {U(178)}; width: {U(480)}; height: {U(30)}; display: flex; align-items: center; gap: U(10) !important; padding: 0 !important;")
r("[data-card='controls'] input[type='range']", "flex: 1 1 auto !important; height: U(20); --range-bg: #2a1206; --range-thumb: #fff1d6; color: #e8891a;")
r("[data-card='controls'] [data-part='pressure-value']", "flex: none; font-size: U(26) !important; line-height: 1 !important; color: #f6d18a !important; text-shadow: 0 0 6px #000;")
r("[data-card='controls'] [data-part='pressure-value'] > span", "font-size: U(18) !important; color: #f6d18a !important;")

# ------------------------------------------------------------------ chart (inside 955..1555 x 695..893), darkened over the printed art
r("[data-card='chart']", f"""{box(952, 692, 606, 204)} min-height: 0 !important; overflow: hidden !important;
  background: rgba(14, 7, 3, 0.62) !important; border-radius: U(10); padding: U(4) U(6) U(4) U(4) !important;""")
r("[data-card='chart'] img", "width: 100% !important; height: 100% !important;")
# The chart draws its own text in fixed pixels: zoom it with the picture so the labels shrink with
# everything else, but not below 0.65 (phones: still readable).
r("[data-card='chart'] > div:first-child", """--cz: clamp(0.65, var(--s), 1); transform: scale(var(--cz)); transform-origin: 0 0; flex: none !important;
  width: calc(100% / var(--cz)) !important; height: calc(100% / var(--cz)) !important;""")
# the enlarged chart covers the screen's middle: a solid panel over every window
rules.append(f"{G}:has([data-part='metrics-row'].opacity-0) [data-card='chart'] {{ {expand(box(355, 250, 1220, 660))} z-index: 3; background: rgba(8, 6, 4, 0.96) !important; box-shadow: 0 0 0 1px rgba(255, 220, 170, 0.25) !important; }}")

# ------------------------------------------------------------------ clock in the short bar (1000..1375 x 930..978)
r("[data-part='clock']", f"""display: flex; {box(1000, 930, 375, 48)} align-items: center; justify-content: space-evenly;
  font-size: U(30); font-weight: 600; letter-spacing: 0.05em; line-height: 1; color: var(--skin-led); text-shadow: var(--skin-led-glow);
  -webkit-text-stroke: U(2) var(--skin-led-edge); paint-order: stroke fill; z-index: 5;""")
r("[data-part='clock-ampm']", "font-size: U(19);")

if CUSTOM:
    # ---------------------------------------------------------------- a theme's nudges (Settings sliders and drags)
    # CustomThemeStyles sets --n-<group>x / --n-<group>y (picture px) and --n-x (everything across).
    # The custom themes' own starting places, where they differ from Western's (picture px):
    # from the user's Deep Sea Fishing theme, 2026-10-01 (menu rows lower, under taller logos).
    DEFAULT = {'menu': (0, 33), 'tabs': (0, 3)}
    def nudge(group, everything=True):
        dx, dy = DEFAULT.get(group, (0, 0))
        x = f"({dx} + var(--n-x, 0) + var(--n-{group}x, 0))" if everything else f"({dx} + var(--n-{group}x, 0))"
        return f"translate: calc({x} * var(--u)) calc(({dy} + var(--n-{group}y, 0)) * var(--u)) !important;"
    r("[data-slot='menu']", nudge('tabs'))
    r("[data-card='flow']", nudge('top'))
    r("[data-card='flow'] > [data-slot='brew']", nudge('brew', everything=False))
    r("[data-metric='weight'] > [data-part='sub']", nudge('tare', everything=False))
    # Flow, weight, temp and pressure each move on their own too, on top of their row's move
    # (top: the flow card with brew and Tare; mid: temp and pressure).
    def own(group):
        return f"translate: calc(var(--n-{group}x, 0) * var(--u)) calc(var(--n-{group}y, 0) * var(--u)) !important;"
    r("[data-caption='flow'] | [data-metric='flow'] > [data-part='value'] | [data-metric='flow'] > [data-part='sub'] | [data-card='flow']::before", own('flow'))
    r("[data-caption='weight'] | [data-metric='weight'] > [data-part='value'] | [data-card='flow']::after", own('weight'))
    for card in ('temp', 'pressure'):
        r(f"[data-card='{card}']", "translate: calc((var(--n-x, 0) + var(--n-midx, 0) + var(--n-%sx, 0)) * var(--u)) calc((var(--n-midy, 0) + var(--n-%sy, 0)) * var(--u)) !important;" % (card, card))
    r("[data-card='tank']", nudge('tank'))
    r("[data-card='controls']", nudge('controls'))
    r("[data-card='chart']", nudge('chart'))
    r("[data-part='clock']", nudge('clock'))
    # the menu moves on its own (not with "Everything, across"); across too since 2026-10-07
    r("[data-slot='sidebar'] [data-menu]", f"translate: calc(var(--n-menux, 0) * var(--u)) calc(({DEFAULT['menu'][1]} + var(--n-menuy, 0)) * var(--u)) !important;")

    # Western's cream and amber text, as the theme's own shades (CustomThemeStyles sets them)
    WARM = {'#ecd6ae': 'var(--skin-caption)', '#f0d9ae': 'var(--skin-caption)', '#ffe6b8': 'var(--skin-led)',
            '#f6d18a': 'var(--skin-caption)', '#ffc36a': 'var(--skin-caption)'}
    rules = [re.sub('|'.join(WARM), lambda m: WARM[m.group(0)], x) for x in rules]

def shades(neon):
    # the same colours the custom themes get at full glow (utils/customThemeFit.js glowColours)
    rgb = [int(neon[i:i + 2], 16) for i in (1, 3, 5)]
    white = lambda w: 'rgb(%d, %d, %d)' % tuple(round(c + (255 - c) * w) for c in rgb)
    deep = '#' + ''.join('%02x' % round(c * 0.85) for c in rgb)
    return {
        'core': white(0.65), 'tab': white(0.95), 'caption': white(0.75), 'text': white(0.8),
        'glow': f'0 0 2px {neon}, 0 0 7px {deep}, 0 0 16px {deep}b3',
        'grid': 'rgba(%d, %d, %d, 0.12)' % tuple(rgb),
    }

def pack_css(rules):
    from PIL import Image, ImageStat
    import shutil
    out = os.path.join(HERE, '..', '..', 'web', 'holidays', PACK_ID)
    os.makedirs(os.path.join(out, 'art'), exist_ok=True)
    im = Image.open(sys.argv[3]).convert('RGB')
    if im.size != (W, H):
        im = im.resize((W, H), Image.LANCZOS)
    im.save(os.path.join(out, 'art', 'page.webp'), 'WEBP', quality=40, method=6)
    for f in os.listdir(os.path.join(PACK, 'art')):
        if f.startswith('ic_'):
            shutil.copy(os.path.join(PACK, 'art', f), os.path.join(out, 'art', f))
    edge = lambda b: '#%02x%02x%02x' % tuple(int(v * 0.8) for v in ImageStat.Stat(im.crop(b)).mean)
    lr = f'linear-gradient(to right, {edge((0, 0, 12, H))}, {edge((W - 12, 0, W, H))})'
    tb = f'linear-gradient(to bottom, {edge((0, 0, W, 12))}, {edge((0, H - 12, W, H))})'
    c = shades(NEON)
    # the master's Western amber -> this pack's colour (as themeCss does for custom themes)
    swap = [("--neon: #ff9a1a", f"--neon: {NEON}"), ("color: #fff6ea", f"color: {c['tab']}"),
            ("background: #fff6ea", f"background: {c['tab']}"),
            ("repeating-linear-gradient(135deg, #ffb347 0 9px, #9c5410 9px 18px)", f"repeating-linear-gradient(135deg, #ffffff 0 9px, {NEON} 9px 18px)"),
            ("color: #e8891a", f"color: {NEON}")]
    # a picture that drifts from the template: its own offsets and rules (layouts/<id>.json)
    layout_file = os.path.join(HERE, 'layouts', f'{PACK_ID}.json')
    layout = json.load(open(layout_file)) if os.path.exists(layout_file) else {}
    extra = []
    for line in layout.get('css', []):
        sel, body_ = line.split(' | ', 1)
        extra.append(f"{G} {sel.strip()} {{ {expand(re.sub(r'U\(([-\d. +*/]+)\)', lambda m: 'U(' + str(round(eval(m.group(1)), 2)) + ')', body_))} }}")
    body = '\n'.join(rules + extra)
    for a, b in swap:
        body = body.replace(a, b)
    head = open(os.path.join(HERE, 'gen16_custom_head.css')).read().replace(':root[data-custom-theme]', ROOT)
    head = head[head.index(ROOT):]  # the custom master's own comment is not this pack's
    title = f"""/* Holiday pack '{PACK_ID}', 16:10, made by tools/holiday-packs/gen16.py pack from {os.path.basename(sys.argv[3])}:
   the template's layout (the custom themes'), shown whole on any screen, in {NEON}. */

{ROOT} {{
  --pack-picture: url('art/page.webp'); /* written once: the upload builds the picture in */
  --bars-lr: {lr};
  --bars-tb: {tb};
  --skin-led: {c['core']};
  --skin-led-edge: {NEON};
  --skin-led-glow: {c['glow']};
  --skin-caption: {c['caption']};
  --color-primary: {NEON};
  --chart-text: {c['text']};
  --chart-grid: {c['grid']};
  --shade: 0.28;
{''.join(f'  --n-{k}: {v};{chr(10)}' for k, v in layout.get('nudge', {}).items())}}}
"""
    # the colours after the template's own (which are the custom themes' amber defaults)
    colours = title[title.index(ROOT):]
    title = title[:title.index(ROOT)]
    return title + head + '\n' + colours + '\n@media (orientation: landscape) {\n' + body + '\n}\n'

if MODE == 'pack':
    css = pack_css(rules)
    OUT = os.path.join(HERE, '..', '..', 'web', 'holidays', PACK_ID, 'theme.css')
else:
    HEAD = open(os.path.join(HERE, 'gen16_custom_head.css' if CUSTOM else 'gen16_head.css')).read()
    css = HEAD + '\n@media (orientation: landscape) {\n' + '\n'.join(rules) + '\n}\n'
    OUT = os.path.join(HERE, '..', '..', 'web', 'src', 'customTheme.css') if CUSTOM else os.path.join(PACK, 'theme.css')
open(OUT, 'w').write(css)
print('rules', len(rules), 'bytes', len(css))
