import { PREVIEW } from '../utils/themePreview.js';
import { useEffect, useState } from 'preact/hooks';
import { activeHoliday } from '../utils/holidays.js';
import { customThemes, isCustomId, loadCustomThemes } from '../utils/customThemes.js';
import { noteShown, pageNote } from '../utils/pageLog.js';
import { glowColours, neonShades, nudgeVars, themeCss } from '../utils/customThemeFit.js';
import '../customTheme.css';
import '../customFonts.css';

// Dresses the page for the holiday that is on: loads its pack from the machine's
// storage (/holidays/<id>/theme.css, one file with its pictures inside, put
// there by scripts/upload_holidays.py) and, once that has arrived, marks
// <html data-holiday='<id>'>, which switches the pack's rules on.
// A pack that isn't on the machine simply leaves the page as it is.
// The first pack of a page load: the page waits hidden for it (style.css data-holiday-loading),
// at most PACK_WAIT_MS, so it doesn't show the plain layout first and then jump (phones load the
// pack slowly). Switching packs later (Settings) doesn't hide anything.
let firstPack = true;
const PACK_WAIT_MS = 6000;

export function HolidayStyles() {
  const id = activeHoliday.value;
  useEffect(() => {
    if (!id || isCustomId(id)) return undefined; // custom themes: CustomThemeStyles
    const root = document.documentElement;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.id = 'gm-holiday';
    link.href = `/holidays/${id}/theme.css`;
    const shown = () => root.removeAttribute('data-holiday-loading');
    let wait = null;
    if (firstPack) {
      root.setAttribute('data-holiday-loading', '');
      wait = setTimeout(shown, PACK_WAIT_MS);
    }
    firstPack = false;
    link.onload = () => {
      root.setAttribute('data-holiday', id);
      shown();
    };
    link.onerror = shown; // no pack on the machine: the plain page
    document.head.appendChild(link);
    return () => {
      clearTimeout(wait);
      shown();
      link.remove();
      root.removeAttribute('data-holiday');
    };
  }, [id]);
  return null;
}

// A theme's Font (Settings > Custom Themes): the numbers, the mode buttons and the clock in it
// (units stay plain), like the old Back to the Future pack.
const FONT_PARTS = [
  "[data-slot='mode-tab']",
  "[data-part='metric'] [data-part='value'] > span:first-child",
  "[data-card='controls'] [data-part='stepper-value']",
  "[data-part='clock']",
];
const fontRules = family =>
  `${FONT_PARTS.map(p => `:root[data-custom-theme]:has([data-slot='manual']) ${p}`).join(', ')} { font-family: ${family}, sans-serif !important; font-weight: 400 !important; }\n` +
  `:root[data-custom-theme]:has([data-slot='manual']) [data-card='controls'] [data-part='stepper-value'] > span { font-family: system-ui, sans-serif !important; }\n`;
// A wide font's sizes, scaled down from the template's (customTheme.css, picture px).
const fontScale = k => {
  const G = ":root[data-custom-theme]:has([data-slot='manual'])";
  const size = (sel, px) => `${G} ${sel} { font-size: calc(${px * k} * var(--u)) !important; }\n`;
  return (
    size("[data-slot='mode-tab']", 25) +
    `${G} [data-part='metric'] [data-part='value'] > span:first-child { font-size: calc(${56 * k} * var(--numk, 1) * var(--u)) !important; }\n` +
    `${G} [data-part='metric'] [data-part='value'] > span:first-child { letter-spacing: -0.08em; }\n` +
    size("[data-card='controls'] [data-part='stepper-value']", 40) +
    size("[data-part='clock']", 30)
  );
};

// id -> [label, CSS family, size scale for wide fonts] (the files: customFonts.css)
export const FONT_LIST = {
  timecircuits: ['Time Circuits (Back to the Future)', "'Time Circuits'"],
  digitaldream: ['Digital Dream (LED clock)', "'Digital Dream'", 0.7],
  pocketcalc: ['Pocket Calculator (LCD)', "'Pocket Calculator'"],
  pixelnes: ['Pixel NES (retro game)', "'Pixel NES'"],
  minecraft: ['Minecraft (blocky)', "'Minecraft'"],
  neonpixel: ['Neon Pixel (neon sign)', "'Neon Pixel'"],
  collegiate: ['SF Collegiate (sports jersey)', "'SF Collegiate'"],
  typewriter: ['Typewriter (vintage)', "'Typewriter'"],
  spaceage: ['Space Age (sci-fi)', "'Space Age'", 0.9],
  frozencrystal: ['Frozen Crystal (winter)', "'Frozen Crystal'"],
  timebomb: ['Ticking Time Bomb (countdown)', "'Ticking Time Bomb'"],
};
export const FONTS = Object.fromEntries(
  Object.entries(FONT_LIST).map(([id, [, family, scale]]) => [id, fontRules(family) + (scale ? fontScale(scale) : '')]),
);

