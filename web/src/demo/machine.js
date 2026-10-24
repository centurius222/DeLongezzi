// The demo site's fake machine (web/src/demo): answers the page's WebSocket requests the way the
// firmware does (WebUIPlugin.cpp) and sends a status every 0.5 s, with a heater that warms up,
// a brew that follows the selected profile (shots.js) and a shot history kept in memory.
// Nothing leaves the browser; a reload starts over.
import { PROFILES, SETTINGS, STATUS_IDLE, OTA } from './recorded.js';
import { ShotRun, SAMPLE_MS, runShot, encodeShot, encodeIndex } from './shots.js';

const MODE = { STANDBY: 0, BREW: 1, STEAM: 2, WATER: 3, GRIND: 4, MANUAL: 5 };
const DAY = 86400;

// Made-up shots for the history: profile id, days ago, hour, rating, beans, grind, taste
// (no rating: no notes).
const PAST_SHOTS = [
  ['9bar', 6, 8, 4, 'House blend', '2.5', 'balanced'],
  ['adapt', 5, 9, 5, 'Ethiopia Guji', '2.2', 'balanced'],
  ['lever', 4, 7, 4, 'Brazil Santos', '2.8', 'bitter'],
  ['Wq1rhfF5r5', 3, 8, 3, 'House blend', '2.4', 'sour'],
  ['lmleva', 2, 10, 5, 'Colombia Huila', '2.6', 'balanced'],
  ['adapt', 1, 8, 4, 'Ethiopia Guji', '2.2', 'balanced'],
  ['9bar', 0, 7, 0],
];

function volumeTarget(profile) {
  for (const phase of profile?.phases || []) {
    const t = (phase.targets || []).find(t => t.type === 'volumetric');
    if (t) return t.value;
  }
  return 0;
}

export class DemoMachine {
  constructor() {
    this.settings = structuredClone(SETTINGS);
    // Opens with Christmas and "Auto themes by date" off: with it on, a dated theme (all of
    // October: Halloween) locks the theme picker, so visitors couldn't try the others.
    this.settings.holidayMode = 'uchristmasday';
    this.settings.keepTheme = true;
    this.profiles = structuredClone(PROFILES);
    if (!this.profiles.some(p => p.selected) && this.profiles.length) this.profiles[0].selected = true;
    this.mode = MODE.MANUAL; // opens on the Manual screen, where the themes show
    this.ct = 92.6;
    this.pressure = 0;
    this.flow = 0;
    this.weight = 0;
    this.process = null;
    this.run = null;
    this.manualPressure = 9;
    this.sockets = new Set();
    this.shots = [];
    this.nextId = 1;
    this.makeHistory();
    setInterval(() => this.step(), SAMPLE_MS);
    setInterval(() => this.broadcast(this.status()), 500);
  }

  selected() {
    return this.profiles.find(p => p.selected) || this.profiles[0];
  }

  targetTemp() {
    if (this.mode === MODE.STANDBY) return 0;
    if (this.mode === MODE.STEAM) return this.settings.targetSteamTemp || 145;
    if (this.mode === MODE.WATER) return this.settings.targetWaterTemp || 80;
    return this.selected()?.temperature || 93;
  }

  makeHistory() {
    const now = Math.floor(Date.now() / 1000);
    const midnight = new Date().setHours(0, 0, 0, 0) / 1000; // the visitor's own morning hours
    for (const [profileId, daysAgo, hour, rating, beanType, grindSetting, balanceTaste] of PAST_SHOTS) {
      const profile = this.profiles.find(p => p.id === profileId) || this.profiles[0];
      const when = Math.min(midnight - daysAgo * DAY + hour * 3600 + 23 * 60, now - 3600);
      const id = this.addShot(runShot(profile, this.nextId * 7919), when, rating);
      if (!rating) continue;
      const shot = this.shots[this.shots.length - 1];
      const doseOut = (Math.round(shot.entry.volume * 10) / 10).toFixed(1);
      shot.notes = { id, rating, beanType, doseIn: '18.0', doseOut, ratio: '', grindSetting, balanceTaste, notes: '' };
      shot.entry.hasNotes = true;
    }
  }

