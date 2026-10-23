import { faFileExport } from '@fortawesome/free-solid-svg-icons/faFileExport';
import { resetBrewArt } from '../../utils/brewArt.js';
import { faFileImport } from '@fortawesome/free-solid-svg-icons/faFileImport';
import { faEllipsisVertical } from '@fortawesome/free-solid-svg-icons/faEllipsisVertical';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useCallback, useEffect, useRef, useState, useContext } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import {
  ApiServiceContext,
  machine,
  prefetchSettings,
  updateSettingsCache,
  getCachedSettings,
} from '../../services/ApiService.js';
import {
  DASHBOARD_LAYOUTS,
  setDashboardLayout,
  setClock24h,
} from '../../utils/dashboardManager.js';
import { getStoredTheme, handleThemeChange } from '../../utils/themeManager.js';

import PageLayout from '../../components/PageLayout.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import TabBar from '../../components/TabBar.jsx';

import lazy from 'preact-iso/lazy';

import { StickyFormFooter } from './StickyFormFooter.jsx';
import {
  GeneralTabSkeleton,
  MachineTabSkeleton,
  PluginsTabSkeleton,
  BluetoothTabSkeleton,
  SystemTabSkeleton,
} from '../../components/skeletons/SettingsSkeletons.jsx';
import { GeneralTab, WifiTab, flushThemeSave } from './tabs/GeneralTab.jsx';
import { DashboardTab } from './tabs/DashboardTab.jsx';

const LazyMachineTab = lazy(() => import('./tabs/MachineTab.jsx').then(m => m.MachineTab));
const LazyCalibrationTab = lazy(() =>
  import('./tabs/CalibrationTab.jsx').then(m => m.CalibrationTab),
);
const LazyPluginsTab = lazy(() => import('./tabs/PluginsTab.jsx').then(m => m.PluginsTab));
const LazyBluetoothTab = lazy(() => import('./tabs/BluetoothTab.jsx').then(m => m.BluetoothTab));
const LazySystemTab = lazy(() => import('./tabs/SystemTab.jsx').then(m => m.SystemTab));
const LazyDiagnosticsTab = lazy(() =>
  import('./tabs/DiagnosticsTab.jsx').then(m => m.DiagnosticsTab),
);

const loadMachineTab = () => import('./tabs/MachineTab.jsx');
const loadCalibrationTab = () => import('./tabs/CalibrationTab.jsx');
const loadPluginsTab = () => import('./tabs/PluginsTab.jsx');
const loadBluetoothTab = () => import('./tabs/BluetoothTab.jsx');
const loadSystemTab = () => import('./tabs/SystemTab.jsx');

// Icons
import { faSliders } from '@fortawesome/free-solid-svg-icons/faSliders';
import { faTemperatureHalf } from '@fortawesome/free-solid-svg-icons/faTemperatureHalf';
import { faCrosshairs } from '@fortawesome/free-solid-svg-icons/faCrosshairs';
import { faPuzzlePiece } from '@fortawesome/free-solid-svg-icons/faPuzzlePiece';
import { faBluetoothB } from '@fortawesome/free-brands-svg-icons/faBluetoothB';
import { faWifi } from '@fortawesome/free-solid-svg-icons/faWifi';
import { faTableColumns } from '@fortawesome/free-solid-svg-icons/faTableColumns';
import { faRotate } from '@fortawesome/free-solid-svg-icons/faRotate';
import { faHeartbeat } from '@fortawesome/free-solid-svg-icons/faHeartbeat';
import { pendingThemeSave } from '../../utils/customThemes.js';

function splitPidString(pidString) {
  if (!pidString) return { pid: pidString, kf: '0.000' };
  const parts = pidString.split(',');
  if (parts.length >= 4) {
    return { pid: parts.slice(0, 3).join(','), kf: parts[3] };
  }
  return { pid: pidString, kf: '0.000' };
}

function splitButtons(buttonBehavior) {
  if (!buttonBehavior) return {};
  const [button0, button1, button2] = buttonBehavior.split(',');
  return { button0, button1, button2 };
}

