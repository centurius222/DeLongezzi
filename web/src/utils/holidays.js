import { computed, signal } from '@preact/signals';
import { customThemes, isCustomId } from './customThemes.js';

// Holiday decorations (user 2026-09-25). Each holiday is a pack, a folder in
// web/holidays/<id>/ with a theme.css and its pictures, kept in the machine's
// storage (scripts/upload_holidays.py sends them; components/Holiday.jsx loads
// one only while that holiday is on). The machine keeps the choice
// (Settings > Web Settings > Holiday Decorations), so every device follows it:
// 'auto' (shown as None) is the plain page, or a theme's id is the everyday theme. On a
// theme's dates that theme shows for the day instead, unless the "Auto themes by date" switch is
// OFF (keepTheme) (user 2026-10-07: a picked theme used to switch every date off).
// from/to: [month, day]; on: year => [month, day] for a holiday that moves;
// weekday: 0-6 (0 = Sunday) for one that comes back every week.
// auto: false = only when picked; Automatic uses the first holiday of each date.
// Western and Pizza Friday were built in until 2026-10-05; they are permanent custom themes now
// (uwestern, upizzafriday: Pizza Friday every Friday), so they can be edited like the others.
export const HOLIDAYS = [];
const MOVED = { western: 'uwestern', pizza: 'upizzafriday' };

const MODE_KEY = 'gaggimate-holiday-mode';
const KEEP_KEY = 'gaggimate-keep-theme';

// A custom theme's id is kept even before the list of custom themes has loaded.
// 'off' (no themes at all, before 2026-10-07) is None now; with "Auto themes by date" OFF it is
// the plain page every day.
function normalizeMode(mode) {
  mode = MOVED[mode] || mode;
  return HOLIDAYS.some(h => h.id === mode) || isCustomId(mode) ? mode : 'auto';
}

function readStoredKeep() {
  try {
    return localStorage.getItem(KEEP_KEY) === '1';
  } catch {
    return false;
  }
}

function readStoredMode() {
  try {
    return normalizeMode(localStorage.getItem(MODE_KEY));
  } catch {
    return 'auto';
  }
}

// The nth weekday (0 = Sunday) of a month in a year, as [month, day].
function nthWeekday(year, month, weekday, n) {
  const first = new Date(year, month - 1, 1).getDay();
  return [month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7];
}

// Today as year * 10000 + month * 100 + day, e.g. 20261224 for December 24, 2026.
function today(date = new Date()) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

// Is a { from, to } / { on } / { weekday } rule on for this date?
function ruleOn({ from, to, on: moves, weekday }, year, day) {
  if (weekday !== undefined) return new Date(year, Math.floor(day / 100) - 1, day % 100).getDay() === weekday;
  if (moves) [from, to] = [moves(year), moves(year)];
  if (!from || !to) return false;
  const start = from[0] * 100 + from[1];
  const end = to[0] * 100 + to[1];
  // A range that runs over New Year (e.g. Dec 30 to Jan 2) wraps around.
  return start <= end ? day >= start && day <= end : day >= start || day <= end;
}

// How many days a dated rule covers in a year: 1 for a date or an nth weekday, the length of
// a range (one over New Year counted across it).
function ruleDays({ from, to, on: moves }) {
  if (moves || !from || !to) return 1;
  const n = ([m, d]) => Math.round((Date.UTC(2001, m - 1, d) - Date.UTC(2001, 0, 1)) / 86400000);
  return ((n(to) - n(from) + 365) % 365) + 1;
}

// A custom theme's "when" (Settings > Custom Themes) as a rule, or null (picked by hand).
function customRule(when) {
  switch (when?.type) {
    case 'date':
      return { from: when.on, to: when.on };
    case 'range':
      return { from: when.from, to: when.to };
    case 'weekday':
      return { weekday: when.weekday };
    case 'nth':
      return { on: year => nthWeekday(year, when.month, when.weekday, when.n) };
    default:
      return null;
  }
}

// The theme on `date` (see today()), or null for the plain page: the theme with today's date
// (the built-in dated holidays first, then custom themes with a date, a range or an nth
// weekday, then the weekly custom themes: Pizza Friday is one), else the picked one (`mode`).
// keep: always the picked one.
export function holidayFor(mode, date, custom = [], keep = false) {
  const known = HOLIDAYS.some(h => h.id === mode) || (isCustomId(mode) && custom.some(c => c.id === mode));
  const picked = known ? mode : null;
  if (keep) return picked;
  return datedFor(date, custom) || picked;
}

