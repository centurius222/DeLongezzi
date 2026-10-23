import { customThemes } from './customThemes.js';
import { holidayModeSignal } from './holidays.js';

// The theme editor's live preview (Settings > Custom Themes, user 2026-10-01): the editor shows
// this page, at /?themepreview, in a frame. In that mode the page talks to nothing: no
// connection to the machine (ApiService feeds it sample readings instead), no saved choices
// (the menu state, the theme), no splash. The editor sends the theme being edited with
// postMessage({ type: 'gm-theme-preview', theme }); it is shown as the custom theme 'upreview'.
const previewParams = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
// Settings > Dashboard's live preview (user 2026-10-08), at /?dashpreview: the Brew dashboard with
// sample readings, no picture theme, redrawn when its layout settings change in Settings.
export const DASH_PREVIEW = !!previewParams?.has('dashpreview');
export const PREVIEW = !!previewParams?.has('themepreview') || DASH_PREVIEW;

export const PREVIEW_ID = 'upreview';

// Sample readings for the preview, in the machine's own status format (ApiService._onStatus).
export const SAMPLE_STATUS = {
  tp: 'evt:status',
  ct: 93.4,
  tt: 94,
  pr: 8.6,
  pt: 9,
  fl: 2.1,
  tf: 0,
  m: DASH_PREVIEW ? 1 : 5, // Brew for the dashboard preview, Manual for the theme editor
  mp: 9,
  mw: 36,
  tw: 36,
  cw: 18.4,
  bc: true,
  wl: 72,
  cp: true,
  process: null,
};

if (PREVIEW) {
  addEventListener('message', e => {
    if (e.origin !== location.origin || e.data?.type !== 'gm-theme-preview') return;
    customThemes.value = [{ ...e.data.theme, id: PREVIEW_ID }];
    holidayModeSignal.value = PREVIEW_ID; // not setHolidayMode: that is remembered in this browser
  });
  // the editor waits for this before sending the theme
  addEventListener('load', () =>
    parent.postMessage({ type: 'gm-theme-preview-ready' }, location.origin),
  );
}

// The dashboard preview follows Settings > Dashboard: same browser, so its layout settings
// arrive as localStorage changes (the 'storage' event fires in every other tab and frame).
if (DASH_PREVIEW) {
  addEventListener('storage', e => {
    if (e.key === null || e.key.startsWith('dashboard'))
      import('./dashboardManager.js').then(m => m.reloadDashboardSettings());
  });
}