  addShot(run, timestamp, rating = 0) {
    const id = this.nextId++;
    const summary = run.summary();
    this.shots.push({
      entry: {
        id,
        timestamp,
        rating,
        profileId: run.profile.id,
        profileName: run.profile.label,
        ...summary,
      },
      file: encodeShot(run, timestamp),
      notes: {},
    });
    return id;
  }

  indexFile(limit) {
    const live = this.shots.filter(s => !s.entry.deleted).map(s => s.entry);
    const entries = limit ? live.slice(-limit) : this.shots.map(s => s.entry);
    return encodeIndex(entries, this.nextId);
  }

  shotFile(id) {
    return this.shots.find(s => s.entry.id === id && !s.entry.deleted)?.file || null;
  }

  // ---- the machine running ------------------------------------------------------------------

  step() {
    const tt = this.targetTemp();
    if (this.run) {
      const s = this.run.step();
      if (s) {
        this.ct = s.ct;
        this.pressure = s.cp;
        this.flow = s.pf;
        this.weight = s.v;
        this.puckResistance = s.pr;
        this.targetPressure = s.tp;
        this.targetFlow = s.tf;
        const phase = this.run.phase;
        const volumetricTarget = (phase.targets || []).find(t => t.type === 'volumetric');
        this.process = {
          a: 1,
          s: phase.phase === 'brew' ? 'brew' : 'infusion',
          l: phase.name || 'Brew',
          e: this.run.t,
          tt: volumetricTarget ? 'volumetric' : 'time',
          pt: volumetricTarget ? volumetricTarget.value : (phase.duration || 0) * 1000,
          pp: volumetricTarget ? s.v : this.run.t - this.run.phaseStart,
        };
      } else {
        this.finishShot();
      }
      return;
    }
    // heating towards the target, cooling in standby
    const goal = tt || 24;
    this.ct += (goal - this.ct) * (tt ? 0.02 : 0.004) + (Math.random() - 0.5) * 0.05;
    this.pressure += (0 - this.pressure) * 0.3;
    this.flow *= 0.5;
    if (this.process?.a && this.mode === MODE.WATER) {
      this.pressure = 1.2 + (Math.random() - 0.5) * 0.1;
      this.flow = 3 + (Math.random() - 0.5) * 0.2;
    }
    if (this.process?.a && this.process.s === 'manual') {
      this.pressure = this.manualPressure * 0.97 + (Math.random() - 0.5) * 0.1;
      this.flow = this.pressure / 4.2;
      this.weight += this.flow * 0.23;
      // a weight target ("Stop at") ends it there, like the firmware's ManualProcess
      const target = this.manualWeight || 0;
      const elapsed = Date.now() - this.manualStart;
      this.process = { ...this.process, e: elapsed, tt: target ? 'volumetric' : 'time', pt: target, pp: target ? this.weight : elapsed };
      if (target && this.weight >= target) this.process = { ...this.process, a: 0, l: 'Finished' };
    }
  }

  startProcess() {
    if (this.run || this.process?.a) return;
    if (this.mode === MODE.BREW) {
      this.run = new ShotRun(this.selected(), Date.now() & 0xffff);
      this.shotStarted = Math.floor(Date.now() / 1000);
      this.weight = 0;
    } else if (this.mode === MODE.MANUAL) {
      this.manualStart = Date.now();
      this.weight = 0;
      this.process = { a: 1, s: 'manual', l: 'Manual', e: 0, tt: 'time', pt: 0, pp: 0 };
    } else {
      // steam and hot water: the firmware only says that something runs (WebUIPlugin)
      this.process = { a: 1 };
    }
  }

