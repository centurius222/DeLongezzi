"""Builds a custom-theme test replica: Western's layout (the master) + a picture + a neon colour + the
auto-fit shifts, no hand tuning. usage: make_ct.py <picture> <out name> <neon #rrggbb> [--labels-printed]"""
import sys, os, shutil, json, re, base64, cv2
sys.path.insert(0, os.path.dirname(__file__))
import autofit
pic, name, neon = sys.argv[1], sys.argv[2], sys.argv[3]
labels = '--labels-printed' in sys.argv
M = os.environ.get('MOCKUPS', 'mockups')
src, out = f'{M}/western1/replica', f'{M}/ct_test/{name}'
if os.path.exists(out): shutil.rmtree(out)
shutil.copytree(src, out)
cv2.imwrite(f'{out}/art/page.webp', cv2.imread(autofit.G + pic), [cv2.IMWRITE_WEBP_QUALITY, 90])
f = autofit.fit_all(autofit.G + pic)
labels = labels or autofit.labels_printed(autofit.G + pic, f['icons'])
print('labels printed:', labels)
json.dump(f, open(f'{out}/fit.json', 'w'), indent=1)
root = ":root[data-holiday='western']"
gated = root + ":has([data-slot='manual']):not(:has([data-slot='sidebar'][data-collapsed]))"
vy = lambda px: f'{px / 7.12:.3f}vh'
vx = f"{f['x'] / 15.17:.3f}vw"
css = open(f'{src}/theme.css').read()
css += f"""

/* ================= custom theme test: colour {neon}, auto-fit {json.dumps({k: v for k, v in f.items() if k != 'found'})} */
{root} {{
  --skin-led-edge: {neon};
  --skin-led-glow: 0 0 2px {neon}, 0 0 7px {neon}, 0 0 16px color-mix(in srgb, {neon} 70%, transparent);
  --skin-caption: color-mix(in srgb, {neon} 25%, #ffffff);
  --color-primary: {neon};
}}
@media (min-width: 1024px) and (min-aspect-ratio: 8/5) and (max-aspect-ratio: 23/10) {{
{gated} [data-slot='mode-tab'], {gated} [data-slot='mode-tab'][data-active] {{ --neon: {neon}; }}
{gated} [data-card='tank'] [data-slot='tank-bar'] {{ background: repeating-linear-gradient(135deg, #ffffff 0 9px, {neon} 9px 18px) !important; }}
{gated} [data-card='controls'] input[type='range'] {{ color: {neon} !important; }}
{gated} [data-slot='menu'] {{ translate: {vx} {vy(f['tabsY'])} !important; }}
{gated} [data-card='flow'], {gated} [data-part='metrics-row'] {{ translate: {vx} {vy(f['topY'])} !important; }}
{gated} [data-card='tank'] {{ translate: {vx} {vy(f['tankY'])} !important; }}
{gated} [data-card='controls'] {{ translate: {vx} {vy(f['controlsY'])} !important; }}
{gated} [data-card='chart'] {{ translate: {vx} {vy(f['chartY'])} !important; }}
{gated} [data-part='clock'] {{ {'translate: ' + vx + ' ' + vy(f['clockY']) + ' !important;' if f['clock'] else 'display: none !important;'} }}
{(gated + " [data-part='caption'][data-caption], " + gated + " [data-metric='flow'] > [data-part='sub'], " + gated + " [data-card='controls'] [data-part='stepper']:first-child > [data-part='caption'] { display: none !important; }") if labels else ''}
}}
"""

# ---------------------------------------------------------------- placements from the extra fit points (all in 1517 x 712 px -> % / vh)
CARD = {'flow': (331, 222, 509.3, 159), 'temp': (851.3, 222, 332.9, 159), 'pressure': (1190.2, 222, 319.8, 159),
        'tank': (331, 386.9, 509.3, 71), 'controls': (331, 463.9, 509.3, 181.1)}
SHIFT = {'flow': f['topY'], 'temp': f['topY'], 'pressure': f['topY'], 'tank': f['tankY'], 'controls': f['controlsY']}
def rel(card, x, y):
    cx, cy, w, h = CARD[card]
    return (x - cx - f['x']) / w * 100, (y - cy - SHIFT[card]) / h * 100
P = []
CAP = {'flow': f"{gated} [data-caption='flow']", 'temp': f"{gated} [data-caption='temp']", 'pressure': f"{gated} [data-caption='pressure']",
       'tank': f"{gated} [data-card='tank'] [data-part='caption']",
       'controls': f"{gated} [data-card='controls'] [data-part='stepper']:first-child > [data-part='caption']"}
