import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { GROUPS, FLAVOR_COLOR } from '../utils/flavors.js';

// Shot Notes' flavour picker (user 2026-10-09, from the flavour wheel mockup): tap a group on
// the wheel, tap its flavours (any groups), then Done, or "Add custom notes" to go on typing.
// Floats over the dimmed page like the turn dial; a tap outside or Escape closes it unchanged.
//   initial   flavours already in the notes
//   onDone    (picked, typeMore) -> the card writes them into Notes
//   onClose   closed without changes
export function FlavorWheel({ initial = [], onDone, onClose }) {
  const [picked, setPicked] = useState(initial);
  const [open, setOpen] = useState(() => {
    const first =
      initial[0] &&
      GROUPS.findIndex(g => (g.items || Object.values(g.subs).flat()).includes(initial[0]));
    return first >= 0 ? first : 0;
  });

  useEffect(() => {
    const esc = e => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  const toggle = f =>
    setPicked(list => (list.includes(f) ? list.filter(x => x !== f) : [...list, f]));

  // The wheel: one wedge per group, its picked count on the label.
  const n = GROUPS.length;
  const cx = 150;
  const cy = 150;
  const R = 146;
  const r = 52;
  const pt = (rad, a) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
  const wedges = GROUPS.map((g, i) => {
    const a0 = (i / n) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
    const d = `M${pt(r, a0)} L${pt(R, a0)} A${R},${R} 0 0 1 ${pt(R, a1)} L${pt(r, a1)} A${r},${r} 0 0 0 ${pt(r, a0)} Z`;
    const am = (a0 + a1) / 2;
    const tx = cx + 100 * Math.cos(am);
    const ty = cy + 100 * Math.sin(am);
    let rot = (am * 180) / Math.PI;
    if (rot > 90 || rot < -90) rot += 180;
    const count = picked.filter(f => FLAVOR_COLOR[f] === g.color).length;
    return (
      <g
        key={g.name}
        role='button'
        tabIndex={0}
        aria-label={g.name}
        aria-pressed={i === open}
        className='cursor-pointer outline-none'
        style={{ opacity: i === open ? 1 : 0.45 }}
        onClick={() => setOpen(i)}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpen(i))}
      >
        <path d={d} fill={g.color} stroke='var(--color-base-100)' strokeWidth='2' />
        <text
          x={tx}
          y={ty}
          textAnchor='middle'
          dominantBaseline='middle'
          transform={`rotate(${rot} ${tx} ${ty})`}
          fill='#160f0a'
          style={{ font: '700 10.5px system-ui, sans-serif', pointerEvents: 'none' }}
        >
          {g.short || g.name}
          {count ? ` · ${count}` : ''}
        </text>
      </g>
    );
  });

  const g = GROUPS[open];
  const flavorButton = f => {
    const on = picked.includes(f);
    return (
      <button
        key={f}
        type='button'
        aria-pressed={on}
        onClick={() => toggle(f)}
        // Plain button, not daisyUI's .btn: the theme styles paint .btn backgrounds over ours.
        className={`min-h-9 cursor-pointer rounded-lg border px-3 py-2 text-sm font-semibold ${on ? 'border-transparent text-[#160f0a]' : 'border-base-content/15 text-base-content bg-base-200'}`}
        style={on ? { backgroundColor: g.color } : undefined}
      >
        {f}
      </button>
    );
  };

  return createPortal(
    <div
      className='fixed inset-0 z-[10001] flex items-center justify-center bg-black/60 p-3'
      onPointerDown={e => e.target === e.currentTarget && onClose()}
    >
      <div
        role='dialog'
        aria-label='Pick flavours'
        className='bg-base-100 border-base-content/10 grid max-h-[calc(100%-8px)] w-[min(96vw,560px)] gap-3 overflow-y-auto rounded-2xl border p-4 shadow-2xl'
      >
        <div className='text-base-content/60 text-center text-sm font-bold tracking-wide uppercase'>
          Flavours
        </div>

        <div className='flex min-h-9 flex-wrap items-center gap-1.5'>
          {picked.length ? (
            picked.map(f => (
              <button
                key={f}
                type='button'
                onClick={() => toggle(f)}
                aria-label={`Remove ${f}`}
                className='inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-semibold text-[#160f0a]'
                style={{ background: FLAVOR_COLOR[f] }}
              >
                {f}
                <span className='font-extrabold opacity-70'>×</span>
              </button>
            ))
          ) : (
            <span className='text-base-content/60 text-sm'>
              Nothing picked yet: tap a group, then its flavours.
            </span>
          )}
        </div>

        <div className='aspect-square w-[min(84vw,340px)] max-w-full justify-self-center'>
          <svg viewBox='0 0 300 300' className='block h-full w-full'>
            {wedges}
            <circle cx='150' cy='150' r='48' fill='var(--color-base-200)' />
            <text
              x='150'
              y='146'
              textAnchor='middle'
              fill='currentColor'
              style={{ font: '800 14px system-ui' }}
            >
              {picked.length}
            </text>
            <text
              x='150'
              y='163'
              textAnchor='middle'
              fill='currentColor'
              opacity='0.6'
              style={{ font: '600 10px system-ui' }}
            >
              picked
            </text>
          </svg>
        </div>

        <div className='grid gap-2'>
          <div className='flex items-center gap-2 font-extrabold'>
            <i className='inline-block h-3 w-3 rounded-full' style={{ background: g.color }} />
            {g.name}
          </div>
          {g.subs ? (
            Object.entries(g.subs).map(([sub, list]) => (
              <div key={sub} className='grid gap-1.5'>
                <div className='text-base-content/60 text-xs font-bold tracking-wide uppercase'>
                  {sub}
                </div>
                <div className='flex flex-wrap gap-2'>{list.map(flavorButton)}</div>
              </div>
            ))
          ) : (
            <div className='flex flex-wrap gap-2'>{g.items.map(flavorButton)}</div>
          )}
        </div>

        <div className='flex flex-wrap justify-center gap-2.5 pt-1'>
          <button
            type='button'
            className='btn btn-primary px-8'
            onClick={() => onDone(picked, false)}
          >
            Done
          </button>
          <button
            type='button'
            className='btn btn-primary btn-outline'
            onClick={() => onDone(picked, true)}
          >
            Add custom notes
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// The wheel in miniature (Shot Notes' "Coffee flavour wheel" button): the same coloured wedges.
export function FlavorWheelIcon({ size = 96 }) {
  const n = GROUPS.length;
  const c = 50;
  const R = 48;
  const r = 16;
  const pt = (rad, a) => `${c + rad * Math.cos(a)},${c + rad * Math.sin(a)}`;
  return (
    <svg viewBox='0 0 100 100' width={size} height={size} aria-hidden='true' className='block'>
      {GROUPS.map((g, i) => {
        const a0 = (i / n) * 2 * Math.PI - Math.PI / 2;
        const a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
        return (
          <path
            key={g.name}
            d={`M${pt(r, a0)} L${pt(R, a0)} A${R},${R} 0 0 1 ${pt(R, a1)} L${pt(r, a1)} A${r},${r} 0 0 0 ${pt(r, a0)} Z`}
            fill={g.color}
            stroke='var(--color-base-100)'
            strokeWidth='1'
          />
        );
      })}
      <circle cx={c} cy={c} r={r - 2} fill='var(--color-base-200)' />
    </svg>
  );
}
