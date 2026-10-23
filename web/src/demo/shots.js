// Shot model for the demo site (web/src/demo): turns a profile into a believable shot, one
// 250 ms sample at a time, for the live brew and for the made-up shot history. It is not a
// physics model: pressure follows the phase's target with a lag, the puck lets water through by
// its resistance once it is wet, and the cup fills a moment later.
// The encoders write the machine's own file formats (models/shot_log_format.h), read by
// pages/ShotHistory/parseBinaryShot.js and parseBinaryIndex.js.

export const SAMPLE_MS = 250;

const EXIT = { volumetric: 1, pressure: 2, flow: 3, pumped: 4, duration: 5, aborted: 7 };

// Small seeded random numbers, so a made-up shot looks the same on every visit.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// What a phase asks the pump for. A number is the old "pump power %" form.
function phaseTargets(phase, puckFlow) {
  const pump = phase.pump;
  if (typeof pump !== 'object' || pump === null) {
    const power = typeof pump === 'number' ? pump : 100;
    return { mode: 'pressure', pressure: phase.valve === 0 ? 0 : (9.2 * power) / 100, flow: 0 };
  }
  if (pump.target === 'flow') {
    return {
      mode: 'flow',
      pressure: pump.pressure > 0 ? pump.pressure : 12,
      flow: pump.flow >= 0 ? pump.flow : Math.max(puckFlow, 1.8), // -1: keep the flow it has
    };
  }
  return { mode: 'pressure', pressure: pump.pressure || 0, flow: pump.flow > 0 ? pump.flow : 0 };
}

export class ShotRun {
  constructor(profile, seed = 1) {
    this.profile = profile;
    this.phases = profile.phases?.length ? profile.phases : [{ name: 'Brew', phase: 'brew', duration: 30, pump: 100 }];
    this.noise = random(seed);
    this.tt = profile.temperature || 93;
    this.ct = this.tt + this.noise() * 0.3;
    this.t = 0;
    this.phaseIndex = 0;
    this.phaseStart = 0;
    this.phasePumped = 0;
    this.cp = 0;
    this.pf = 0;
    this.v = 0;
    this.pumped = 0;
    this.wetAt = -1;
    this.samples = [];
    this.transitions = [{ sampleIndex: 0, phaseNumber: 0, phaseName: this.phases[0].name || 'Phase 1', reason: 0 }];
    this.finished = false;
    this.exitReason = 0;
    this.volumetric = this.phases.some(p => (p.targets || []).some(t => t.type === 'volumetric'));
  }

  get phase() {
    return this.phases[this.phaseIndex];
  }

  // Water the cup gets, in grams (what the scale shows).
  get weight() {
    return this.v;
  }

