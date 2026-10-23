import { useEffect, useRef, useState } from 'preact/hooks';
import {
  customStorage,
  customThemes,
  deleteCustomTheme,
  exportCustomThemes,
  idFromName,
  importCustomThemes,
  pendingThemeSave,
  saveCustomTheme,
  shrinkPicture,
} from '../../../utils/customThemes.js';
import { barColours, NUDGE_KEYS, PICTURE_H, PICTURE_W } from '../../../utils/customThemeFit.js';
import { FONT_LIST } from '../../../components/Holiday.jsx';
import { addVideo, loadVideos, videoLibrary, videoUrl } from '../../../utils/brewVideos.js';
import { resetBrewArt } from '../../../utils/brewArt.js';
import {
  holidayModeSignal,
  holidayToday,
  holidayUntilText,
  themePickLocked,
} from '../../../utils/holidays.js';

// Settings > Web Settings > Custom Themes (docs/MULTI_SHAPE_PLAN.txt): a picture made on the
// 16:10 template (the Western pack's layout, 1587 x 991) becomes a theme, no build or flash.
// The preview draws where the live numbers and buttons will land; drags, arrow keys and the
// sliders move a group when the picture's windows sit a little off the template's.

const PRESETS = [
  '#ff9a1a',
  '#ff2a1a',
  '#ff3bd4',
  '#1e9bff',
  '#39ff6a',
  '#ffc233',
  '#e0a81c',
  '#ffffff',
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const NTH = ['1st', '2nd', '3rd', '4th'];

// The template's windows (the master layout, customTheme.css), for the preview, in picture px
// (1587 x 991). The custom themes start the mode buttons 3 px and the menu 33 px lower than
// Western (tools/holiday-packs/gen16.py DEFAULT).
const BOXES = {
  tabs: [[360, 180, 1576, 244]],
  flow: [[392, 302, 672, 432]],
  weight: [[1060, 302, 1400, 432]],
  tare: [[745, 587, 990, 657]],
  temp: [[397, 552, 697, 635]],
  pressure: [[1057, 552, 1300, 632]],
  tank: [[1490, 262, 1545, 657]],
  controls: [
    [560, 710, 715, 770],
    [560, 780, 715, 840],
  ],
  chart: [[955, 695, 1555, 893]],
  menu: [[25, 233, 305, 713]],
  clock: [[1000, 930, 1375, 978]],
};
const BREW = [873.5, 412.5, 142]; // the rope ring's centre and the brew button's radius

// A theme's glow 0-100 % (themes saved before the slider have full glow).
const glowOf = t => (Number.isFinite(t.glow) ? t.glow : 100);

export function whenText(when) {
  switch (when?.type) {
    case 'date':
      return `${MONTHS[when.on[0] - 1]} ${when.on[1]}`;
    case 'range':
      return `${MONTHS[when.from[0] - 1]} ${when.from[1]} to ${MONTHS[when.to[0] - 1]} ${when.to[1]}`;
    case 'weekday':
      return `every ${DAYS[when.weekday]}`;
    case 'nth':
      return `${NTH[when.n - 1]} ${DAYS[when.weekday]} of ${MONTHS[when.month - 1]}`;
    default:
      return 'picked by hand';
  }
}

// Each group the preview draws, where it is now (picture px), and which nudges a drag changes:
// [across, up/down] (null: that way is not free).
const DRAG = NUDGE_KEYS;
const GROUP_NAMES = {
  tabs: 'Mode buttons',
  top: 'Top row',
  flow: 'Flow',
  weight: 'Weight',
  temp: 'Temp',
  pressure: 'Pressure',
  brew: 'Brew button',
  tare: 'Tare',
  mid: 'Temp and pressure',
  tank: 'Water tank',
  controls: 'Controls',
  chart: 'Chart',
  menu: 'Menu',
  clock: 'Clock',
};

// Brew and Tare sit in the top row's card: they move with it, plus their own nudge. The menu
// moves on its own, not with "Everything, across" (it sits in the side column).
function shapes(nudge, clockOn) {
  const n = key => nudge[key] || 0;
  const at = group => {
    const [kx, ky] = NUDGE_KEYS[group];
    let x = (group === 'menu' ? 0 : n('x')) + (kx ? n(kx) : 0);
    let y = ky ? n(ky) : 0;
    if (['brew', 'tare', 'flow', 'weight'].includes(group)) {
      x += n('topX');
      y += n('top');
    }
    if (group === 'temp' || group === 'pressure') {
      x += n('midX');
      y += n('mid');
    }
    return [x, y];
  };
  const out = [];
  for (const [group, boxes] of Object.entries(BOXES)) {
    if (group === 'clock' && !clockOn) continue;
    const [dx, dy] = at(group);
    out.push({
      group,
      rects: boxes.map(([x1, y1, x2, y2]) => [x1 + dx, y1 + dy, x2 + dx, y2 + dy]),
    });
  }
  const [bx, by] = at('brew');
  out.push({ group: 'brew', circle: [BREW[0] + bx, BREW[1] + by, BREW[2]] });
  return out;
}

// A shape's box (picture px): its rectangles together, or the circle's square.
function bounds(s) {
  if (s.circle) {
    const [cx, cy, r] = s.circle;
    return [cx - r, cy - r, cx + r, cy + r];
  }
  return s.rects.reduce(
    (b, [x1, y1, x2, y2]) => [
      Math.min(b[0], x1),
      Math.min(b[1], y1),
      Math.max(b[2], x2),
      Math.max(b[3], y2),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

// How far one nudge (key, across or down) can change from `nudge`, as [least, most]: every
// shape it moves (a row moves the boxes in it too) stays inside the picture. A box already
// outside may still come back in. Any spot in the picture (user 2026-10-07; it was +-80 px).
function nudgeRoom(nudge, clockOn, key, across) {
  const before = shapes(nudge, clockOn);
  const after = shapes({ ...nudge, [key]: (nudge[key] || 0) + 1 }, clockOn);
  let least = -Infinity;
  let most = Infinity;
  before.forEach((s, i) => {
    const b = bounds(s);
    const a = bounds(after[i]);
    if (b[0] === a[0] && b[1] === a[1]) return; // this key doesn't move it
    if (across) {
      least = Math.max(least, -b[0]);
      most = Math.min(most, PICTURE_W - b[2]);
    } else {
      least = Math.max(least, -b[1]);
      most = Math.min(most, PICTURE_H - b[3]);
    }
  });
  return [Math.min(0, Math.ceil(least)), Math.max(0, Math.floor(most))];
}

// The group under a point (picture px), with a few px of slack; the brew circle first.
function hitGroup(list, x, y) {
  const slack = 8;
  const brew = list.find(s => s.circle);
  if (brew && Math.hypot(x - brew.circle[0], y - brew.circle[1]) <= brew.circle[2] + slack)
    return 'brew';
  let best = null;
  for (const s of list) {
    for (const [x1, y1, x2, y2] of s.rects || []) {
      if (x >= x1 - slack && x <= x2 + slack && y >= y1 - slack && y <= y2 + slack) {
        const area = (x2 - x1) * (y2 - y1);
        if (!best || area < best.area) best = { group: s.group, area };
      }
    }
  }
  return best?.group ?? null;
}

// Where a group's "drag" tag sits: the top-left corner of its highest box (or of the brew circle).
function tagSpot(s) {
  if (s.circle) return [s.circle[0] - s.circle[2] * 0.7, s.circle[1] - s.circle[2] * 0.7];
  const top = [...s.rects].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
  return [top[0], top[1]];
}

// A four-way arrow (drawn, not a font character: some fonts lack ✥), centred on x, y.
function drawMoveIcon(g, x, y, r) {
  g.beginPath();
  g.moveTo(x - r, y);
  g.lineTo(x + r, y);
  g.moveTo(x, y - r);
  g.lineTo(x, y + r);
  g.stroke();
  const a = r * 0.45;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const tx = x + dx * r;
    const ty = y + dy * r;
    g.beginPath();
    g.moveTo(tx, ty);
    g.lineTo(tx - dx * a + dy * a, ty - dy * a + dx * a);
    g.lineTo(tx - dx * a - dy * a, ty - dy * a - dx * a);
    g.closePath();
    g.fill();
  }
}

// A small see-through "drag" tag with a move arrow on every group, on the top edge of its box so
// it doesn't cover the numbers: the preview shows what can be moved (the user 2026-10-06: you
// couldn't tell the boxes move). Out of the way while working: none while dragging, and not on
// the group under the mouse, so what it covers shows.
function drawDragTags(g, list, k, dragging, hover) {
  if (dragging) return;
  g.save();
  g.shadowBlur = 0;
  // solid yellow with black, like a road sign: it reads on any picture (thin see-through
  // white on dark was invisible on busy art, the user 2026-10-06)
  g.font = '700 20px system-ui, sans-serif';
  g.textBaseline = 'middle';
  for (const s of list) {
    if (s.group === hover) continue;
    const [x, y] = tagSpot(s);
    const w = g.measureText('drag').width + 42;
    const h = 30;
    const px = x * k + 4;
    const py = y * k - h / 2;
    g.beginPath();
    if (g.roundRect) g.roundRect(px, py, w, h, h / 2);
    else g.rect(px, py, w, h); // older browsers
    g.fillStyle = '#ffd400';
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    g.stroke();
    g.fillStyle = g.strokeStyle = '#111111';
    g.lineWidth = 2.2;
    drawMoveIcon(g, px + 16, py + h / 2, 8);
    g.fillText('drag', px + 30, py + h / 2 + 1);
  }
  g.restore();
}

// live: the real page shows under the canvas (the frame), so only the picked group and the one
// under the mouse are outlined.
function drawPreview(canvas, img, nudge, neon, clockOn, selected, live, hover, dragging) {
  if (!canvas || (!img && !live)) return;
  const w = canvas.clientWidth || 600;
  canvas.width = w;
  canvas.height = Math.round((w * PICTURE_H) / PICTURE_W);
  const g = canvas.getContext('2d');
  const k = w / PICTURE_W;
  if (!live) g.drawImage(img, 0, 0, canvas.width, canvas.height);
  g.shadowBlur = 6;
  const list = shapes(nudge, clockOn);
  for (const s of list) {
    const on = s.group === selected;
    if (live && !on && s.group !== hover) continue;
    g.lineWidth = on ? 3.5 : 2;
    g.strokeStyle = on ? '#ffffff' : neon;
    g.shadowColor = on ? '#ffffff' : neon;
    for (const [x1, y1, x2, y2] of s.rects || [])
      g.strokeRect(x1 * k, y1 * k, (x2 - x1) * k, (y2 - y1) * k);
    if (s.circle) {
      g.beginPath();
      g.arc(s.circle[0] * k, s.circle[1] * k, s.circle[2] * k, 0, Math.PI * 2);
      g.stroke();
    }
  }
  drawDragTags(g, list, k, dragging, hover);
}

// A day of the month (1-31). What you type is kept here, so the box can be empty while you type
// (backspace used to turn it into 1 at once, and the editor's re-renders put the old day back
// into an emptied box); only a real day is saved. Left empty, it goes back to the day it had
// when you clicked into it.
function DayInput({ value, pick }) {
  const [draft, setDraft] = useState(String(value));
  const before = useRef(value);
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      type='number'
      min='1'
      max='31'
      className='input input-bordered input-sm w-20'
      value={draft}
      onFocus={() => {
        before.current = value;
      }}
      onInput={e => {
        const text = e.currentTarget.value;
        setDraft(text);
        const n = Math.round(+text);
        if (text !== '' && n >= 1) pick(Math.min(31, n));
      }}
      onBlur={() => {
        const n = Math.round(+draft);
        if (draft !== '' && n >= 1) return setDraft(String(value));
        setDraft(String(before.current));
        if (before.current !== value) pick(before.current);
      }}
    />
  );
}

function WhenPicker({ when, onChange }) {
  const set = patch => onChange({ ...when, ...patch });
  const monthSel = (value, pick) => (
    <select
      className='select select-bordered select-sm'
      value={value}
      onChange={e => pick(+e.currentTarget.value)}
    >
      {MONTHS.map((m, i) => (
        <option key={m} value={i + 1}>
          {m}
        </option>
      ))}
    </select>
  );
  const dayIn = (value, pick) => <DayInput value={value} pick={pick} />;
  const weekdaySel = (value, pick) => (
    <select
      className='select select-bordered select-sm'
      value={value}
      onChange={e => pick(+e.currentTarget.value)}
    >
      {DAYS.map((d, i) => (
        <option key={d} value={i}>
          {d}
        </option>
      ))}
    </select>
  );
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <select
        className='select select-bordered select-sm'
        value={when.type}
        onChange={e => {
          const type = e.currentTarget.value;
          const now = new Date();
          const md = [now.getMonth() + 1, now.getDate()];
          onChange(
            {
              never: { type },
              date: { type, on: md },
              range: { type, from: md, to: md },
              weekday: { type, weekday: 5 },
              nth: { type, n: 2, weekday: 0, month: 5 },
            }[type],
          );
        }}
      >
        <option value='never'>Picked by hand</option>
        <option value='date'>On a date</option>
        <option value='range'>From a date to a date</option>
        <option value='weekday'>Every week on a day</option>
        <option value='nth'>A weekday of a month (e.g. 4th Thursday of November)</option>
      </select>
      {when.type === 'date' && (
        <>
          {monthSel(when.on[0], m => set({ on: [m, when.on[1]] }))}
          {dayIn(when.on[1], d => set({ on: [when.on[0], d] }))}
        </>
      )}
      {when.type === 'range' && (
        <>
          {monthSel(when.from[0], m => set({ from: [m, when.from[1]] }))}
          {dayIn(when.from[1], d => set({ from: [when.from[0], d] }))}
          <span>to</span>
          {monthSel(when.to[0], m => set({ to: [m, when.to[1]] }))}
          {dayIn(when.to[1], d => set({ to: [when.to[0], d] }))}
        </>
      )}
      {when.type === 'weekday' && weekdaySel(when.weekday, v => set({ weekday: v }))}
      {when.type === 'nth' && (
        <>
          <select
            className='select select-bordered select-sm'
            value={when.n}
            onChange={e => set({ n: +e.currentTarget.value })}
          >
            {NTH.map((t, i) => (
              <option key={t} value={i + 1}>
                {t}
              </option>
            ))}
          </select>
          {weekdaySel(when.weekday, v => set({ weekday: v }))}
          <span>of</span>
          {monthSel(when.month, m => set({ month: m }))}
        </>
      )}
    </div>
  );
}

// The theme's brew button video: the default (Settings' choice), none, or one from the shared
// library (Settings > Pictures), video or still picture; "Add video or picture…" uploads into that
// library and picks it.
function BrewVideoChoice({ value, onChange }) {
  const [progress, setProgress] = useState(null);
  const [message, setMessage] = useState('');
  const input = useRef(null);
  useEffect(() => {
    loadVideos();
  }, []);
  // what "Default" means: the Settings choice (one video, none, or shuffling)
  const [settingsPick, setSettingsPick] = useState(null);
  useEffect(() => {
    fetch('/api/settings')
      .then(r => (r.ok ? r.json() : null))
      .then(
        s =>
          s && setSettingsPick(s.brewVideoMode === 'shuffle' ? 'shuffle' : s.brewVideo || 'none'),
      )
      .catch(() => {});
  }, []);
  const [playing, setPlaying] = useState(false);
  const { videos } = videoLibrary.value;
  const shownId = value || settingsPick;
  const shown = videos.find(v => v.id === shownId);
  useEffect(() => setPlaying(false), [shownId]); // another choice: show its still first
  return (
    <div className='flex flex-col gap-1 text-sm'>
      Brew button video or picture
      <div className='flex flex-wrap items-center gap-3'>
        {/* the theme's brew button as it will look: tap to play a video */}
        <button
          type='button'
          title={shown ? `${shown.name}${playing ? '' : ' (tap to play)'}` : ''}
          className='bg-base-300 relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white/30'
          onClick={() => shown && setPlaying(p => !p)}
        >
          {shown ? (
            playing ? (
              <video
                src={videoUrl(shown, 'video')}
                autoPlay
                loop
                muted
                playsInline
                className='h-full w-full object-cover'
              />
            ) : (
              <img src={videoUrl(shown, 'still')} alt='' className='h-full w-full object-cover' />
            )
          ) : shownId === 'shuffle' ? (
            <span className='text-xs'>shuffle</span>
          ) : (
            <span className='text-2xl' aria-hidden='true'>
              ☕
            </span>
          )}
        </button>
        <select
          className='select select-bordered select-sm'
          value={value}
          onChange={e => onChange(e.currentTarget.value)}
        >
          <option value=''>Default (as in Settings)</option>
          <option value='none'>Original cup</option>
          {videos.map(v => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <input
          ref={input}
          type='file'
          accept='video/mp4,video/webm,image/*'
          className='hidden'
          onChange={async e => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (!file) return;
            setMessage('');
            setProgress(0);
            try {
              onChange(await addVideo(file, setProgress));
              resetBrewArt();
            } catch (err) {
              setMessage(err.message);
            } finally {
              setProgress(null);
            }
          }}
        />
        {/* Keeps its colour while adding (a disabled button turned dark) and says "Saving…" after
            100 % while the still picture and the name are saved (user 2026-10-17). */}
        <button
          type='button'
          className={`btn btn-primary btn-xs ${progress !== null ? 'pointer-events-none' : ''}`}
          aria-disabled={progress !== null}
          onClick={() => progress === null && input.current?.click()}
        >
          {progress !== null ? (
            <>
              <span className='loading loading-spinner loading-xs' aria-hidden='true' />{' '}
              {progress >= 100 ? 'Saving…' : `${progress}%`}
            </>
          ) : (
            'Add video or picture…'
          )}
        </button>
      </div>
      {message && <span className='text-warning text-xs'>{message}</span>}
    </div>
  );
}

// A new theme's name from its picture's file name ("pizza_night-v2.png" -> "Pizza night v2"), so a
// theme is never lost to a forgotten name; the field shows it selected, ready to type over.
function nameFromFile(fileName = '') {
  const words = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 24).trim();
}

function Editor({ start, onDone, onPick }) {
  const [t, setT] = useState(start);
  const [img, setImg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // 0-100 while a new picture goes up
  const [saveStep, setSaveStep] = useState(''); // prepare (shrinking the picture) / upload / finish
  const [error, setError] = useState('');
  const [nameMissing, setNameMissing] = useState(false); // Save pressed without a name
  const canvas = useRef(null);
  const nameInput = useRef(null);
  // Edit / New picture on a theme far down the list: bring the editor (above the list) into view.
  // A new theme: its name (from the file) selected, ready to type over.
  const box = useRef(null);
  useEffect(() => {
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!start.id) {
      nameInput.current?.focus({ preventScroll: true });
      nameInput.current?.select();
    }
    // once, when the editor opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const set = patch => setT(prev => ({ ...prev, ...patch }));

  // New picture… under the preview: only the picture (and the bars' colours from its edges)
  // changes; the name, positions and every setting stay. It goes up with Save theme.
  const pictureInput = useRef(null);
  const swapPicture = async file => {
    if (!file) return;
    setError('');
    try {
      const bitmap = await createImageBitmap(file);
      const bars = barColours(bitmap);
      if (Math.abs(bitmap.width / bitmap.height - PICTURE_W / PICTURE_H) > 0.05)
        setError(
          'This picture is not the template’s shape (16:10, e.g. 1587 x 991), so it won’t line up.',
        );
      if (t.file && t.previewUrl.startsWith('blob:')) URL.revokeObjectURL(t.previewUrl);
      set({ file, previewUrl: URL.createObjectURL(file), bars });
    } catch {
      setError('That file could not be read as a picture.');
    }
  };

  useEffect(() => {
    const image = new Image();
    image.onload = () => setImg(image);
    image.src = t.previewUrl;
  }, [t.previewUrl]);
  const [selected, setSelected] = useState(null);
  const [hover, setHover] = useState(null); // the group under the mouse: outlined, a grab cursor
  const [dragging, setDragging] = useState(null);
  const drag = useRef(null);
  // Live preview (default): the real page with sample numbers, in a frame under the canvas
  // (utils/themePreview.js); off: the picture with the groups' boxes.
  const [live, setLive] = useState(true);
  const frame = useRef(null);
  const stage = useRef(null);
  const [scale, setScale] = useState(0);
  // Counts the frame's "ready" messages: each new frame (the preview turned off and on again)
  // gets the theme again once it has loaded.
  const [frameReady, setFrameReady] = useState(0);
  useEffect(() => {
    const fit = () => setScale((stage.current?.clientWidth || 0) / PICTURE_W);
    fit();
    const ro = new ResizeObserver(fit);
    if (stage.current) ro.observe(stage.current);
    const ready = e =>
      e.source === frame.current?.contentWindow &&
      e.data?.type === 'gm-theme-preview-ready' &&
      setFrameReady(n => n + 1);
    addEventListener('message', ready);
    return () => {
      ro.disconnect();
      removeEventListener('message', ready);
    };
  }, [live]);
  useEffect(() => {
    if (!live || !frameReady) return;
    const { id, file, previewUrl, ...rest } = t;
    const pictureUrl = new URL(previewUrl, location.href).href;
    frame.current?.contentWindow?.postMessage(
      { type: 'gm-theme-preview', theme: { ...rest, pictureUrl } },
      location.origin,
    );
  }, [live, frameReady, t]);
  useEffect(
    () =>
      drawPreview(canvas.current, img, t.nudge, t.neon, t.clock, selected, live, hover, dragging),
    [img, t.nudge, t.neon, t.clock, selected, live, scale, hover, dragging],
  );

  // The preview is also an editor: drag a group, or pick it and use the arrow keys (Shift: 5 px).
  // Both set the theme's nudges.
  const toPicture = e => {
    const r = canvas.current.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * PICTURE_W,
      ((e.clientY - r.top) / r.height) * PICTURE_H,
    ];
  };
  const moveGroup = (group, from, ddx, ddy) => {
    const [ax, ay] = DRAG[group];
    const next = { ...from };
    const step = (key, d, across) => {
      const [least, most] = nudgeRoom(from, t.clock, key, across);
      next[key] = (from[key] || 0) + Math.max(least, Math.min(most, Math.round(d)));
    };
    if (ax) step(ax, ddx, true);
    if (ay) step(ay, ddy, false);
    set({ nudge: next });
  };
  const onPointerDown = e => {
    const [x, y] = toPicture(e);
    const group = hitGroup(shapes(t.nudge, t.clock), x, y);
    setSelected(group);
    canvas.current.focus();
    if (!group) return;
    drag.current = { group, x, y, from: t.nudge };
    setDragging(group);
    canvas.current.style.cursor = 'grabbing';
    canvas.current.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = e => {
    const d = drag.current;
    const [x, y] = toPicture(e);
    if (!d) {
      const over = hitGroup(shapes(t.nudge, t.clock), x, y);
      if (over !== hover) setHover(over);
      canvas.current.style.cursor = over ? 'grab' : 'default';
      return;
    }
    moveGroup(d.group, d.from, x - d.x, y - d.y);
  };
  const onPointerUp = () => {
    drag.current = null;
    setDragging(null);
    if (canvas.current) canvas.current.style.cursor = hover ? 'grab' : 'default';
  };
  const onKeyDown = e => {
    const step = e.shiftKey ? 5 : 1;
    const dir = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[e.key];
    if (!selected || !dir) return;
    e.preventDefault();
    moveGroup(selected, t.nudge, dir[0], dir[1]);
  };

  // One save at a time, and a new theme keeps the id of its first save: Save theme and then
  // Save Settings (or two taps) used to make the same theme twice ("New Year" and a "New Year" b).
  const saving = useRef(null);
  const savedId = useRef(start.id || null);
  // No name: nothing is saved; the name field turns red and gets the cursor. false for Save Settings.
  const save = async () => {
    if (!t.name.trim()) {
      setNameMissing(true);
      nameInput.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      nameInput.current?.focus({ preventScroll: true });
      return false;
    }
    if (saving.current) return saving.current;
    const run = doSave();
    saving.current = run;
    try {
      return await run;
    } finally {
      saving.current = null;
    }
  };
  const doSave = async () => {
    setBusy(true);
    setError('');
    try {
      const taken = customThemes.value.map(c => c.id);
      const id = savedId.current || t.id || idFromName(t.name, taken);
      savedId.current = id;
      setSaveStep(t.file ? 'prepare' : 'finish');
      const picture = t.file ? await shrinkPicture(t.file) : null;
      await saveCustomTheme(
        id,
        {
          name: t.name.trim().slice(0, 24),
          neon: t.neon,
          glow: glowOf(t),
          clock: !!t.clock,
          permanent: !!t.permanent,
          shade: t.shade || 0,
          numSize: t.numSize || 100,
          font: t.font || '',
          brewVideo: t.brewVideo || '',
          when: t.when,
          fit: { template: '16:10' }, // the layout it was made for (older themes: the wide Western)
          bars: t.bars,
          nudge: t.nudge,
        },
        picture,
        picture
          ? pct => {
              setProgress(pct);
              setSaveStep(pct < 100 ? 'upload' : 'finish');
            }
          : undefined,
      );
      onDone(id);
    } catch (e) {
      setError(`Could not save: ${e.message}. Is there room on the machine?`);
    } finally {
      setBusy(false);
      setProgress(null);
      setSaveStep('');
    }
  };

  // Save Settings / Save & Restart save this theme too; without a name they stop and say so
  // (they used to skip it and report Saved, and the new picture was lost).
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    pendingThemeSave.current = () => saveRef.current();
    return () => {
      pendingThemeSave.current = null;
    };
  }, []);

  return (
    <div
      ref={box}
      className='border-base-content/20 mt-3 flex scroll-mt-4 flex-col gap-3 rounded-lg border p-3'
    >
      <div
        ref={stage}
        className='relative w-full overflow-hidden rounded'
        style={{ aspectRatio: `${PICTURE_W} / ${PICTURE_H}` }}
      >
        {live && (
          <iframe
            ref={frame}
            src='/?themepreview'
            title='Live theme preview'
            tabIndex={-1}
            className='pointer-events-none absolute top-0 left-0 border-0'
            style={{
              width: PICTURE_W,
              height: PICTURE_H,
              transform: `scale(${scale})`,
              transformOrigin: '0 0',
            }}
          />
        )}
        <canvas
          ref={canvas}
          tabIndex={0}
          aria-label='Theme preview: drag a group to move it, or pick it and use the arrow keys'
          className='absolute inset-0 h-full w-full touch-none outline-none'
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => !drag.current && setHover(null)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className='flex flex-wrap gap-2'>
        <button type='button' className='btn btn-xs' onClick={() => setLive(v => !v)}>
          {live ? 'Show boxes instead' : 'Show live preview'}
        </button>
        {/* every box back to its template spot; saved only with Save theme */}
        <button type='button' className='btn btn-xs' onClick={() => set({ nudge: {} })}>
          Reset template boxes
        </button>
        <input
          ref={pictureInput}
          type='file'
          accept='image/*'
          className='hidden'
          onChange={e => {
            swapPicture(e.currentTarget.files?.[0]);
            e.currentTarget.value = '';
          }}
        />
        <button
          type='button'
          className='btn btn-primary btn-xs'
          disabled={busy}
          onClick={() => pictureInput.current?.click()}
        >
          New picture…
        </button>
      </div>
      <p className='text-base-content/60 text-xs'>
        {live
          ? 'The real page with sample numbers. Drag a number, button or box to move it, or tap it and use the arrow keys (Shift: 5 px).'
          : 'The lines show where the live numbers, buttons and the brew button will sit. Drag a group to move it, or tap it and use the arrow keys (Shift: 5 px).'}
        {selected ? ` Selected: ${GROUP_NAMES[selected]}.` : ''}
      </p>
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        <div className='flex flex-col gap-3'>
          <label className='flex flex-col gap-1'>
            <span className='font-semibold'>
              Theme name
              {!t.name.trim() && (
                <span className={nameMissing ? 'text-error' : 'text-warning'}>
                  {' '}
                  (needed to save)
                </span>
              )}
            </span>
            <input
              ref={nameInput}
              className={`input input-bordered w-full border-2 text-base ${
                !t.name.trim()
                  ? nameMissing
                    ? 'input-error ring-error/30 ring-4'
                    : 'input-warning'
                  : 'input-primary'
              }`}
              maxLength={24}
              value={t.name}
              onInput={e => {
                set({ name: e.currentTarget.value });
                if (e.currentTarget.value.trim()) setNameMissing(false);
              }}
              placeholder='e.g. Poker Night'
            />
            {nameMissing && !t.name.trim() && (
              <span className='text-error text-sm'>
                Give the theme a name first. Nothing was saved.
              </span>
            )}
          </label>
          <BrewVideoChoice value={t.brewVideo || ''} onChange={brewVideo => set({ brewVideo })} />
        </div>
        <div className='flex flex-col gap-1 text-sm'>
          Text colour and glow{' '}
          <span className='text-base-content/60 text-xs'>
            (for plain coloured text, set Glow to 0 %, then pick a colour)
          </span>
          <div className='flex flex-wrap items-center gap-2'>
            <input
              type='color'
              value={t.neon}
              onInput={e => set({ neon: e.currentTarget.value })}
            />
            {PRESETS.map(c => (
              <button
                key={c}
                type='button'
                aria-label={`Colour ${c}`}
                className='h-6 w-6 rounded-full border border-white/40'
                style={{ background: c, boxShadow: t.neon === c ? `0 0 0 2px ${c}` : 'none' }}
                onClick={() => set({ neon: c })}
              />
            ))}
            {/* None: plain white text, no glow */}
            <button
              type='button'
              aria-label='No glow'
              title='No glow (plain white text)'
              className='relative h-6 w-6 overflow-hidden rounded-full border border-white/60 bg-black/40'
              style={{
                boxShadow: glowOf(t) === 0 && t.neon === '#ffffff' ? '0 0 0 2px #ffffff' : 'none',
              }}
              onClick={() => set({ neon: '#ffffff', glow: 0 })}
            >
              <span className='absolute top-1/2 left-1/2 h-[2px] w-7 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-red-500' />
            </button>
          </div>
          <label className='flex items-center gap-2'>
            Font
            <select
              className='select select-bordered select-sm'
              value={t.font || ''}
              onChange={e => set({ font: e.currentTarget.value })}
            >
              <option value=''>Normal</option>
              {Object.entries(FONT_LIST).map(([id, [label]]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className='flex items-center gap-2'>
            Big numbers size
            <input
              type='range'
              min='70'
              max='130'
              step='5'
              className='range range-xs w-40'
              value={t.numSize || 100}
              onInput={e => set({ numSize: +e.currentTarget.value })}
            />
            <span className='w-10 text-right tabular-nums'>{t.numSize || 100}%</span>
          </label>
          <label className='flex items-center gap-2'>
            Window shading
            <input
              type='range'
              min='0'
              max='100'
              step='5'
              className='range range-xs w-40'
              value={t.shade || 0}
              onInput={e => set({ shade: +e.currentTarget.value })}
            />
            <span className='w-10 text-right tabular-nums'>{t.shade || 0}%</span>
          </label>
          <label className='flex items-center gap-2'>
            Glow
            <input
              type='range'
              min='0'
              max='100'
              step='5'
              className='range range-xs w-40'
              value={glowOf(t)}
              onInput={e => set({ glow: +e.currentTarget.value })}
            />
            <span className='w-10 text-right tabular-nums'>{glowOf(t)}%</span>
          </label>
          <div className='flex flex-wrap gap-2'>
            {/* the look new themes start with: full neon (keeps the colour, unless it was None's white) */}
            <button
              type='button'
              className='btn btn-xs'
              onClick={() =>
                set({
                  glow: 100,
                  neon: t.neon === '#ffffff' && glowOf(t) === 0 ? '#ff9a1a' : t.neon,
                })
              }
            >
              Default glow
            </button>
            {/* back to the colour and glow the theme had when this editor opened */}
            <button
              type='button'
              className='btn btn-xs'
              disabled={t.neon === start.neon && glowOf(t) === glowOf(start)}
              onClick={() => set({ neon: start.neon, glow: glowOf(start) })}
            >
              Undo colour changes
            </button>
          </div>
        </div>
        <div className='flex flex-col gap-1 text-sm'>
          Shows
          <WhenPicker when={t.when} onChange={when => set({ when })} />
        </div>
        <label className='flex items-center gap-2 text-sm'>
          <input
            type='checkbox'
            className='toggle toggle-sm'
            checked={!!t.clock}
            onChange={e => set({ clock: e.currentTarget.checked })}
          />
          Clock (in the template’s bottom-right window)
        </label>
        <label className='flex items-center gap-2 text-sm'>
          <input
            type='checkbox'
            className='toggle toggle-sm'
            checked={!!t.permanent}
            onChange={e => set({ permanent: e.currentTarget.checked })}
          />
          Permanent: listed with the holidays, deleting it asks you to be sure (find it under Manage
          permanent themes, below the custom themes)
        </label>
      </div>
      {error && <p className='text-error text-sm'>{error}</p>}
      <div className='flex gap-2'>
        <button type='button' className='btn btn-primary btn-sm' disabled={busy} onClick={save}>
          {busy ? (
            <>
              <span className='loading loading-spinner loading-xs' aria-hidden='true' />{' '}
              {saveStep === 'prepare'
                ? 'Preparing picture…'
                : saveStep === 'upload'
                  ? `Uploading ${progress}%`
                  : 'Saving…'}
            </>
          ) : (
            'Save theme'
          )}
        </button>
        {progress !== null && (
          <progress
            className='progress progress-primary w-32 self-center'
            value={progress}
            max='100'
            aria-label='Saving progress'
          />
        )}
        <button type='button' className='btn btn-sm' disabled={busy} onClick={() => onDone(null)}>
          Cancel
        </button>
        {t.id && (
          <button type='button' className='btn btn-sm' disabled={busy} onClick={() => onPick(t.id)}>
            Use now
          </button>
        )}
      </div>
    </div>
  );
}

// permanent: the permanent themes instead (listed with the holidays, no Delete), in a folded
// section at the bottom of the page; uncheck Permanent in the editor to make one deletable again.
// The free space the machine keeps for itself (its CUSTOM_MIN_FREE_BYTES).
const KEPT_FREE = 1048576;

export function CustomThemesSection({ onPick, permanent = false }) {
  const [editing, setEditing] = useState(null);
  // folded (permanent): its 20+ small pictures load only once it is opened, not with every
  // Settings load (they held up the page's other pictures by ~2.5 s)
  const [unfolded, setUnfolded] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);
  const restoreInput = useRef(null);
  const pictureFor = useRef(null); // the theme a new picture is for (null: a new theme)

  const choosePicture = async file => {
    if (!file) return;
    setError('');
    try {
      const bitmap = await createImageBitmap(file);
      const ratio = bitmap.width / bitmap.height;
      const bars = barColours(bitmap);
      const previewUrl = URL.createObjectURL(file);
      const existing = pictureFor.current;
      // A theme's New picture keeps everything but the picture (it used to start over and lose
      // Permanent, the brew video, font, number size, shading and the moves, user 2026-10-07).
      setEditing(
        existing
          ? { ...existing, nudge: existing.nudge || {}, bars, file, previewUrl }
          : {
              id: null,
              name: nameFromFile(file.name),
              neon: '#ff9a1a',
              glow: 100,
              when: { type: 'never' },
              nudge: {},
              clock: true,
              bars,
              file,
              previewUrl,
            },
      );
      if (Math.abs(ratio - PICTURE_W / PICTURE_H) > 0.05)
        setError(
          'This picture is not the template’s shape (16:10, e.g. 1587 x 991), so it won’t line up.',
        );
    } catch {
      setError('That file could not be read as a picture.');
    }
  };

  const edit = theme =>
    setEditing({
      ...theme,
      nudge: theme.nudge || {},
      file: null,
      previewUrl: `/custom/${theme.id}/page.webp?v=${encodeURIComponent(theme.tag || '')}`,
    });

  const remove = async theme => {
    const sure = theme.permanent
      ? `"${theme.name}" is permanent. Delete it anyway? This can't be undone.`
      : `Delete the theme "${theme.name}"?`;
    if (!confirm(sure)) return;
    try {
      // the machine refuses a permanent theme: make it ordinary first, then delete
      if (theme.permanent) {
        const { id, tag, ...meta } = theme;
        await saveCustomTheme(id, { ...meta, permanent: false });
      }
      await deleteCustomTheme(theme.id);
    } catch (e) {
      setError(`Could not delete: ${e.message}`);
    }
  };

  const { free, total } = customStorage.value;
  const list = customThemes.value.filter(t => !!t.permanent === permanent);
  // Use now (the button or the small picture): like the theme picker, not while a dated theme
  // is on with Auto themes ON; then it says why (user 2026-10-08: "Show now" seemed to do nothing).
  const [lockedTap, setLockedTap] = useState(false);
  const usePick = id => {
    if (themePickLocked.value) return setLockedTap(true);
    setLockedTap(false);
    onPick(id);
  };
  const lockedNote = lockedTap && themePickLocked.value && (
    <p className='bg-error text-error-content rounded-lg p-2 text-sm font-bold'>
      ⬆ {holidayToday.value.name} is on {holidayUntilText(holidayToday.value)}. Turn Auto themes
      OFF to change.
    </p>
  );
  const inUse = holidayModeSignal.value;
  const rows = list.map(theme => (
    // the whole row uses the theme (user 2026-10-08); its buttons do only their own job
    <div
      key={theme.id}
      className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2 ${
        inUse === theme.id ? 'border-primary border-2' : 'border-base-content/10'
      }`}
      onClick={e => !e.target.closest('button') && usePick(theme.id)}
    >
      {/* the small copy (10 KB): 20+ full pictures at once (4 MB+) restarted the machine; tap: use it */}
      <button type='button' className='shrink-0' title='Use now' onClick={() => usePick(theme.id)}>
        <img
          src={`/custom/${theme.id}/thumb.webp?v=${encodeURIComponent(theme.tag || '')}`}
          alt=''
          loading='lazy'
          className='h-10 w-[85px] rounded object-cover'
          onError={e => {
            const img = e.currentTarget;
            if (!img.dataset.full) {
              img.dataset.full = '1';
              img.src = `/custom/${theme.id}/page.webp?v=${encodeURIComponent(theme.tag || '')}`;
            }
          }}
        />
      </button>
      <div className='min-w-0 flex-1'>
        <div className='truncate font-medium' style={{ color: theme.neon }}>
          {theme.name}
        </div>
        <div className='text-base-content/60 text-xs'>{whenText(theme.when)}</div>
      </div>
      {inUse === theme.id ? (
        <span className='text-primary px-2 text-xs font-bold'>In use</span>
      ) : (
        <button type='button' className='btn btn-xs' onClick={() => usePick(theme.id)}>
          Use now
        </button>
      )}
      <button type='button' className='btn btn-xs' onClick={() => edit(theme)}>
        Edit
      </button>
      <button
        type='button'
        className='btn btn-primary btn-xs'
        onClick={() => {
          pictureFor.current = theme;
          fileInput.current?.click();
        }}
      >
        New picture
      </button>
      <button type='button' className='btn btn-xs btn-error' onClick={() => remove(theme)}>
        Delete
      </button>
    </div>
  ));
  const pictureInput = (
    <input
      ref={fileInput}
      data-part='custom-theme-file'
      type='file'
      accept='image/*'
      className='hidden'
      onChange={e => {
        choosePicture(e.currentTarget.files?.[0]);
        e.currentTarget.value = '';
      }}
    />
  );
  const editor = editing && (
    <Editor
      key={editing.previewUrl}
      start={editing}
      onPick={usePick}
      onDone={() => {
        setEditing(null);
        setError('');
      }}
    />
  );
  if (permanent) {
    return (
      <details className='mt-6 text-sm' onToggle={e => setUnfolded(e.currentTarget.open)}>
        {/* in the accent colour so it reads as something to open, with its own arrow (user 2026-10-08) */}
        <summary className='text-primary cursor-pointer list-none [&::-webkit-details-marker]:hidden'>
          {unfolded ? '▾' : '▸'} Manage permanent themes ({list.length})
        </summary>
        <div className='mt-2 flex flex-col gap-2'>
          {pictureInput}
          {error && <p className='text-warning text-sm'>{error}</p>}
          {lockedNote}
          {editor}
          {rows.length ? (
            unfolded && rows
          ) : (
            <p className='text-base-content/60 text-xs'>
              None yet: tick Permanent on a custom theme.
            </p>
          )}
        </div>
      </details>
    );
  }
  return (
    <div className='mt-4 flex flex-col gap-2'>
      <div className='flex items-center justify-between'>
        <div>
          <div className='font-medium'>Custom Themes</div>
          <div className='text-base-content/60 text-xs'>
            A picture made on the standard layout becomes a theme: pick it above, or give it dates.
            {free ? ' About 0.1 to 0.25 MB each.' : ''}
          </div>
          {/* storage meter: what new themes and videos can still use, the free space less the 1 MB
              the machine keeps for itself (saving shots and settings, the new copy of a replaced
              file). Green, yellow below 0.5 MB, red at 0 (new themes refused). */}
          {free > 0 && total > 0 && (
            <div className='mt-2 flex flex-wrap items-center gap-3'>
              <span className='text-lg font-bold tabular-nums'>
                {(Math.max(0, free - KEPT_FREE) / 1048576).toFixed(1)} MB available
              </span>
              <span className='text-base-content/60 text-sm'>(1 MB kept free for the machine)</span>
              <progress
                className={`progress w-40 ${
                  free <= KEPT_FREE
                    ? 'progress-error'
                    : free < KEPT_FREE + 0.5 * 1048576
                      ? 'progress-warning'
                      : 'progress-success'
                }`}
                value={Math.min(total - KEPT_FREE, total - free)}
                max={total - KEPT_FREE}
                aria-label='Storage used'
              />
            </div>
          )}
          {/* below 0.5 MB available: say so before the machine starts refusing new themes */}
          {free > 0 && free < KEPT_FREE + 0.5 * 1048576 && (
            <div className='text-warning mt-1 text-sm'>
              {free <= KEPT_FREE ? 'Storage is full' : 'Storage is getting full'} (
              {(Math.max(0, free - KEPT_FREE) / 1048576).toFixed(1)} MB available): delete a theme
              you don&apos;t use, or keep fewer shots (Shot History above). New themes stop being
              accepted at 0.
            </div>
          )}
        </div>
        <div className='flex flex-wrap justify-end gap-2'>
          <button
            type='button'
            className='btn btn-primary btn-sm'
            onClick={() => {
              pictureFor.current = null;
              fileInput.current?.click();
            }}
          >
            <span aria-hidden='true' className='text-lg leading-none'>
              +
            </span>{' '}
            Add theme
          </button>
          <button
            type='button'
            className='btn btn-sm btn-ghost'
            disabled={busy || !customThemes.value.length}
            title='Download every custom theme (pictures and settings) and the brew button videos as one file'
            onClick={async () => {
              setBusy(true);
              setNote('');
              try {
                const n = await exportCustomThemes();
                setNote(`Backed up ${n} theme${n === 1 ? '' : 's'}.`);
              } catch (e) {
                setError(`Backup failed: ${e.message}`);
              } finally {
                setBusy(false);
              }
            }}
          >
            Back up themes
          </button>
          <button
            type='button'
            className='btn btn-primary btn-sm'
            disabled={busy}
            title='Put themes back from a backup file'
            onClick={() => restoreInput.current?.click()}
          >
            {busy ? (
              <>
                <span className='loading loading-spinner loading-xs' aria-hidden='true' />{' '}
                Restoring…
              </>
            ) : (
              'Restore themes'
            )}
          </button>
        </div>
      </div>
      <input
        ref={restoreInput}
        data-part='custom-theme-restore'
        type='file'
        accept='application/json,.json'
        className='hidden'
        onChange={async e => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          setBusy(true);
          setNote('');
          setError('');
          try {
            const n = await importCustomThemes(file);
            setNote(`Restored ${n} theme${n === 1 ? '' : 's'}.`);
          } catch (err) {
            setError(`Restore failed: ${err.message}`);
          } finally {
            setBusy(false);
          }
        }}
      />
      {busy && <p className='text-sm'>Working…</p>}
      {note && <p className='text-success text-sm'>{note}</p>}
      {pictureInput}
      {error && <p className='text-warning text-sm'>{error}</p>}
      {lockedNote}
      {editor}
      {rows}
    </div>
  );
}
