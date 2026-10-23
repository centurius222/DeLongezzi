import { useEffect, useState } from 'preact/hooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHeartbeat } from '@fortawesome/free-solid-svg-icons/faHeartbeat';
import Section from '../../../components/Card.jsx';
import { HeatUpCheckCell } from './MachineTab.jsx';

// Status chip: green/red dot + label. ok=null -> neutral (unknown/disabled).
// OK in green and faults in red, the words too, not only the dot (user 2026-10-22). Fixed
// colours: a picture theme can make the theme's "success" orange (utiki did).
const OK_GREEN = '#22c55e';
const FAULT_RED = '#ef4444';
function StatusChip({ ok, label }) {
  const color = ok === null ? undefined : ok ? OK_GREEN : FAULT_RED;
  return (
    <span className='flex items-center gap-2 text-sm' style={color ? { color } : undefined}>
      <span className='status status-neutral' style={color ? { backgroundColor: color } : undefined}></span>
      {label}
    </span>
  );
}

function Row({ label, value, mono = true }) {
  return (
    <div className='flex justify-between gap-4 py-1 text-sm'>
      <span className='text-base-content/70'>{label}</span>
      <span className={mono ? 'font-mono' : ''}>{value}</span>
    </div>
  );
}

// Fault-bit decoder for the MAX31865 status register (datasheet table 10).
const MAX_FAULTS = [
  [0x80, 'RTD high threshold'],
  [0x40, 'RTD low threshold'],
  [0x20, 'REFIN- > 0.85x VBIAS'],
  [0x10, 'REFIN- < 0.85x VBIAS (wiring/open)'],
  [0x08, 'RTDIN- < 0.85x VBIAS (open circuit)'],
  [0x04, 'Over/undervoltage'],
];