function parseAutoWakeupSchedules(autowakeupSchedules) {
  const defaultSchedule = [{ time: '07:00', days: [true, true, true, true, true, true, true] }];
  if (!autowakeupSchedules) {
    return defaultSchedule;
  }
  const schedules = [];
  if (typeof autowakeupSchedules === 'string' && autowakeupSchedules.trim()) {
    const scheduleStrings = autowakeupSchedules.split(';');
    for (const scheduleStr of scheduleStrings) {
      const [time, daysStr] = scheduleStr.split('|');
      if (time && daysStr && daysStr.length === 7) {
        const days = daysStr.split('').map(d => d === '1');
        schedules.push({ time, days });
      }
    }
  }
  return schedules.length > 0 ? schedules : defaultSchedule;
}

// The theme is saved the moment it is picked (Settings > General theme menu, picture theme and
// colors through saveThemeSoon; the menu's theme button). Save Settings leaves these alone: its
// copy from when the page opened put an older theme back, chosen since on another tab or device
// (2026-10-21, build 963, review 3.6). Not an unsaved change either.
const SAVED_WHEN_PICKED = ['webTheme', 'holidayMode', 'themeBg', 'themeAccent', 'themeText'];

// Order- and type-insensitive picture of the form (inputs give strings, the
// machine returns numbers), for the "Unsaved changes" note in the footer.
function settingsSnapshot(formData, schedules) {
  const fields = Object.keys(formData)
    .filter(k => !SAVED_WHEN_PICKED.includes(k))
    .sort()
    .map(k => {
      const v = formData[k];
      return [k, v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)];
    });
  return JSON.stringify([fields, schedules]);
}

// The same picture with one field replaced: a value another tool already
// stored on the machine (pump flow calibration) is not an unsaved change.
function patchSnapshot(snapshot, key, value) {
  const [fields, schedules] = JSON.parse(snapshot);
  const v = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const rest = fields.filter(([k]) => k !== key);
  rest.push([key, v]);
  rest.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([rest, schedules]);
}

function transformFetchedSettings(fetchedSettings) {
  if (!fetchedSettings) return {};
  const buttonFields = fetchedSettings.buttonBehavior
    ? splitButtons(fetchedSettings.buttonBehavior)
    : {};
  const settingsWithToggle = {
    ...fetchedSettings,
    ...buttonFields,
    standbyDisplayEnabled:
      fetchedSettings.standbyDisplayEnabled !== undefined
        ? fetchedSettings.standbyDisplayEnabled
        : fetchedSettings.standbyBrightness > 0,
    dashboardLayout: fetchedSettings.dashboardLayout || DASHBOARD_LAYOUTS.ORDER_FIRST,
  };

  if (fetchedSettings.pid) {
    const split = splitPidString(fetchedSettings.pid);
    settingsWithToggle.pid = split.pid;
    settingsWithToggle.kf = split.kf;
  }
  return settingsWithToggle;
}

function buildSubmitFormData(formData, autowakeupSchedules, restart) {
  const formDataToSubmit = new FormData();
  const checkboxKeys = [
    'homekit',
    'boilerFillActive',
    'smartGrindActive',
    'homeAssistant',
    'momentaryButtons',
    'delayAdjust',
    'clock24hFormat',
    'autowakeupEnabled',
    'smartGrindToggle',
  ];

  for (const [key, value] of Object.entries(formData)) {
    if (value === undefined || value === null) continue;
    // saved the moment they are picked (Settings > Brew Button Videos): a page opened earlier
    // would otherwise save its old choice over a newer one
    if (
      key === 'brewVideo' ||
      key === 'brewVideoMode' ||
      key === 'keepTheme' ||
      key === 'hasDisplay' ||
      key === 'saveManualShots' || // saved the moment it's flipped (also on the Shot History page)
      key === 'lastGrinder' || // set from Shot Notes' grinder dropdown
      key === 'lastBasket' || // set from Shot Notes' basket pop-up
      key === 'heatUpCheck' || // saved the moment it's flipped (Settings > Machine)
      key === 'btStandby' || // saved the moment it's flipped (Settings > Bluetooth)
      key === 'heatUpTrip' || // read only: the last trip
      key === 'ip' || // read only: the machine's addresses (Wi-Fi tab)
      key === 'lastIp' ||
      SAVED_WHEN_PICKED.includes(key) // the theme: saved when picked (see SAVED_WHEN_PICKED)
    )
      continue;

    if (checkboxKeys.includes(key)) {
      // Every switch goes as 1 or 0. The machine leaves a switch that is missing
      // from a save alone, so a partial save (pump calibration) can't turn it off.
      formDataToSubmit.set(key, value ? '1' : '0');
    } else {
      formDataToSubmit.set(key, String(value));
    }
  }

  formDataToSubmit.set('steamPumpPercentage', String(formData.steamPumpPercentage ?? 0));
  formDataToSubmit.set(
    'altRelayFunction',
    formData.altRelayFunction !== undefined ? String(formData.altRelayFunction) : '1',
  );
  formDataToSubmit.set(
    'buttonBehavior',
    `${formData.button0},${formData.button1},${formData.button2}`,
  );

  if (formData.pid && formData.kf !== undefined) {
    const combinedPid = `${formData.pid},${formData.kf}`;
    formDataToSubmit.set('pid', combinedPid);
  }

  const schedulesStr = autowakeupSchedules
    .map(schedule => `${schedule.time}|${schedule.days.map(d => (d ? '1' : '0')).join('')}`)
    .join(';');
  formDataToSubmit.set('autowakeupSchedules', schedulesStr);

  if (!formData.standbyDisplayEnabled) {
    formDataToSubmit.set('standbyBrightness', '0');
  }

  if (restart) {
    formDataToSubmit.append('restart', '1');
  }

  return formDataToSubmit;
}

