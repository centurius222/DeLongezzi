// Check that the live pieces still land on their windows at other window sizes.
// The pack is sized in vw/vh, so every box should scale with the picture.
const { chromium } = require('playwright');
const DIR = `${process.env.MOCKUPS || 'mockups'}/retrogamez/replica`;
const sels = [
  "[data-metric='flow'] > [data-part='value']",
  "[data-metric='weight'] > [data-part='value']",
  "[data-metric='temp'] > [data-part='value']",
  "[data-metric='pressure'] > [data-part='value']",
  "[data-card='tank'] div:has(> [data-slot='tank-bar'])",
  "[data-card='controls'] [data-part='stepper']:first-child [data-part='stepper-value']",
  "[data-card='flow'] > [data-slot='brew']",
];
// the picture's windows, in CSS px of 1517x712, which scale by w/1517 and h/712
const ref = {
  "[data-metric='flow'] > [data-part='value']": [358,293,492,353],
  "[data-metric='weight'] > [data-part='value']": [684,293,817,353],
  "[data-metric='temp'] > [data-part='value']": [881,295,1160,365],
  "[data-metric='pressure'] > [data-part='value']": [1221,296,1422,375],
  "[data-card='tank'] div:has(> [data-slot='tank-bar'])": [374,412,826,462],
  "[data-card='controls'] [data-part='stepper']:first-child [data-part='stepper-value']": [535,496,669,539],
  "[data-card='flow'] > [data-slot='brew']": [494.2,230.7,673,409.5],
};
(async () => {
  const b = await chromium.launch();
  for (const [W, H] of [[1517,712],[1200,700],[1024,768],[1920,1080],[800,480]]) {
    const p = await b.newPage({ viewport: { width: W, height: H } });
    await p.goto('file://' + DIR + '/index.html');
    await p.waitForTimeout(700);
    const out = await p.evaluate((sels) => sels.map(s => {
      const e = document.querySelector(s); if (!e) return [s, null];
      const r = e.getBoundingClientRect();
      return [s, [r.left, r.top, r.right, r.bottom].map(v => Math.round(v))];
    }), sels);
    console.log(`\n### ${W} x ${H}`);
    for (const [s, r] of out) {
      if (!r) { console.log('  MISSING', s); continue; }
      const t = ref[s], sx = W/1517, sy = H/712;
      const want = [t[0]*sx, t[1]*sy, t[2]*sx, t[3]*sy];
      const d = r.map((v,i) => Math.round(v - want[i]));
      const worst = Math.max(...d.map(Math.abs));
      console.log(`  ${worst <= 3 ? 'ok  ' : 'OFF '} d=[${d.join(',')}]  ${s.slice(0,58)}`);
    }
    await p.close();
  }
  await b.close();
})();
