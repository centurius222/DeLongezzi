import { computed, signal } from '@preact/signals';
import { activeHoliday } from './holidays.js';
import { customThemes, isCustomId } from './customThemes.js';
import { fetchVideoList } from './brewVideos.js';

// Custom brew-button art (Settings > Pictures > Brew Button Videos, user 2026-09-24 / 2026-10-02):
// a still for idle and a video (MP4, or animated WebP/GIF) that loops while brewing, from the
// video library (utils/brewVideos.js). Which one: the active custom theme's own pick, else the
// Settings choice (one video, or another each shot when shuffling). Each is loaded once and kept
// for the page's lifetime: the small still first, the video ANIM_DELAY_MS later, so it is not
// part of the page-load burst. With none picked the button keeps exactly today's look. Settings
// calls resetBrewArt() after a save or an upload so the button picks up the change.
const ANIM_DELAY_MS = 3000;

const state = signal(null); // { numColor, numOpacity, numSize, video, mode, videos: [{id, tag}] }
const shuffleId = signal('');
let shuffleNext = '';
let statePromise = null;
const arts = new Map(); // id -> { still, anim, video, videoUrl }
const stills = new Map(); // id -> promise
const anims = new Map(); // id -> promise
// A video still downloading for a theme that was left stops (user 2026-10-18): the machine sends
// one file at a time per device, and the next theme's picture waited behind the last theme's
// video (933 log: up to 3.5 s on the tablet). Picked again, it loads again.
const animAborts = new Map(); // id -> AbortController while its video downloads
const animHolds = new Map(); // id -> brew buttons showing it now

function pickOther(ids, not) {
  const pool = ids.filter(id => id !== not);
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : ids[0] || '';
}

export function loadBrewState() {
  if (!statePromise) {
    statePromise = Promise.all([
      fetch('/api/settings', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : {}))
        .catch(() => ({})),
      fetchVideoList().then(lib => lib || { videos: [] }),
    ]).then(([s, lib]) => {
      const videos = (lib.videos || []).map(v => ({ id: v.id, tag: v.tag || '', once: !!v.once }));
      state.value = {
        // The seconds' colour, opacity and size over the art (Settings > Brew Button Numbers).
        numColor: s.brewNumColor || '#ffffff',
        numOpacity: (s.brewNumOpacity ?? 60) / 100,
        numSize: (s.brewNumSize ?? 100) / 100,
        video: s.brewVideo || '',
        mode: s.brewVideoMode === 'shuffle' ? 'shuffle' : 'fixed',
        videos,
      };
      const ids = videos.map(v => v.id);
      shuffleId.value = pickOther(ids, '');
      shuffleNext = pickOther(ids, shuffleId.value);
      // shuffling: the next shot's video comes a little after the page has settled
      if (state.value.mode === 'shuffle') setTimeout(() => loadBrewAnim(shuffleNext), 10000);
      return state.value;
    });
  }
  return statePromise;
}

// The video the brew button shows now: '' = none (the plain button).
export const brewVideoId = computed(() => {
  const st = state.value;
  if (!st) return '';
  const ids = st.videos.map(v => v.id);
  const hol = activeHoliday.value;
  const theme = isCustomId(hol) ? customThemes.value.find(t => t.id === hol) : null;
  const choice = theme?.brewVideo;
  if (choice === 'none') return '';
  if (choice && ids.includes(choice)) return choice; // a deleted video: the theme falls back to the default
  if (st.mode === 'shuffle') return shuffleId.value;
  return ids.includes(st.video) ? st.video : '';
});

// The brew button's video plays once and holds its last frame, instead of looping.
export const brewVideoOnce = computed(() => {
  const id = brewVideoId.value;
  return !!state.value?.videos.find(v => v.id === id)?.once;
});

// The seconds' colour, opacity and size (Settings > Brew Button Numbers), over a video or
// picture and over the Original cup alike (user 2026-10-08).
export const brewNumStyle = computed(() => {
  const st = state.value;
  return st
    ? { color: st.numColor, opacity: st.numOpacity, transform: `scale(${st.numSize})` }
    : {};
});

const tagOf = id => state.value?.videos.find(v => v.id === id)?.tag || '';

export function getBrewArt(id) {
  const a = id && arts.get(id);
  if (!a || !a.still || !state.value) return null;
  const { numColor, numOpacity, numSize } = state.value;
  return { ...a, numColor, numOpacity, numSize };
}

