// Turns the real web page into the demo site (web/src/demo): before the page's own code runs,
// its WebSocket, its /api requests and its uploads are pointed at a fake machine (machine.js) in
// the browser. A banner says it is a demo; anything that would change a real machine shows a
// short note. Nothing is sent anywhere; a reload starts over.
import { DemoMachine } from './machine.js';
import { CUSTOM_THEMES, VIDEOS, DIAGNOSTICS, WATERLEVEL, SCALES_INFO } from './recorded.js';

const machine = new DemoMachine();
const themes = structuredClone(CUSTOM_THEMES);
const videos = structuredClone(VIDEOS);
let beans = [];
const startedAt = Date.now();

// ---- demo tag and notes --------------------------------------------------------------------------
// The page fills the screen (a custom theme lays its controls over its picture), so nothing here
// takes room from it or catches a click: a small corner tag and short notes at the bottom.

function addStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .demo-tag { position: fixed; z-index: 2147483000; top: 6px; right: 6px; padding: 1px 8px; border-radius: 999px;
      background: rgba(139, 74, 43, 0.85); color: #fff; font: 700 11px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      letter-spacing: 0.08em; pointer-events: none; }
    .demo-note { position: fixed; z-index: 2147483001; left: 50%; bottom: max(16px, env(safe-area-inset-bottom)); transform: translateX(-50%);
      max-width: calc(100vw - 32px); padding: 9px 16px; border-radius: 10px; background: #8b4a2b; color: #fff;
      font: 500 14px/1.35 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; box-shadow: 0 6px 22px rgba(0,0,0,.25);
      opacity: 0; pointer-events: none; transition: opacity .3s; }
    .demo-note.shown { opacity: 1; }
  `;
  document.head.appendChild(style);
  const tag = document.createElement('div');
  tag.className = 'demo-tag';
  tag.textContent = 'DEMO';
  document.body.appendChild(tag);
}

let noteTimer = 0;
function note(text) {
  let el = document.querySelector('.demo-note');
  if (!el) {
    el = document.createElement('div');
    el.className = 'demo-note';
    document.body.appendChild(el);
  }
  el.textContent = `Demo: ${text}`;
  el.classList.add('shown');
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => el.classList.remove('shown'), 3200);
}
machine.notice = note;

if (document.body) addStyles();
else document.addEventListener('DOMContentLoaded', addStyles);

// Download links to the machine (full backup, new-board file).
document.addEventListener(
  'click',
  e => {
    const a = e.target.closest?.('a[href^="/api/"]');
    if (!a) return;
    e.preventDefault();
    note('downloads come from a real machine');
  },
  true,
);

// ---- WebSocket ---------------------------------------------------------------------------------

class FakeWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    super();
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    setTimeout(() => {
      if (this.readyState !== FakeWebSocket.CONNECTING) return;
      this.readyState = FakeWebSocket.OPEN;
      machine.sockets.add(this);
      this.emit(new Event('open'));
      this.deliver(machine.status());
    }, 30);
  }

  emit(event) {
    this.dispatchEvent(event);
    this[`on${event.type}`]?.(event);
  }

  send(data) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('WebSocket is not open');
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    const reply = machine.handle(msg);
    if (reply) setTimeout(() => this.deliver(reply), 20 + Math.random() * 60);
  }

  deliver(message) {
    if (this.readyState !== FakeWebSocket.OPEN) return;
    this.emit(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    machine.sockets.delete(this);
    // a real socket reports it later, after the page has already opened its next one
    setTimeout(() => this.emit(new CloseEvent('close', { code: 1000, wasClean: true })), 0);
  }
}
window.WebSocket = FakeWebSocket;

// ---- /api requests -------------------------------------------------------------------------------

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const binary = buffer =>
  buffer ? new Response(buffer, { headers: { 'Content-Type': 'application/octet-stream' } }) : new Response('Not found', { status: 404 });

// A POST body as plain fields (form data, URL-encoded text or JSON).
async function fields(body) {
  if (!body) return {};
  if (typeof FormData !== 'undefined' && body instanceof FormData) return Object.fromEntries(body.entries());
  if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return Object.fromEntries(new URLSearchParams(body).entries());
    }
  }
  return {};
}

// A setting from a form keeps the type the machine gives it.
function applySettings(form) {
  const s = machine.settings;
  for (const [key, raw] of Object.entries(form)) {
    if (!(key in s)) continue;
    const current = s[key];
    if (typeof current === 'boolean') s[key] = ['1', 'true', 'on', true].includes(raw);
    else if (typeof current === 'number') s[key] = Number(raw);
    else s[key] = String(raw);
  }
}

function demoLog() {
  const up = ((Date.now() - startedAt) / 1000).toFixed(3);
  return [
    '[0.518] BOOT #1 reset=POWERON prevRun=kept prevWdt=0 coredump=0 B',
    '[0.519] firmware built (demo)',
    '[1.436] BT standby off',
    '[2.311] WIFI got IP 192.168.1.50',
    `[${up}] demo: this log comes from the demo site, not a machine`,
  ].join('\n');
}

async function answer(url, init) {
  const path = url.pathname;
  const method = (init?.method || 'GET').toUpperCase();
  const id = url.searchParams.get('id');

  if (path === '/api/settings') {
    if (method === 'POST') {
      applySettings(await fields(init.body));
      note('settings kept in this browser only');
    }
    return json(machine.settings);
  }
  if (path === '/api/settings-import' || path === '/api/portal' || path.startsWith('/api/scales/connect')) {
    note('this needs a real machine');
    return json({ error: 'demo' }, 400);
  }
  if (path === '/api/custom-themes') return json(themes);
  if (path === '/api/custom-theme-meta' && method === 'POST') {
    const meta = JSON.parse((await fields(init.body)).meta || '{}');
    const i = themes.themes.findIndex(t => t.id === id);
    if (i >= 0) themes.themes[i] = { ...meta, id, tag: themes.themes[i].tag };
    note('theme changes stay in this browser');
    return json({ ok: true });
  }
  if (path === '/api/custom-theme-delete' && method === 'POST') {
    themes.themes = themes.themes.filter(t => t.id !== id);
    note('removed in this browser only');
    return json({ ok: true });
  }
  if (path === '/api/videos') return json(videos);
  if (path === '/api/video-name' && method === 'POST') {
    const v = videos.videos.find(v => v.id === id);
    if (v) v.name = (await fields(init.body)).name || v.name;
    return json({ ok: true });
  }
  if (path === '/api/video-loop' && method === 'POST') {
    const v = videos.videos.find(v => v.id === id);
    if (v) v.once = (await fields(init.body)).loop === '0';
    return json({ ok: true });
  }
  if (path === '/api/video-delete' && method === 'POST') {
    videos.videos = videos.videos.filter(v => v.id !== id);
    note('removed in this browser only');
    return json({ ok: true });
  }
  if (path === '/api/history/index.bin') return binary(machine.indexFile());
  if (path === '/api/history/recent.bin') return binary(machine.indexFile(Number(url.searchParams.get('limit')) || 10));
  const shot = path.match(/^\/api\/history\/(\d+)\.slog$/);
  if (shot) return binary(machine.shotFile(Number(shot[1])));
  if (path === '/api/diagnostics') {
    return json({ ...DIAGNOSTICS, uptime: Math.round((Date.now() - startedAt) / 1000) + 3600 });
  }
  if (path === '/api/waterlevel') return json({ ...WATERLEVEL, percent: 100 });
  if (path === '/api/beans') {
    if (method === 'POST') {
      try {
        beans = JSON.parse(init.body);
      } catch {
        // keep the old list
      }
      note('kept in this browser only');
    }
    return json(beans);
  }
  if (path === '/api/scales/list' || path === '/api/scales/scan') return json([]);
  if (path === '/api/scales/info') return json({ ...SCALES_INFO, connected: true, name: 'Demo scale' });
  if (path === '/api/log') return new Response(demoLog(), { headers: { 'Content-Type': 'text/plain' } });
  if (path.startsWith('/api/test/')) {
    if (path !== '/api/test/stop') note('nothing runs, there is no pump or heater here');
    return json({ ok: true });
  }
  if (method === 'POST') note('nothing is sent to a machine');
  return new Response('Not found', { status: 404 });
}

// GitHub Pages gives a file its type from its name, and the page checks it (a brew-button video
// plays in a <video>), so the demo keeps them as video.mp4, video.webp and still.webp.
function staticFile(url) {
  const m = url.pathname.match(/^\/vid\/([a-z]+)\/(video|still)$/);
  if (!m) return null;
  const mp4 = m[2] === 'video' && VIDEOS.videos.find(v => v.id === m[1])?.type === 'video/mp4';
  return `/vid/${m[1]}/${m[2]}.${mp4 ? 'mp4' : 'webp'}${url.search}`;
}

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input), location.href);
  if (url.origin !== location.origin) {
    // Visualizer uploads: a visitor's account would get made-up shots
    note('nothing is sent anywhere from the demo');
    return new Response('demo', { status: 403 });
  }
  const file = staticFile(url);
  if (file) return nativeFetch(file, init);
  if (!url.pathname.startsWith('/api/')) return nativeFetch(input, init);
  if (!init && input instanceof Request) init = { method: input.method, body: await input.text() };
  await new Promise(r => setTimeout(r, 40 + Math.random() * 80)); // a little like a real machine
  return answer(url, init);
};

// The same for pictures and videos the page shows straight from their address.
function fixSrc(value) {
  if (typeof value !== 'string' || !value.startsWith('/vid/')) return value;
  return staticFile(new URL(value, location.href)) || value;
}
for (const Kind of [HTMLMediaElement, HTMLImageElement, HTMLSourceElement]) {
  const d = Object.getOwnPropertyDescriptor(Kind.prototype, 'src');
  Object.defineProperty(Kind.prototype, 'src', {
    ...d,
    set(value) {
      d.set.call(this, fixSrc(value));
    },
  });
}
const setAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function (name, value) {
  return setAttribute.call(this, name, name === 'src' ? fixSrc(value) : value);
};

// The settings file is downloaded with a link that is never added to the page.
const anchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () {
  const url = new URL(this.href, location.href);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    note('downloads come from a real machine');
    return;
  }
  return anchorClick.call(this);
};

// ---- uploads (theme pictures, videos, logo) --------------------------------------------------------

const NativeXHR = window.XMLHttpRequest;
class DemoXHR {
  constructor() {
    this.upload = {};
    this.readyState = 0;
    this.status = 0;
    this.responseText = '';
  }

  open(method, url, ...rest) {
    this.target = new URL(url, location.href);
    if (!this.target.pathname.startsWith('/api/')) {
      this.native = new NativeXHR();
      this.native.open(method, url, ...rest);
    }
    this.readyState = 1;
  }

  setRequestHeader(name, value) {
    this.native?.setRequestHeader(name, value);
  }

  addEventListener(type, listener) {
    this[`on${type}`] = listener;
  }

  send(body) {
    if (this.native) {
      const n = this.native;
      n.upload.onprogress = e => this.upload.onprogress?.(e);
      n.onload = () => {
        Object.assign(this, { status: n.status, responseText: n.responseText, readyState: 4 });
        this.onload?.();
      };
      n.onerror = () => this.onerror?.();
      n.send(body);
      return;
    }
    setTimeout(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 });
      Object.assign(this, { status: 403, responseText: JSON.stringify({ error: 'demo' }), readyState: 4 });
      note('uploads need a real machine');
      this.onload?.();
    }, 300);
  }

  abort() {
    this.native?.abort();
  }
}
window.XMLHttpRequest = DemoXHR;
