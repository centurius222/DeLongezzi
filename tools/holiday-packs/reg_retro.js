// Screenshot the registration check (picture + live page stacked, same origin so the
// iframe loads) and a plain shot of the live page. Both go next to the mockup folder.
const { chromium } = require('playwright');
const MOCKUPS = process.env.MOCKUPS || 'mockups';
const DIR = `${MOCKUPS}/retrogamez/replica`;
const OUT = `${MOCKUPS}/retrogamez`;
(async () => {
  const b = await chromium.launch();
  // stacked overlay
  const p = await b.newPage({ viewport: { width: 1517, height: 712 } });
  await p.goto('file://' + DIR + '/overlay.html');
  await p.waitForTimeout(1800);
  await p.screenshot({ path: OUT + '/registration.png' });
  console.log('wrote registration.png');
  // just the live page
  const q = await b.newPage({ viewport: { width: 1517, height: 712 } });
  await q.goto('file://' + DIR + '/index.html');
  await q.waitForTimeout(1800);
  await q.screenshot({ path: OUT + '/mockup.png' });
  console.log('wrote mockup.png');
  await b.close();
})();
