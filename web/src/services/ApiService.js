import { PREVIEW, SAMPLE_STATUS } from '../utils/themePreview.js';
import { rememberThemeSettings } from '../utils/themeManager.js';
import { createContext } from 'preact';
import { signal } from '@preact/signals';
import uuidv4 from '../utils/uuid.js';

function randomId() {
  return Math.random()
    .toString(36)
    .replace(/[^a-z]+/g, '')
    .substr(2, 10);
}

export default class ApiService {
  socket = null;
  listeners = {};
  reconnectAttempts = 0;
  maxReconnectDelay = 30000; // Maximum delay of 30 seconds
  baseReconnectDelay = 1000; // Start with 1 second delay
  reconnectTimeout = null;
  isConnecting = false;

  constructor() {
    if (PREVIEW) {
      // the theme editor's preview: sample readings, no connection (utils/themePreview.js)
      for (let i = 0; i < 40; i++)
        this._onStatus({ ...SAMPLE_STATUS, ct: SAMPLE_STATUS.ct - (40 - i) * 0.05 });
      return;
    }
    console.log('Established websocket connection');
    this.connect();
  }

  async connect() {
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      if (this.socket) {
        this.socket.close();
      }

      const apiHost = window.location.host;
      const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
      this.socket = new WebSocket(`${wsProtocol}${apiHost}/ws`);

      this.socket.addEventListener('message', this._onMessage.bind(this));
      this.socket.addEventListener('close', this._onClose.bind(this));
      this.socket.addEventListener('error', this._onError.bind(this));
      this.socket.addEventListener('open', this._onOpen.bind(this));
    } catch (error) {
      console.error('WebSocket connection error:', error);
      this._scheduleReconnect();
    } finally {
      this.isConnecting = false;
    }
  }

  _onOpen() {
    console.log('WebSocket connected successfully');
    // Tell the machine why this connection is new (Diagnostics request log, user 2026-10-09).
    try {
      const reason = this.dropReason || 'page load';
      const away = this.droppedAt ? Date.now() - this.droppedAt : 0;
      this.socket.send(JSON.stringify({ tp: 'req:hello', reason: `${reason} ${away}ms` }));
    } catch {
      // not important
    }
    this.dropReason = '';
    this.droppedAt = 0;
    this.reconnectAttempts = 0;
    // Back after a drop: a theme switched on another device meanwhile came as an event this page
    // missed. One light request for it (the theme lives in the settings); re-reading everything
    // was 5 requests per page, and several pages coming back together ran the memory down
    // (user 2026-10-09).
    if (this.wasConnected) {
      fetch('/api/settings', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then(s => s && rememberThemeSettings(s))
        .catch(() => {});
    }
    this.wasConnected = true;
    // The machine sends status every 0.5 s. Nothing for 5 s means the link is stuck (it can
    // stay "open" for minutes): drop it and reconnect (user 2026-10-09).
    this.lastStatusAt = Date.now();
    clearInterval(this.staleTimer);
    const socket = this.socket;
    let lastTick = Date.now();
    this.staleTimer = setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) {
        clearInterval(this.staleTimer);
        return;
      }
      const now = Date.now();
      // The page itself was frozen (a slow tablet redrawing): its updates are waiting to be
      // read, the link is fine, so start counting again instead of dropping it.
      if (now - lastTick > 2500) this.lastStatusAt = now;
      lastTick = now;
      if (now - this.lastStatusAt > 5000) {
        console.warn('No status for 5 s, reconnecting');
        this.dropReason = 'no update 5s';
        this.droppedAt = Date.now();
        clearInterval(this.staleTimer);
        // A stuck socket can take long to report closed: open a new one now (connect()
        // closes this one; its late close event is ignored, see _onClose).
        this.connect();
      }
    }, 1000);
    machine.value = {
      ...machine.value,
      connected: true,
    };
  }

  _onClose(event) {
    // Only the current socket counts: one replaced by a reconnect closes late.
    if (event && event.target !== this.socket) return;
    console.log('WebSocket connection closed');
    if (!this.dropReason) {
      this.dropReason = `closed ${event?.code ?? '?'}${event?.wasClean ? ' clean' : ''}`;
      this.droppedAt = Date.now();
    }
    machine.value = {
      ...machine.value,
      connected: false,
    };
    this._scheduleReconnect();
  }

  _onError(error) {
    console.error('WebSocket error:', error);
    if (this.socket) {
      this.socket.close();
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    // Straight back, then every second until it is (user 2026-10-09: the growing waits, up to
    // 30 s, turned a short drop into a long dead page).
    const delay = this.reconnectAttempts === 0 ? 100 : 1000;

    console.log(`Scheduling reconnect attempt ${this.reconnectAttempts + 1} in ${delay}ms`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  _onMessage(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return; // Discard malformed messages to avoid crashing the WS handler.
    }
    const listeners = Object.values(this.listeners[message.tp] || {});
    if (message.tp === 'evt:status') {
      this._onStatus(message);
      this.lastStatusAt = Date.now();
    }
    for (const listener of listeners) {
      listener(message);
    }
  }

  send(event) {
    if (PREVIEW) return;
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(event));
    } else {
      throw new Error('WebSocket is not connected');
    }
  }

  async request(data = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    const returnType = `res:${data.tp.substring(4)}`;
    const rid = uuidv4();
    const message = { ...data, rid };
    return new Promise((resolve, reject) => {
      let timeoutId;

      // Create a listener for the response with matching rid
      const listenerId = this.on(returnType, response => {
        if (response.rid === rid) {
          // Clean up the listener and cancel the timeout to free the closure.
          clearTimeout(timeoutId);
          this.off(returnType, listenerId);
          resolve(response);
        }
      });

      // Send the request
      this.send(message);

      // Timeout: reject if no matching response arrives within 30 seconds
      timeoutId = setTimeout(() => {
        this.off(returnType, listenerId);
        reject(new Error(`Request ${data.tp} timed out`));
      }, 30000); // 30 second timeout
    });
  }

  on(type, listener) {
    const id = randomId();
    if (!this.listeners[type]) {
      this.listeners[type] = {};
    }
    this.listeners[type][id] = listener;
    return id;
  }

  off(type, id) {
    delete this.listeners[type][id];
  }

  _onStatus(message) {
    const newStatus = {
      currentTemperature: message.ct,
      targetTemperature: message.tt,
      currentPressure: message.pr,
      wl: typeof message.wl === 'number' ? message.wl : undefined,
      targetPressure: message.pt,
      targetWeight: message.tw || 0,
      activeTargetWeight: (message?.process?.a && message.tw) || 0,
      currentFlow: message.fl,
      targetFlow: message.tf || 0,
      mode: message.m,
      storageWalkMin: typeof message.sw === 'number' ? message.sw : -1,
      storageWalking: !!message.wk,
      storageNextWalk: typeof message.nw === 'number' ? message.nw : -1,
      wakeMode: message.wm ?? 1,
      manualPressure: message.mp ?? 0,
      manualWeight: message.mw ?? 0,
      selectedProfile: message.p,
      selectedProfileId: message.puid,
      brewTarget: !!message.bt,
      brewTargetDuration: message.btd || 0,
      volumetricAvailable: message.bta || false,
      grindTargetDuration: message.gtd || 0,
      grindTargetVolume: message.gtv || 0,
      grindTarget: message.gt || 0,
      grindActive: message.gact || false,
      currentWeight: message.cw || 0,
      bluetoothConnected: message.bc || false,
      process: message.process || null,
      timestamp: new Date(),
      rssi: message.rssi || 0,
      lat: message.lat || 0,
      tofDistance: message.tof || 0,
      currentPumpPower: message.pw ?? 0,
      currentBoilerPower: message.hp ?? 0,
      currentPuckResistance: message.pkr ?? 0,
      currentPuckFlow: message.pf ?? 0,
      currentCoffeeVolume: message.cv ?? 0,
      machineError: message.err ?? 0,
    };
    const historyEntry = { ...newStatus };
    delete historyEntry.process;
    const newValue = {
      ...machine.value,
      connected: true,
      status: {
        ...machine.value.status,
        ...newStatus,
      },
      capabilities: {
        ...machine.value.capabilities,
        dimming: message.cd,
        pressure: message.cp,
        ledControl: message.led,
        gearpumpAddon: !!message.gp,
      },
      history: [...machine.value.history, historyEntry],
    };
    newValue.history = newValue.history.slice(-600);
    machine.value = newValue;
  }
}

