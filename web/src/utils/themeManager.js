import { signal } from '@preact/signals';
import { PREVIEW } from './themePreview.js';
import { setHolidayMode, setKeepTheme, themeGuarded } from './holidays.js';
import { rememberChartTimer } from './chartTimer.js';
import { loadCustomThemes } from './customThemes.js';
import { refreshBrewState } from './brewArt.js';
import { loadVideos } from './brewVideos.js';

const THEME_STORAGE_KEY = 'gaggimate-daisyui-theme';
const AVAILABLE_THEMES = ['system', 'light', 'dark', 'coffee', 'nord', 'custom'];

const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

// The colour theme and the custom colours as the machine has them now, for an open Settings
// page: its menus follow a change made in another tab or device (user 2026-10-08).
export const colorThemeSignal = signal(null);
export const themeColorsSignal = signal(null);

// Custom theme (Settings > Theme > Custom, user 2026-09-25): three colors kept on
// the machine and used exactly as picked; the rest is worked out from them.
// Cached here so the page starts in the right colors before settings arrive.
const CUSTOM_COLORS_KEY = 'gaggimate-custom-theme';
const CUSTOM_STYLE_ID = 'gm-custom-theme';
export const DEFAULT_CUSTOM_COLORS = { bg: '#0a1120', accent: '#3abdf7', text: '#c9cbd0' };
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
// Alerts keep the standard colors (Dark or Light theme's) so they still read as
// alerts whatever the custom colors are.
const STATUS_DARK = `
  --color-info: oklch(68.455% 0.148 237.251);
  --color-info-content: oklch(0% 0 0);
  --color-success: oklch(78.452% 0.132 181.911);
  --color-success-content: oklch(15.69% 0.026 181.911);
  --color-warning: oklch(83.242% 0.139 82.95);
  --color-warning-content: oklch(16.648% 0.027 82.95);
  --color-error: oklch(71.785% 0.17 13.118);
  --color-error-content: oklch(14.357% 0.034 13.118);`;
const STATUS_LIGHT = `
  --color-info: oklch(88.127% 0.085 214.515);
  --color-info-content: oklch(17.625% 0.017 214.515);
  --color-success: oklch(80.494% 0.077 197.823);
  --color-success-content: oklch(16.098% 0.015 197.823);
  --color-warning: oklch(92% 0.12 95.746);
  --color-warning-content: oklch(17.834% 0.009 71.47);
  --color-error: oklch(73.092% 0.11 20.076);
  --color-error-content: oklch(14.618% 0.022 20.076);`;

const channel = (hex, i) => Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);

// WCAG relative luminance: 0 is black, 1 is white.
function luminance(hex) {
  const lin = i => {
    const c = channel(hex, i) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(0) + 0.7152 * lin(1) + 0.0722 * lin(2);
}

// Black or white, whichever reads better on `hex`.
function textOn(hex) {
  const l = luminance(hex);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000000' : '#ffffff';
}

// `hex` moved `amount` (0 to 1) of the way toward `to`.
function mix(hex, to, amount) {
  let out = '#';
  for (let i = 0; i < 3; i++) {
    const a = channel(hex, i);
    out += Math.round(a + (channel(to, i) - a) * amount)
      .toString(16)
      .padStart(2, '0');
  }
  return out;
}

function normalizeCustomColors(colors) {
  const out = { ...DEFAULT_CUSTOM_COLORS };
  for (const key of ['bg', 'accent', 'text']) {
    if (HEX_COLOR.test(colors?.[key] || '')) out[key] = colors[key];
  }
  return out;
}

// Page background = bg, cards a slightly lighter shade; buttons, sliders and
// switches = accent, with black or white text on them; text = text.
function customThemeCss({ bg, accent, text }) {
  const dark = luminance(bg) < 0.2;
  const second = mix(accent, dark ? '#ffffff' : '#000000', 0.25);
  return `html[data-theme='custom'] {
  color-scheme: ${dark ? 'dark' : 'light'};
  --color-base-100: ${mix(bg, '#ffffff', 0.04)};
  --color-base-200: ${mix(bg, '#ffffff', 0.02)};
  --color-base-300: ${bg};
  --color-base-content: ${text};
  --color-primary: ${accent};
  --color-primary-content: ${textOn(accent)};
  --color-secondary: ${second};
  --color-secondary-content: ${textOn(second)};
  --color-accent: ${accent};
  --color-accent-content: ${textOn(accent)};
  --color-neutral: ${mix(bg, '#ffffff', 0.1)};
  --color-neutral-content: ${text};${dark ? STATUS_DARK : STATUS_LIGHT}
  --radius-selector: 1rem;
  --radius-field: 0.5rem;
  --radius-box: 1rem;
  --size-selector: 0.25rem;
  --size-field: 0.25rem;
  --border: 1px;
  --depth: 0;
  --noise: 0;
}`;
}

// Puts custom colors on the page without saving them (live preview in Settings).
export function previewCustomColors(colors) {
  const c = normalizeCustomColors(colors);
  let style = document.getElementById(CUSTOM_STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = CUSTOM_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = customThemeCss(c);
  // Dark backgrounds also get the Dark theme's chart and glass colors (style.css).
  document.documentElement.classList.toggle('theme-dark', luminance(c.bg) < 0.2);
}

function getCustomColors() {
  try {
    return normalizeCustomColors(JSON.parse(localStorage.getItem(CUSTOM_COLORS_KEY) || 'null'));
  } catch {
    return { ...DEFAULT_CUSTOM_COLORS };
  }
}

// Takes the theme and custom colors from the machine's settings (at startup, when
// Settings loads and after Save), so every device follows them.
export function rememberThemeSettings(settings) {
  if (PREVIEW) return; // the theme editor's preview: nothing from the machine, nothing saved
  if (!settings) return;
  if (HEX_COLOR.test(settings.themeBg || '')) {
    const colors = normalizeCustomColors({
      bg: settings.themeBg,
      accent: settings.themeAccent,
      text: settings.themeText,
    });
    try {
      localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(colors));
    } catch {
      // Not remembered in this browser; the machine still has them.
    }
    if (getStoredTheme() === 'custom') previewCustomColors(colors);
    themeColorsSignal.value = colors;
  }
  // Empty until a theme is saved on the machine; until then each browser keeps its own.
  if (
    AVAILABLE_THEMES.includes(settings.webTheme) &&
    (settings.webTheme !== getStoredTheme() || settings.webTheme !== shownTheme)
  ) {
    setStoredTheme(settings.webTheme);
  }
  if (AVAILABLE_THEMES.includes(settings.webTheme)) colorThemeSignal.value = settings.webTheme;
  // Holiday decorations too (Settings > Web Settings > Holiday Decorations).
  // Not within 10 s of a theme change: this reply may have left the machine before it (2026-10-16).
  if (!themeGuarded()) {
    if (typeof settings.holidayMode === 'string') setHolidayMode(settings.holidayMode);
    if (typeof settings.keepTheme === 'boolean') setKeepTheme(settings.keepTheme);
  }
  rememberChartTimer(settings);
}

export function getSystemTheme() {
  return mediaQuery.matches ? 'dark' : 'light';
}

export function getStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored && AVAILABLE_THEMES.includes(stored) ? stored : 'system';
  } catch (error) {
    console.warn('Failed to get stored theme:', error);
    return 'system';
  }
}

