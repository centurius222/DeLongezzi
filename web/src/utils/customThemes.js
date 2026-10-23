import { signal } from '@preact/signals';
import { fetchVideoList } from './brewVideos.js';

// Custom themes (docs/MULTI_SHAPE_PLAN.txt): made in Settings > Web Settings > Custom
// Themes from one picture on the 16:10 template, kept on the machine (/api/custom-themes),
// shown like a holiday (picked by hand or on their own dates) on the Western layout
// (customTheme.css, utils/customThemeFit.js).

// [{ id, name, neon, glow, clock, when, fit, bars, nudge, tag }]
export const customThemes = signal([]);
export const customStorage = signal({ free: 0, total: 0 });

// "u" + lowercase letters, up to 16: the machine keeps it as holidayMode like a holiday id.
export const isCustomId = id => typeof id === 'string' && /^u[a-z]{1,15}$/.test(id);

// An id from a name, not taken yet: "Pizza Friday!" -> "upizzafriday", then "upizzafridayb" ...
export function idFromName(name, taken = []) {
  const base = ('u' + name.toLowerCase().replace(/[^a-z]+/g, '')).slice(0, 15) || 'utheme';
  const id = base.length > 1 ? base : 'utheme';
  if (!taken.includes(id)) return id;
  for (const c of 'bcdefghijklmnopqrstuvwxyz') {
    const next = id.slice(0, 15) + c;
    if (!taken.includes(next)) return next;
  }
  return id;
}

// The theme being edited in Settings registers its save here, so the page's own
// Save Settings / Save & Restart saves it too (one Save for everything).
export const pendingThemeSave = { current: null };

export async function loadCustomThemes() {
  try {
    let r = await fetch('/api/custom-themes', { cache: 'no-store' });
    // 503: the machine is still reading the themes (just after a restart or a change)
    for (let i = 0; r.status === 503 && i < 15; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      r = await fetch('/api/custom-themes', { cache: 'no-store' });
    }
    if (!r.ok) return;
    const j = await r.json();
    customThemes.value = Array.isArray(j.themes) ? j.themes : [];
    customStorage.value = { free: j.free || 0, total: j.total || 0 };
  } catch {
    // The machine is away: no custom themes this time.
  }
}

// The picture as WebP (JPEG where a browser can't make WebP, e.g. Safari), at most
// 1587 px wide (the 16:10 template's size): the machine does no picture work.
// quality 0.35: painted pictures lose nothing visible at screen size, and it is ~60% smaller than 0.88
// (Beach 605 -> 242 KB, Matrix 328 -> 124 KB; same in Chrome and Firefox).
export async function shrinkPicture(file, maxWidth = 1587, quality = 0.35) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / img.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const make = type => new Promise(ok => canvas.toBlob(ok, type, quality));
  const webp = await make('image/webp');
  const made = webp && webp.type === 'image/webp' ? webp : await make('image/jpeg');
  // A WebP already at size and smaller than the browser's own (a desktop encoder packs tighter,
  // e.g. Christmas 140 KB vs 156 KB) goes up as it is.
  const asIs = file.type === 'image/webp' && scale === 1 && file.size < made.size;
  return asIs ? file : made;
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', body });
  if (!r.ok) throw new Error(`${url.split('?')[0]}: ${r.status}`);
}

// The picture upload, reporting how much has gone up (0-100), which fetch can't.
function postWithProgress(url, body, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = e => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`${url.split('?')[0]}: ${xhr.status}`));
    xhr.onerror = () => reject(new Error(`${url.split('?')[0]}: upload failed`));
    xhr.send(body);
  });
}

// Saves a theme: the picture (when a new one is given; onProgress hears 0-100 while it goes up),
// then its settings.
// The theme picker's small copy of a picture (240 x 150, about 10 KB).
export async function makeThumb(picture) {
  const img = await createImageBitmap(picture);
  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 150;
  canvas.getContext('2d').drawImage(img, 0, 0, 240, 150);
  const make = type => new Promise(ok => canvas.toBlob(ok, type, 0.7));
  const webp = await make('image/webp');
  return webp && webp.type === 'image/webp' ? webp : make('image/jpeg');
}

export async function uploadThumb(id, picture) {
  const form = new FormData();
  form.append('file', await makeThumb(picture), 'thumb.webp');
  await post(`/api/custom-theme-file?id=${id}&name=thumb`, form);
}