  // One step of 250 ms; returns the sample, or null once the shot is over.
  step() {
    if (this.finished) return null;
    const dt = SAMPLE_MS / 1000;
    const phase = this.phase;
    const wet = this.wetAt >= 0;
    const wetFor = wet ? (this.t - this.wetAt) / 1000 : 0;
    // Bar per ml/s: a fresh puck holds back a bit more, then wears down over the shot.
    const r = (3.9 * (1 + 0.15 * Math.exp(-wetFor / 6)) * (1 - 0.18 * Math.min(wetFor / 30, 1))) * (1 + this.noise() * 0.02);
    const tgt = phaseTargets(phase, this.pf);
    const before = this.cp;
    let tf = 0;
    if (tgt.mode === 'pressure') {
      this.cp += (tgt.pressure - this.cp) * (tgt.pressure < this.cp ? 0.35 : 0.28);
      if (tgt.flow > 0 && wet && this.cp / r > tgt.flow) this.cp = tgt.flow * r;
    } else {
      tf = tgt.flow;
      if (!wet) this.cp += (Math.min(tgt.pressure, 1.6) - this.cp) * 0.15;
      else this.cp = Math.min((this.pf + (tgt.flow - this.pf) * 0.3) * r, tgt.pressure);
    }
    this.cp = clamp(this.cp + this.noise() * 0.06, 0, 12.5);
    const puckFlow = wet ? this.cp / r : 0;
    const filling = wet ? 0 : tgt.mode === 'flow' ? tgt.flow : Math.max(0.6, 3.2 * (1 - this.cp / 9.5));
    const fl = clamp(puckFlow + Math.max(0, this.cp - before) * 1.2 + filling + this.noise() * 0.05, 0, 9);
    this.pumped += fl * dt;
    this.phasePumped += fl * dt;
    if (!wet && this.pumped > 9) this.wetAt = this.t;
    this.pf = puckFlow;
    const dripping = wet && this.t - this.wetAt > 2500;
    const scaleFlow = dripping ? puckFlow * 0.93 : 0;
    this.v += scaleFlow * dt;
    // the group cools a little while water runs, and comes back after
    this.ct += (this.tt - 0.9 * Math.min(fl, 3) / 3 - this.ct) * 0.06 + this.noise() * 0.04;

    const sample = {
      t: this.t,
      tt: this.tt,
      ct: this.ct,
      tp: tgt.mode === 'pressure' ? tgt.pressure : 0,
      cp: this.cp,
      fl,
      tf,
      pf: puckFlow,
      vf: scaleFlow,
      v: this.v,
      ev: dripping ? this.v + puckFlow * 0.6 : 0,
      pr: wet ? r : 0,
      si: 0x0008 | 0x0004 | (this.volumetric ? 0x0001 | 0x0002 : 0),
    };
    this.samples.push(sample);
    this.t += SAMPLE_MS;
    this.checkPhaseEnd();
    return sample;
  }

  checkPhaseEnd() {
    const phase = this.phase;
    const s = { volumetric: this.v, pressure: this.cp, flow: this.pf, pumped: this.phasePumped };
    let reason = 0;
    for (const t of phase.targets || []) {
      const value = s[t.type];
      if (value === undefined) continue;
      const hit = { gte: value >= t.value, gt: value > t.value, lte: value <= t.value, lt: value < t.value }[t.operator];
      // a "lower than" target only counts once the phase has had a moment
      if (hit && (!t.operator.startsWith('l') || this.t - this.phaseStart > 1500)) {
        reason = EXIT[t.type];
        break;
      }
    }
    if (!reason && this.t - this.phaseStart >= (phase.duration || 30) * 1000) reason = EXIT.duration;
    if (!reason && this.t >= 120000) reason = EXIT.duration; // safety stop
    if (!reason) return;
    // a weight target ends the shot; any other target moves on to the next phase
    if (reason === EXIT.volumetric || this.phaseIndex === this.phases.length - 1) {
      this.finish(reason);
      return;
    }
    this.transitions[this.transitions.length - 1].reason = reason;
    this.phaseIndex++;
    this.phaseStart = this.t;
    this.phasePumped = 0;
    this.transitions.push({
      sampleIndex: this.samples.length,
      phaseNumber: this.phaseIndex,
      phaseName: this.phase.name || `Phase ${this.phaseIndex + 1}`,
      reason: 0,
    });
  }

  finish(reason) {
    this.finished = true;
    this.exitReason = reason;
    this.transitions[this.transitions.length - 1].reason = reason;
  }

  // The figures a finished shot keeps in the history index.
  summary() {
    const n = this.samples.length || 1;
    const avg = key => this.samples.reduce((sum, s) => sum + s[key], 0) / n;
    return {
      duration: this.t,
      volume: this.v,
      avgTemp: avg('ct'),
      maxPressure: Math.max(0, ...this.samples.map(s => s.cp)),
      avgFlow: avg('pf'),
    };
  }
}

// Runs a whole shot at once (the made-up history).
export function runShot(profile, seed) {
  const run = new ShotRun(profile, seed);
  while (run.step()) {
    // until the shot is over
  }
  return run;
}

function writeCString(bytes, offset, size, text) {
  const encoded = new TextEncoder().encode(text || '').subarray(0, size - 1);
  bytes.set(encoded, offset);
}

