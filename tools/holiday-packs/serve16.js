// View-only preview of the 16:10 Western: the machine's own page, with this folder's pack/ served as
// /holidays/western/, Western forced on and the Manual screen shown. Nothing is sent to the machine
// (no POSTs, websocket messages from the page are dropped), so its settings and mode never change.
// node serve16.js  ->  http://localhost:8090
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MACHINE = 'delongezzi.local';
const PORT = 8090;
const PACK = path.join(__dirname, 'pack');
const TYPES = { '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.ttf': 'font/ttf' };

const INJECT = `<script>(() => {
  const Real = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    const ws = new Real(url, protocols);
    ws.send = () => {}; // view only
    const add = ws.addEventListener.bind(ws);
    const wrap = fn => e => {
      if (typeof e.data === 'string') {
        try { const j = JSON.parse(e.data); if (j.tp === 'evt:status') { j.m = 5; e = new MessageEvent('message', { data: JSON.stringify(j) }); } } catch {}
      }
      return fn.call(ws, e);
    };
    ws.addEventListener = (t, fn, o) => add(t, t === 'message' ? wrap(fn) : fn, o);
    let on = null;
    Object.defineProperty(ws, 'onmessage', { get: () => on, set: fn => { if (on) ws.removeEventListener('message', on._w); on = fn; if (fn) { fn._w = wrap(fn); add('message', fn._w); } } });
    return ws;
  };
  Object.assign(window.WebSocket, Real);
  window.WebSocket.prototype = Real.prototype;
})();</script>`;

function fetchMachine(req, cb) {
  const headers = { ...req.headers, host: MACHINE };
  delete headers['accept-encoding'];
  const up = http.request({ host: MACHINE, port: 80, path: req.url, method: 'GET', headers }, cb);
  up.on('error', e => cb(null, e));
  up.end();
}

function readBody(res, cb) {
  const parts = [];
  res.on('data', d => parts.push(d));
  res.on('end', () => {
    let buf = Buffer.concat(parts);
    if (res.headers['content-encoding'] === 'gzip') buf = zlib.gunzipSync(buf);
    cb(buf);
  });
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(403, { 'content-type': 'application/json' });
      return res.end('{"preview":"view only"}');
    }
    if (url.pathname.startsWith('/holidays/western/')) {
      const file = path.join(PACK, url.pathname.slice('/holidays/western/'.length));
      if (!file.startsWith(PACK) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(file));
    }
    const isPage = !path.extname(url.pathname) || url.pathname.endsWith('.html');
    if (url.pathname === '/api/settings' || isPage) {
      return fetchMachine(req, (up, err) => {
        if (!up) { res.writeHead(502); return res.end(String(err)); }
        readBody(up, buf => {
          let body = buf;
          const type = up.headers['content-type'] || '';
          if (url.pathname === '/api/settings') {
            const j = JSON.parse(buf.toString());
            j.holidayMode = 'western';
            body = Buffer.from(JSON.stringify(j));
          } else if (type.includes('html')) {
            body = Buffer.from(buf.toString().replace('<head>', '<head>' + INJECT));
          }
          const h = { ...up.headers, 'cache-control': 'no-store' };
          delete h['content-encoding'];
          delete h['content-length'];
          delete h['etag'];
          res.writeHead(up.statusCode, h);
          res.end(body);
        });
      });
    }
    const headers = { ...req.headers, host: MACHINE };
    delete headers['if-none-match'];
    delete headers['if-modified-since'];
    const up = http.request({ host: MACHINE, port: 80, path: req.url, method: 'GET', headers }, r => {
      const h = { ...r.headers, 'cache-control': 'no-store' };
      delete h['etag'];
      delete h['last-modified'];
      res.writeHead(r.statusCode, h);
      r.pipe(res);
    });
    up.on('error', () => { res.writeHead(502); res.end(); });
    up.end();
  })
  .on('upgrade', (req, socket, head) => {
    const up = net.connect(80, MACHINE, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i];
        lines.push(`${k}: ${k.toLowerCase() === 'host' ? MACHINE : k.toLowerCase() === 'origin' ? 'http://' + MACHINE : req.rawHeaders[i + 1]}`);
      }
      up.write(lines.join('\r\n') + '\r\n\r\n');
      if (head && head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  })
  .listen(PORT, () => console.log(`preview on http://localhost:${PORT}`));
