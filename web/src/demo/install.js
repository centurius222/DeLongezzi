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
    .demo-hint, .demo-ring { position: fixed; z-index: 2147482990; pointer-events: none; color-scheme: only light; forced-color-adjust: none; }
    .demo-hint { max-width: min(300px, calc(100vw - 16px)); padding: 8px 12px; border-radius: 10px; background: #ffd60a; color: #111;
      box-shadow: 0 4px 18px rgba(0,0,0,.45); font: 700 16px/1.3 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; text-transform: uppercase; }
    .demo-hint::before { content: ''; position: absolute; border: 11px solid transparent; }
    .demo-hint[data-side='below']::before { bottom: 100%; left: var(--ax); transform: translateX(-50%); border-bottom-color: #ffd60a; }
    .demo-hint[data-side='above']::before { top: 100%; left: var(--ax); transform: translateX(-50%); border-top-color: #ffd60a; }
    .demo-hint[data-side='right']::before { right: 100%; top: var(--ay); transform: translateY(-50%); border-right-color: #ffd60a; }
    .demo-hint[data-side='left']::before { left: 100%; top: var(--ay); transform: translateY(-50%); border-left-color: #ffd60a; }
    .demo-ring { width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; border: 4px solid #ffd60a;
      box-shadow: 0 0 0 2px rgba(0,0,0,.45), 0 0 14px #ffd60a; animation: demo-ring 1.4s ease-out infinite; }
    @keyframes demo-ring { 0% { transform: scale(.75); opacity: 1; } 100% { transform: scale(1.35); opacity: .35; } }
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
// The first screen points out what isn't obvious: a pulsing ring on the spot to press and a label
// beside it. Neither catches a press (a press on them reaches the control underneath), and a
// hint goes once its control is pressed. They show only while the control is on screen and on
// top (not under the menu, the theme picker or another page), so every other page looks as it
// does on a machine. A reload brings them back.
const center = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const HINTS = [
  // on the logo itself where it fits, so holding the words opens the picker too
  { id: 'themes', anchor: "[data-slot='logo']", text: 'Hold here for themes', sides: ['inside', 'right', 'below'] },
  // phones: the logo is in the menu
  { id: 'menu', anchor: '.fab .btn-circle', text: 'Open the menu, then hold the logo for themes', sides: ['right', 'above'] },
  {
    id: 'brew',
    anchor: "[data-slot='manual'] [data-slot='brew']",
    text: "Press to brew. You can change the number's colour, opacity and size in Settings.",
    sides: ['below', 'above', 'right', 'left'],
  },
  { id: 'weight', anchor: "[data-slot='manual'] [aria-label='Weight: tap to tare']", text: 'Tap to zero the scale', sides: ['below', 'above', 'left', 'right'] },
  {
    id: 'pressure',
    anchor: "[data-slot='manual'] [data-part='pressure-row']",
    text: 'Slide to change pressure, even mid-shot',
    sides: ['below', 'above'],
    // the slider's knob
    spot: el => {
      const input = el.querySelector('input[type=range]');
      if (!input) return center(el.getBoundingClientRect());
      const r = input.getBoundingClientRect();
      const min = Number(input.min || 0);
      const span = Number(input.max || 100) - min || 1;
      const knob = Math.min(r.height, 32) / 2;
      return { x: r.left + knob + ((Number(input.value) - min) / span) * (r.width - 2 * knob), y: r.top + r.height / 2 };
    },
  },
  // the label goes right under the ring, inside the chart
  { id: 'chart', anchor: "[data-slot='manual'] [data-card='chart']", text: 'Tap to enlarge', sides: ['below', 'above'], nearSpot: true },
];
const dismissed = new Set();
const shown = new Map(); // hint -> { label, ring }

function elementsFor(hint) {
  let els = shown.get(hint);
  if (!els) {
    const label = document.createElement('div');
    label.className = 'demo-hint';
    label.textContent = hint.text;
    const ring = document.createElement('div');
    ring.className = 'demo-ring';
    document.body.append(ring, label);
    els = { label, ring };
    shown.set(hint, els);
  }
  return els;
}

// The control's box when it is on screen and on top at its spot, else null.
function onTop(anchor, spot) {
  const r = anchor.getBoundingClientRect();
  if (r.width < 4 || r.height < 4 || spot.x < 0 || spot.y < 0 || spot.x >= innerWidth || spot.y >= innerHeight) return null;
  const hit = document.elementFromPoint(spot.x, spot.y);
  return hit && anchor.contains(hit) ? r : null;
}

// Anything a press could land on, to keep the labels off them where there is room.
function controls(except) {
  return [...document.querySelectorAll("button, a[href], input, select, [role='button'], [data-slot='logo']")]
    .filter(el => !except.contains(el) && !el.contains(except))
    .map(el => el.getBoundingClientRect())
    .filter(r => r.width > 0 && r.height > 0);
}

const overlap = (a, b) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

// Beside the control: of the sides that fit on screen without covering another label, the one
// covering the fewest other controls. The arrow points at the spot.
function placeLabel(el, r, spot, sides, taken, avoid) {
  const gap = 14;
  const m = 8;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const clampX = x => Math.min(Math.max(x, m), innerWidth - w - m);
  const clampY = y => Math.min(Math.max(y, m), innerHeight - h - m);
  let best = null;
  for (const side of sides) {
    let x = clampX(spot.x - w / 2);
    let y = clampY(spot.y - h / 2);
    if (side === 'below') y = r.bottom + gap;
    else if (side === 'above') y = r.top - gap - h;
    else if (side === 'right') x = r.right + gap;
    else if (side === 'left') x = r.left - gap - w;
    else {
      // inside the control, under its ring
      if (r.height < h + 64 || r.width < w + 8) continue;
      x = Math.min(Math.max(spot.x - w / 2, r.left + 4), r.right - w - 4);
      y = r.bottom - h - 8;
    }
    const box = { left: x, top: y, right: x + w, bottom: y + h };
    if (x < m || y < m || box.right > innerWidth - m || box.bottom > innerHeight - m) continue;
    if (taken.some(t => overlap(t, box) > 0)) continue;
    const cost = avoid.reduce((sum, c) => sum + overlap(c, box), 0);
    if (!best || cost < best.cost) best = { side, box, cost };
    if (cost === 0) break;
  }
  if (!best) return false;
  const { side, box } = best;
  el.style.left = `${box.left}px`;
  el.style.top = `${box.top}px`;
  el.dataset.side = side === 'inside' ? 'below' : side; // inside: the arrow points up at the ring
  el.style.setProperty('--ax', `${Math.min(Math.max(spot.x - box.left, 16), w - 16)}px`);
  el.style.setProperty('--ay', `${Math.min(Math.max(spot.y - box.top, 14), h - 14)}px`);
  taken.push(box);
  return true;
}

function layoutHints() {
  const ready = document.querySelector("[data-slot='manual']") && !document.querySelector('[aria-label="Dismiss splash screen"]');
  const taken = [];
  for (const hint of HINTS) {
    const anchor = ready && !dismissed.has(hint.id) && document.querySelector(hint.anchor);
    const spot = anchor && (hint.spot ? hint.spot(anchor) : center(anchor.getBoundingClientRect()));
    const r = anchor && onTop(anchor, spot);
    const els = shown.get(hint);
    if (!r) {
      if (els) els.label.hidden = els.ring.hidden = true;
      continue;
    }
    const { label, ring } = elementsFor(hint);
    label.hidden = ring.hidden = false;
    ring.style.left = `${spot.x}px`;
    ring.style.top = `${spot.y}px`;
    const near = hint.nearSpot ? { left: spot.x - 24, right: spot.x + 24, top: spot.y - 24, bottom: spot.y + 24 } : r;
    if (!placeLabel(label, near, spot, hint.sides, taken, controls(anchor))) label.hidden = true;
  }
}

// A hint goes once its control is pressed.
addEventListener(
  'pointerdown',
  e => {
    for (const hint of HINTS) if (e.target.closest?.(hint.anchor)) dismissed.add(hint.id);
  },
  true,
);

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