const u16 = v => clamp(Math.round(v), 0, 65535);
const i16 = v => clamp(Math.round(v), -32768, 32767);

// A .slog file, version 5 (512-byte header, all 13 fields, 26 bytes per sample).
export function encodeShot(run, startEpoch) {
  const HEADER = 512;
  const SAMPLE = 26;
  const buffer = new ArrayBuffer(HEADER + run.samples.length * SAMPLE);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  view.setUint32(0, 0x544f4853, true); // 'SHOT'
  view.setUint8(4, 5);
  view.setUint8(5, SAMPLE);
  view.setUint16(6, HEADER, true);
  view.setUint16(8, SAMPLE_MS, true);
  view.setUint32(12, 0x1fff, true);
  view.setUint32(16, run.samples.length, true);
  view.setUint32(20, run.t, true);
  view.setUint32(24, startEpoch, true);
  writeCString(bytes, 28, 32, run.profile.id);
  writeCString(bytes, 60, 48, run.profile.label);
  view.setUint16(108, u16(run.v * 10), true);
  const transitions = run.transitions.slice(0, 12);
  transitions.forEach((tr, i) => {
    const o = 110 + i * 29;
    view.setUint16(o, tr.sampleIndex, true);
    view.setUint8(o + 2, tr.phaseNumber);
    view.setUint8(o + 3, tr.reason);
    writeCString(bytes, o + 4, 25, tr.phaseName);
  });
  view.setUint8(110 + 12 * 29, transitions.length);
  view.setUint8(110 + 12 * 29 + 1, run.exitReason);
  view.setUint16(110 + 12 * 29 + 2, 800, true); // brew delay (ms), the machine's default
  run.samples.forEach((s, i) => {
    const o = HEADER + i * SAMPLE;
    view.setUint16(o, i, true); // tick: the parser multiplies it by the sample interval
    view.setUint16(o + 2, u16(s.tt * 10), true);
    view.setUint16(o + 4, u16(s.ct * 10), true);
    view.setUint16(o + 6, u16(s.tp * 10), true);
    view.setUint16(o + 8, u16(s.cp * 10), true);
    view.setInt16(o + 10, i16(s.fl * 100), true);
    view.setInt16(o + 12, i16(s.tf * 100), true);
    view.setInt16(o + 14, i16(s.pf * 100), true);
    view.setInt16(o + 16, i16(s.vf * 100), true);
    view.setUint16(o + 18, u16(s.v * 10), true);
    view.setUint16(o + 20, u16(s.ev * 10), true);
    view.setUint16(o + 22, u16(s.pr * 100), true);
    view.setUint16(o + 24, s.si, true);
  });
  return buffer;
}

// index.bin / recent.bin: a 32-byte header and one 128-byte entry per shot.
export function encodeIndex(entries, nextId) {
  const buffer = new ArrayBuffer(32 + entries.length * 128);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  view.setUint32(0, 0x58444953, true); // 'SIDX'
  view.setUint16(4, 1, true);
  view.setUint16(6, 128, true);
  view.setUint32(8, entries.length, true);
  view.setUint32(12, nextId, true);
  entries.forEach((e, i) => {
    const o = 32 + i * 128;
    view.setUint32(o, e.id, true);
    view.setUint32(o + 4, e.timestamp, true);
    view.setUint32(o + 8, e.duration, true);
    view.setUint16(o + 12, u16(e.volume * 10), true);
    view.setUint8(o + 14, e.rating || 0);
    view.setUint8(o + 15, (e.deleted ? 0x02 : 0) | 0x01 | (e.hasNotes ? 0x04 : 0));
    writeCString(bytes, o + 16, 32, e.profileId);
    writeCString(bytes, o + 48, 48, e.profileName);
    view.setUint16(o + 96, u16(e.avgTemp * 10), true);
    view.setUint16(o + 98, u16(e.maxPressure * 10), true);
    view.setUint16(o + 100, u16(e.avgFlow * 100), true);
  });
  return buffer;
}
