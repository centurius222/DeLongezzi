import PropTypes from 'prop-types';
import { CardDecor } from '../../../components/Holiday.jsx';

// large: the bigger variant on the full-screen MANUAL page (ManualScreen.jsx).
export function WaterLevelCard({ waterLevelPercent, inCard = false, large = false }) {
  const pct = Math.round(waterLevelPercent);
  // color stops by level: 100% green -> 50% purple -> 20% yellow -> 0% red
  const stops = [
    [0, [239, 68, 68]], // red
    [20, [234, 179, 8]], // yellow
    [50, [168, 85, 247]], // purple
    [100, [34, 197, 94]], // green
  ];
  const hi = stops.findIndex(([p]) => pct <= p);
  const [p1, c1] = stops[hi <= 0 ? 1 : hi];
  const [p0, c0] = stops[hi <= 0 ? 0 : hi - 1];
  const u = p1 === p0 ? 0 : (pct - p0) / (p1 - p0);
  const mix = c0.map((v, i) => Math.round(v + (c1[i] - v) * u));
  const color = `rgb(${mix[0]} ${mix[1]} ${mix[2]})`;

  return (
    <div
      data-slot={inCard ? undefined : 'card'}
      data-card={inCard ? undefined : 'tank'}
      className={
        inCard
          ? 'flex flex-col gap-1.5'
          : `card bg-base-100 flex flex-col rounded-xl ${large ? 'gap-2.5 px-5 py-4' : 'gap-1.5 p-3'}`
      }
    >
      <div className='flex items-center justify-between'>
        <div
          data-part='caption'
          data-caption='tank'
          className={`text-base-content/50 font-semibold tracking-wider uppercase ${large ? 'text-xs' : 'text-[0.6rem]'}`}
        >
          Water Tank
        </div>
        <div
          data-part='pct'
          className={`font-bold tabular-nums ${large ? 'text-lg' : 'text-xs'}`}
          style={{ color }}
        >
          {pct}%
        </div>
      </div>
      <div
        className={`bg-base-content/10 w-full overflow-hidden rounded-full ${large ? 'h-3' : 'h-2'}`}
      >
        <div
          data-slot='tank-bar'
          className='h-full rounded-full transition-all duration-500 ease-out'
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      {!inCard && <CardDecor />}
    </div>
  );
}

WaterLevelCard.propTypes = {
  waterLevelPercent: PropTypes.number.isRequired,
  inCard: PropTypes.bool,
  large: PropTypes.bool,
};
