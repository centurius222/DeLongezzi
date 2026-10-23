import { useEffect, useRef, useState } from 'preact/hooks';
import {
  DASHBOARD_MODES,
  dashboardModeSignal,
  setDashboardMode,
} from '../../../utils/dashboardManager.js';
import { DashboardSettings } from '../../DashboardSettings/index.jsx';
import Section from '../../../components/Card.jsx';

const SUMMARY = {
  [DASHBOARD_MODES.SIMPLE]: 'Simple: pressure, flow, temperature and weight, no recent shots.',
  [DASHBOARD_MODES.ADVANCED]:
    'Advanced: also pump and heater power, favourite profiles and recent shots.',
  [DASHBOARD_MODES.CUSTOM]: '⬇ Live view, scroll down to adjust the options',
};

const MODES = [
  [DASHBOARD_MODES.SIMPLE, 'Simple'],
  [DASHBOARD_MODES.ADVANCED, 'Advanced'],
  [DASHBOARD_MODES.CUSTOM, 'Custom'],
];

// A live, shrunk copy of the Brew dashboard with sample readings (/?dashpreview): it redraws as
// soon as Simple, Advanced or a Custom option changes (utils/themePreview.js).
const FRAME_W = 1280;
const FRAME_H = 800;
function DashboardPreview({ small = false }) {
  const box = useRef(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const fit = () => setScale((box.current?.clientWidth || 0) / FRAME_W);
    fit();
    const ro = new ResizeObserver(fit);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={box}
      className={`border-base-content/10 bg-base-100 relative w-full overflow-hidden rounded-lg border ${
        small ? 'max-w-xl' : 'max-w-3xl'
      }`}
      style={{ height: FRAME_H * scale }}
    >
      <iframe
        src='/?dashpreview'
        title='Dashboard preview'
        tabIndex={-1}
        className='pointer-events-none absolute top-0 left-0 border-0'
        style={{
          width: FRAME_W,
          height: FRAME_H,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
        }}
      />
    </div>
  );
}

// Settings > Dashboard (user 2026-10-08): the dashboard's look in one place. Simple and Advanced
// are ready-made; Custom shows every option (the pencil's page), and changing any of them
// switches to Custom. Kept in this browser, applied at once (no Save needed).
export function DashboardTab() {
  const mode = dashboardModeSignal.value;
  const custom = mode === DASHBOARD_MODES.CUSTOM;
  return (
    <div className='space-y-4 sm:space-y-6'>
      <Section title='Dashboard'>
        <div className='join'>
          {MODES.map(([value, label]) => (
            <button
              key={value}
              type='button'
              className={`btn join-item ${mode === value ? 'btn-primary' : ''}`}
              onClick={() => setDashboardMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <p
          className={
            custom ? 'text-primary mt-2 text-lg font-bold' : 'text-base-content/70 mt-2 text-sm'
          }
        >
          {SUMMARY[mode]}
        </p>
      </Section>
      {/* Custom: the preview, smaller, stays pinned at the top while the options scroll under it
          (user 2026-10-08). The same element in every mode, so the frame doesn't load again. */}
      <div className={custom ? 'bg-base-300 sticky top-0 z-20 -mx-1 rounded-b-xl px-1 pb-2' : ''}>
        <DashboardPreview small={custom} />
      </div>
      {custom && <DashboardSettings embedded />}
    </div>
  );
}
