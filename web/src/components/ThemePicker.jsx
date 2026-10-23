import { useEffect, useRef, useState } from 'preact/hooks';
import {
  HOLIDAYS,
  holidayModeSignal,
  holidayToday,
  holidayUntilText,
  keepThemeSignal,
  saveKeepTheme,
  saveThemePick,
  themePickLocked,
  themeSchedule,
} from '../utils/holidays.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const md = ([m, d]) => `${MONTHS[m - 1]} ${d}`;

// A dated theme's tag: "Now, until Oct 31" (Auto ON, showing now), "Every Fri", "Dec 1 – Dec 25"
// (a range, as set), "Jun 4" (a date, or when an nth weekday comes next).
function whenNote(s, nowId) {
  if (s.id === nowId)
    return holidayUntilText(holidayToday.value) === 'today'
      ? 'Now, today'
      : `Now, ${holidayUntilText(holidayToday.value)}`;
  if (s.weekly) return `Every ${DAYS[s.rule.weekday]}`;
  const { from, to } = s.rule;
  if (from && to && (from[0] !== to[0] || from[1] !== to[1])) return `${md(from)} – ${md(to)}`;
  return md([s.start.getMonth() + 1, s.start.getDate()]);
}
import { customThemes } from '../utils/customThemes.js';
import { notePick } from '../utils/pageLog.js';

// The theme picker (user 2026-10-01): hold the logo (top left) for a moment and every theme
// shows as a small picture; tap one to switch. The choice is saved on the machine like
// Settings > Manual mode theme, so every device follows it. Small pictures only (packs:
// thumb.webp from upload_holidays.py, custom themes: thumb.webp made on save), loaded only
// while the picker is open.
const HOLD_MS = 700;

// The machine serves a few small pictures well but not twenty at once: the tiles load three at a
// time (turn: this tile may start; done(): it finished, the next may), each tried twice, then its
// fallback. The browser keeps them (their address carries the theme's tag), so the picker opens
// at once after the first time.
function Tile({ label, picture, fallback, active, note, now, onPick, turn, done }) {
  const [tries, setTries] = useState(
    [picture, picture && `${picture}${picture.includes('?') ? '&' : '?'}r=2`, fallback].filter(
      Boolean,
    ),
  );
  const [shown, setShown] = useState(false);
  const finished = useRef(false);
  const finish = () => {
    if (!finished.current) done();
    finished.current = true;
  };
  useEffect(() => {
    if (turn && !tries.length) finish();
  }, [turn, tries.length]);
  const src = turn ? tries[0] : null;
  return (
    <button
      type='button'
      onClick={onPick}
      className={`flex flex-col overflow-hidden rounded-lg border-2 bg-black/40 text-left ${
        active ? 'border-primary' : 'border-transparent'
      }`}
    >
      <div className='relative flex aspect-[16/10] w-full items-center justify-center bg-black/50 text-sm text-white/70'>
        {!shown && label}
        {src && (
          <img
            key={src}
            src={src}
            alt=''
            className={`absolute inset-0 h-full w-full object-cover ${shown ? '' : 'opacity-0'}`}
            onLoad={() => {
              setShown(true);
              finish();
            }}
            // 1 s before the next try: a busy machine (503) would otherwise fall straight through
            // to the big page.webp fallback (2026-10-16)
            onError={() => setTimeout(() => setTries(t => t.slice(1)), 1000)}
          />
        )}
        {note && (
          <span
            className={`absolute top-1 left-1 rounded px-1.5 py-0.5 text-xs font-bold ${
              now ? 'bg-warning text-warning-content' : 'bg-black/75 text-white'
            }`}
          >
            {note}
          </span>
        )}
      </div>
      <span className='truncate px-2 py-1 text-xs text-white'>{label}</span>
    </button>
  );
}

