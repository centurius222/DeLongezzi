# Wiring diagrams

`lowvoltage.py` draws the low-voltage wiring diagram (`docs/wiring-low-voltage.png`) as an SVG, and
`render.cjs` turns the SVG into the PNG at 2x (4000 × 2828).

```bash
python3 tools/diagrams/lowvoltage.py /tmp/wiring-low-voltage.svg
node tools/diagrams/render.cjs /tmp/wiring-low-voltage.svg docs/wiring-low-voltage.png
```

- Playwright comes from `tools/holiday-packs`: run `npm install` and `npx playwright install chromium` there once.
- The labels are sized for the DejaVu Sans fonts (`fonts-dejavu` on Debian/Ubuntu).
- Every GPIO comes from the firmware (`GM_PRO_LEGO` in `lib/GaggiMateController/src/ControllerConfig.h`,
  `TOUCH_PIN` in `src/display/plugins/WaterLevelPlugin.cpp`): check there before changing a pin.
- The mains side is a separate picture (`docs/wiring.jpg`), not drawn by these scripts.