function DiagnosticsTab({ formData, setField }) {
  const [diag, setDiag] = useState(null);
  const [error, setError] = useState(null);
  // Bench test state. The FIRMWARE timer is the single source of truth:
  // /api/diagnostics now reports diagTest.active/heater, and this poll already
  // runs every 2 s. The UI only mirrors it — no local countdown timers, so the
  // button can never say "running" after the firmware already stopped the pump.
  const [pumpPower, setPumpPower] = useState(50);
  const [testMsg, setTestMsg] = useState(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch('/api/diagnostics');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (alive) {
          setDiag(data);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(String(e));
      }
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const testActive = diag?.diagTest?.active === true;
  const ssrActive = testActive && diag?.diagTest?.heater === true;
  const pumpActive = testActive && !ssrActive;

  const stopTests = async () => {
    try {
      await fetch('/api/test/stop');
    } catch (e) {
      /* firmware auto-off covers us */
    }
    setTestMsg('Tests stopped');
  };

  const runTest = async (kind) => {
    setTestMsg(null);
    try {
      const url =
        kind === 'pump'
          ? `/api/test/pump?power=${pumpPower}&dur=10000`
          : kind === 'pump5min'
            ? `/api/test/pump?power=${pumpPower}&dur=60000`
            : '/api/test/heater?dur=3000';
      const r = await fetch(url);
      const data = await r.json();
      setTestMsg(
        data.ok
          ? kind === 'pump'
            ? `Pump at ${pumpPower}% for 10 s`
            : kind === 'pump5min'
              ? `Pump at ${pumpPower}% for 1 min — press Stop to end early`
              : 'SSR ON for 3 s'
          : 'REFUSED by firmware (error state or sensor fault) — see serial log'
      );
    } catch (e) {
      setTestMsg(`Request failed: ${e}`);
    }
  };

  if (error && !diag) {
    return (
      <Section title='Diagnostics'>
        <div className='alert alert-error text-sm'>Diagnostics unavailable: {error}</div>
      </Section>
    );
  }
  if (!diag) {
    return (
      <Section title='Diagnostics'>
        <span className='loading loading-spinner loading-md' />
      </Section>
    );
  }

  const max = diag.max31865;
  const ads = diag.ads1115;
  const act = diag.actuators;
  const faultBits = max && max.fault ? MAX_FAULTS.filter(([bit]) => max.fault & bit).map(([, name]) => name) : [];

  return (
    <div className='space-y-4 sm:space-y-6'>
      {!diag.merged && (
        <div className='alert alert-warning text-sm'>
          Running a non-merged firmware - controller-half devices are not present in this image.
        </div>
      )}

      {/* Same cell as Settings > Machine: people look here first after a trip. */}
      <Section title='Safety'>
        <HeatUpCheckCell formData={formData} setField={setField} />
      </Section>

      <Section title='Boiler Temperature (MAX31865)'>
        <StatusChip ok={max ? max.present : null} label={max ? (max.present ? 'OK' : 'FAULT / not responding') : 'n/a'} />
        {max && (
          <div className='mt-2'>
            <Row label='Temperature' value={`${max.temperature.toFixed(1)} °C`} />
            <Row label='Raw RTD' value={max.rtd} />
            <Row label='Fault register' value={`0x${max.fault.toString(16).padStart(2, '0')}`} />
            <Row label='Error count (window)' value={max.errorCount} />
            {faultBits.length > 0 && (
              <div className='mt-2 text-error text-sm'>
                {faultBits.map(f => (
                  <div key={f}>⚠ {f}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title='Pressure (ADS1115 @ 0x48)'>
        <StatusChip ok={ads ? ads.connected : null} label={ads ? (ads.connected ? 'OK' : 'FAULT / not responding') : 'n/a'} />
        {ads && (
          <div className='mt-2'>
            <Row label='Pressure' value={`${ads.pressureBar.toFixed(2)} bar`} />
            <Row label='Raw counts' value={ads.raw} />
            <Row label='Voltage' value={`${ads.volts.toFixed(3)} V`} />
          </div>
        )}
      </Section>

      <Section title='Actuators'>
        {act && (
          <>
            <Row label='Heater duty' value={`${act.heaterDuty.toFixed(0)} %`} />
            <Row label='Pump power' value={`${act.pumpPower.toFixed(0)} %`} />
            <Row label='Pump dimmer (zero-cross)' value={`${diag.actuators.pumpZeroCross ?? 'n/a'} ticks / ${diag.actuators.pumpCps ?? 'n/a'} Hz`} />
            <Row
              label='Controller error code'
              value={
                <span style={{ color: act.errorCode === 0 ? OK_GREEN : FAULT_RED }}>
                  {act.errorCode === 0 ? 'none' : act.errorCode}
                </span>
              }
            />
          </>
        )}
      </Section>

      <Section title='Test Pump'>
        <div className='text-base-content/60 text-xs'>
          Drives the pump dimmer directly (no brew process). Watch "Pump power" above and listen for the pump.
        </div>
        <div className='mt-2 flex flex-wrap items-center gap-3'>
          <input
            type='range'
            min='10'
            max='100'
            step='5'
            value={pumpPower}
            onInput={e => setPumpPower(Number(e.target.value))}
            className='range range-sm range-primary w-48'
            disabled={diag?.merged !== true}
          />
          <span className='font-mono text-sm'>{pumpPower}%</span>
          <button
            type='button'
            className='btn btn-primary btn-sm'
            onClick={() => runTest('pump')}
            disabled={diag?.merged !== true || testActive}
          >
            {pumpActive ? 'Running…' : 'Run 10 s'}
          </button>
          <button
            type='button'
            className={pumpActive ? 'btn btn-error btn-sm' : 'btn btn-secondary btn-sm'}
            onClick={() => (pumpActive ? stopTests() : runTest('pump5min'))}
            disabled={diag?.merged !== true}
          >
            {pumpActive ? 'STOP' : 'Run 1 min'}
          </button>
        </div>
      </Section>

      <Section title='Test SSR (heater)'>
        <div className='text-base-content/60 text-xs'>
          Forces the heater SSR fully ON for 3 s. Refused if the MAX31865 is faulted or the boiler is above 120 °C.
          Measure 230 VAC at the SSR output or watch the heater duty clamp.
        </div>
        <div className='mt-2 flex flex-wrap items-center gap-3'>
          <button
            type='button'
            className='btn btn-error btn-sm'
            onClick={() => runTest('heater')}
            disabled={diag?.merged !== true || testActive}
          >
            {ssrActive ? 'SSR ON…' : 'SSR ON 3 s'}
          </button>
          <span className='text-base-content/60 text-xs'>Boiler must be cold and thermocouple healthy.</span>
        </div>
      </Section>

      <Section title='Test Controls'>
        <div className='flex flex-wrap items-center gap-3'>
          <button type='button' className='btn btn-outline btn-sm' onClick={stopTests}>
            STOP all tests
          </button>
          {testMsg && <span className='text-sm'>{testMsg}</span>}
        </div>
        <div className='text-base-content/60 mt-2 text-xs'>
          All tests auto-off (pump max 1 min, SSR max 5 s) even if the browser disconnects.
        </div>
      </Section>

      <Section title='Water Level (touch, GPIO12)'>
        <Row label='Raw touch reading' value={diag.waterTouch ?? 'n/a'} />
        <div className='text-base-content/60 text-xs'>
          Dry baseline is typically high (tens); touching the tape pulls it down sharply.
        </div>
      </Section>

      <Section title='System'>
        <Row label='Free heap' value={`${(diag.heap / 1024).toFixed(0)} KB`} />
        <Row label='Uptime' value={`${Math.floor(diag.uptime / 3600)}h ${Math.floor((diag.uptime % 3600) / 60)}m`} />
        <Row label='WiFi RSSI' value={`${diag.rssi} dBm`} />
        <div className='text-base-content/60 text-xs'>Auto-refreshes every 2 s.</div>
      </Section>
    </div>
  );
}

export { DiagnosticsTab };