// A custom theme (Settings > Custom Themes): the master layout (customTheme.css) is
// switched on with <html data-custom-theme>; the picture, its bars' colours, the theme's
// colours and its nudges are set as CSS variables, and its colour rules added.
export function CustomThemeStyles() {
  const id = activeHoliday.value;
  const theme = isCustomId(id) ? customThemes.value.find(t => t.id === id) : null;
  useEffect(() => {
    if (!PREVIEW) loadCustomThemes();
  }, []);
  // The picture: loaded here first, then shown. A CSS background that failed to load (a phone
  // on weak Wi-Fi, the machine busy) was never asked for again until a reload (user 2026-10-07:
  // Genie without its picture). Tries again after 2, 5 and 10 s, then every 30 s, for 10 min.
  const pictureUrl =
    theme &&
    (theme.pictureUrl || `/custom/${theme.id}/page.webp?v=${encodeURIComponent(theme.tag || '')}`);
  useEffect(() => {
    if (!pictureUrl) return undefined;
    const root = document.documentElement;
    const show = url => root.style.setProperty('--pack-picture', `url(${url})`);
    if (PREVIEW || pictureUrl.startsWith('blob:')) {
      show(pictureUrl); // the editor's own picture, already in the browser
      return () => root.style.removeProperty('--pack-picture');
    }
    let alive = true;
    let timer = null;
    let tries = 0;
    const started = Date.now();
    const attempt = url => {
      const img = new Image();
      img.onload = () => {
        if (!alive) return;
        show(url);
        noteShown(theme.id);
      };
      img.onerror = () => {
        if (!alive) return;
        pageNote(`picture failed ${theme.id} after ${Math.round(Date.now() - started)}ms`);
        // every 1 s for the first 10 tries: a busy machine (503) has a free turn within about 1 s
        // (2026-10-16); then 2, 5, 10 s and every 30 s as before
        const wait = tries < 10 ? 1000 : ([2000, 5000, 10000][tries - 10] ?? 30000);
        tries++;
        if (Date.now() - started + wait > 10 * 60 * 1000) return;
        timer = setTimeout(() => attempt(`${pictureUrl}&r=${tries}`), wait);
      };
      img.src = url;
    };
    attempt(pictureUrl);
    return () => {
      alive = false;
      clearTimeout(timer);
      root.style.removeProperty('--pack-picture');
    };
  }, [pictureUrl]);
  useEffect(() => {
    if (!theme) return undefined;
    const root = document.documentElement;
    const neon = /^#[0-9a-f]{6}$/i.test(theme.neon || '') ? theme.neon : '#ff9a1a';
    const shades = neonShades(neon);
    const glow = Number.isFinite(theme.glow) ? theme.glow : 100;
    const { core, edge, glow: halo } = glowColours(neon, glow);
    const vars = {
      '--skin-led': core,
      '--skin-led-edge': edge,
      '--skin-led-glow': halo,
      '--skin-caption': shades.caption,
      '--color-primary': neon,
      '--chart-text': shades.text,
      '--chart-grid': shades.grid,
      ...(theme.bars ? { '--bars-lr': theme.bars.lr, '--bars-tb': theme.bars.tb } : {}),
      ...nudgeVars(theme.nudge || {}),
      // Window shading 0-100 % (Settings): a dark veil behind the numbers, up to 0.5
      '--shade': String((Number.isFinite(theme.shade) ? theme.shade : 0) / 200),
      // Big numbers size 70-130 % (Settings): flow, weight, temperature and pressure
      '--numk': String((Number.isFinite(theme.numSize) ? theme.numSize : 100) / 100),
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    const style = document.createElement('style');
    style.id = 'gm-custom-theme-fit';
    style.textContent =
      themeCss({ neon, glow }) +
      (theme.clock === false ? ":root[data-custom-theme] [data-part='clock'] { display: none !important; }\n" : '') +
      (FONTS[theme.font] || '');
    document.head.appendChild(style);
    root.setAttribute('data-custom-theme', theme.id);
    return () => {
      root.removeAttribute('data-custom-theme');
      style.remove();
      for (const k of Object.keys(vars)) root.style.removeProperty(k);
    };
  }, [
    theme?.id,
    theme?.tag,
    theme?.neon,
    theme?.glow,
    theme?.clock,
    theme?.shade,
    theme?.numSize,
    theme?.font,
    theme?.pictureUrl,
    JSON.stringify(theme?.bars),
    JSON.stringify(theme?.nudge),
  ]);
  return null;
}

// Empty boxes for a holiday's pictures, one per name. The holiday's theme.css
// decides which show, where, and what they look like (style.css keeps them out
// of the layout). Nothing at all while no holiday is on.
export function Decor({ pieces }) {
  if (!activeHoliday.value) return null;
  return pieces.map(piece => <span key={piece} data-piece={piece} aria-hidden='true' />);
}

// What every card (data-slot='card') offers a pack: a texture behind the text,
// something along the top and bottom edges, a garland, and up to eight ornaments.
const CARD_PIECES = [
  'card-texture',
  'card-top',
  'card-bottom',
  'card-garland',
  'ornament-1',
  'ornament-2',
  'ornament-3',
  'ornament-4',
  'ornament-5',
  'ornament-6',
  'ornament-7',
  'ornament-8',
];

export function CardDecor() {
  return <Decor pieces={CARD_PIECES} />;
}

// A live clock a pack can show and place (hidden unless its theme.css shows
// [data-part='clock']): month, day, year, AM/PM and the time, in its own
// boxes so each can sit in its own window of the pack's picture. The time is
// the viewing device's. Nothing while no holiday is on.
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function HolidayClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10 * 1000);
    return () => clearInterval(t);
  }, []);
  if (!activeHoliday.value) return null;
  const h = now.getHours();
  return (
    <div data-part='clock' aria-hidden='true'>
      <span data-part='clock-month'>{MONTHS[now.getMonth()]}</span>
      <span data-part='clock-day'>{String(now.getDate()).padStart(2, '0')}</span>
      <span data-part='clock-year'>{now.getFullYear()}</span>
      <span data-part='clock-ampm'>{h < 12 ? 'AM' : 'PM'}</span>
      <span data-part='clock-time'>
        {String(h % 12 || 12).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
      </span>
    </div>
  );
}