  stopProcess() {
    if (this.run) {
      this.run.finish(7); // aborted
      this.finishShot();
      return;
    }
    if (this.process) this.process = { ...this.process, a: 0, ...(this.process.l ? { l: 'Finished' } : {}) };
  }

  finishShot() {
    const run = this.run;
    this.run = null;
    if (!run) return;
    this.process = { ...(this.process || {}), a: 0, l: 'Finished' };
    this.targetPressure = 0;
    this.targetFlow = 0;
    const summary = run.summary();
    this.broadcast({ tp: 'evt:shot-finished-stats', maxPressure: summary.maxPressure, avgFlow: summary.avgFlow });
    if (run.t >= 15000) {
      const id = this.addShot(run, this.shotStarted);
      this.broadcast({ tp: 'evt:history-shot-saved', id });
    }
  }

  status() {
    const profile = this.selected();
    const total = (profile?.phases || []).reduce((sum, p) => sum + (p.duration || 0), 0);
    const tw = volumeTarget(profile);
    return {
      ...STATUS_IDLE,
      tp: 'evt:status',
      ct: Math.round(this.ct * 1000) / 1000,
      tt: this.targetTemp(),
      pr: Math.max(0, Math.round(this.pressure * 100) / 100),
      fl: Math.max(0, Math.round(this.flow * 100) / 100),
      pt: this.run ? this.targetPressure : this.mode === MODE.MANUAL ? this.manualPressure : 0,
      tf: this.run ? this.targetFlow : 0,
      m: this.mode,
      mp: this.manualPressure,
      mw: this.manualWeight || 0,
      p: profile?.label || '',
      puid: profile?.id || '',
      tw,
      bta: 1,
      bt: tw ? 1 : 0,
      btd: total,
      rssi: -52,
      lat: 18,
      pw: this.run ? Math.min(100, Math.round(this.flow * 30)) : 0,
      hp: this.mode !== MODE.STANDBY && this.ct < this.targetTemp() - 0.3 ? 60 : 0,
      bw: Math.round(this.weight * 10) / 10,
      cw: Math.round(this.weight * 10) / 10,
      bc: true,
      pkr: this.run ? this.puckResistance : 0,
      // manual: the flow from the scale (WebUIPlugin)
      pf: this.run || (this.process?.a && this.process.s === 'manual') ? Math.round(this.flow * 100) / 100 : 0,
      err: 0,
      ...(this.process ? { process: this.process } : {}),
    };
  }

  // ---- the page's WebSocket ------------------------------------------------------------------

  broadcast(message) {
    for (const socket of this.sockets) socket.deliver(message);
  }

  profilesList() {
    return this.profiles.map(p => ({ ...p }));
  }