function datedFor(date, custom) {
  const year = Math.floor(date / 10000);
  const day = date % 10000;
  const auto = HOLIDAYS.filter(h => h.auto !== false);
  const dated = auto.find(h => h.weekday === undefined && ruleOn(h, year, day));
  if (dated) return dated.id;
  const rules = custom.map(c => ({ id: c.id, rule: customRule(c.when) })).filter(c => c.rule);
  // Two dated themes on one day: the shorter one wins (Taco Day, Oct 6, inside Halloween's
  // October), the first in the list on a tie. It used to be the first in the list (by name).
  const customDated = rules
    .filter(c => c.rule.weekday === undefined && ruleOn(c.rule, year, day))
    .reduce((best, c) => (!best || ruleDays(c.rule) < ruleDays(best.rule) ? c : best), null);
  if (customDated) return customDated.id;
  const weekly = auto.find(h => h.weekday !== undefined && ruleOn(h, year, day));
  if (weekly) return weekly.id;
  const customWeekly = rules.find(c => c.rule.weekday !== undefined && ruleOn(c.rule, year, day));
  return customWeekly ? customWeekly.id : null;
}

export const holidayModeSignal = signal(readStoredMode());
export const keepThemeSignal = signal(readStoredKeep());
const todaySignal = signal(today());
// A page left open (a wall tablet) changes over on the day itself.
setInterval(() => {
  todaySignal.value = today();
}, 60 * 1000);

// The dated theme on today (whether or not it shows), and until when: the theme picker says
// why a picked theme isn't showing.
export const holidayToday = computed(() => {
  const id = datedFor(todaySignal.value, customThemes.value);
  const theme = id && customThemes.value.find(t => t.id === id);
  if (!theme) return null;
  const until = theme.when?.type === 'range' ? theme.when.to : null; // else: today only
  return { id, name: theme.name, until };
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "until Oct 31" for a range, "today" for a one-day theme.
export const holidayUntilText = h =>
  h?.until ? `until ${MONTHS[h.until[0] - 1]} ${h.until[1]}` : 'today';

// Auto themes by date ON and a dated theme on today: the theme can't be picked (the picker's
// pictures dim, the Settings menu is locked) until the switch is OFF (user 2026-10-07: a pick
// that didn't show was confusing).
export const themePickLocked = computed(() => !keepThemeSignal.value && !!holidayToday.value);

export const activeHoliday = computed(() =>
  holidayFor(holidayModeSignal.value, todaySignal.value, customThemes.value, keepThemeSignal.value),
);

// From the machine's settings (at startup and after Save) or the Settings select.
export function setHolidayMode(mode) {
  const next = normalizeMode(mode);
  holidayModeSignal.value = next;
  try {
    localStorage.setItem(MODE_KEY, next);
  } catch {
    // Not remembered in this browser; the machine still has it.
  }
}

// keepTheme: the "Auto themes by date" switch OFF; from the machine's settings or a switch.
export function setKeepTheme(keep) {
  keepThemeSignal.value = !!keep;
  try {
    localStorage.setItem(KEEP_KEY, keep ? '1' : '0');
  } catch {
    // Not remembered in this browser; the machine still has it.
  }
}

// Ticked or unticked in Settings or the theme picker: shown at once, kept on the machine.
export function saveKeepTheme(keep) {
  setKeepTheme(keep);
  sendTheme({ keepTheme: keep });
}

// The open WebSocket (set once in index.jsx). A theme change goes over it: no new connection,
// no settings reply (2026-10-16). Not open: the POST, as before.
let themeLink = null;
export function setThemeLink(api) {
  themeLink = api;
}

// For 10 s after a theme change, settings replies that were already on their way are not
// allowed to switch the theme back (they may have left the machine before the change).
let themeGuardUntil = 0;
export const themeGuarded = () => Date.now() < themeGuardUntil;
export function guardTheme() {
  themeGuardUntil = Date.now() + 10000;
}

function sendTheme(fields) {
  guardTheme();
  try {
    if (themeLink) {
      themeLink.send({ tp: 'req:theme', ...fields });
      return;
    }
  } catch {
    // not connected: the POST below
  }
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) body.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : v);
  fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }).catch(() => {});
}

// A theme picked in the theme picker: shown at once, kept on the machine.
export function saveThemePick(id) {
  setHolidayMode(id);
  sendTheme({ holidayMode: id });
}

// When each dated custom theme comes next, for the theme picker's calendar (Auto themes ON):
// [{ id, start (Date), days (from today), weekly, rule }], soonest first, the weekly ones last.
// Looks a year ahead day by day: a few thousand cheap checks, only while the picker is open.
export function themeSchedule(custom = [], now = new Date()) {
  const out = [];
  for (const c of custom) {
    const rule = customRule(c.when);
    if (!rule) continue;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (let i = 0; i < 400; i++, d.setDate(d.getDate() + 1)) {
      const n = today(d);
      if (ruleOn(rule, Math.floor(n / 10000), n % 10000)) {
        out.push({ id: c.id, start: new Date(d), days: i, weekly: rule.weekday !== undefined, rule });
        break;
      }
    }
  }
  return out.sort((a, b) => a.weekly - b.weekly || a.days - b.days);
}
