import './style.css';
import { initializeTheme, onMachineChanged } from './utils/themeManager.js';

if (import.meta.env.DEV) {
  // Dev-only Preact warnings; stripped from production builds.
  import('preact/debug');
}

import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { LocationProvider, Router, Route, ErrorBoundary, useLocation } from 'preact-iso';
import lazy from 'preact-iso/lazy';

import ApiService, { ApiServiceContext, invalidateSettingsCache, machine } from './services/ApiService.js';
import { Navigation } from './components/Navigation.jsx';
import { CustomThemeStyles, Decor, HolidayClock, HolidayStyles } from './components/Holiday.jsx';
import { FullscreenButton } from './components/FullscreenButton.jsx';
import { ThemePicker } from './components/ThemePicker.jsx';
import { PREVIEW } from './utils/themePreview.js';
import { guardTheme, setHolidayMode, setKeepTheme, setThemeLink } from './utils/holidays.js';
import { setNoteLink } from './utils/pageLog.js';
import { Spinner } from './components/Spinner.jsx';
import { Splash } from './components/Splash.jsx';
import { isSplashEnabled } from './utils/splashManager.js';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars } from '@fortawesome/free-solid-svg-icons/faBars';

// Each page lazy-loads as its own Vite chunk so the initial bundle stays small.
// Chart.js, FontAwesome icon sets, and the analyzer/statistics views are too
// large to ship up-front on the ESP32's slow WiFi pipe.
const Home = lazy(() => import('./pages/Home/index.jsx').then(m => m.Home));
const NotFound = lazy(() => import('./pages/_404.jsx').then(m => m.NotFound));
const Settings = lazy(() => import('./pages/Settings/index.jsx').then(m => m.Settings));
const ProfileList = lazy(() => import('./pages/ProfileList/index.jsx').then(m => m.ProfileList));
const ProfileEdit = lazy(() => import('./pages/ProfileEdit/index.jsx').then(m => m.ProfileEdit));
const ShotHistory = lazy(() => import('./pages/ShotHistory/index.jsx').then(m => m.ShotHistory));
const ShotAnalyzer = lazy(() => import('./pages/ShotAnalyzer/index.jsx').then(m => m.ShotAnalyzer));
const StatisticsPage = lazy(() =>
  import('./pages/Statistics/index.jsx').then(m => m.StatisticsPage),
);
const DashboardSettings = lazy(() =>
  import('./pages/DashboardSettings/index.jsx').then(m => m.DashboardSettings),
);

const apiService = new ApiService();

// The machine stopped and stays stopped until it is restarted (Controller::onError latches the
// error); without this the brew button just did nothing (user 2026-10-17). Error 4: the heater was
// stopped for safety. Any other: a rare link error between the two halves.
function SafetyNote() {
  const err = machine.value.status?.machineError || 0;
  if (!err) return null;
  if (err === 4)
    return (
      <a href='/settings/machine' className='alert alert-error mb-3 font-semibold'>
        Heater stopped for safety (heat-up check, overheat or temperature sensor fault). See Settings ›
        Machine. Restart the machine to clear it.
      </a>
    );
  return (
    <div className='alert alert-error mb-3 font-semibold'>Machine error {err}. Restart the machine to clear it.</div>
  );
}
// another device (or this one) changed settings, custom themes or videos: follow at once
setThemeLink(apiService);
setNoteLink(apiService);
apiService.on('evt:changed', msg => {
  const { what = [] } = msg;
  // a theme change on any device: the value is in the message, nothing to read back (2026-10-16)
  if (what.includes('theme')) {
    guardTheme();
    if (typeof msg.holidayMode === 'string') setHolidayMode(msg.holidayMode);
    if (typeof msg.keepTheme === 'boolean') setKeepTheme(msg.keepTheme);
    invalidateSettingsCache();
  }
  if (what.includes('settings')) invalidateSettingsCache();
  onMachineChanged(what);
});
// No right-click / long-press menu on the dashboard screen (user 2026-10-07): nothing there to
// copy or save. Other screens (Settings, Shot History ...) keep it, and so do text boxes.
document.addEventListener('contextmenu', e => {
  if (!document.querySelector("[data-slot='home'], [data-slot='manual']")) return;
  if (e.target.closest?.('input, textarea')) return;
  e.preventDefault();
});
const DESKTOP_NAV_COLLAPSED_STORAGE_KEY = 'gaggimate.desktopNavCollapsed';