export async function saveCustomTheme(id, meta, picture, onProgress = () => {}) {
  if (picture) {
    const form = new FormData();
    form.append('file', picture, 'page.webp');
    await postWithProgress(`/api/custom-theme-file?id=${id}`, form, onProgress);
  }
  const form = new URLSearchParams();
  form.append('meta', JSON.stringify(meta));
  await post(`/api/custom-theme-meta?id=${id}`, form);
  // Done for the user now: this page shows the saved theme at once, while the machine re-reads its
  // themes (a few seconds) and the picker's small picture goes up in the background.
  const old = customThemes.value.find(t => t.id === id);
  customThemes.value = [
    ...customThemes.value.filter(t => t.id !== id),
    { ...old, ...meta, id, tag: picture ? `"saved-${Date.now()}"` : old?.tag },
  ];
  const after = picture ? uploadThumb(id, picture).catch(() => {}) : Promise.resolve();
  after.then(() => loadCustomThemes());
}

// Backup of every custom theme in one file (Settings > Custom Themes): each theme's settings
// and its picture (base64). The settings file and the new-board file don't hold them; the
// full 16 MB backup does, as part of the storage.
const toBase64 = async r => {
  const bytes = new Uint8Array(await r.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromBase64 = (b64, type) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
};

export async function exportCustomThemes() {
  await loadCustomThemes();
  const themes = [];
  for (const { id, tag, ...meta } of customThemes.value) {
    const r = await fetch(`/custom/${id}/page.webp`);
    if (!r.ok) continue;
    themes.push({ id, meta, picture: await toBase64(r) });
  }
  // the brew button video library too (Settings > Pictures), so a restore brings the themes' videos back
  const videos = [];
  const lib = (await fetchVideoList()) || { videos: [] };
  for (const v of lib.videos || []) {
    const [video, still] = await Promise.all([fetch(`/vid/${v.id}/video`), fetch(`/vid/${v.id}/still`)]);
    if (!video.ok || !still.ok) continue;
    videos.push({
      id: v.id,
      name: v.name,
      type: video.headers.get('content-type'),
      once: !!v.once,
      video: await toBase64(video),
      still: await toBase64(still),
    });
  }
  const blob = new Blob([JSON.stringify({ format: 'delongezzi-custom-themes', version: 2, themes, videos })], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `delongezzi-custom-themes-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return themes.length;
}

// Restores a backup file: every theme in it is saved again (an existing one with the same id
// is replaced). Returns how many were restored.
export async function importCustomThemes(file) {
  const data = JSON.parse(await file.text());
  if (data?.format !== 'delongezzi-custom-themes' || !Array.isArray(data.themes)) {
    throw new Error('not a DeLongezzi custom themes backup');
  }
  let done = 0;
  for (const t of data.themes) {
    if (!isCustomId(t.id) || typeof t.picture !== 'string' || !t.meta) continue;
    await saveCustomTheme(t.id, t.meta, fromBase64(t.picture, 'image/webp'));
    done++;
  }
  // videos (backups since version 2): the same ids, so the themes' picks still match
  for (const v of Array.isArray(data.videos) ? data.videos : []) {
    if (!/^v[a-z]{1,15}$/.test(v.id) || typeof v.video !== 'string' || typeof v.still !== 'string') continue;
    const send = async (part, blob) => {
      const form = new FormData();
      form.append('file', blob, part);
      const r = await fetch(`/api/video-file?id=${v.id}&part=${part}`, { method: 'POST', body: form });
      if (!r.ok)
        throw new Error(r.status === 413 ? "not enough video space for the backup's videos" : `video: ${r.status}`);
    };
    await send('video', fromBase64(v.video, v.type || 'video/mp4'));
    await send('still', fromBase64(v.still, 'image/webp'));
    await fetch(`/api/video-name?id=${v.id}`, {
      method: 'POST',
      body: new URLSearchParams({ name: v.name || 'Video' }),
    });
    if (v.once)
      await fetch(`/api/video-loop?id=${v.id}`, { method: 'POST', body: new URLSearchParams({ loop: '0' }) });
  }
  return done;
}

export async function deleteCustomTheme(id) {
  await post(`/api/custom-theme-delete?id=${id}`, new URLSearchParams());
  await loadCustomThemes();
}
