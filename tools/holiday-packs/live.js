// The machine's page with a holiday forced on (settings untouched); reports failed pack loads.
// usage: node live.js <holiday id> out.png   (GM_HOST=http://<ip> to use another machine)
const { chromium } = require('playwright');
(async () => {
  const [holiday, out] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'] });
  const p = await b.newPage({ viewport: { width: 1517, height: 712 } });
  await p.route(u => u.pathname === '/api/settings', async route => { if (route.request().method() !== 'GET') return route.continue(); const res = await route.fetch(); const j = await res.json(); j.holidayMode = holiday; route.fulfill({ response: res, json: j }); });
  await p.routeWebSocket(/\/ws$/, ws => { const s = ws.connectToServer(); s.onMessage(m => { if (typeof m === 'string') { try { const j = JSON.parse(m); if (j.tp === 'evt:status') { j.m = 5; m = JSON.stringify(j); } } catch {} } ws.send(m); }); ws.onMessage(m => s.send(m)); });
  const bad = [];
  p.on('response', r => { if (r.url().includes('/holidays/') && r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
  p.on('requestfailed', r => { if (r.url().includes('/holidays/')) bad.push('FAILED ' + r.url()); });
  await p.goto((process.env.GM_HOST || 'http://delongezzi.local') + '/', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  const sp = p.locator('[aria-label="Dismiss splash screen"]'); if (await sp.count()) await sp.click();
  await p.locator('button[aria-label="Start"]').first().waitFor();
  await p.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(2500);
  const h = await p.evaluate(() => [document.documentElement.getAttribute('data-holiday'), document.fonts.check("40px 'Time Circuits'")]);
  await p.screenshot({ path: out });
  console.log(holiday, 'problems:', bad.length ? bad.join(', ') : 'none', '| data-holiday:', h[0], '| font loaded:', h[1]);
  await p.unrouteAll({ behavior: 'ignoreErrors' });
  await b.close();
})();
