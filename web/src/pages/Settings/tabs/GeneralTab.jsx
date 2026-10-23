import { useEffect, useRef, useState } from 'preact/hooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEye } from '@fortawesome/free-solid-svg-icons/faEye';
import { faEyeSlash } from '@fortawesome/free-solid-svg-icons/faEyeSlash';
import { timezones } from '../../../config/zones.js';
import { isSplashEnabled, setSplashEnabled } from '../../../utils/splashManager.js';
import { resetBrewArt } from '../../../utils/brewArt.js';
import { BrewVideoLibrary } from '../../../components/BrewVideoLibrary.jsx';
import { BrewButtonPreview } from '../../Home/cards/ManualCard.jsx';
import {
  DEFAULT_CUSTOM_COLORS,
  colorThemeSignal,
  previewCustomColors,
  themeColorsSignal,
} from '../../../utils/themeManager.js';
import {
  HOLIDAYS,
  activeHoliday,
  holidayModeSignal,
  keepThemeSignal,
  holidayToday,
  holidayUntilText,
  saveKeepTheme,
  setHolidayMode,
  themePickLocked,
} from '../../../utils/holidays.js';
import { customStorage, customThemes } from '../../../utils/customThemes.js';
import { CustomThemesSection } from './CustomThemes.jsx';
import Section from '../../../components/Card.jsx';
import {
  InputGroupField,
  SettingsFormField,
  ToggleField,
} from '../../../components/SettingsFormField.jsx';

function ButtonBehaviorSelect({ id, label, value, onChange, profiles }) {
  return (
    <SettingsFormField label={label} htmlFor={id} noMargin>
      <select
        id={id}
        name={id}
        className='select select-bordered w-full'
        value={value}
        onChange={onChange}
      >
        <option value='none'>None</option>
        <option value='brew'>Brew button</option>
        <option value='steam'>Steam button</option>
        <option value='water'>Water button</option>
        <option value='flush'>Flush</option>
        {profiles.map(p => (
          <option key={p.id} value={p.id}>
            Profile: {p.label}
          </option>
        ))}
      </select>
    </SettingsFormField>
  );
}

// Setup Portal button (2026-10-14): asks the machine its real state (/api/portal) and sends
// on/off. It used to guess from the page's address and only flip a flag, so in the fallback
// hotspot "Return to Normal Network" switched the always-on portal ON. Older firmware without
// the state: the old guess from the address.
function SetupPortalButton() {
  const [mode, setMode] = useState(null); // normal | forced | fallback | setup
  const [status, setStatus] = useState('');
  useEffect(() => {
    fetch('/api/portal', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => d?.mode && setMode(d.mode))
      .catch(() => {});
  }, []);
  if (mode === 'setup') {
    return (
      <div className='alert alert-info text-sm'>
        No Wi-Fi saved yet: enter it above and save, and the machine restarts onto it.
      </div>
    );
  }
  const back = mode ? mode === 'forced' || mode === 'fallback' : window.location.hostname === '4.4.4.1';
  return (
    <>
      <div className='alert alert-warning text-sm'>
        {back
          ? 'Switches the machine back to your normal Wi-Fi network and reboots. This portal will disconnect.'
          : 'Switches the machine into its DeLongezzi Wi-Fi hotspot for direct access and reboots. It stays in portal mode across reboots until you switch back here. This page will disconnect.'}
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <button
          type='button'
          className='btn btn-warning btn-sm'
          onClick={() => {
            if (
              !confirm(
                back
                  ? 'Switch back to your normal Wi-Fi network and reboot? This portal will disconnect.'
                  : 'Switch into the GaggiMate setup portal and reboot? It stays in portal mode until you switch back, and this page will disconnect.',
              )
            )
              return;
            setStatus(
              back
                ? 'Rebooting back to your normal network...'
                : 'Rebooting into setup portal - join the "DeLongezzi" Wi-Fi (hotspot password: Access Point Password above).',
            );
            // Fire-and-forget: the device reboots and drops this connection, so no response arrives.
            fetch(`/api/portal?on=${back ? 0 : 1}`, { method: 'POST' }).catch(() => {});
          }}
        >
          {back ? 'Return to Normal Network' : 'Enter Setup Portal'}
        </button>
        <span className='text-sm'>{status}</span>
      </div>
    </>
  );
}

function PasswordField({ id, label, placeholder, value, onChange, shown, setShown, ...rest }) {
  return (
    <label className='input w-full'>
      {/* A text field drawn as dots, not type=password: Chrome took the machine's Wi-Fi
          password, filled in here, for a login and offered "Update password?" on the next page
          (user 2026-10-09, phone). Password managers leave text fields alone. */}
      <input
        id={id}
        name={id}
        type='text'
        autoComplete='off'
        autoCapitalize='off'
        autoCorrect='off'
        spellCheck={false}
        data-lpignore='true'
        data-1p-ignore='true'
        style={{ WebkitTextSecurity: shown ? 'none' : 'disc' }}
        placeholder={placeholder ?? label}
        value={value}
        onChange={onChange}
        {...rest}
      />
      <button
        type='button'
        className='hover:text-primary cursor-pointer focus:outline-none'
        aria-label='Show Password'
        onClick={() => setShown(!shown)}
      >
        <FontAwesomeIcon icon={shown ? faEyeSlash : faEye} />
      </button>
    </label>
  );
}