export function Settings() {
  const apiService = useContext(ApiServiceContext);
  const { params } = useRoute();
  const tab = params.tab || 'general';
  const isFormTab = ['general', 'machine', 'plugins', 'wifi'].includes(tab);

  const [profiles, setProfiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({});
  // What was last loaded or saved, to tell the user about unsaved changes.
  const [saved, setSaved] = useState(null);
  // Result of the last save, for the footer: 'saved', 'restarting', 'failed' or 'unnamed' (a
  // custom theme being made has no name: nothing saved).
  const [saveStatus, setSaveStatus] = useState(null);
  useEffect(() => {
    if (saveStatus !== 'saved' && saveStatus !== 'restarting') return undefined;
    const timer = setTimeout(() => setSaveStatus(null), saveStatus === 'saved' ? 4000 : 20000);
    return () => clearTimeout(timer);
  }, [saveStatus]);
  const [currentTheme, setCurrentTheme] = useState('light');
  const [showWifiPassword, setShowWifiPassword] = useState(false);
  const [showApPassword, setShowApPassword] = useState(false);
  const [autowakeupSchedules, setAutoWakeupSchedules] = useState([
    { time: '07:00', days: [true, true, true, true, true, true, true] },
  ]);

  const [fetchedSettings, setFetchedSettings] = useState(() => getCachedSettings());
  const [isLoading, setIsLoading] = useState(!fetchedSettings);
  const [loadError, setLoadError] = useState(false);

  // Load until it works. A failed load used to show EMPTY tabs with Save
  // enabled, and saving them wrote defaults (steam pump 0, button setup
  // "undefined", every switch off). Now the tabs wait, retrying every 3 s.
  useEffect(() => {
    if (fetchedSettings) return undefined;
    let cancelled = false;
    let timer;
    const load = () => {
      prefetchSettings()
        .then(data => {
          if (cancelled) return;
          setLoadError(false);
          setFetchedSettings(data);
          setIsLoading(false);
        })
        .catch(err => {
          if (cancelled) return;
          console.error('Failed to prefetch settings:', err);
          setLoadError(true);
          timer = setTimeout(load, 3000);
        });
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fetchedSettings]);

  useEffect(() => {
    const loadProfiles = async () => {
      if (machine.value.connected) {
        const response = await apiService.request({ tp: 'req:profiles:list', minimal: true });
        setProfiles(response.profiles);
      }
    };
    loadProfiles();
  }, [machine.value.connected, apiService]);

  const formRef = useRef();
  const dropdownRef = useRef(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    if (!dropdownOpen) return;

    const handleOutsideClick = event => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [dropdownOpen]);

  useEffect(() => {
    if (fetchedSettings) {
      const settingsWithToggle = transformFetchedSettings(fetchedSettings);
      const parsedSchedules = parseAutoWakeupSchedules(fetchedSettings.autowakeupSchedules);
      setAutoWakeupSchedules(parsedSchedules);
      setClock24h(!!fetchedSettings.clock24hFormat);
      setCurrentTheme(getStoredTheme()); // may just have followed the machine's theme
      setFormData(settingsWithToggle);
      setSaved(settingsSnapshot(settingsWithToggle, parsedSchedules));
    } else {
      setFormData({});
      setSaved(null);
      setAutoWakeupSchedules([{ time: '07:00', days: [true, true, true, true, true, true, true] }]);
    }
  }, [fetchedSettings]);

  useEffect(() => {
    setCurrentTheme(getStoredTheme());
  }, []);

  const onChange = key => {
    return e => {
      let value = e.currentTarget.value;
      if (
        [
          'homekit',
          'boilerFillActive',
          'smartGrindActive',
          'smartGrindToggle',
          'homeAssistant',
          'momentaryButtons',
          'delayAdjust',
          'clock24hFormat',
          'autowakeupEnabled',
          'saveManualShots',
        ].includes(key)
      ) {
        value = !formData[key];
      }
      if (key === 'clock24hFormat') {
        setClock24h(value);
      }
      if (key === 'standbyDisplayEnabled') {
        value = !formData.standbyDisplayEnabled;
        const newFormData = {
          ...formData,
          [key]: value,
        };
        if (!value) {
          newFormData.standbyBrightness = 0;
        }
        setFormData(newFormData);
        return;
      }
      if (key === 'dashboardLayout') {
        setDashboardLayout(value);
      }
      setFormData({
        ...formData,
        [key]: value,
      });
    };
  };

  const setField = useCallback((key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  }, []);

  // A value another tool already stored on the machine: take it into the form,
  // the saved picture and the settings cache. Without this, the next Save
  // Settings sent the old pump calibration back.
  const onFieldStored = useCallback((key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    setSaved(prev => (prev === null ? prev : patchSnapshot(prev, key, value)));
    const cached = getCachedSettings();
    if (cached) updateSettingsCache({ ...cached, [key]: value });
  }, []);

  // The machine learns the brew/grind delay after shots and gets new PID values from
  // autotune; take them in when it says settings changed, or the next Save would send
  // this page's older copy back (audit S7-M2).
  useEffect(() => {
    const id = apiService.on('evt:changed', ({ what = [] }) => {
      if (!what.includes('settings')) return;
      fetch('/api/settings', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
          if (!d) return;
          const fresh = transformFetchedSettings(d);
          for (const key of ['pid', 'kf', 'brewDelay', 'grindDelay']) {
            if (fresh[key] === undefined) continue;
            setFormData(prev => ({ ...prev, [key]: fresh[key] }));
            setSaved(prev => (prev === null ? prev : patchSnapshot(prev, key, fresh[key])));
          }
        })
        .catch(() => {});
    });
    return () => apiService.off('evt:changed', id);
  }, [apiService]);

  const addAutoWakeupSchedule = () => {
    setAutoWakeupSchedules([
      ...autowakeupSchedules,
      {
        time: '07:00',
        days: [true, true, true, true, true, true, true],
      },
    ]);
  };

  const removeAutoWakeupSchedule = index => {
    if (autowakeupSchedules.length > 1) {
      const newSchedules = autowakeupSchedules.filter((_, i) => i !== index);
      setAutoWakeupSchedules(newSchedules);
    }
  };

  const updateAutoWakeupTime = (index, value) => {
    const newSchedules = [...autowakeupSchedules];
    newSchedules[index].time = value;
    setAutoWakeupSchedules(newSchedules);
  };

  const updateAutoWakeupDay = (scheduleIndex, dayIndex, enabled) => {
    const newSchedules = [...autowakeupSchedules];
    newSchedules[scheduleIndex].days[dayIndex] = enabled;
    setAutoWakeupSchedules(newSchedules);
  };

  const onSubmit = useCallback(
    async (e, restart = false) => {
      if (e) e.preventDefault();
      // Never save a form that didn't load: it would write defaults.
      if (!fetchedSettings) return;
      setSubmitting(true);
      setSaveStatus(null);
      // A custom theme open in Settings > Custom Themes is saved with the rest.
      // An unnamed one stops the save (the editor shows why): nothing is saved, not half.
      if (pendingThemeSave.current && (await pendingThemeSave.current()) === false) {
        setSaveStatus('unnamed');
        setSubmitting(false);
        return;
      }
      // A theme color still waiting for its half-second save goes first, so this save's reply
      // already holds it (build 963)
      await flushThemeSave();
      const form = formRef.current;
      const formDataToSubmit = buildSubmitFormData(formData, autowakeupSchedules, restart);

      try {
        const response = await fetch(form.action, {
          method: 'post',
          body: formDataToSubmit,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        // restarting: the machine restarts itself (new Wi-Fi saved on its hotspot)
        const { restarting, ...data } = await response.json();

        const splitPid = data.pid ? splitPidString(data.pid) : null;
        const buttonFields = data.buttonBehavior ? splitButtons(data.buttonBehavior) : {};

        const updatedData = {
          ...data,
          ...(splitPid !== null ? { pid: splitPid.pid, kf: splitPid.kf } : {}),
          ...buttonFields,
          standbyDisplayEnabled:
            data.standbyBrightness > 0 ? formData.standbyDisplayEnabled : false,
        };

        updateSettingsCache(data);
        setFormData(updatedData);
        setSaved(settingsSnapshot(updatedData, autowakeupSchedules));
        resetBrewArt(); // the dashboard's brew button reloads its number style
        setSaveStatus(restart || restarting ? 'restarting' : 'saved');
      } catch (error) {
        console.error('Failed to save settings:', error);
        setSaveStatus('failed');
      } finally {
        setSubmitting(false);
      }
    },
    [formData, autowakeupSchedules, fetchedSettings],
  );

  // The machine writes the file: every setting it keeps, not only this page's.
  const onExport = useCallback(() => {
    const link = document.createElement('a');
    link.href = '/api/settings-export';
    link.download = '';
    link.click();
  }, []);

  // Result of the last import, shown above the tabs: 'imported' or 'failed'.
  const [importStatus, setImportStatus] = useState(null);
  const onUpload = function (evt) {
    if (evt.target.files.length) {
      const file = evt.target.files[0];
      const reader = new FileReader();
      reader.onload = async e => {
        let data;
        try {
          data = JSON.parse(e.target.result);
        } catch {
          setImportStatus('failed');
          return;
        }
        if (data?.format !== 'delongezzi-settings') {
          // An older export (the Settings page fields only): load it into the
          // form, applied when you press Save.
          setFormData(data);
          return;
        }
        // A settings file: the machine applies every setting in it and restarts.
        try {
          const response = await fetch('/api/settings-import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          setImportStatus('imported');
          setTimeout(() => window.location.reload(), 8000);
        } catch (err) {
          console.error('Failed to import settings:', err);
          setImportStatus('failed');
        }
      };
      reader.readAsText(file);
      evt.target.value = ''; // the same file can be picked again
    }
  };

  const settingsTabs = [
    { id: 'general', label: 'General', icon: faSliders },
    { id: 'dashboard', label: 'Dashboard', icon: faTableColumns },
    { id: 'machine', label: 'Machine', icon: faTemperatureHalf, preload: loadMachineTab },
    { id: 'calibration', label: 'Calibration', icon: faCrosshairs, preload: loadCalibrationTab },
    { id: 'plugins', label: 'Plugins', icon: faPuzzlePiece, preload: loadPluginsTab },
    { id: 'bluetooth', label: 'Bluetooth', icon: faBluetoothB, preload: loadBluetoothTab },
    { id: 'wifi', label: 'Wi-Fi', icon: faWifi },
    { id: 'system', label: 'System', icon: faRotate, preload: loadSystemTab },
    { id: 'diagnostics', label: 'Diagnostics', icon: faHeartbeat },
  ];

  return (
    <PageLayout>
      <PageHeader
        title='Settings'
        noStack={true}
        tabs={<TabBar tabs={settingsTabs} activeTab={tab} basePath='/settings' />}
        actions={
          <div
            className={`action-dropdown relative ${dropdownOpen ? 'action-dropdown-open' : ''}`}
            ref={dropdownRef}
          >
            <button
              onClick={() => setDropdownOpen(open => !open)}
              className='btn btn-ghost btn-circle text-base-content/85 hover:bg-base-content/10'
              aria-label='More options'
              aria-expanded={dropdownOpen}
            >
              <FontAwesomeIcon icon={faEllipsisVertical} size='lg' />
            </button>
            <ul className='menu action-dropdown-menu bg-base-100 rounded-box border-base-content/10 right-0 z-50 mt-1 w-52 border p-2 shadow-lg'>
              <li>
                <button
                  type='button'
                  onClick={() => {
                    onExport();
                    setDropdownOpen(false);
                  }}
                  className='justify-start gap-2 font-medium'
                  aria-label='Export settings'
                >
                  <FontAwesomeIcon icon={faFileExport} />
                  <span>Export Settings</span>
                </button>
              </li>
              <li>
                <button
                  type='button'
                  onClick={() => {
                    document.getElementById('settingsImport')?.click();
                    setDropdownOpen(false);
                  }}
                  className='justify-start gap-2 font-medium'
                  aria-label='Import settings'
                >
                  <FontAwesomeIcon icon={faFileImport} />
                  <span>Import Settings</span>
                </button>
              </li>
            </ul>
            <input
              onChange={onUpload}
              className='hidden'
              id='settingsImport'
              type='file'
              accept='.json,application/json'
            />
          </div>
        }
      />

      {importStatus === 'imported' && (
        <div role='status' className='alert alert-success mb-4 text-sm'>
          Settings imported. The machine is restarting, and this page reloads in a few seconds.
        </div>
      )}
      {importStatus === 'failed' && (
        <div role='alert' className='alert alert-error mb-4 text-sm'>
          Import failed: not a DeLongezzi settings file, or the machine didn&apos;t answer.
        </div>
      )}
      {loadError && !fetchedSettings && (
        <div role='alert' className='alert alert-error mb-4 text-sm'>
          Couldn&apos;t load the settings from the machine. Trying again every few seconds.
        </div>
      )}
      <form
        key='settings'
        ref={formRef}
        method='post'
        action='/api/settings'
        onSubmit={onSubmit}
        className={isFormTab ? '' : 'hidden'}
      >
        {tab === 'general' &&
          (isLoading ? (
            <GeneralTabSkeleton />
          ) : (
            <GeneralTab
              formData={formData}
              onChange={onChange}
              setField={setField}
              profiles={profiles}
              currentTheme={currentTheme}
              setCurrentTheme={setCurrentTheme}
              handleThemeChange={handleThemeChange}
            />
          ))}
        {tab === 'wifi' &&
          (isLoading ? (
            <GeneralTabSkeleton />
          ) : (
            <WifiTab
              formData={formData}
              onChange={onChange}
              showWifiPassword={showWifiPassword}
              setShowWifiPassword={setShowWifiPassword}
              showApPassword={showApPassword}
              setShowApPassword={setShowApPassword}
            />
          ))}
        {tab === 'machine' &&
          (isLoading ? (
            <MachineTabSkeleton />
          ) : (
            <LazyMachineTab formData={formData} onChange={onChange} setField={setField} />
          ))}
        {tab === 'plugins' &&
          (isLoading ? (
            <PluginsTabSkeleton />
          ) : (
            <LazyPluginsTab
              formData={formData}
              onChange={onChange}
              autowakeupSchedules={autowakeupSchedules}
              addAutoWakeupSchedule={addAutoWakeupSchedule}
              removeAutoWakeupSchedule={removeAutoWakeupSchedule}
              updateAutoWakeupTime={updateAutoWakeupTime}
              updateAutoWakeupDay={updateAutoWakeupDay}
            />
          ))}

        {isFormTab && (
          <StickyFormFooter
            submitting={submitting}
            disabled={!fetchedSettings}
            status={saveStatus}
            onRestart={e => {
              // Same browser checks as Save Settings (like the hotspot password
              // length): this click handler sends the form itself and skipped them.
              if (!formRef.current?.reportValidity()) {
                e.preventDefault();
                return;
              }
              onSubmit(e, true);
            }}
            dirty={saved !== null && settingsSnapshot(formData, autowakeupSchedules) !== saved}
          />
        )}
      </form>

      {tab === 'calibration' && (
        <LazyCalibrationTab formData={formData} onChange={onChange} onFieldStored={onFieldStored} />
      )}
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'bluetooth' && (isLoading ? <BluetoothTabSkeleton /> : <LazyBluetoothTab />)}
      {tab === 'system' && (isLoading ? <SystemTabSkeleton /> : <LazySystemTab />)}
      {tab === 'diagnostics' && <LazyDiagnosticsTab formData={formData} setField={setField} />}
    </PageLayout>
  );
}
