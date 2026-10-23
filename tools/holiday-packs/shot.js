// Screenshot a replica (index.html) at a size, report missing files: node shot.js <replica dir> out.png [w h]
const { chromium } = require('playwright');
(async () => {
  const [R, out, w, h] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: +w || 1517, height: +h || 712 } });
  const failed = [];
  p.on('requestfailed', r => failed.push(r.url().split('/').pop()));
  await p.goto('file://' + R + '/index.html');
  await p.waitForTimeout(1200);
  await p.screenshot({ path: out });
  console.log('missing files:', failed.length ? failed.join(', ') : 'none');
  await b.close();
})();
