// Renders an SVG to a PNG at 2x in Chromium: node tools/diagrams/render.cjs <in.svg> <out.png>
// Uses Playwright; install it once with `npm install` in tools/holiday-packs (see its README).
const fs = require('fs');
const path = require('path');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require(path.join(__dirname, '..', 'holiday-packs', 'node_modules', 'playwright')));
}
(async () => {
  const [, , svgPath, pngPath] = process.argv;
  const svg = fs.readFileSync(svgPath, 'utf8');
  const w = +svg.match(/width="(\d+)"/)[1], h = +svg.match(/height="(\d+)"/)[1];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: w, height: h } });
  await browser.close();
})();