export const ApiServiceContext = createContext(null);

export const machine = signal({
  connected: false,
  status: {
    currentTemperature: 0,
    targetTemperature: 0,
    currentFlow: 0,
    targetFlow: 0,
    mode: 0,
    manualPressure: 0,
    manualWeight: 0,
    selectedProfile: '',
    selectedProfileId: null,
    brewTargetDuration: 0,
    brewTargetVolume: 0,
    grindTargetDuration: 0,
    grindTargetVolume: 0,
    grindTarget: 0,
    grindActive: false,
    process: null,
  },
  capabilities: {
    pressure: false,
    dimming: false,
  },
  history: [],
});

let settingsCache = null;
let settingsData = null;

export const prefetchSettings = () => {
  if (!settingsCache) {
    settingsCache = fetch('/api/settings')
      .then(res => {
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        settingsData = data;
        rememberThemeSettings(data);
        return data;
      })
      .catch(err => {
        settingsCache = null;
        throw err;
      });
  }
  return settingsCache;
};

export const getCachedSettings = () => settingsData;

export const updateSettingsCache = data => {
  settingsData = data;
  rememberThemeSettings(data);
  settingsCache = Promise.resolve(data);
};

export const invalidateSettingsCache = () => {
  settingsData = null;
  settingsCache = null;
};