// The browser shrinks the picture before it goes to the machine: longest side
// 1024 px, WebP (JPEG where the browser cannot encode WebP). Some pictures
// encode larger than the source at quality 0.85, so the quality steps down
// (then the side) until the result fits under the machine's 100 KB cap.
async function shrinkImage(file, maxSide = 1024) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const encode = (side, quality) =>
      new Promise(resolve => {
        const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(resolve, 'image/webp', quality);
      });
    for (const side of [maxSide, Math.round(maxSide * 0.75), Math.round(maxSide * 0.5), Math.round(maxSide * 0.35)]) {
      for (const quality of [0.85, 0.7, 0.55, 0.4, 0.3]) {
        const blob = await encode(side, quality);
        if (blob && blob.size <= ANIMATED_MAX_BYTES) return blob;
      }
    }
    // Nothing small enough; hand the smallest one to the machine, which will
    // say why it refused.
    return await encode(Math.round(maxSide * 0.35), 0.3);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Animated WebP has an ANIM chunk and animated PNG an acTL chunk near the
// start; a GIF with more than one frame has more than one graphic control
// block. Those go up untouched, since shrinking would keep one frame.
const ANIMATED_MAX_BYTES = 100 * 1024;
async function isAnimated(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 64 * 1024));
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return head.includes('ANIM');
  if (bytes[0] === 0x89 && head.slice(1, 4) === 'PNG') return head.includes('acTL');
  if (head.startsWith('GIF8')) {
    let frames = 0;
    for (let i = 0; i + 2 < bytes.length && frames < 2; i++) {
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) frames++;
    }
    return frames > 1;
  }
  return false;
}

// First frame of a video as a still (the brew button's idle look).
async function videoFirstFrame(file, maxSide) {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    await new Promise((resolve, reject) => {
      v.onloadeddata = resolve;
      v.onerror = reject;
    });
    v.currentTime = 0;
    await new Promise(resolve => {
      v.onseeked = resolve;
      setTimeout(resolve, 500); // already at 0: no seeked event
    });
    const scale = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
    const encode = type => new Promise(resolve => canvas.toBlob(resolve, type, 0.85));
    const webp = await encode('image/webp');
    return webp && webp.type === 'image/webp' ? webp : await encode('image/jpeg');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// POSTs a form and reports how much of it has gone up (0-100), which fetch can't.
function postWithProgress(url, form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = e =>
      e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.send(form);
  });
}

// A custom picture stored on the machine so every browser shows it: the splash
// and the sidebar logo (user 2026-09-24). No preview: it shows the next time
// the page loads. Still pictures are shrunk to maxSide, animated ones go as is.
// stillEndpoint (brew button): also saves the first frame, for the idle look.
function ImagePicker({
  endpoint,
  resetEndpoint,
  maxSide,
  chooseLabel,
  stillEndpoint,
  stillResetEndpoint,
  accept = 'image/*',
  onChanged,
  preview,
  previewFallback,
}) {
  const [status, setStatus] = useState('');
  // the picture in use now, shown small; a new version after each upload or reset
  const [version, setVersion] = useState(0);
  const [previewSrc, setPreviewSrc] = useState(preview);
  const bump = () => {
    setPreviewSrc(preview);
    setVersion(v => v + 1);
  };
  const [progress, setProgress] = useState(null); // 0-100 while uploading
  const inputRef = useRef(null);

  const upload = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setStatus('Uploading…');
    try {
      // A video (MP4/WebM) goes up as is, like an animated picture.
      const video = file.type.startsWith('video/');
      const animated = video || (await isAnimated(file));
      if (animated && file.size > ANIMATED_MAX_BYTES) {
        setStatus(`${video ? 'Videos' : 'Animated pictures'} can be up to 100 KB.`);
        return;
      }
      const blob = animated ? file : await shrinkImage(file, maxSide);
      if (blob.size > ANIMATED_MAX_BYTES) {
        setStatus('Max 100 KB per picture — this one is larger, pick a smaller image.');
        return;
      }
      const form = new FormData();
      form.append('file', blob, 'picture');
      setProgress(0);
      let r = await postWithProgress(endpoint, form, setProgress);
      const uploadError = r.ok ? null : r.body?.error || 'unknown reason';
      if (r.ok && stillEndpoint) {
        // drawImage of an animated picture draws its first frame (HTML spec).
        const still = new FormData();
        still.append(
          'file',
          video ? await videoFirstFrame(file, maxSide) : await shrinkImage(file, maxSide),
          'still',
        );
        r = await fetch(stillEndpoint, { method: 'POST', body: still });
      }
      if (r.ok) {
        onChanged?.();
        bump();
      }
      setStatus(
        r.ok
          ? `Saved${video ? ' (video)' : animated ? ' (animated, uploaded as is)' : ''}. It shows the next time the page loads.`
          : `Upload failed: ${uploadError}.`,
      );
    } catch {
      setStatus('That file could not be read as a picture.');
    } finally {
      setProgress(null);
    }
  };

  const reset = async () => {
    const r = await fetch(resetEndpoint, { method: 'POST' });
    const r2 = stillResetEndpoint ? await fetch(stillResetEndpoint, { method: 'POST' }) : r;
    if (r.ok && r2.ok) {
      onChanged?.();
      bump();
    }
    setStatus(r.ok && r2.ok ? 'Back to the original picture.' : 'Reset failed.');
  };

  return (
    <div className='mt-3 flex flex-wrap items-center gap-3'>
      {preview && (
        <div className='bg-base-300 flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg'>
          {previewSrc ? (
            <img
              src={`${previewSrc}${previewSrc.includes('?') ? '&' : '?'}v=${version}`}
              alt=''
              className='h-full w-full object-contain'
              onError={() => setPreviewSrc(previewSrc !== previewFallback ? previewFallback : null)}
            />
          ) : (
            <span className='text-base-content/50 text-xs'>none</span>
          )}
        </div>
      )}
      <input ref={inputRef} type='file' accept={accept} className='hidden' onChange={upload} />
      <button
        type='button'
        className='btn btn-primary btn-sm'
        disabled={progress !== null}
        onClick={() => inputRef.current?.click()}
      >
        {progress !== null ? (
          <>
            <span className='loading loading-spinner loading-xs' aria-hidden='true' /> {progress}%
          </>
        ) : (
          chooseLabel
        )}
      </button>
      <button type='button' className='btn btn-sm btn-ghost' onClick={reset}>
        Back to original
      </button>
      <span className='text-base-content/40 text-xs'>100 KB max</span>
      {progress !== null && (
        <progress
          className='progress progress-primary w-32'
          value={progress}
          max='100'
          aria-label='Upload progress'
        />
      )}
      {status && (
        <span className='text-base-content/60 text-sm'>
          {progress !== null ? `Uploading ${progress}%` : status}
        </span>
      )}
    </div>
  );
}

