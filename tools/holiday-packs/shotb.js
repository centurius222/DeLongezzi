// Screenshot a replica's view.html (scaled to the window, like the user sees it) in a chosen browser.
// usage: node shotb.js <replica dir> out.png [chromium|firefox] [w h]
const pw = require('playwright');
(async () => {
  const [R, out, browser, w, h] = process.argv.slice(2);
  const b = await pw[browser || 'chromium'].launch();
  const p = await b.newPage({ viewport: { width: +w || 1517, height: +h || 712 } });
  await p.goto('file://' + R + '/index.html');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: out });
  const r = await p.evaluate(() => { const e = document.querySelector("[data-card='controls']").getBoundingClientRect(); return [e.left, e.top, e.width, e.height]; });
  console.log(browser, 'controls card', r.map(v => Math.round(v * 10) / 10).join(' '));
  await b.close();
})();
