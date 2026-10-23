// Client-side (per-browser) preference for the logo splash screen, stored in
// localStorage like the theme and dashboard-layout preferences. Defaults to on.
const SPLASH_ENABLED_KEY = 'gaggimate.splashEnabled';

export function isSplashEnabled() {
  try {
    const stored = window.localStorage.getItem(SPLASH_ENABLED_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

export function setSplashEnabled(enabled) {
  try {
    window.localStorage.setItem(SPLASH_ENABLED_KEY, String(!!enabled));
  } catch {
    // Ignore storage write failures so the toggle still works in restricted browsers.
  }
}
