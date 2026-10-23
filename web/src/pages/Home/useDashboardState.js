import { computed, effect, signal } from '@preact/signals';
import { useContext, useState } from 'preact/hooks';
import { useQuery } from 'preact-fetching';
import { ApiServiceContext, machine } from '../../services/ApiService.js';

const status = computed(() => machine.value.status);
const capabilities = computed(() => machine.value.capabilities);

// A mode tap shows at once and is sent again while the machine hasn't confirmed it (a phone's
// connection can stall for a few seconds, e.g. right after turning it sideways): resent every
// second, given up after 6.5 s, when the screen follows the machine again.
const pendingMode = signal(null); // { mode, at }
const RESEND_MS = [1000, 2000, 3000, 4000, 5000];
const GIVE_UP_MS = 6500;
let resendTimers = [];
// Start / Stop the same way: shown at once; Stop is resent until the machine's status agrees.
// Start goes once (audit S7-M1): a shot that ended before any status showed it running was
// started again by the resend, up to 5 times.
const pendingRun = signal(null); // { active }
let runTimers = [];
// The mode to show: the one just tapped, until the machine confirms or it's given up.
export const shownMode = computed(() => pendingMode.value?.mode ?? status.value?.mode);
effect(() => {
  const pending = pendingMode.value;
  if (pending && status.value.mode === pending.mode) pendingMode.value = null; // confirmed
});
effect(() => {
  const pending = pendingRun.value;
  if (pending && !!status.value.process?.a === pending.active) pendingRun.value = null; // confirmed
});
// While a tap waits for the machine, <html data-machine-waiting> (style.css: the brew button pulses).
effect(() => {
  const waiting = !!pendingMode.value || !!pendingRun.value;
  if (typeof document !== 'undefined')
    document.documentElement.toggleAttribute('data-machine-waiting', waiting);
});

// Sends now and (resend) again every second until confirmed(); at GIVE_UP_MS giveUp() (the
// screen follows the machine again). A send while the socket is reconnecting throws: the next
// one tries again.
function sendUntil(apiService, message, confirmed, giveUp, timers, resend = true) {
  timers.forEach(clearTimeout);
  const request = () => {
    try {
      apiService.send(message);
    } catch {
      // not connected this moment
    }
  };
  request();
  return [
    ...(resend ? RESEND_MS : []).map(ms => setTimeout(() => confirmed() || request(), ms)),
    setTimeout(() => confirmed() || giveUp(), GIVE_UP_MS),
  ];
}