// The theme and its custom colours go to the machine as they change (half a second after the
// last move of a colour picker), not only with Save: every open page re-reads the machine's
// theme each minute and on any change, and put back the saved one over an unsaved pick
// (user 2026-10-07: Custom snapped back to Dark while the colours were being picked).
const themeFields = {};
let themeTimer = null;
let lastThemeEdit = 0; // a change made here: the machine's echo of an older one must not undo it
function saveThemeSoon(fields, delay = 500) {
  lastThemeEdit = Date.now();
  Object.assign(themeFields, fields);
  clearTimeout(themeTimer);
  themeTimer = setTimeout(() => {
    const body = new URLSearchParams(themeFields).toString();
    for (const k of Object.keys(themeFields)) delete themeFields[k];
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }).catch(() => {});
  }, delay);
}
// Sends a theme change that is still waiting at once. Save Settings no longer sends the theme
// (index.jsx SAVED_WHEN_PICKED), so it calls this first: a color picked a moment before Save
// would otherwise arrive after it, and the reply would show the old color (build 963).
export function flushThemeSave() {
  if (!Object.keys(themeFields).length) return Promise.resolve();
  clearTimeout(themeTimer);
  const body = new URLSearchParams(themeFields).toString();
  for (const k of Object.keys(themeFields)) delete themeFields[k];
  return fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }).catch(() => {});
}