// The machine turns pictures and videos away with 503 while it is busy (2026-10-16): ask again
// every 1 s, up to 10 times, instead of giving up until the next page load.
async function fetchBusy(url, signal) {
  let r = await fetch(url, { signal });
  for (let i = 0; r.status === 503 && i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    r = await fetch(url, { signal });
  }
  return r;
}

// A brew button shows this video now / no longer: with no button left showing it, its download
// stops (the shuffle's next video is left to load).
export function holdBrewAnim(id) {
  if (id) animHolds.set(id, (animHolds.get(id) || 0) + 1);
}

export function releaseBrewAnim(id) {
  if (!id) return;
  const n = (animHolds.get(id) || 0) - 1;
  if (n > 0) {
    animHolds.set(id, n);
    return;
  }
  animHolds.delete(id);
  if (id !== shuffleNext) animAborts.get(id)?.abort();
}

export function loadBrewStill(id) {
  if (!id) return Promise.resolve(null);
  if (!stills.has(id)) {
    stills.set(
      id,
      (async () => {
        try {
          const r = await fetchBusy(`/vid/${id}/still?v=${encodeURIComponent(tagOf(id))}`);
          if (r.ok) arts.set(id, { ...arts.get(id), still: URL.createObjectURL(await r.blob()) });
        } catch {
          // no still: the plain button
        }
      })(),
    );
  }
  return stills.get(id).then(() => getBrewArt(id));
}

export function loadBrewAnim(id, delay = ANIM_DELAY_MS) {
  if (!id) return Promise.resolve(null);
  // stopped (its theme was left) and wanted again: a fresh download
  if (animAborts.get(id)?.signal.aborted) anims.delete(id);
  if (!anims.has(id)) {
    const ctl = new AbortController();
    animAborts.set(id, ctl);
    const load = (async () => {
      try {
        if (!(await loadBrewStill(id))) return;
        await new Promise(resolve => setTimeout(resolve, delay));
        if (ctl.signal.aborted) return;
        const r = await fetchBusy(
          `/vid/${id}/video?v=${encodeURIComponent(tagOf(id))}`,
          ctl.signal,
        );
        if (r.ok) {
          const video = (r.headers.get('content-type') || '').startsWith('video/');
          const blob = await r.blob();
          // MP4/WebM plays in a <video>, which can freeze on the current frame.
          arts.set(id, {
            ...arts.get(id),
            anim: blob,
            video,
            videoUrl: video ? URL.createObjectURL(blob) : null,
          });
        }
      } catch {
        // keep the still
      } finally {
        if (animAborts.get(id) === ctl) animAborts.delete(id);
        // stopped before it arrived: forgotten, so picking the theme again loads it again
        if (ctl.signal.aborted && anims.get(id) === load && !arts.get(id)?.anim) anims.delete(id);
      }
    })();
    anims.set(id, load);
  }
  return anims.get(id).then(() => getBrewArt(id));
}

// A shot starts: when shuffling (and the theme doesn't pick a video), the next video takes over
// if it has arrived (never one that would still be loading), and the one after it starts loading.
export function onShotStart() {
  const st = state.value;
  if (!st || st.mode !== 'shuffle' || brewVideoId.value !== shuffleId.value) return;
  if (shuffleNext && arts.get(shuffleNext)?.anim) shuffleId.value = shuffleNext;
  shuffleNext = pickOther(
    st.videos.map(v => v.id),
    shuffleId.value,
  );
  loadBrewAnim(shuffleNext, 0);
}

// Read the machine's choice and library again (another device may have changed them); art
// already loaded is kept unless its video was replaced (a new tag).
export function refreshBrewState() {
  const before = state.value;
  const shuffling = shuffleId.value;
  statePromise = null;
  return loadBrewState().then(st => {
    for (const v of st.videos) {
      const old = before?.videos.find(o => o.id === v.id);
      if (old && old.tag !== v.tag) {
        const a = arts.get(v.id);
        if (a?.still) URL.revokeObjectURL(a.still);
        if (a?.videoUrl) URL.revokeObjectURL(a.videoUrl);
        arts.delete(v.id);
        stills.delete(v.id);
        anims.delete(v.id);
      }
    }
    // keep shuffling where it was
    if (st.videos.some(v => v.id === shuffling)) shuffleId.value = shuffling;
  });
}

export function resetBrewArt() {
  for (const a of arts.values()) {
    if (a.still) URL.revokeObjectURL(a.still);
    if (a.videoUrl) URL.revokeObjectURL(a.videoUrl);
  }
  arts.clear();
  stills.clear();
  anims.clear();
  statePromise = null;
  loadBrewState();
}