function readInitialDesktopNavCollapsed() {
  const storage = globalThis.window?.localStorage;
  if (!storage) return true;

  try {
    return storage.getItem(DESKTOP_NAV_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return true;
  }
}

const RedirectTo = to =>
  function Redirect() {
    const loc = useLocation();
    useEffect(() => {
      loc.route(to, true);
    }, [loc]);
    return null;
  };

function RouteFallback() {
  return (
    <div className='flex w-full flex-row items-center justify-center py-16'>
      <Spinner size={8} />
    </div>
  );
}

export function App() {
  const [navCollapsed, setNavCollapsed] = useState(
    () => !PREVIEW && readInitialDesktopNavCollapsed(),
  );
  const [showSplash, setShowSplash] = useState(() => !PREVIEW && isSplashEnabled());

  useEffect(() => {
    const storage = globalThis.window?.localStorage;
    if (!storage || PREVIEW) return;

    try {
      storage.setItem(DESKTOP_NAV_COLLAPSED_STORAGE_KEY, String(navCollapsed));
    } catch {
      // Ignore storage write failures so the navigation still works in restricted browsers.
    }
  }, [navCollapsed]);

  useEffect(() => {
    const handleOpenNav = () => setNavCollapsed(false);
    window.addEventListener('open-mobile-nav', handleOpenNav);
    return () => window.removeEventListener('open-mobile-nav', handleOpenNav);
  }, []);

  return (
    <LocationProvider>
      <ApiServiceContext.Provider value={apiService}>
        {showSplash && <Splash onDismiss={() => setShowSplash(false)} />}
        <HolidayStyles />
        <CustomThemeStyles />
        <div data-slot='page' className='bg-base-300 flex h-screen overflow-hidden'>
          <Navigation
            collapsed={navCollapsed}
            onToggleCollapsed={() => setNavCollapsed(collapsed => !collapsed)}
          />
          {/* The menu-edge stripe waits for the splash to close; over the splash it
              would be a stray line across the picture. */}
          {!showSplash && <Decor pieces={['divider']} />}
          <div className='flex flex-1 flex-col overflow-x-hidden overflow-y-auto'>
            <div data-slot='content' className='flex min-h-0 w-full flex-1 flex-col p-4'>
              <SafetyNote />
              <div className='grid min-h-0 flex-1 grid-cols-1'>
                <div className='min-h-0'>
                  <ErrorBoundary>
                    <Router>
                      <Route path='/' component={Home} />
                      <Route path='/dashboard-settings' component={DashboardSettings} />
                      <Route path='/profiles' component={ProfileList} />
                      <Route path='/profiles/:id' component={ProfileEdit} />
                      <Route path='/settings/:tab?' component={Settings} />
                      {/* Legacy routes now live in settings tabs */}
                      <Route path='/ota' component={RedirectTo('/settings/system')} />
                      <Route path='/scales' component={RedirectTo('/settings/bluetooth')} />
                      <Route path='/pidtune' component={RedirectTo('/settings/calibration')} />
                      <Route path='/history' component={ShotHistory} />
                      <Route path='/analyzer' component={ShotAnalyzer} />
                      <Route path='/statistics' component={StatisticsPage} />
                      <Route
                        path='/statistics/:sourceAlias/:profileName'
                        component={StatisticsPage}
                      />
                      <Route path='/analyzer/:source/:id' component={ShotAnalyzer} />{' '}
                      {/*deep-link route (sorce & ID)*/}
                      <Route default component={NotFound} />
                    </Router>
                  </ErrorBoundary>
                </div>
              </div>
            </div>
          </div>
          {navCollapsed && (
            <div className='fab end-auto left-4 md:hidden landscape:hidden'>
              <button
                className='btn btn-lg btn-circle btn-primary'
                onClick={() => setNavCollapsed(false)}
              >
                <FontAwesomeIcon icon={faBars} />
              </button>
            </div>
          )}
          <Decor pieces={['fall', 'frame', 'garland']} />
          <HolidayClock />
          {!PREVIEW && <FullscreenButton />}
          {!PREVIEW && <ThemePicker />}
        </div>
      </ApiServiceContext.Provider>
    </LocationProvider>
  );
}

// Must be called before render
initializeTheme();

// On the machine's hotspot (4.4.4.1) the page is for fixing Wi-Fi: open the Wi-Fi settings
// instead of the dashboard (user 2026-10-14), before the router reads the address.
if (window.location.hostname === '4.4.4.1' && window.location.pathname === '/') {
  window.history.replaceState(null, '', '/settings/wifi');
}

render(<App />, document.getElementById('app'));