export function useDashboardState() {
  const apiService = useContext(ApiServiceContext);
  const [isFlushing, setIsFlushing] = useState(false);

  const s = status.value;
  const caps = capabilities.value;
  const p = s.process;
  const pending = pendingMode.value;
  const mode = pending ? pending.mode : s.mode;

  const { data: settings } = useQuery(
    'settings-cache',
    async () => (await fetch('/api/settings')).json(),
    { staleTime: 30000, refetchOnWindowFocus: false },
  );

  // ── derived ──────────────────────────────────────────────
  const run = pendingRun.value;
  const isActive = run ? run.active : !!p?.a;
  const isFinished = !!p?.e && !isActive;
  const isBrewing = mode === 1;
  const isGrinding = mode === 4;
  const isManual = mode === 5;

  const isSmartGrindEnabled = settings?.smartGrindActive || false;
  const altRelayFunction = settings?.altRelayFunction ?? 1;
  const isGrindAvailable = isSmartGrindEnabled || altRelayFunction === 1;
  const showGrindTab = isGrindAvailable || isGrinding;

  // ── water level (Alba) ────────────────────────────────────
  const ledControl = caps?.ledControl || false;
  const emptyTankDistance = settings?.emptyTankDistance || 0;
  const fullTankDistance = settings?.fullTankDistance || 0;
  const albaCalibrated = emptyTankDistance > 0 && fullTankDistance > 0;
  const waterLevelPercent =
    typeof s.wl === 'number' && s.wl >= 0
      ? Math.max(0, Math.min(100, s.wl))
      : ledControl && albaCalibrated
        ? Math.max(
            0,
            Math.min(
              100,
              ((emptyTankDistance - s.tofDistance) / (emptyTankDistance - fullTankDistance)) * 100,
            ),
          )
        : null;

  // ── handlers ─────────────────────────────────────────────
  // One-off requests; while the socket reconnects they are dropped instead of throwing, so a
  // sequence (Standby: stop, clear, change mode) still reaches its resent parts.
  const send = tp => {
    try {
      apiService.send({ tp });
    } catch {
      // not connected this moment
    }
  };

  const changeMode = next => {
    pendingMode.value = { mode: next, at: Date.now() };
    const done = () => pendingMode.peek()?.mode !== next;
    resendTimers = sendUntil(
      apiService,
      { tp: 'req:change-mode', mode: next },
      done,
      () => done() || (pendingMode.value = null),
      resendTimers,
    );
  };

  // Full sleep: stop any running process, clear state, drop to standby mode.
  // Used by the ActionCard "Standby" button (heater + pump off).
  const goStandby = () => {
    deactivate();
    clear();
    changeMode(0);
  };

  const setRunning = active => {
    pendingRun.value = { active };
    const done = () => pendingRun.peek()?.active !== active;
    const tp = isGrinding
      ? `req:grind:${active ? 'activate' : 'deactivate'}`
      : `req:process:${active ? 'activate' : 'deactivate'}`;
    // A shot or grind can be over in a second or two: a late resent Start would start it again,
    // so every Start goes once (it is still shown at once); every Stop is resent.
    const once = active;
    runTimers = sendUntil(
      apiService,
      { tp },
      done,
      () => done() || (pendingRun.value = null),
      runTimers,
      !once,
    );
  };
  const activate = () => setRunning(true);
  const deactivate = () => {
    setRunning(false);
    if (isFlushing) {
      send('req:process:clear');
      setIsFlushing(false);
    }
  };
  const clear = () => {
    send('req:process:clear');
    setIsFlushing(false);
  };

  const startFlush = () => {
    if (isFlushing) return;
    setIsFlushing(true);
    apiService.request({ tp: 'req:flush:start' }).catch(() => setIsFlushing(false));
  };

  // Pressure is live (updateControl reads it every cycle); weight is read once
  // when the shot starts, so changing it mid-shot is deliberately inert.
  const setManualPressure = pressure => apiService.send({ tp: 'req:manual-pressure', pressure });
  const setManualWeight = weight => apiService.send({ tp: 'req:manual-weight', weight });
  // Zeroes the BLE scale. Firmware ignores it during a shot; see WebUIPlugin.
  const tare = () => apiService.send({ tp: 'req:tare' });

  const raiseTemp = () => send('req:raise-temp');
  const lowerTemp = () => send('req:lower-temp');
  const raiseTarget = () => send(isGrinding ? 'req:raise-grind-target' : 'req:raise-brew-target');
  const lowerTarget = () => send(isGrinding ? 'req:lower-grind-target' : 'req:lower-brew-target');
  const changeTarget = target =>
    apiService.send({
      tp: isGrinding ? 'req:change-grind-target' : 'req:change-brew-target',
      target,
    });

  return {
    // raw status
    mode,
    currentTemperature: s.currentTemperature,
    targetTemperature: s.targetTemperature,
    currentPressure: s.currentPressure,
    targetPressure: s.targetPressure,
    currentFlow: s.currentFlow,
    targetFlow: s.targetFlow,
    currentWeight: s.currentWeight,
    bluetoothConnected: !!s.bluetoothConnected,
    manualPressure: s.manualPressure ?? 0,
    manualWeight: s.manualWeight ?? 0,
    currentPumpPower: s.currentPumpPower ?? 0,
    currentBoilerPower: s.currentBoilerPower ?? 0,
    currentPuckResistance: s.currentPuckResistance ?? 0,
    currentPuckFlow: s.currentPuckFlow ?? 0,
    currentCoffeeVolume: s.currentCoffeeVolume ?? 0,
    targetWeight: s.targetWeight,
    volumetricAvailable: s.volumetricAvailable,
    brewTarget: !!s.brewTarget,
    grindTarget: s.grindTarget,
    grindTargetDuration: s.grindTargetDuration,
    grindTargetVolume: s.grindTargetVolume,
    selectedProfile: s.selectedProfile,
    selectedProfileId: s.selectedProfileId,
    processInfo: p,
    tofDistance: s.tofDistance,
    // derived
    isActive,
    isFinished,
    isBrewing,
    isGrinding,
    isManual,
    isGrindAvailable,
    showGrindTab,
    // water level
    ledControl,
    albaCalibrated,
    waterLevelPercent,
    // settings
    isSmartGrindEnabled,
    altRelayFunction,
    emptyTankDistance,
    fullTankDistance,
    // action state
    isFlushing,
    // handlers
    changeMode,
    goStandby,
    activate,
    deactivate,
    clear,
    startFlush,
    raiseTemp,
    lowerTemp,
    raiseTarget,
    lowerTarget,
    changeTarget,
    setManualPressure,
    setManualWeight,
    tare,
  };
}
