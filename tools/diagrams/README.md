# Wiring diagrams

`lowvoltage.py` draws the low-voltage wiring diagram (`docs/wiring-low-voltage.png`), `highvoltage.py` the
high-voltage (mains) side (`docs/wiring-high-voltage.png`), and `stock.py` the stock machine's wiring in its four switch positions
(`docs/stock-wiring.png`), all as SVG. The high-voltage parts (boiler, terminal block, pump, SSR, ...) are in `hv_parts/`.
`render.cjs` turns an SVG into the PNG at 2x.

```bash
python3 tools/diagrams/lowvoltage.py /tmp/wiring-low-voltage.svg
node tools/diagrams/render.cjs /tmp/wiring-low-voltage.svg docs/wiring-low-voltage.png
python3 tools/diagrams/highvoltage.py /tmp/wiring-high-voltage.svg
node tools/diagrams/render.cjs /tmp/wiring-high-voltage.svg docs/wiring-high-voltage.png
python3 tools/diagrams/stock.py /tmp/stock-wiring.svg
node tools/diagrams/render.cjs /tmp/stock-wiring.svg docs/stock-wiring.png
```

- Playwright comes from `tools/holiday-packs`: run `npm install` and `npx playwright install chromium` there once.
- The labels are sized for the DejaVu Sans fonts (`fonts-dejavu` on Debian/Ubuntu).
- Every GPIO comes from the firmware (`GM_PRO_LEGO` in `lib/GaggiMateController/src/ControllerConfig.h`,
  `TOUCH_PIN` in `src/display/plugins/WaterLevelPlugin.cpp`): check there before changing a pin.
- `docs/wiring.jpg` is the builder's original hand-made mains picture; `highvoltage.py` is its redrawn version.