if not labels:
    for k, sel in CAP.items():
        ic = f['icons'].get(k)
        if not ic: continue
        if k == 'tank':   # above the bar: level with the icon's top
            lx, ly = rel(k, ic[2] + 9, ic[1] + 1)
            P.append(f"{sel} {{ left: {lx:.2f}% !important; top: {ly:.2f}% !important; translate: none !important; }}")
            continue
        lx, ly = rel(k, ic[2] + 9, (ic[1] + ic[3]) / 2)
        P.append(f"{sel} {{ left: {lx:.2f}% !important; top: {ly:.2f}% !important; translate: 0 -50% !important; }}")
    ic = f['icons'].get('controls')
    if ic:
        lx, ly = rel('controls', ic[2] + 9, 562 + f['controlsY'])
        P.append(f"{gated} [data-card='controls'] [data-part='stepper'] + [data-part='stepper'] > [data-part='caption'] {{ left: {lx:.2f}% !important; top: {ly:.2f}% !important; translate: 0 -50% !important; }}")
if f['brew']:
    bx, by, r = f['brew']
    d = 2 * r - 6 if 0.9 < r / 76.8 < 1.1 else 148   # a ring much bigger or smaller than the master's is its outer edge: keep the master size
    cx, cy = rel('flow', bx, by)
    P.append(f"{gated} [data-card='flow'] > [data-slot='brew'] {{ left: calc({cx:.2f}% - {d / 2 / 7.12:.3f}vh) !important; top: calc({cy:.2f}% - {d / 2 / 7.12:.3f}vh) !important; }}")
    P.append(f"{gated} [data-card='flow'] > [data-slot='brew'] > button {{ width: {d / 7.12:.3f}vh !important; height: {d / 7.12:.3f}vh !important; }}")
if f['menu']:
    mx1, my1, mx2, my2 = f['menu']
    plate = f['dashPlate']
    dash_top = plate[1] if plate else my1 + 3
    dash_h = (plate[3] - plate[1]) if plate else 48
    rows_top = my1 + 4 if plate else dash_top + dash_h + 4
    credit_room = 0 if f['creditPlate'] else 36
    row_h = (my2 - rows_top - 8 - credit_room) / 7
    P.append(f"{gated} [data-slot='sidebar']:not([data-collapsed]) [data-slot='logo'] {{ height: {dash_top / 7.12:.3f}vh !important; }}")
    P.append(f"{gated} [data-slot='sidebar'] [data-menu] {{ height: {row_h / 7.12:.3f}vh !important; }}")
    P.append(f"{gated} [data-slot='sidebar'] [data-menu='dashboard'] {{ height: {dash_h / 7.12:.3f}vh !important; margin-bottom: {(rows_top - dash_top - dash_h) / 7.12:.3f}vh !important; }}")
    if f['creditPlate']:
        a, b, c2, e = f['creditPlate']
        P.append(f"{gated} [data-slot='sidebar']:not([data-collapsed]) [data-part='credit'] {{ left: {a / 15.17:.3f}vw !important; top: {b / 7.12:.3f}vh !important; width: {(c2 - a) / 15.17:.3f}vw !important; height: {(e - b) / 7.12:.3f}vh !important; }}")
    else:
        P.append(f"{gated} [data-slot='sidebar']:not([data-collapsed]) [data-part='credit'] {{ left: {(mx1 + 12) / 15.17:.3f}vw !important; top: {(my2 - 36) / 7.12:.3f}vh !important; width: {(mx2 - mx1 - 24) / 15.17:.3f}vw !important; height: {28 / 7.12:.3f}vh !important; padding: 0 !important; font-size: 1.4vh !important; white-space: nowrap; display: flex !important; align-items: center; justify-content: center; background: rgba(8, 8, 8, 0.85); border-radius: 0.7vh; }}")
P.append(f"{gated} [data-metric='weight'] > [data-part='sub'] button {{ background: rgba(0, 0, 0, 0.55) !important; box-shadow: 0 0 0 1.5px {neon}, 0 0 8px {neon} !important; color: #ffffff !important; text-shadow: 0 0 6px {neon} !important; }}")
css = css.rstrip().rstrip('}') + "\n/* extra fit points */\n" + "\n".join(P) + "\n}\n"
open(f'{out}/theme.css', 'w').write(css)
def inl(m): return 'url("data:image/webp;base64,%s")' % base64.b64encode(open(f'{out}/' + m.group(1), 'rb').read()).decode()
open(f'{out}/theme_view.css', 'w').write(re.sub(r"url\('(art/[a-z_]+\.webp)'\)", inl, css))
print(name, json.dumps({k: v for k, v in f.items() if k != 'found'}))