  // Returns the answer to a request (or null), as the firmware would send it.
  handle(msg) {
    const { tp, rid } = msg;
    const reply = (fields = {}) => ({ tp: `res:${tp.substring(4)}`, rid, ...fields });
    switch (tp) {
      case 'req:hello':
      case 'req:log-note':
        return null;
      case 'req:profiles:list':
        return reply({ profiles: this.profilesList() });
      case 'req:profiles:load': {
        const profile = this.profiles.find(p => p.id === msg.id);
        return profile ? reply({ profile: { ...profile } }) : reply({ error: 'Profile not found' });
      }
      case 'req:profiles:save': {
        const profile = { ...msg.profile };
        if (!profile.id) profile.id = Math.random().toString(36).slice(2, 12);
        const i = this.profiles.findIndex(p => p.id === profile.id);
        if (i >= 0) this.profiles[i] = { ...this.profiles[i], ...profile };
        else this.profiles.push({ favorite: false, selected: false, ...profile });
        this.notice('saved in this browser only');
        return reply({ profile });
      }
      case 'req:profiles:delete':
        this.profiles = this.profiles.filter(p => p.id !== msg.id);
        if (!this.profiles.some(p => p.selected) && this.profiles.length) this.profiles[0].selected = true;
        return reply({});
      case 'req:profiles:select':
        for (const p of this.profiles) p.selected = p.id === msg.id;
        return reply({});
      case 'req:profiles:favorite':
      case 'req:profiles:unfavorite': {
        const p = this.profiles.find(p => p.id === msg.id);
        if (p) p.favorite = tp.endsWith(':favorite');
        return reply({});
      }
      case 'req:profiles:reorder': {
        const order = msg.order || [];
        this.profiles.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        return reply({});
      }
      case 'req:change-mode':
        this.mode = Number(msg.mode) || 0;
        if (!this.process?.a) this.process = null;
        return reply({});
      case 'req:process:activate':
        this.startProcess();
        return reply({});
      case 'req:process:deactivate':
        this.stopProcess();
        return reply({});
      case 'req:process:clear':
        if (!this.process?.a) this.process = null;
        return reply({});
      case 'req:grind:activate':
        this.notice('a grinder would run on a real machine');
        return reply({});
      case 'req:flush:start':
        this.notice('a flush would run on a real machine');
        return reply({});
      case 'req:tare':
        this.weight = 0;
        return reply({});
      case 'req:manual-pressure':
        this.manualPressure = Number(msg.pressure ?? this.manualPressure);
        return reply({});
      case 'req:manual-weight':
        this.manualWeight = Number(msg.weight ?? 0);
        return reply({});
      case 'req:raise-temp':
      case 'req:lower-temp': {
        const p = this.selected();
        if (p) p.temperature = (p.temperature || 93) + (tp === 'req:raise-temp' ? 1 : -1);
        return reply({});
      }
      case 'req:history:notes:get': {
        const shot = this.shots.find(s => String(s.entry.id) === String(msg.id));
        return reply({ notes: shot?.notes || {} });
      }
      case 'req:history:notes:save': {
        const shot = this.shots.find(s => String(s.entry.id) === String(msg.id));
        if (shot) {
          shot.notes = msg.notes || {};
          shot.entry.hasNotes = true;
          if (shot.notes.rating !== undefined) shot.entry.rating = Number(shot.notes.rating) || 0;
        }
        this.notice('saved in this browser only');
        return reply({});
      }
      case 'req:history:delete': {
        const shot = this.shots.find(s => String(s.entry.id) === String(msg.id));
        if (shot) shot.entry.deleted = true;
        return reply({});
      }
      case 'req:history:delete-all':
        for (const s of this.shots) s.entry.deleted = true;
        return reply({});
      case 'req:history:rename': {
        const shot = this.shots.find(s => String(s.entry.id) === String(msg.id));
        if (shot) Object.assign(shot.entry, { profileId: msg.profileId, profileName: msg.profileName });
        return reply({});
      }
      case 'req:history:rebuild':
        this.shots = this.shots.filter(s => !s.entry.deleted);
        setTimeout(() => this.broadcast({ tp: 'evt:history-rebuild-progress', status: 'completed', total: this.shots.length, current: this.shots.length }), 600);
        return reply({});
      case 'req:ota-settings':
        return { ...OTA, rid };
      case 'req:autotune-start':
        this.notice('autotune needs a real machine');
        setTimeout(() => this.broadcast({ tp: 'evt:autotune-failed', error: 'demo' }), 1500);
        return reply({});
      case 'req:theme':
        // a theme pick or the "Auto themes" switch: kept like a setting, no reply (WebUIPlugin)
        if (typeof msg.holidayMode === 'string' && msg.holidayMode) this.settings.holidayMode = msg.holidayMode;
        if (typeof msg.keepTheme === 'boolean') this.settings.keepTheme = msg.keepTheme;
        return null;
      default:
        return reply({});
    }
  }

  // set by install.js: shows the "demo only" note
  notice() {}
}
