// Turns the real web page into the demo site (web/src/demo): before the page's own code runs,
// its WebSocket, its /api requests and its uploads are pointed at a fake machine (machine.js) in
// the browser. A small tag says it is a demo, hints on the first screen show what to try, and
// anything that would change a real machine shows a short note. Nothing is sent anywhere; a
// reload starts over.
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
    .demo-hint { position: fixed; z-index: 2147482990; max-width: min(300px, calc(100vw - 16px)); padding: 8px 30px 8px 12px;
      border-radius: 10px; background: #ffd60a; color: #111; cursor: pointer; box-shadow: 0 4px 18px rgba(0,0,0,.4);
      font: 700 16px/1.3 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; text-transform: uppercase;
      user-select: none; -webkit-user-select: none; touch-action: manipulation; }
    .demo-hint::after { content: '\\00d7'; position: absolute; top: 3px; right: 9px; font-size: 18px; font-weight: 400; }
    .demo-hint::before { content: ''; position: absolute; border: 8px solid transparent; }
    .demo-hint[data-side='below']::before { bottom: 100%; left: var(--ax); transform: translateX(-50%); border-bottom-color: #ffd60a; }
    .demo-hint[data-side='above']::before { top: 100%; left: var(--ax); transform: translateX(-50%); border-top-color: #ffd60a; }
    .demo-hint[data-side='right']::before { right: 100%; top: var(--ay); transform: translateY(-50%); border-right-color: #ffd60a; }
    .demo-hint[data-side='left']::before { left: 100%; top: var(--ay); transform: translateY(-50%); border-left-color: #ffd60a; }
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

// ---- hints on the Manual screen ------------------------------------------------------------------
// The first screen points out what isn't obvious. A hint stays until it is tapped, and shows only
// while its control is on screen and on top (not under the menu, the theme picker or another
// page), so every other page looks as it does on a machine. A reload brings them back.
const HINTS = [
  { id: 'themes', anchor: "[data-slot='logo']", text: 'Hold here for themes', sides: ['right', 'below'] },
  // phones: the logo is in the menu
  { id: 'themes', anchor: '.fab .btn-circle', text: 'Open the menu, then hold the logo for themes', sides: ['right', 'above'] },
  {
    id: 'brew',
    anchor: "[data-slot='manual'] [data-slot='brew']",
    text: "Press to brew. You can change the number's colour, opacity and size in Settings.",
    sides: ['below', 'above', 'right', 'left'],
  },
  { id: 'weight', anchor: "[data-slot='manual'] [aria-label='Weight: tap to tare']", text: 'Tap to zero the scale', sides: ['below', 'above'] },
  { id: 'pressure', anchor: "[data-slot='manual'] [data-part='pressure-row']", text: 'Slide to change pressure, even mid-shot', sides: ['below', 'above'] },
  { id: 'chart', anchor: "[data-slot='manual'] [data-card='chart']", text: 'Tap to enlarge', sides: ['inside'] },
];
const dismissed = new Set();
const hintEls = new Map();

function hintElement(hint) {
  let el = hintEls.get(hint);
  if (!el) {
    el = document.createElement('div');
    el.className = 'demo-hint';
    el.textContent = hint.text;
    // Gone when it is clicked or tapped (a mouse passing over it does nothing). It goes when the
    // press ends, so the click can't land on the control underneath; the page never sees it.
    const close = e => {
      e.preventDefault();
      e.stopPropagation();
      dismissed.add(hint.id);
      layoutHints();
    };
    el.addEventListener('pointerdown', e => (e.preventDefault(), e.stopPropagation()));
    el.addEventListener('pointerup', close);
    el.addEventListener('click', close);
    document.body.appendChild(el);
    hintEls.set(hint, el);
  }
  return el;
}

// The control's box when it is on screen and on top, else null.
function onTop(anchor) {
  const r = anchor.getBoundingClientRect();
  if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return null;
  const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
  const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
  // what's there under the hints (one may sit on its own control)
  const hit = document.elementsFromPoint(x, y).find(e => !e.closest('.demo-hint'));
  return hit && anchor.contains(hit) ? r : null;
}

// Beside the control, on the first side that fits on screen without covering another hint;
// the arrow points at the control's middle.
function placeHint(el, r, sides, taken) {
  const gap = 10;
  const m = 8;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const clampX = x => Math.min(Math.max(x, m), innerWidth - w - m);
  const clampY = y => Math.min(Math.max(y, m), innerHeight - h - m);
  for (const side of sides) {
    let x = clampX(cx - w / 2);
    let y = clampY(cy - h / 2);
    if (side === 'below') y = r.bottom + gap;
    else if (side === 'above') y = r.top - gap - h;
    else if (side === 'right') x = r.right + gap;
    else if (side === 'left') x = r.left - gap - w;
    const box = { left: x, top: y, right: x + w, bottom: y + h };
    const fits = x >= m && y >= m && box.right <= innerWidth - m && box.bottom <= innerHeight - m;
    if (!fits || taken.some(t => t.left < box.right && box.left < t.right && t.top < box.bottom && box.top < t.bottom)) continue;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.dataset.side = side;
    el.style.setProperty('--ax', `${Math.min(Math.max(cx - x, 14), w - 14)}px`);
    el.style.setProperty('--ay', `${Math.min(Math.max(cy - y, 12), h - 12)}px`);
    taken.push(box);
    return true;
  }
  return false;
}

function layoutHints() {
  const ready = document.querySelector("[data-slot='manual']") && !document.querySelector('[aria-label="Dismiss splash screen"]');
  const taken = [];
  const shown = new Set();
  for (const hint of HINTS) {
    const anchor = ready && !dismissed.has(hint.id) && !shown.has(hint.id) && document.querySelector(hint.anchor);
    const r = anchor && onTop(anchor);
    if (!r) {
      if (hintEls.has(hint)) hintEls.get(hint).hidden = true;
      continue;
    }
    const el = hintElement(hint);
    el.hidden = false;
    if (placeHint(el, r, hint.sides, taken)) shown.add(hint.id);
    else el.hidden = true;
  }
}

function start() {
  addStyles();
  const timer = setInterval(() => {
    layoutHints();
    if (HINTS.every(h => dismissed.has(h.id))) clearInterval(timer);
  }, 250);
  addEventListener('resize', layoutHints);
}
if (document.body) start();
else document.addEventListener('DOMContentLoaded', start);

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