export function setStoredTheme(theme) {
  try {
    if (AVAILABLE_THEMES.includes(theme)) {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
      applyTheme(theme);
      return true;
    }
    return false;
  } catch (error) {
    console.warn('Failed to set stored theme:', error);
    return false;
  }
}

// The colour theme this page shows now (applyTheme). Another tab's change already sits in the
// shared localStorage, so "different from what is stored" missed it (user 2026-10-08).
let shownTheme = null;

export function applyTheme(theme) {
  if (!AVAILABLE_THEMES.includes(theme)) {
    return;
  }
  shownTheme = theme;
  const actualTheme = theme === 'system' ? getSystemTheme() : theme;
  if (actualTheme === 'custom') previewCustomColors(getCustomColors());
  document.documentElement.setAttribute('data-theme', actualTheme);
}

export function getAvailableThemes() {
  return AVAILABLE_THEMES.map(theme => ({
    value: theme,
    label: theme.charAt(0).toUpperCase() + theme.slice(1),
  }));
}

function onSystemThemeChange() {
  if (getStoredTheme() === 'system') {
    applyTheme('system');
  }
}

function readThemeSettings() {
  fetch('/api/settings', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(s => s && rememberThemeSettings(s))
    .catch(() => {});
}

// The machine says something changed (evt:changed, from this or another device): read just
// that again, at once. Loaded pictures and videos stay unless their file changed.
export function onMachineChanged(what = []) {
  if (PREVIEW) return;
  if (what.includes('settings')) readThemeSettings();
  if (what.includes('themes')) loadCustomThemes();
  if (what.includes('videos')) loadVideos();
  if (what.includes('settings') || what.includes('videos')) refreshBrewState();
}

// Initialize theme on load
export function initializeTheme() {
  const theme = getStoredTheme();
  mediaQuery.addEventListener('change', onSystemThemeChange);
  applyTheme(theme);
  // The theme, custom colors and holiday live on the machine: follow changes made on
  // another device (the stored theme above shows until they arrive). Again whenever the page
  // comes back into view and once a minute: phones keep a page open for days.
  // Custom themes (their pictures, positions, fonts, videos) and the brew button's videos too.
  let first = true;
  const follow = () => {
    readThemeSettings();
    if (first || PREVIEW) {
      first = false; // at page load the page loads these itself
      return;
    }
    loadCustomThemes();
    refreshBrewState();
  };
  follow();
  document.addEventListener(
    'visibilitychange',
    () => document.visibilityState === 'visible' && follow(),
  );
  setInterval(() => document.visibilityState === 'visible' && follow(), 60 * 1000);
}

// Simple function to handle theme change from select element
export function handleThemeChange(event) {
  const theme = event.target.value;
  setStoredTheme(theme);
}