export function GeneralTab({
  formData,
  onChange,
  setField,
  profiles,
  currentTheme,
  setCurrentTheme,
  handleThemeChange,
}) {
  const [splashOn, setSplashOn] = useState(isSplashEnabled);
  // Custom theme: show color changes right away; Save keeps them on the machine.
  useEffect(() => {
    if (currentTheme !== 'custom') return;
    previewCustomColors({
      bg: formData.themeBg,
      accent: formData.themeAccent,
      text: formData.themeText,
    });
  }, [currentTheme, formData.themeBg, formData.themeAccent, formData.themeText]);
  // Another tab or device changed the theme: this page's menus follow (not right after a change
  // made here, which the machine is still echoing), so Save Settings can't put an old one back.
  const machineColorTheme = colorThemeSignal.value;
  const machinePicture = holidayModeSignal.value;
  const machineColors = themeColorsSignal.value;
  // only changes after this page opened: the first values may be this browser's old copy
  const followed = useRef(null);
  useEffect(() => {
    const first = followed.current === null;
    followed.current = true;
    if (first || Date.now() - lastThemeEdit < 2000) return;
    if (machineColorTheme && machineColorTheme !== currentTheme) {
      setCurrentTheme(machineColorTheme);
      setField('webTheme', machineColorTheme);
    }
    const shownPicture =
      formData.holidayMode && formData.holidayMode !== 'off' ? formData.holidayMode : 'auto';
    if (machinePicture && machinePicture !== shownPicture) setField('holidayMode', machinePicture);
    if (machineColors) {
      if (machineColors.bg !== formData.themeBg) setField('themeBg', machineColors.bg);
      if (machineColors.accent !== formData.themeAccent)
        setField('themeAccent', machineColors.accent);
      if (machineColors.text !== formData.themeText) setField('themeText', machineColors.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineColorTheme, machinePicture, machineColors]);
  return (
    <div className='space-y-4 sm:space-y-6'>
      {/* User Preferences */}
      <Section title='User Preferences'>
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          <SettingsFormField
            label='Startup Mode'
            htmlFor='startup-mode'
            helpText="The mode the machine starts in after it's switched on"
            noMargin
          >
            <select
              id='startup-mode'
              name='startupMode'
              className='select select-bordered w-full'
              onChange={onChange('startupMode')}
            >
              <option value='standby' selected={formData.startupMode === 'standby'}>
                Standby
              </option>
              <option value='brew' selected={formData.startupMode === 'brew'}>
                Brew
              </option>
              <option value='manual' selected={formData.startupMode === 'manual'}>
                Manual
              </option>
            </select>
          </SettingsFormField>
          <SettingsFormField label='Startup Profile' htmlFor='startup-profile' noMargin>
            <select
              id='startup-profile'
              name='startupProfile'
              className='select select-bordered w-full'
              value={formData.startupProfile || ''}
              onChange={onChange('startupProfile')}
            >
              <option value=''>Last used profile</option>
              {profiles.map(profile => (
                <option key={profile.id} value={profile.id}>
                  {profile.label}
                </option>
              ))}
            </select>
          </SettingsFormField>
          <InputGroupField
            label='Standby Timeout'
            htmlFor='standbyTimeout'
            unit='s'
            unitAriaLabel='seconds'
            noMargin
          >
            <input
              id='standbyTimeout'
              name='standbyTimeout'
              type='number'
              placeholder='0'
              value={formData.standbyTimeout}
              onChange={onChange('standbyTimeout')}
            />
          </InputGroupField>
          <SettingsFormField label='Time Zone' htmlFor='timezone' noMargin>
            <select
              id='timezone'
              name='timezone'
              className='select select-bordered w-full'
              onChange={onChange('timezone')}
            >
              {timezones.map(tz => (
                <option key={tz} value={tz} selected={formData.timezone === tz}>
                  {tz}
                </option>
              ))}
            </select>
          </SettingsFormField>
        </div>

        {/* Clock */}
        <div className='border-base-content/5 mt-6 border-t pt-6'>
          <ToggleField
            label='Use 24h Format'
            htmlFor='clock24hFormat'
            checked={!!formData.clock24hFormat}
            onChange={onChange('clock24hFormat')}
          />
        </div>

        {/* Shot history: how many shots the machine keeps (they share the storage with themes) */}
        <div className='border-base-content/5 mt-6 border-t pt-6'>
          <SettingsFormField label='Shot History' htmlFor='shotHistoryLimit' noMargin>
            <select
              id='shotHistoryLimit'
              name='shotHistoryLimit'
              className='select select-bordered w-full md:w-80'
              value={String(formData.shotHistoryLimit ?? 50)}
              onChange={onChange('shotHistoryLimit')}
            >
              <option value='50'>Keep the last 50 shots (about 0.2 MB)</option>
              <option value='100'>Keep the last 100 shots (about 0.4 MB)</option>
              <option value='0'>Keep all shots</option>
            </select>
          </SettingsFormField>
          {String(formData.shotHistoryLimit ?? 50) === '0' ? (
            <p className='text-warning mt-2 text-sm'>
              Every shot (about 4 KB each) stays until the storage is nearly full; then new themes,
              fonts and pictures can&apos;t be added until old shots are gone.
              {customStorage.value.free
                ? ` ${(Math.max(0, customStorage.value.free - 1048576) / 1048576).toFixed(1)} MB available now.`
                : ''}
            </p>
          ) : (
            <p className='text-base-content/60 mt-2 text-sm'>
              Older shots are removed after the next shot. Shot History and Statistics show what is
              kept.
            </p>
          )}
          <div className='mt-4'>
            <ToggleField
              label='Save Manual shots'
              htmlFor='saveManualShots'
              checked={!!formData.saveManualShots}
              onChange={e => {
                // Saved at once, like the Shot History page's switch, so neither can undo the other.
                const on = !formData.saveManualShots;
                onChange('saveManualShots')(e);
                fetch('/api/settings', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: `saveManualShots=${on ? 1 : 0}`,
                }).catch(() => {});
              }}
            />
            <p className='text-base-content/60 mt-2 text-sm'>
              Shots under 15 seconds are not saved.
            </p>
          </div>
        </div>

        {/* Predictive Scale Delay */}
        <div className='border-base-content/5 mt-6 border-t pt-6'>
          <h3 className='text-md text-base-content mb-2 font-semibold'>Predictive Scale Delay</h3>
          <p className='text-base-content/85 mb-4 text-sm opacity-70'>
            Shuts off the process ahead of time based on the flow rate to account for any dripping
            or delays in the control.
          </p>
          <div className='mb-4'>
            <ToggleField
              label='Auto Adjust'
              htmlFor='delayAdjust'
              checked={!!formData.delayAdjust}
              onChange={onChange('delayAdjust')}
            />
          </div>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <InputGroupField
              label='Brew'
              htmlFor='brewDelay'
              unit='ms'
              unitAriaLabel='milliseconds'
              noMargin
            >
              <input
                id='brewDelay'
                name='brewDelay'
                type='number'
                step='any'
                className='grow'
                placeholder='0'
                value={formData.brewDelay}
                onChange={onChange('brewDelay')}
              />
            </InputGroupField>
            <InputGroupField
              label='Grind'
              htmlFor='grindDelay'
              unit='ms'
              unitAriaLabel='milliseconds'
              noMargin
            >
              <input
                id='grindDelay'
                name='grindDelay'
                type='number'
                step='any'
                className='grow'
                placeholder='0'
                value={formData.grindDelay}
                onChange={onChange('grindDelay')}
              />
            </InputGroupField>
          </div>
        </div>

        {/* Buttons */}
        <div className='border-base-content/5 mt-6 border-t pt-6'>
          <h3 className='text-md text-base-content mb-2 font-semibold'>Physical Buttons</h3>
          <p className='text-base-content/85 mb-4 text-sm opacity-70'>
            What switches wired to the board do when pressed (brew: GPIO 38, steam: GPIO 48). They
            do nothing until something is connected.
          </p>
          <div className='mb-4'>
            <ToggleField
              label='Momentary Buttons'
              htmlFor='momentaryButtons'
              checked={!!formData.momentaryButtons}
              onChange={onChange('momentaryButtons')}
            />
          </div>
          {/* two inputs on this board (GaggiMateController: brewBtn, steamBtn); the third
              behaviour (button2) is kept as saved but has no switch, so it isn't shown */}
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            <ButtonBehaviorSelect
              id='button0'
              label='Brew Button Behavior'
              value={formData.button0}
              onChange={onChange('button0')}
              profiles={profiles}
            />
            <ButtonBehaviorSelect
              id='button1'
              label='Steam Button Behavior'
              value={formData.button1}
              onChange={onChange('button1')}
              profiles={profiles}
            />
          </div>
        </div>
      </Section>

      {/* Display Settings: the machine's own touchscreen; hidden on one without (DeLongezzi) */}
      {formData.hasDisplay !== false && (
        <Section title='Display Settings'>
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            <SettingsFormField label='Main Brightness (1-16)' htmlFor='mainBrightness' noMargin>
              <input
                id='mainBrightness'
                name='mainBrightness'
                type='number'
                className='input input-bordered w-full'
                placeholder='16'
                min='1'
                max='16'
                value={formData.mainBrightness}
                onChange={onChange('mainBrightness')}
              />
            </SettingsFormField>
            <SettingsFormField label='Display Theme' htmlFor='themeMode' noMargin>
              <select
                id='themeMode'
                name='themeMode'
                className='select select-bordered w-full'
                value={formData.themeMode}
                onChange={onChange('themeMode')}
              >
                <option value={0}>Dark Theme</option>
                <option value={1}>Light Theme</option>
              </select>
            </SettingsFormField>
          </div>

          {/* Standby Display */}
          <div className='border-base-content/5 mt-6 border-t pt-6'>
            <div className='mb-4'>
              <ToggleField
                label='Enable standby display'
                htmlFor='standbyDisplayEnabled'
                checked={!!formData.standbyDisplayEnabled}
                onChange={onChange('standbyDisplayEnabled')}
              />
            </div>
            <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
              <SettingsFormField
                label='Standby Brightness (0-16)'
                htmlFor='standbyBrightness'
                helpText='When the toggle is off, brightness will be set to 0'
                noMargin
              >
                <input
                  id='standbyBrightness'
                  name='standbyBrightness'
                  type='number'
                  className='input input-bordered w-full'
                  placeholder='8'
                  min='0'
                  max='16'
                  disabled={!formData.standbyDisplayEnabled}
                  value={formData.standbyDisplayEnabled ? formData.standbyBrightness : 0}
                  onChange={onChange('standbyBrightness')}
                />
              </SettingsFormField>
              <InputGroupField
                label='Standby Brightness Timeout'
                htmlFor='standbyBrightnessTimeout'
                unit='s'
                unitAriaLabel='seconds'
                noMargin
              >
                <input
                  id='standbyBrightnessTimeout'
                  name='standbyBrightnessTimeout'
                  type='number'
                  min='1'
                  placeholder='60'
                  value={formData.standbyBrightnessTimeout}
                  onChange={onChange('standbyBrightnessTimeout')}
                />
              </InputGroupField>
            </div>
          </div>
        </Section>
      )}

      {/* Splash & Logo: the machine's own pictures, in their own card (user 2026-10-08) */}
      <Section title='Splash & Logo'>
        {/* Splash screen (per-browser preference, not a device setting) */}
        <div className='mt-3'>
          <ToggleField
            label='Show Splash Screen'
            htmlFor='splashEnabled'
            checked={splashOn}
            onChange={() => {
              const next = !splashOn;
              setSplashOn(next);
              setSplashEnabled(next);
            }}
          />
          <ImagePicker
            endpoint='/api/splash'
            resetEndpoint='/api/splash-reset'
            maxSide={1024}
            chooseLabel='Choose image…'
            preview='/api/splash'
            previewFallback='/splash.webp'
          />
        </div>
        <div className='border-base-content/10 mt-5 border-t pt-4'>
          <div className='font-medium'>Sidebar Logo</div>
          <ImagePicker
            endpoint='/api/logo'
            resetEndpoint='/api/logo-reset'
            maxSide={600}
            chooseLabel='Choose logo…'
            onChanged={() => window.dispatchEvent(new Event('gm:logo-changed'))}
            preview='/api/logo'
            previewFallback='/logo.webp'
          />
        </div>
      </Section>

      {/* Web Settings */}
      <Section title='Web Settings'>
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          <SettingsFormField label='Color theme' htmlFor='webui-theme' noMargin>
            <select
              id='webui-theme'
              name='webui-theme'
              className='select select-bordered w-full'
              // While a picture theme is showing no colour theme is in use: "Picture theme on".
              value={activeHoliday.value ? '' : currentTheme}
              onChange={e => {
                // read before anything below switches the picture theme off
                const pictureThemeOn = !!activeHoliday.value;
                setCurrentTheme(e.target.value);
                handleThemeChange(e);
                setField('webTheme', e.target.value);
                // A holiday's colors cover every theme, so picking a theme while one
                // is showing turns the holiday off (user 2026-09-25).
                if (pictureThemeOn) {
                  setField('holidayMode', 'off');
                  setHolidayMode('off');
                }
                saveThemeSoon(
                  pictureThemeOn
                    ? { webTheme: e.target.value, holidayMode: 'auto' }
                    : { webTheme: e.target.value },
                  0,
                );
              }}
            >
              {/* shown while a picture theme (Manual mode theme) covers the colours */}
              <option value='' disabled hidden>
                Picture theme on
              </option>
              <option value='system'>System</option>
              <option value='light'>Light</option>
              <option value='dark'>Dark</option>
              <option value='coffee'>Coffee</option>
              <option value='nord'>Nord</option>
              <option value='custom'>My colors</option>
            </select>
            {/* Custom theme colors, right under the menu (user 2026-10-07): kept on the machine as
                they change (saveThemeSoon), used exactly as picked. */}
            {currentTheme === 'custom' && !activeHoliday.value && (
              <div className='mt-3 flex flex-wrap items-center gap-5 text-sm'>
                {[
                  ['themeBg', 'Background', DEFAULT_CUSTOM_COLORS.bg],
                  ['themeAccent', 'Accent', DEFAULT_CUSTOM_COLORS.accent],
                  ['themeText', 'Text', DEFAULT_CUSTOM_COLORS.text],
                ].map(([key, label, fallback]) => (
                  <label key={key} className='flex items-center gap-2'>
                    {label}
                    <input
                      type='color'
                      name={key}
                      value={formData[key] || fallback}
                      onInput={e => {
                        onChange(key)(e);
                        saveThemeSoon({ [key]: e.currentTarget.value });
                      }}
                      className='h-8 w-12 cursor-pointer rounded border-0 bg-transparent p-0'
                    />
                  </label>
                ))}
                <button
                  type='button'
                  className='btn btn-xs btn-ghost'
                  onClick={() => {
                    setField('themeBg', DEFAULT_CUSTOM_COLORS.bg);
                    setField('themeAccent', DEFAULT_CUSTOM_COLORS.accent);
                    setField('themeText', DEFAULT_CUSTOM_COLORS.text);
                    saveThemeSoon(
                      {
                        themeBg: DEFAULT_CUSTOM_COLORS.bg,
                        themeAccent: DEFAULT_CUSTOM_COLORS.accent,
                        themeText: DEFAULT_CUSTOM_COLORS.text,
                      },
                      0,
                    );
                  }}
                >
                  Default
                </button>
              </div>
            )}
          </SettingsFormField>
          {/* Dashboard Layout moved to Settings > Dashboard (user 2026-10-08) */}
        </div>
        {/* faint lines between the groups, so they don't run together (user 2026-10-07) */}
        <hr className='border-base-content/10 my-6' />
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          {/* Shown right away; Save keeps it on the machine for every device. */}
          <SettingsFormField
            label={
              <>
                Manual mode theme{' '}
                {/* a small red HOT tag, like the menu's NEW tags (user 2026-10-08) */}
                <span className='text-error ml-1 align-super text-[10px] font-bold'>HOT</span>
              </>
            }
            htmlFor='holidayMode'
            helpText="Shown in Manual mode: your everyday theme. On a theme's own dates (Valentine's Day, Donut Day, Pizza Friday every Friday) that theme shows for the day, then yours comes back."
            noMargin
          >
            <select
              id='holidayMode'
              name='holidayMode'
              className='select select-bordered w-full'
              disabled={themePickLocked.value}
              value={
                formData.holidayMode && formData.holidayMode !== 'off'
                  ? formData.holidayMode
                  : 'auto'
              }
              onChange={e => {
                onChange('holidayMode')(e);
                setHolidayMode(e.currentTarget.value);
                // kept on the machine at once, so other tabs and devices follow (user 2026-10-08);
                // Save Settings still saves it with the rest
                saveThemeSoon({ holidayMode: e.currentTarget.value }, 0);
              }}
            >
              <option value='auto'>None (plain page)</option>
              {HOLIDAYS.map(h => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
              {/* permanent custom themes look like the built-in ones */}
              {customThemes.value
                .filter(t => t.permanent)
                .map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              {customThemes.value.some(t => !t.permanent) && (
                <optgroup label='Custom themes'>
                  {customThemes.value
                    .filter(t => !t.permanent)
                    .map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </optgroup>
              )}
            </select>
            {/* saved the moment it is ticked, like the brew video choice */}
            <label className='mt-2 flex cursor-pointer items-center gap-2 text-sm font-semibold'>
              Auto themes by date
              <span className={keepThemeSignal.value ? '' : 'opacity-40'}>OFF</span>
              <input
                type='checkbox'
                role='switch'
                className='toggle toggle-primary'
                checked={!keepThemeSignal.value}
                onChange={e => saveKeepTheme(!e.currentTarget.checked)}
              />
              <span className={keepThemeSignal.value ? 'opacity-40' : ''}>ON</span>
            </label>
            {themePickLocked.value && (
              <p className='text-warning mt-1 text-sm font-semibold'>
                {holidayToday.value.name} is on {holidayUntilText(holidayToday.value)}. Turn Auto
                themes OFF to change.
              </p>
            )}
          </SettingsFormField>
        </div>

        <hr className='border-base-content/10 my-6' />
        <CustomThemesSection
          onPick={id => {
            setField('holidayMode', id);
            setHolidayMode(id);
            saveThemeSoon({ holidayMode: id }, 0); // kept on the machine at once, like the picker
          }}
        />

        {/* Permanent themes: folded away under the custom themes (they show with the holidays above) */}
        <CustomThemesSection
          permanent
          onPick={id => {
            setField('holidayMode', id);
            setHolidayMode(id);
            saveThemeSoon({ holidayMode: id }, 0); // kept on the machine at once, like the picker
          }}
        />

        <hr className='border-base-content/10 my-6' />
        {/* Pictures, the brew button's numbers and the chart timer, each in its own card (user 2026-10-02) */}
        <div className='bg-base-200/70 rounded-xl p-4'>
          <h3 className='mb-1 text-base font-semibold'>Pictures</h3>
          <div className='mt-3'>
            <div className='font-medium'>Brew Button Videos and Pictures</div>
            <div className='text-base-content/70 mt-1 mb-3 text-sm'>
              Videos: square, 230 x 230, H.264 MP4 (animated WebP/GIF also work), loop while brewing
              and freeze on the frame when you stop; about 0.3 MB each is plenty. Pictures (PNG,
              JPG, WebP) are shrunk to 230 x 230, about 10 KB. 3 MB for all of them together;
              everything added in a theme is kept here too.
            </div>
            <BrewVideoLibrary
              chosen={formData.brewVideo || ''}
              mode={formData.brewVideoMode || 'fixed'}
              onChange={(key, value) => {
                // saved at once, like the library itself (no Save needed)
                setField(key, value);
                fetch('/api/settings', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: new URLSearchParams({ [key]: value }).toString(),
                })
                  .then(() => resetBrewArt())
                  .catch(() => {});
              }}
            />
          </div>
        </div>

        {/* The seconds on the brew button, over a video or the Original cup (saved with Save). */}
        <div className='bg-base-200/70 mt-4 rounded-xl p-4'>
          <h3 className='mb-3 text-base font-semibold'>Brew Button Numbers</h3>
          <div className='flex flex-wrap items-center gap-6'>
            {/* live preview: the real brew button now in use, with the numbers as they're being set */}
            <BrewButtonPreview
              numStyle={{
                color: formData.brewNumColor || '#ffffff',
                opacity: (formData.brewNumOpacity ?? 60) / 100,
                transform: `scale(${(formData.brewNumSize ?? 100) / 100})`,
              }}
            />
            <div className='grid min-w-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-3'>
              <label className='flex items-center gap-3'>
                <span className='w-20'>Color</span>
                <input
                  type='color'
                  name='brewNumColor'
                  value={formData.brewNumColor || '#ffffff'}
                  onInput={onChange('brewNumColor')}
                  className='h-9 w-14 cursor-pointer rounded border-0 bg-transparent p-0'
                />
              </label>
              <label className='flex items-center gap-3'>
                <span className='w-20'>Opacity</span>
                <input
                  type='range'
                  name='brewNumOpacity'
                  min='0'
                  max='100'
                  step='5'
                  value={formData.brewNumOpacity ?? 60}
                  onInput={onChange('brewNumOpacity')}
                  className='range range-sm flex-1'
                />
                <span className='w-12 text-right font-semibold tabular-nums'>
                  {formData.brewNumOpacity ?? 60}%
                </span>
              </label>
              <label className='flex items-center gap-3'>
                <span className='w-20'>Size</span>
                <input
                  type='range'
                  name='brewNumSize'
                  min='50'
                  max='160'
                  step='5'
                  value={formData.brewNumSize ?? 100}
                  onInput={onChange('brewNumSize')}
                  className='range range-sm flex-1'
                />
                <span className='w-12 text-right font-semibold tabular-nums'>
                  {formData.brewNumSize ?? 100}%
                </span>
              </label>
            </div>
          </div>
          <button
            type='button'
            className='btn btn-sm btn-ghost mt-3'
            onClick={() => {
              setField('brewNumColor', '#ffffff');
              setField('brewNumOpacity', 60);
              setField('brewNumSize', 100);
            }}
          >
            Back to default
          </button>
        </div>

        {/* The shot timer, big, in the middle of the chart too: with the button's numbers
            at 0% opacity, the video shows clear and the time still reads on the chart. */}
        <div className='bg-base-200/70 mt-4 rounded-xl p-4'>
          <h3 className='mb-3 text-base font-semibold'>Timer on the Chart</h3>
          <label className='flex items-center gap-3'>
            <input
              type='checkbox'
              className='toggle toggle-sm'
              checked={!!Number(formData.chartTimer ?? 0)}
              onChange={e => setField('chartTimer', e.currentTarget.checked ? 1 : 0)}
            />
            Show the shot time big in the middle of the chart
          </label>
          {!!Number(formData.chartTimer ?? 0) && (
            <div className='mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <label className='flex items-center gap-3'>
                <span className='w-20'>Brightness</span>
                <input
                  type='range'
                  name='chartTimerOpacity'
                  min='5'
                  max='100'
                  step='5'
                  value={formData.chartTimerOpacity ?? 35}
                  onInput={onChange('chartTimerOpacity')}
                  className='range range-sm flex-1'
                />
                <span className='w-12 text-right font-semibold tabular-nums'>
                  {formData.chartTimerOpacity ?? 35}%
                </span>
              </label>
              <label className='flex items-center gap-3'>
                <span className='w-20'>Size</span>
                <input
                  type='range'
                  name='chartTimerSize'
                  min='40'
                  max='200'
                  step='5'
                  value={formData.chartTimerSize ?? 100}
                  onInput={onChange('chartTimerSize')}
                  className='range range-sm flex-1'
                />
                <span className='w-12 text-right font-semibold tabular-nums'>
                  {formData.chartTimerSize ?? 100}%
                </span>
              </label>
            </div>
          )}
          <div className='text-base-content/70 mt-3 text-sm'>
            Tip: set the brew button&apos;s number opacity to 0% to see its video fully, and read
            the time on the chart.
          </div>
        </div>
      </Section>
    </div>
  );
}

// Settings > Wi-Fi (user 2026-10-08): the network fields, out of the everyday settings (a wrong
// change can take the machine off the network). Saved with Save Settings like the rest.
export function WifiTab({
  formData,
  onChange,
  showWifiPassword,
  setShowWifiPassword,
  showApPassword,
  setShowApPassword,
}) {
  return (
    <div className='space-y-6'>
      <Section title='Wi-Fi'>
        {/* Where to find the machine (user 2026-10-14): its router address, big and tappable to
            bookmark; on the hotspot the last address it had on the router. */}
        {formData.ip ? (
          <div className='mb-4'>
            <div className='text-base-content/70 text-sm'>This machine's address</div>
            <a className='link text-primary text-3xl font-bold' href={`http://${formData.ip}`}>
              http://{formData.ip}
            </a>
            <p className='text-base-content/70 mt-1 text-sm'>
              Bookmark it. Lost it? Try http://{formData.mdnsName || 'delongezzi'}.local, or find
              &quot;{formData.mdnsName || 'delongezzi'}&quot; in your router&apos;s device list.
            </p>
          </div>
        ) : (
          formData.lastIp && (
            <div className='mb-4'>
              <div className='text-base-content/70 text-sm'>Last known address on your router</div>
              <div className='text-3xl font-bold'>http://{formData.lastIp}</div>
              <p className='text-base-content/70 mt-1 text-sm'>
                Once the Wi-Fi is fixed, the machine is usually back there.
              </p>
            </div>
          )
        )}
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          <SettingsFormField label='Wi-Fi SSID' htmlFor='wifiSsid' noMargin>
            <input
              id='wifiSsid'
              name='wifiSsid'
              type='text'
              className='input input-bordered w-full'
              placeholder='Wi-Fi SSID'
              // no phone-keyboard suggestions or capitals in the network name (2026-10-14)
              autoComplete='off'
              autoCapitalize='off'
              autoCorrect='off'
              spellCheck={false}
              value={formData.wifiSsid}
              onChange={onChange('wifiSsid')}
            />
          </SettingsFormField>
          <SettingsFormField label='Wi-Fi Password' htmlFor='wifiPassword' noMargin>
            {/* On the hotspot the machine sends a placeholder instead of the password; shown
                empty, so typing doesn't add to it. Left empty, the placeholder is still sent
                and the saved password is kept (handleSettings). */}
            <PasswordField
              id='wifiPassword'
              label='Wi-Fi Password'
              placeholder={
                formData.wifiPassword === '---unchanged---' ? 'Saved - type to replace' : undefined
              }
              value={formData.wifiPassword === '---unchanged---' ? '' : formData.wifiPassword}
              onChange={onChange('wifiPassword')}
              shown={showWifiPassword}
              setShown={setShowWifiPassword}
            />
          </SettingsFormField>
          <SettingsFormField
            label='Access Point Password'
            htmlFor='apPassword'
            helpText='Used for the DeLongezzi hotspot when no Wi-Fi is configured (min. 8 characters).'
            noMargin
          >
            <PasswordField
              id='apPassword'
              label='Access Point Password'
              minLength={8}
              maxLength={63}
              value={formData.apPassword}
              onChange={onChange('apPassword')}
              shown={showApPassword}
              setShown={setShowApPassword}
            />
          </SettingsFormField>
          <SettingsFormField label='Hostname' htmlFor='mdnsName' noMargin>
            <input
              id='mdnsName'
              name='mdnsName'
              type='text'
              className='input input-bordered w-full'
              placeholder='Hostname'
              value={formData.mdnsName}
              onChange={onChange('mdnsName')}
            />
          </SettingsFormField>
        </div>
      </Section>

      {/* moved here from the System tab (user 2026-10-08): it's how the machine joins a new network */}
      {/* Toggle between the normal network and the GaggiMate AP/portal (persistent) */}
      <Section title='Setup Portal'>
        {/* the machine's hotspot lags for devices that save power (measured 2026-10-08: ~355 ms,
            10-22 % loss; no fix in this ESP-IDF 4.4 Wi-Fi), so it's for setup only */}
        <p className='text-warning mb-2 text-sm font-semibold'>
          For setup only: in portal mode the page can lag or drop out, especially on phones and
          tablets. Use it to change the Wi-Fi settings, then return to your normal network.
        </p>
        <SetupPortalButton />
      </Section>
    </div>
  );
}
