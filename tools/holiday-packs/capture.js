// Replica base: a 1517x712 snapshot of the REAL page (local web build, Manual faked),
// with the holiday hooks set, ready to be dressed by <replica>/theme.css.
// usage: node capture.js <replica dir> <holiday id>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const HOST = process.env.GM_HOST || 'http://delongezzi.local';   // the machine
const DIST = path.resolve(__dirname, '../../web/dist');   // the local web build (scripts/build_webui.sh)
const R = process.argv[2];
const ID = process.argv[3];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.woff2': 'font/woff2' };
function local(p) {
  const f = path.join(DIST, p);
  if (!f.startsWith(DIST + '/')) return null;
  if (fs.existsSync(f) && fs.statSync(f).isFile()) return fs.readFileSync(f);
  if (fs.existsSync(f + '.gz')) return zlib.gunzipSync(fs.readFileSync(f + '.gz'));
  return null;
}
(async () => {
  const b = await chromium.launch({ args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'] });
  const ctx = await b.newContext({ viewport: { width: 1517, height: 712 }, colorScheme: 'dark' });
  const p = await ctx.newPage();
  await p.route(u => u.origin === HOST, async route => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname.startsWith('/api/')) {
      if (u.pathname === '/api/settings' && req.method() === 'GET') {
        const res = await route.fetch();
        const j = await res.json();
        j.holidayMode = 'tiki'; // any pack, so the page draws its decoration boxes
        return route.fulfill({ response: res, json: j });
      }
      return route.continue();
    }
    let pth = u.pathname === '/' ? '/index.html' : u.pathname;
    let body = local(pth);
    if (!body && !pth.startsWith('/assets/')) { pth = '/index.html'; body = local(pth); }
    if (!body) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, body, contentType: TYPES[path.extname(pth)] || 'application/octet-stream' });
  });
  await p.routeWebSocket(/\/ws$/, ws => {
    const server = ws.connectToServer();
    server.onMessage(m => {
      if (typeof m === 'string') { try { const j = JSON.parse(m); if (j.tp === 'evt:status') { j.m = 5; if ('tt' in j) j.tt = 93; m = JSON.stringify(j); } } catch {} }
      ws.send(m);
    });
    ws.onMessage(m => server.send(m));
  });
  await p.goto(HOST + '/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const splash = p.locator('[aria-label="Dismiss splash screen"]');
  if (await splash.count()) { await splash.click(); await p.waitForTimeout(800); }
  await p.locator('button[aria-label="Start"]').first().waitFor({ timeout: 20000 });
  await p.waitForTimeout(2500);

  const out = await p.evaluate(async (ID) => {
    const root = document.documentElement;
    document.getElementById('gm-holiday')?.remove();
    document.getElementById('gm-custom-theme')?.remove();
    root.classList.remove('theme-dark');
    root.setAttribute('data-theme', 'dark');
    root.setAttribute('data-holiday', ID);
    for (const card of document.querySelectorAll("[data-card='flow'], [data-card='temp'], [data-card='pressure']")) {
      for (const g of card.querySelectorAll('.grid')) {
        const c = g.firstElementChild;
        if (c && g.children.length === 3 && /^(flow|weight|temp|pressure)$/i.test(c.textContent.trim())) {
          const name = c.textContent.trim().toLowerCase();
          g.setAttribute('data-part', 'metric'); g.setAttribute('data-metric', name);
          c.setAttribute('data-part', 'caption'); c.setAttribute('data-caption', name);
          g.children[1].setAttribute('data-part', 'value');
          g.children[2].setAttribute('data-part', 'sub');
        }
      }
    }
    // as in the picture: a scale linked, reading -4.7, Tare ready; the brew button idle; Standby lit
    const wv = document.querySelector("[data-metric='weight'] [data-part='value'] > span");
    if (wv) { wv.textContent = '-4.7'; wv.className = wv.className.replace('text-base-content/30', 'text-base-content'); }
    document.querySelector("[data-metric='weight'] [data-part='sub'] button")?.removeAttribute('disabled');
    for (const t of document.querySelectorAll("[data-slot='mode-tab']")) {
      const on = t.getAttribute('data-tab') === 'standby';
      if (on) t.setAttribute('data-active', ''); else t.removeAttribute('data-active');
      t.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    for (const cv of document.querySelectorAll('canvas')) {
      const r = cv.getBoundingClientRect(), img = document.createElement('img');
      const cx = cv.getContext('2d'), data = cx.getImageData(0, 0, cv.width, cv.height), px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const [R, G, B, A] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
        if (!A) continue;
        const grey = Math.abs(R - G) < 12 && Math.abs(G - B) < 12;
        if (grey && R > 80 && R < 130) { px[i] = 238; px[i + 1] = 238; px[i + 2] = 238; }
        else if (grey && R < 40) { px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = Math.min(255, A * 0.7); }
      }
      cx.putImageData(data, 0, 0);
      img.src = cv.toDataURL(); img.className = cv.className; img.style.cssText = cv.style.cssText; img.style.width = r.width + 'px'; img.style.height = r.height + 'px';
      cv.replaceWith(img);
    }
    for (const im of document.querySelectorAll('img')) {
      const src = im.getAttribute('src');
      if (src && src.startsWith('/')) {
        try { const res = await fetch(src); if (res.ok) { const blob = await res.blob(); im.setAttribute('src', await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); })); } } catch {}
      }
    }
    const sheets = [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.getAttribute('href'));
    document.querySelectorAll('script, link, style#gm-holiday').forEach(e => e.remove());
    document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="app.css"><link rel="stylesheet" href="theme.css">');
    return { sheets, html: '<!doctype html>\n' + document.documentElement.outerHTML };
  }, ID);
  let css = '';
  for (const href of out.sheets) css += local(href).toString('utf8') + '\n';
  const assets = [...new Set([...css.matchAll(/url\((['"]?)(\/assets\/[^'")]+)\1\)/g)].map(m => m[2]))];
  fs.mkdirSync(`${R}/assets`, { recursive: true });
  for (const a of assets) { const buf = local(a); if (buf) fs.writeFileSync(`${R}/assets/${a.split('/').pop()}`, buf); }
  css = css.replace(/url\((['"]?)\/assets\//g, 'url($1assets/');
  fs.writeFileSync(`${R}/app.css`, css);
  fs.writeFileSync(`${R}/index.html`, out.html);
  console.log(`captured: ${out.sheets.length} stylesheet(s), ${assets.length} asset file(s), page ${(out.html.length / 1024).toFixed(0)} KB`);
  await b.close();
})();
