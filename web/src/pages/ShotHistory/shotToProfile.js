import { grinderName } from '../../utils/grinders.js';
import { basketName } from '../../utils/baskets.js';
import { daysOffRoast, offRoastText } from '../../utils/beans.js';

// "Save as profile" (docs/MANUAL_SHOTS_PLAN.txt): turns a saved shot into an advanced profile.
// A Manual shot is rebuilt from its curve: the pressure slider (target pressure, 4 samples a
// second) is simplified into straight lines, each ramp + hold becomes one pressure step with its
// own temperature, a low opening step is marked pre-infusion, and the last step stops at the
// shot's weight (or the notes' "dose out"), and the shot notes become the description. A profile
// shot is a copy of the profile it ran with, when that still exists.

const MAX_PHASES = 12;
const FLAT_BAR = 0.3; // a line that moves less than this is a hold, not a ramp
const JUMP_S = 0.6; // a ramp shorter than this is a jump (instant transition)
const MIN_PHASE_S = 1.5; // shorter steps are folded into the one before

const round1 = x => Math.round(x * 10) / 10;

// Ramer-Douglas-Peucker: the fewest points that keep every sample within eps bar of the line.
function simplify(points, eps) {
  if (points.length < 3) return points.slice();
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const pa = points[a];
    const pb = points[b];
    let worst = -1;
    let worstDist = eps;
    for (let i = a + 1; i < b; i++) {
      const f = (points[i].t - pa.t) / (pb.t - pa.t || 1);
      const d = Math.abs(points[i].p - (pa.p + (pb.p - pa.p) * f));
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = true;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// Lines -> steps: a ramp and the hold after it share one step (the ramp is its transition).
function toSteps(vertices) {
  const steps = [];
  let ramp = null;
  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const dt = b.t - a.t;
    if (dt <= 0) continue;
    if (Math.abs(b.p - a.p) < FLAT_BAR) {
      if (ramp) {
        steps.push({ start: ramp.start, pressure: ramp.to, ramp: ramp.dt, duration: ramp.dt + dt });
        ramp = null;
      } else {
        const prev = steps[steps.length - 1];
        if (prev && Math.abs(prev.pressure - (a.p + b.p) / 2) < FLAT_BAR) {
          prev.duration += dt; // still holding the same pressure
        } else {
          steps.push({ start: a.t, pressure: (a.p + b.p) / 2, ramp: 0, duration: dt });
        }
      }
    } else if (ramp && Math.sign(b.p - a.p) === Math.sign(ramp.to - ramp.from)) {
      // still climbing (or falling): one ramp
      ramp.to = b.p;
      ramp.dt += dt;
    } else {
      if (ramp)
        steps.push({ start: ramp.start, pressure: ramp.to, ramp: ramp.dt, duration: ramp.dt });
      ramp = { start: a.t, from: a.p, to: b.p, dt };
    }
  }
  if (ramp) steps.push({ start: ramp.start, pressure: ramp.to, ramp: ramp.dt, duration: ramp.dt });

  // Fold steps too short to matter into the one before.
  const merged = [];
  for (const s of steps) {
    const prev = merged[merged.length - 1];
    if (prev && s.duration < MIN_PHASE_S) {
      prev.duration += s.duration;
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

// The shot's notes as the profile's description, so it says how to repeat the shot:
// "From shot #6 · Beans: … · 18 g in → 36 g out (1:2) · Grind 12 · Taste: balanced · 4/5 · …".
export function notesToDescription(shot, notes) {
  const n = notes || {};
  const has = v => v !== undefined && v !== null && String(v).trim() !== '';
  const parts = [`From shot #${shot.id}`];
  if (has(n.beanType)) {
    const off = daysOffRoast(n.bean, shot.timestamp ? new Date(shot.timestamp * 1000) : new Date());
    parts.push(
      `Beans: ${String(n.beanType).trim()}${off != null ? ` (${offRoastText(off)})` : ''}`,
    );
  }
  const dose = [has(n.doseIn) && `${n.doseIn} g in`, has(n.doseOut) && `${n.doseOut} g out`]
    .filter(Boolean)
    .join(' → ');
  if (dose) parts.push(has(n.ratio) ? `${dose} (1:${n.ratio})` : dose);
  const basket = basketName(n.basket);
  if (basket) parts.push(`Basket: ${basket}`);
  const grinder = grinderName(n.grinder);
  if (has(n.grindSetting))
    parts.push(`Grind ${String(n.grindSetting).trim()}${grinder ? ` on ${grinder}` : ''}`);
  else if (grinder) parts.push(`Grinder: ${grinder}`);
  if (Object.keys(n).length && has(n.balanceTaste)) parts.push(`Taste: ${n.balanceTaste}`);
  if (Number(n.rating) > 0) parts.push(`${n.rating}/5`);
  if (Array.isArray(n.flavors) && n.flavors.length)
    parts.push(`Flavours: ${n.flavors.join(', ').toLowerCase()}`);
  if (has(n.notes)) parts.push(String(n.notes).trim());
  return parts.join(' · ');
}

// The weight to stop at: the scale's final weight, else the "dose out" from the notes.
const stopWeight = (shot, notes) => {
  if (shot.volume > 0) return round1(shot.volume);
  const out = parseFloat(notes?.doseOut);
  return out > 0 ? round1(out) : 0;
};

export function curveToProfile(shot, name, notes) {
  const samples = (shot.samples || []).filter(s => !s.systemInfo?.extendedRecording);
  if (samples.length < 4) throw new Error('This shot has no curve to copy.');
  const points = samples.map(s => ({ t: s.t / 1000, p: Math.max(0, s.tp || 0), tt: s.tt || 0 }));

  let eps = 0.25;
  let steps = toSteps(simplify(points, eps));
  while (steps.length > MAX_PHASES && eps < 5) {
    eps *= 1.5;
    steps = toSteps(simplify(points, eps));
  }

  // Each step's temperature: the target you had set while it ran.
  const tempFor = s => {
    const inStep = points.filter(pt => pt.t >= s.start && pt.t < s.start + s.duration && pt.tt > 0);
    const list = inStep.length ? inStep : points.filter(pt => pt.tt > 0);
    return list.length ? Math.round(list.reduce((sum, pt) => sum + pt.tt, 0) / list.length) : 93;
  };

  const highest = Math.max(...steps.map(s => s.pressure));
  const finalWeight = stopWeight(shot, notes);
  const phases = steps.map((s, i) => {
    const pressure = round1(s.pressure);
    const preinfusion = i === 0 && steps.length > 1 && pressure <= 4 && highest >= pressure + 2;
    const isRamp = s.ramp >= JUMP_S;
    const last = i === steps.length - 1;
    let label =
      isRamp && s.ramp >= s.duration - 0.05 ? `Ramp to ${pressure} bar` : `${pressure} bar`;
    if (preinfusion) label = 'Pre-infusion';
    return {
      name: label,
      phase: preinfusion ? 'preinfusion' : 'brew',
      valve: 1,
      // The last step runs on to the weight; its time is only a backstop.
      duration: round1(
        last && finalWeight ? Math.max(s.duration * 1.5, s.duration + 10) : s.duration,
      ),
      temperature: tempFor(s),
      pump: { target: 'pressure', pressure, flow: 0 },
      transition: {
        type: isRamp ? 'linear' : 'instant',
        duration: isRamp ? round1(s.ramp) : 0,
        adaptive: false,
      },
      targets:
        last && finalWeight ? [{ type: 'volumetric', operator: 'gte', value: finalWeight }] : [],
    };
  });

  return {
    label: name,
    type: 'pro',
    description: notesToDescription(shot, notes),
    temperature: phases[0].temperature,
    phases,
  };
}

// The profile to save for this shot: a copy of the one it ran with, or one built from its curve.
export async function shotToProfile(shot, name, apiService, notes) {
  const manual = !shot.profileId || shot.profileId === 'manual';
  if (!manual && apiService) {
    try {
      const res = await apiService.request({ tp: 'req:profiles:load', id: shot.profileId });
      if (res?.profile?.phases) {
        const { id, favorite, selected, ...rest } = res.profile;
        return {
          ...rest,
          label: name,
          utility: false,
          // the notes first, then the profile's own description (often how to use it)
          description: [notesToDescription(shot, notes), rest.description]
            .filter(Boolean)
            .join(' · '),
        };
      }
    } catch {
      // gone or unreadable: build it from the curve instead
    }
  }
  return curveToProfile(shot, name, notes);
}
