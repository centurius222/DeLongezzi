import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';

// A dial you turn with a finger (or mouse): the angle travelled around it becomes steps,
// so a number can be set on a phone or tablet without the keyboard. Shot Notes uses it for
// Grind Setting (user 2026-10-09, from the dial mockup). Arrow keys step it too. It floats in
// a square over the dimmed page (phone and PC alike), so the page doesn't grow; a tap on the
// dimmed area, Done or Escape closes it.
//   value      current number
//   steps      the step sizes offered as buttons, e.g. [0.5, 1]
//   perTurn    steps in one full turn
//   onChange   called with the new number on every step
//   onDone     the Done button
export function TurnDial({
  label,
  value,
  unit = '',
  steps = [1],
  defaultStep,
  perTurn = 10,
  min = 0,
  max = 9999,
  onChange,
  onDone,
  children, // shown above the dial (Shot Notes puts the grinder dropdowns here)
}) {
  const [step, setStep] = useState(defaultStep ?? steps[steps.length - 1]);
  const dialRef = useRef(null);
  const drag = useRef({ angle: null, carry: 0 });
  const valueRef = useRef(value);
  valueRef.current = value;

  const decimals = Math.max(step < 1 ? 1 : 0, Number.isInteger(value) ? 0 : 1);
  const shown = (Number(value) || 0).toFixed(decimals);

  const nudge = n => {
    const v = Math.round(((Number(valueRef.current) || 0) + n * step) / step) * step;
    const next = Math.min(max, Math.max(min, Number(v.toFixed(3))));
    if (next !== valueRef.current) {
      valueRef.current = next;
      onChange(next);
      try {
        navigator.vibrate?.(4);
      } catch {
        // no vibration on this device
      }
    }
  };

  const angleOf = e => {
    const r = dialRef.current.getBoundingClientRect();
    return Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2)));
  };
  const onDown = e => {
    dialRef.current.setPointerCapture(e.pointerId);
    drag.current = { angle: angleOf(e), carry: 0 };
  };
  const onMove = e => {
    if (drag.current.angle === null) return;
    const a = angleOf(e);
    let d = a - drag.current.angle;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    drag.current.angle = a;
    const perStep = (2 * Math.PI) / perTurn;
    drag.current.carry += d;
    while (drag.current.carry >= perStep) {
      drag.current.carry -= perStep;
      nudge(1);
    }
    while (drag.current.carry <= -perStep) {
      drag.current.carry += perStep;
      nudge(-1);
    }
  };
  const onUp = () => {
    drag.current.angle = null;
  };

  // The knob sits where the value lands on the ring (one turn = perTurn steps).
  const turns = (Number(value) || 0) / (step * perTurn);
  const a = (((turns % 1) + 1) % 1) * 2 * Math.PI;
  const ticks = Array.from({ length: perTurn }, (_, i) => {
    const t = (i / perTurn) * 2 * Math.PI;
    const r2 = i === 0 ? 66 : 72;
    return (
      <line
        key={i}
        x1={100 + 82 * Math.sin(t)}
        y1={100 - 82 * Math.cos(t)}
        x2={100 + r2 * Math.sin(t)}
        y2={100 - r2 * Math.cos(t)}
        stroke={i === 0 ? 'var(--color-primary)' : 'currentColor'}
        strokeOpacity={i === 0 ? 1 : 0.35}
        strokeWidth={i === 0 ? 3 : 2}
        strokeLinecap='round'
      />
    );
  });

  useEffect(() => {
    const esc = e => e.key === 'Escape' && onDone();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onDone]);

  // On <body>, so no parent's layout or transform can move or clip it.
  return createPortal(
    <div
      className='fixed inset-0 z-[10001] flex items-center justify-center bg-black/55 p-4'
      onPointerDown={e => e.target === e.currentTarget && onDone()}
    >
      <div
        role='dialog'
        aria-label={`Set ${label}`}
        className='bg-base-100 border-base-content/10 grid w-[min(92vw,360px)] justify-items-center gap-3 rounded-2xl border p-5 shadow-2xl'
      >
        {children}
        <div className='text-base-content/60 text-sm font-semibold tracking-wide uppercase'>
          Turn to set {label}
        </div>
        <div
          ref={dialRef}
          role='slider'
          tabIndex={0}
          aria-label={`Turn to set ${label}`}
          aria-valuenow={shown}
          className='relative aspect-square w-[min(78vw,280px)] max-w-full cursor-grab touch-none select-none active:cursor-grabbing'
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onKeyDown={e => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
              nudge(1);
              e.preventDefault();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
              nudge(-1);
              e.preventDefault();
            }
          }}
        >
          <svg
            viewBox='0 0 200 200'
            className='text-base-content block h-full w-full'
            aria-hidden='true'
          >
            <circle
              cx='100'
              cy='100'
              r='88'
              fill='var(--color-base-200)'
              stroke='currentColor'
              strokeOpacity='0.2'
              strokeWidth='2'
            />
            {ticks}
            <circle
              cx={100 + 76 * Math.sin(a)}
              cy={100 - 76 * Math.cos(a)}
              r='11'
              fill='var(--color-primary)'
            />
          </svg>
          <div className='pointer-events-none absolute inset-0 grid place-content-center text-center'>
            <b className='text-5xl font-bold tabular-nums'>{shown}</b>
            <span className='text-base-content/60 mt-1 text-sm'>
              {unit ? `${unit} · ` : ''}one turn = {(step * perTurn).toFixed(step < 1 ? 1 : 0)}
            </span>
          </div>
        </div>
        <div className='flex flex-wrap justify-center gap-2'>
          {steps.map(s => (
            <button
              key={s}
              type='button'
              className={`btn btn-sm rounded-full ${s === step ? 'btn-primary btn-outline' : 'btn-ghost border-base-content/20'}`}
              aria-pressed={s === step}
              onClick={() => setStep(s)}
            >
              Steps of {s}
              {unit ? ` ${unit}` : ''}
            </button>
          ))}
        </div>
        <button type='button' className='btn btn-primary px-8' onClick={onDone}>
          Done
        </button>
      </div>
    </div>,
    document.body,
  );
}