export function ThemePicker() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(0); // tiles whose picture has finished (loaded or given up)
  const [lockedTap, setLockedTap] = useState(false); // a picture was tapped while a holiday is on: say why
  const timer = useRef(null);

  useEffect(() => {
    const cancel = () => clearTimeout(timer.current);
    const down = e => {
      if (!e.target.closest?.("[data-slot='logo']")) return;
      cancel();
      timer.current = setTimeout(() => {
        setLoaded(0);
        setLockedTap(false);
        setOpen(true);
      }, HOLD_MS);
    };
    // a long press on a phone would also open the browser's own menu for the logo picture
    const menu = e => e.target.closest?.("[data-slot='logo']") && e.preventDefault();
    const move = e => Math.abs(e.movementX) + Math.abs(e.movementY) > 6 && cancel(); // a scroll, not a hold
    addEventListener('pointerdown', down, true);
    addEventListener('pointerup', cancel, true);
    addEventListener('pointercancel', cancel, true);
    addEventListener('pointermove', move, true);
    addEventListener('contextmenu', menu, true);
    return () => {
      cancel();
      removeEventListener('pointerdown', down, true);
      removeEventListener('pointerup', cancel, true);
      removeEventListener('pointercancel', cancel, true);
      removeEventListener('pointermove', move, true);
      removeEventListener('contextmenu', menu, true);
    };
  }, []);

  if (!open) return null;

  const pick = id => {
    notePick(id);
    saveThemePick(id); // over the open WebSocket (POST only when it is not open)
    setOpen(false);
  };
  const current = holidayModeSignal.value;
  const tileOf = t => {
    const v = encodeURIComponent(t.tag || '');
    return {
      id: t.id,
      label: t.name,
      picture: `/custom/${t.id}/thumb.webp?v=${v}`,
      fallback: `/custom/${t.id}/page.webp?v=${v}`,
    };
  };
  const none = { id: 'auto', label: 'None (plain page)' };
  const packs = HOLIDAYS.map(h => ({
    id: h.id,
    label: h.label,
    picture: `/holidays/${h.id}/thumb.webp`,
  }));
  // Auto themes ON: a calendar first, the dated themes in the order they come (now, then
  // next), each tagged with its date; then the others (user 2026-10-07). OFF: one list in the
  // usual order, the dated themes still tagged with their dates.
  const auto = !keepThemeSignal.value;
  const schedule = themeSchedule(customThemes.value);
  const nowId = auto ? holidayToday.value?.id : null;
  const dated = schedule
    .map(s => {
      const t = customThemes.value.find(c => c.id === s.id);
      return t && { ...tileOf(t), note: whenNote(s, nowId), now: s.id === nowId };
    })
    .filter(Boolean);
  const others = [
    none,
    ...packs,
    ...customThemes.value.filter(t => !dated.some(d => d.id === t.id)).map(tileOf),
  ];
  const sections =
    auto && dated.length
      ? [
          ['By date', dated],
          ['Other themes', others],
        ]
      : [
          [
            null,
            [
              none,
              ...packs,
              ...customThemes.value.map(t => ({
                ...tileOf(t),
                note: dated.find(d => d.id === t.id)?.note,
              })),
            ],
          ],
        ];

  return (
    <div
      data-part='theme-picker'
      className='fixed inset-0 z-[10001] flex items-center justify-center bg-black/70 p-4'
      onClick={() => setOpen(false)}
    >
      <div
        className='bg-base-100 max-h-full w-full max-w-4xl overflow-y-auto rounded-xl p-4'
        onClick={e => e.stopPropagation()}
      >
        <div className='mb-3 flex items-center justify-between'>
          <span className='font-semibold'>Themes</span>
          <button type='button' className='btn btn-sm btn-ghost' onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
        {/* Loud, at the top, every time (user 2026-10-07): a picked theme that doesn't show is
            explained right here, and the switch can't be forgotten. Same setting as in Settings.
            Pinned while the pictures scroll, so the "why not" message shows wherever you tap. */}
        <div className='bg-base-100 sticky -top-4 z-10 -mx-4 px-4 pt-4 pb-1'>
          <label className='bg-warning text-warning-content mb-3 flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 rounded-lg p-3 text-lg font-bold'>
            {/* a switch, ON = themes change by date (the setting underneath is its opposite: keepTheme) */}
            {/* OFF [switch] ON: the side it is on bold, the other faded */}
            <span className='flex items-center gap-3'>
              Auto themes by date
              <span className={keepThemeSignal.value ? '' : 'opacity-40'}>OFF</span>
              <input
                type='checkbox'
                role='switch'
                className='toggle toggle-lg border-warning-content bg-warning-content/20 checked:bg-warning-content/90'
                checked={!keepThemeSignal.value}
                onChange={e => saveKeepTheme(!e.currentTarget.checked)}
              />
              <span className={keepThemeSignal.value ? 'opacity-40' : ''}>ON</span>
            </span>
            {holidayToday.value && (
              <span className='text-base font-semibold'>
                Today: {holidayToday.value.name}
                {holidayToday.value.until ? ` ${holidayUntilText(holidayToday.value)}` : ''}
              </span>
            )}
          </label>
          {lockedTap && themePickLocked.value && (
            <div className='bg-error text-error-content mb-3 rounded-lg p-3 text-base font-bold'>
              <span aria-hidden='true'>⬆ </span>
              {holidayToday.value.name} is on {holidayUntilText(holidayToday.value)}. Turn Auto
              themes OFF to change.
            </div>
          )}
        </div>
        {sections.map(([title, list], s) => {
          // pictures load in turn across the sections, the calendar first
          const first = sections.slice(0, s).reduce((n, [, l]) => n + l.length, 0);
          return (
            <div key={title || 'all'}>
              {title && <div className='mt-2 mb-2 text-sm font-semibold opacity-80'>{title}</div>}
              <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4'>
                {list.map((t, j) => (
                  <Tile
                    key={t.id}
                    turn={first + j < loaded + 3}
                    done={() => setLoaded(n => n + 1)}
                    label={t.label}
                    picture={t.picture}
                    fallback={t.fallback}
                    note={t.note}
                    now={t.now}
                    active={current === t.id}
                    // a holiday on: nothing can be picked (the red line says why)
                    onPick={() => (themePickLocked.value ? setLockedTap(true) : pick(t.id))}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
