// Boxes of elements in a replica, in CSS px: node box.js <replica dir> "<css selector>" ...
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1517, height: 712 } });
  await p.goto('file://' + process.argv[2] + '/index.html');
  await p.waitForTimeout(800);
  const r = await p.evaluate((sels) => sels.map(s => { const e = document.querySelector(s); if (!e) return [s, null]; const r = e.getBoundingClientRect(); return [s, [r.left, r.top, r.right, r.bottom].map(v => Math.round(v * 10) / 10)]; }), process.argv.slice(3));
  for (const x of r) console.log(JSON.stringify(x));
  await b.close();
})();
