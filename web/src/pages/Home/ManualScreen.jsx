import PropTypes from 'prop-types';
import { useState } from 'preact/hooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faWeightScale } from '@fortawesome/free-solid-svg-icons/faWeightScale';
import { faExpand } from '@fortawesome/free-solid-svg-icons/faExpand';
import { faCompress } from '@fortawesome/free-solid-svg-icons/faCompress';
import { OverviewChart } from '../../components/OverviewChart.jsx';
import { MODES, fmtElapsed } from './utils.js';
import { useDashboardState } from './useDashboardState.js';
import { WaterLevelCard } from './cards/WaterLevelCard.jsx';
import { BigStepper, CupButton, PressureRow, useManualControls } from './cards/ManualCard.jsx';
import { CardDecor, Decor } from '../../components/Holiday.jsx';
import { chartTimer } from '../../utils/chartTimer.js';

/*
 * Full-screen MANUAL page (user 2026-09-23, from the approved mockup
 * DeLongezzi/mockups/special_screen.html). Shown instead of the dashboard
 * while the machine is in MODE_MANUAL (Home/index.jsx); every other mode keeps
 * the normal dashboard. Shared with it: the mode list (MODES, now with Manual)
 * and the manual logic itself (useManualControls, CupButton, BigStepper,
 * PressureRow from ManualCard.jsx), so this page behaves exactly like the
 * manual card: optimistic controls, stop-at arming, tare rule, cup timer.
 *
 *   tabs      the big full-width mode bar
 *   top row   FLOW | cup | WEIGHT (left)   TEMP | PRESSURE (right), one
 *             height (--top) so the four numbers sit on one line
 *   left      water tank just under the numbers, then temperature, stop at,
 *             pressure
 *   right     the chart under the tiles; tap it to grow over the whole right
 *             half, tap again to shrink (starts small on every visit)
 */

function BigTabs({ mode, showGrindTab, changeMode }) {
  return (
    <div
      data-slot='menu'
      className='card bg-base-100 flex shrink-0 flex-row gap-1.5 overflow-x-auto rounded-xl p-1.5 [scrollbar-width:none]'
    >
      {MODES.filter(m => m.id !== 4 || showGrindTab).map(m => (
        <button
          key={m.id}
          type='button'
          onClick={() => changeMode(m.id)}
          aria-pressed={mode === m.id}
          data-slot='mode-tab'
          data-tab={m.label.toLowerCase()}
          data-active={mode === m.id ? '' : undefined}
          className={`min-w-24 flex-1 rounded-lg px-3 py-2.5 text-lg font-extrabold tracking-wide whitespace-nowrap transition-colors sm:text-[22px] ${
            mode === m.id
              ? 'bg-base-200 text-base-content'
              : 'text-base-content/40 hover:text-base-content/70'
          }`}
        >
          {m.label}
          <Decor pieces={['card-texture']} />
        </button>
      ))}
    </div>
  );
}

BigTabs.propTypes = {
  mode: PropTypes.number,
  showGrindTab: PropTypes.bool,
  changeMode: PropTypes.func.isRequired,
};

// One of the four big numbers. Caption / number / sub line on fixed rows, the
// same in every block, which is what puts all four numbers on one line; top
// and bottom rows are equal (46 px) so that line is the card's middle, level
// with the centre of the cup button (user 2026-09-24).
function Metric({ caption, value, target, sub, dimmed = false, onTap }) {
  // data-part / data-metric: places a holiday pack can style (components/Holiday.jsx).
  const name = caption.toLowerCase();
  return (
    <div
      data-part='metric'
      data-metric={name}
      className='grid h-full min-w-0 grid-rows-[46px_1fr_46px] items-center justify-items-center text-center'
    >
      <div
        data-part='caption'
        data-caption={name}
        className='text-base-content/60 self-start pt-1 text-[13px] font-bold tracking-[0.1em] uppercase'
      >
        {caption}
      </div>
      {/* With onTap (Weight: tare, like its Tare button) the number is a button too. */}
      <div
        data-part='value'
        className={`whitespace-nowrap ${onTap ? 'cursor-pointer select-none active:scale-95' : ''}`}
        role={onTap ? 'button' : undefined}
        tabIndex={onTap ? 0 : undefined}
        aria-label={onTap ? `${caption}: tap to tare` : undefined}
        onClick={onTap}
        onKeyDown={
          onTap
            ? e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onTap())
            : undefined
        }
      >
        <span
          className={`text-[length:clamp(40px,3.8vw,70px)] leading-none font-extrabold tracking-tight tabular-nums ${
            dimmed ? 'text-base-content/30' : 'text-base-content'
          }`}
        >
          {value}
        </span>
        {target != null && (
          <span className='text-success ml-1.5 text-[length:clamp(15px,1.5vw,24px)] font-extrabold'>
            <span className='text-base-content/40 mr-0.5 font-normal'>/</span>
            {target}
          </span>
        )}
      </div>
      <div data-part='sub' className='text-base-content/60 text-[17px]'>
        {sub}
      </div>
    </div>
  );
}

