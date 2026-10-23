import { useState, useEffect, useCallback, useContext } from 'preact/hooks';
import { ApiServiceContext } from '../../../services/ApiService.js';
import { OverviewChart } from '../../../components/OverviewChart.jsx';
import { Spinner } from '../../../components/Spinner.jsx';
import Section from '../../../components/Card.jsx';
import PumpFlowCalibration from '../../../components/PumpFlowCalibration/index.jsx';
import { SettingsFormField } from '../../../components/SettingsFormField.jsx';

export function CalibrationTab({ formData, onFieldStored }) {
  const apiService = useContext(ApiServiceContext);
  // Water tank calibration state
  const [waterRaw, setWaterRaw] = useState(null);
  const [waterPercent, setWaterPercent] = useState(null);
  const [waterMsg, setWaterMsg] = useState('');
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch('/api/waterlevel');
        const j = await r.json();
        if (alive) {
          setWaterRaw(j.raw);
          setWaterPercent(j.percent);
        }
      } catch (e) {
        /* device unreachable; keep last */
      }
    };
    poll();
    const t = setInterval(poll, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const calibrateWater = useCallback(async point => {
    try {
      await fetch('/api/waterlevel?calibrate=' + point);
      setWaterMsg('Saved ' + point + ' = current reading');
      setTimeout(() => setWaterMsg(''), 4000);
    } catch (e) {
      setWaterMsg('Failed to save');
    }
  }, []);

  // Autotune state
  const [autotuneActive, setAutotuneActive] = useState(false);
  const [autotuneResult, setAutotuneResult] = useState(null);
  const [autotuneFailed, setAutotuneFailed] = useState(false);
  const [autotuneTime, setAutotuneTime] = useState(120);
  const [autotuneSamples, setAutotuneSamples] = useState(6);
  const [autotuneWattage, setAutotuneWattage] = useState(680);

  const onStartAutotune = useCallback(() => {
    apiService.send({
      tp: 'req:autotune-start',
      time: autotuneTime,
      samples: autotuneSamples,
      wattage: autotuneWattage,
    });
    setAutotuneFailed(false);
    setAutotuneResult(null);
    setAutotuneActive(true);
  }, [autotuneTime, autotuneSamples, autotuneWattage, apiService]);

  useEffect(() => {
    const resultListener = apiService.on('evt:autotune-result', msg => {
      setAutotuneActive(false);
      setAutotuneFailed(false);
      setAutotuneResult(msg.pid);
    });
    const failedListener = apiService.on('evt:autotune-failed', () => {
      setAutotuneActive(false);
      setAutotuneResult(null);
      setAutotuneFailed(true);
    });
    return () => {
      apiService.off('evt:autotune-result', resultListener);
      apiService.off('evt:autotune-failed', failedListener);
    };
  }, [apiService]);

  return (
    <div className='space-y-4 sm:space-y-6'>
      {/* PID Autotune Section */}
      <Section title='PID Autotune'>
        {autotuneActive && (
          <div className='space-y-4'>
            <div className='w-full'>
              <OverviewChart />
            </div>
            <div className='flex flex-col items-center justify-center space-y-4 py-4'>
              <div className='flex items-center space-x-3'>
                <Spinner size={8} />
                <span className='text-base-content text-lg font-medium'>Autotune in Progress</span>
              </div>
              <div className='alert alert-warning max-w-md'>
                <span>
                  The boiler will heat at full power until its temperature inflection is detected,
                  then the SIMC tuning rule derives PID gains. Typically 1–3 minutes depending on
                  machine.
                </span>
              </div>
            </div>
          </div>
        )}

        {autotuneResult && (
          <div className='space-y-4 text-center'>
            <div className='alert alert-success mx-auto max-w-md'>
              <div>
                <h3 className='font-bold'>Autotune Complete!</h3>
                <div className='text-sm'>Your new PID values have been saved successfully.</div>
              </div>
            </div>
            <div className='mockup-code bg-base-200 mx-auto max-w-md'>
              <pre data-prefix='$'>
                <code>{autotuneResult}</code>
              </pre>
            </div>
            <button
              type='button'
              className='btn btn-outline btn-sm mt-2'
              onClick={() => setAutotuneResult(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {autotuneFailed && (
          <div className='space-y-4 text-center'>
            <div className='alert alert-error mx-auto max-w-md'>
              <div>
                <h3 className='font-bold'>Autotune Failed</h3>
                <div className='text-sm'>
                  No valid gains were produced. Your existing PID settings have been preserved. Try
                  increasing Test Duration or confirm the boiler was cold at start.
                </div>
              </div>
            </div>
            <button
              type='button'
              className='btn btn-outline btn-sm mt-2'
              onClick={() => setAutotuneFailed(false)}
            >
              Retry
            </button>
          </div>
        )}

        {!autotuneActive && !autotuneResult && !autotuneFailed && (
          <div className='space-y-4'>
            <div className='alert alert-warning'>
              <span>
                Please ensure the boiler temperature is below 50°C before starting the autotune
                process.
              </span>
            </div>

            <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
              <SettingsFormField
                label='Test Duration (seconds)'
                htmlFor='testTime'
                helpText='Upper bound on the identification test. Most espresso boilers resolve within 60–120 s. Extend if Autotune fails before peak slope is detected.'
                noMargin
              >
                <input
                  id='testTime'
                  type='number'
                  min='30'
                  max='300'
                  className='input input-bordered w-full'
                  value={autotuneTime}
                  onChange={e => setAutotuneTime(Number.parseInt(e.target.value, 10) || 0)}
                  placeholder='120'
                />
              </SettingsFormField>
              <SettingsFormField
                label='Slope Window'
                htmlFor='slopeWindow'
                helpText='Moving-window length (samples) used for slope estimation. Larger values smooth MAX31855 quantisation but lag the inflection. 6 is the sweet spot.'
                noMargin
              >
                <input
                  id='slopeWindow'
                  type='number'
                  min='4'
                  max='20'
                  className='input input-bordered w-full'
                  value={autotuneSamples}
                  onChange={e => setAutotuneSamples(Number.parseInt(e.target.value, 10) || 4)}
                  placeholder='6'
                />
              </SettingsFormField>
              <SettingsFormField
                label='Heater Wattage (W)'
                htmlFor='heaterWattage'
                helpText='Heater wattage in Watts (e.g. 680 W).'
                noMargin
              >
                <input
                  id='heaterWattage'
                  type='number'
                  min='300'
                  max='1500'
                  className='input input-bordered w-full'
                  value={autotuneWattage}
                  onChange={e => setAutotuneWattage(Number.parseInt(e.target.value, 10) || 0)}
                  placeholder='680'
                />
              </SettingsFormField>
            </div>

            <div className='pt-2'>
              <button
                type='button'
                className='btn btn-primary'
                onClick={onStartAutotune}
                disabled={
                  autotuneTime < 30 ||
                  autotuneTime > 300 ||
                  autotuneSamples < 4 ||
                  autotuneSamples > 20 ||
                  autotuneWattage < 300 ||
                  autotuneWattage > 1500
                }
              >
                Start Autotune
              </button>
            </div>
          </div>
        )}
      </Section>

      {/* Water Tank Calibration Section */}
      <Section title='Water Tank Calibration'>
        <div className='alert alert-warning text-sm'>
          Empty the tank completely, press Set Empty. Then fill it to the top and press Set Full.
        </div>
        <div className='flex flex-wrap items-center gap-4 py-2'>
          <div className='text-sm'>
            <span className='text-base-content/60'>Current reading:</span>{' '}
            <span className='font-mono font-bold tabular-nums'>{waterRaw ?? '—'}</span>
          </div>
          <div className='text-sm'>
            <span className='text-base-content/60'>Level:</span>{' '}
            <span className='font-mono font-bold tabular-nums'>
              {waterPercent !== null && waterPercent >= 0
                ? Math.round(waterPercent) + '%'
                : 'uncalibrated'}
            </span>
          </div>
        </div>
        <div className='flex gap-2'>
          <button
            type='button'
            className='btn btn-primary btn-sm'
            onClick={() => calibrateWater('empty')}
          >
            Set Empty
          </button>
          <button
            type='button'
            className='btn btn-primary btn-sm'
            onClick={() => calibrateWater('full')}
          >
            Set Full
          </button>
          {waterMsg && <span className='text-success self-center text-sm'>{waterMsg}</span>}
        </div>
      </Section>
      {/* Pump Flow Tuning Section */}
      <Section title='Pump Flow Calibration'>
        {/* The calibration saves straight to the machine. Tell the form, or the
            next Save Settings sends the old coefficients back. */}
        <PumpFlowCalibration
          currentCoeffs={formData.pumpModelCoeffs}
          onApplied={coeffs => onFieldStored?.('pumpModelCoeffs', coeffs)}
        />
      </Section>
    </div>
  );
}