Metric.propTypes = {
  onTap: PropTypes.func,
  caption: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  target: PropTypes.string,
  sub: PropTypes.node,
  dimmed: PropTypes.bool,
};

export function ManualScreen() {
  const ds = useDashboardState();
  const m = useManualControls({
    mode: ds.mode,
    isActive: ds.isActive,
    activate: ds.activate,
    deactivate: ds.deactivate,
    changeMode: ds.changeMode,
    currentWeight: ds.currentWeight ?? 0,
    currentPuckFlow: ds.currentPuckFlow ?? 0,
    bluetoothConnected: ds.bluetoothConnected ?? false,
    manualPressure: ds.manualPressure ?? 0,
    manualWeight: ds.manualWeight ?? 0,
    setManualPressure: ds.setManualPressure,
    setManualWeight: ds.setManualWeight,
    tare: ds.tare,
    targetTemperature: ds.targetTemperature ?? 0,
    currentTemperature: ds.currentTemperature ?? 0,
    raiseTemp: ds.raiseTemp,
    lowerTemp: ds.lowerTemp,
    processInfo: ds.processInfo,
  });
  const [chartBig, setChartBig] = useState(false);

  // Chart.js hides a dataset when its legend entry is tapped; a tap up there
  // must not also resize the chart. At most a quarter of the card: a theme's chart
  // window on a phone is ~75 px tall, and a fixed 48 px left almost nothing to tap.
  const onChartClick = e => {
    const r = e.currentTarget.getBoundingClientRect();
    if (e.clientY - r.top < Math.min(48, r.height / 4)) return;
    setChartBig(big => !big);
  };

  return (
    <div
      data-slot='manual'
      className='flex w-full flex-col gap-3 [--top:190px] lg:h-full lg:[--top:clamp(230px,31vh,290px)]'
    >
      <BigTabs mode={ds.mode} showGrindTab={ds.showGrindTab} changeMode={ds.changeMode} />

      <div
        data-part='columns'
        className='grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,43fr)_minmax(0,57fr)]'
      >
        <section data-unclip className='flex min-h-0 flex-col gap-3 lg:overflow-auto'>
          <div
            data-slot='card'
            data-card='flow'
            className='card bg-base-100 grid h-[var(--top)] shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 rounded-xl p-3.5'
          >
            {/* Live flow while pulling, the shot average once it has finished,
                as on the manual card. */}
            <Metric
              caption='Flow'
              value={m.currentPuckFlow.toFixed(1)}
              sub={!m.running && m.elapsed > 0 ? 'g/s avg' : 'g/s'}
            />
            <CupButton
              running={m.running}
              elapsed={m.elapsed}
              glow={m.glow}
              heatProgress={m.heatProgress}
              onClick={m.togglePump}
              size='min(200px, calc(var(--top) - 36px), 34vw)'
              timeClass='text-[length:clamp(40px,3.8vw,70px)]'
            />
            <Metric
              caption='Weight'
              value={m.bluetoothConnected ? m.currentWeight.toFixed(1) : '--'}
              dimmed={!m.bluetoothConnected}
              onTap={m.canTare ? m.tare : undefined}
              sub={
                <button
                  type='button'
                  onClick={m.tare}
                  disabled={!m.canTare}
                  className='btn btn-primary h-10 min-h-10 gap-2 rounded-full border-0 px-6 text-[17px] font-extrabold shadow-md'
                  title={m.hasFinishedShot ? 'Zero the scale and clear the shot' : 'Zero the scale'}
                >
                  <FontAwesomeIcon icon={faWeightScale} />
                  Tare
                </button>
              }
            />
            <CardDecor />
          </div>

          {ds.waterLevelPercent !== null && (
            <WaterLevelCard waterLevelPercent={ds.waterLevelPercent} large />
          )}

          <div
            data-slot='card'
            data-card='controls'
            className='card bg-base-100 flex min-h-0 flex-col gap-4 rounded-xl p-5 lg:flex-1'
          >
            <BigStepper
              label='Temperature'
              value={m.shownTemp}
              unit='°C'
              onDecrease={() => m.changeTemp(-1)}
              onIncrease={() => m.changeTemp(1)}
            />
            {/* Tapping the number arms/disarms the stop, as on the manual card. */}
            <BigStepper
              label={m.weightArmed ? 'Stop at' : 'Stop at — off'}
              value={m.weightShown}
              unit='g'
              onDecrease={() => m.changeWeight(-1)}
              onIncrease={() => m.changeWeight(1)}
              onValueClick={m.toggleWeightArmed}
              muted={!m.weightArmed}
            />
            <PressureRow value={m.shownPressure} onChange={m.changePressure} />
            <CardDecor />
          </div>
        </section>

        <section className='flex min-h-0 flex-col gap-3'>
          <div
            data-part='metrics-row'
            data-unclip={chartBig ? undefined : ''}
            className={`grid shrink-0 grid-cols-2 gap-3 overflow-hidden transition-all duration-300 ease-out ${
              chartBig ? '-mb-3 h-0 opacity-0' : 'h-[var(--top)] opacity-100'
            }`}
          >
            <div
              data-slot='card'
              data-card='temp'
              className='card bg-base-100 min-h-0 overflow-hidden rounded-xl px-3 py-3.5'
            >
              <Metric
                caption='Temp'
                value={`${(ds.currentTemperature ?? 0).toFixed(1)}°`}
                target={`${Math.round(ds.targetTemperature ?? 0)}°C`}
              />
              <CardDecor />
            </div>
            <div
              data-slot='card'
              data-card='pressure'
              className='card bg-base-100 min-h-0 overflow-hidden rounded-xl px-3 py-3.5'
            >
              <Metric
                caption='Pressure'
                value={(ds.currentPressure ?? 0).toFixed(1)}
                target={`${(ds.targetPressure ?? 0).toFixed(1)} bar`}
              />
              <CardDecor />
            </div>
          </div>

          <div
            data-slot='card'
            data-card='chart'
            className={`card bg-base-100 relative rounded-xl p-3 lg:min-h-0 lg:flex-1 ${
              chartBig ? 'cursor-zoom-out max-lg:h-[62vh]' : 'cursor-zoom-in max-lg:h-[260px]'
            }`}
            onClick={onChartClick}
            title='Tap to enlarge or shrink'
          >
            <OverviewChart className='h-full min-h-0 w-full' />
            {/* The shot timer, big, over the middle of the chart (Settings > Brew Button). */}
            {chartTimer.value.on && (m.running || m.elapsed > 0) && (
              <div
                data-part='chart-timer'
                aria-hidden='true'
                className='pointer-events-none absolute inset-0 flex items-center justify-center font-extrabold tabular-nums'
                style={{
                  opacity: chartTimer.value.opacity,
                  fontSize: `calc(min(26vh, 13vw) * ${chartTimer.value.size})`,
                  lineHeight: 1,
                  color: 'var(--skin-led, var(--color-base-content))',
                  WebkitTextStroke: '2px var(--skin-led-edge, transparent)',
                  paintOrder: 'stroke fill',
                  textShadow: 'var(--skin-led-glow, none)',
                }}
              >
                {fmtElapsed(m.elapsed)}
              </div>
            )}
            <div
              data-part='hint'
              className='text-base-content/40 pointer-events-none absolute top-2 right-3 flex items-center gap-1.5 text-[11px]'
            >
              {chartBig ? 'tap to shrink' : 'tap to enlarge'}
              <FontAwesomeIcon icon={chartBig ? faCompress : faExpand} />
            </div>
            <CardDecor />
          </div>
        </section>
      </div>
      <Decor pieces={['manual-floor']} />
    </div>
  );
}
