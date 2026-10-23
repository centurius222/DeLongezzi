// WeighMyBru scale peripheral for XIAO ESP32-S3.
//
// Purpose: a REAL BLE GATT peripheral (NimBLE host) so the De'longezzi machine
// is tested against actual BLE, not the PC BlueZ simulator. Streams the same
// 20-byte WeighMyBru weight frames at 10 Hz over the Nordic UART service.
//
// Touch controls (capacitive touchRead, touch the bare pad — no GND needed):
//   D3 (GPIO4) -> start/stop pour
//   D8 (GPIO7) -> tare
//
// Advertised name "WeighMyBru-Sim" matches the firmware's scale plugin
// (weighmybru.h: deviceName.find("WeighMyBru") == 0).

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <NimBLEDevice.h>
#include <NimBLEServer.h>
#include <NimBLECharacteristic.h>

// ---- Push-in pads to touch -------------------------------------------------
constexpr int TOUCH_POUR = 4;  // D3 — start/stop pour
constexpr int TOUCH_TARE = 7;  // D8 — tare
// Capacitive threshold: raise if false triggers, lower if misses.
constexpr int TOUCH_THRESHOLD = 45;

// WiFi for the web UI control surface (same network/creds as the machine).
const char *WIFI_SSID = "YOUR_WIFI";
const char *WIFI_PASS = "YOUR_PASSWORD";

// ---- WeighMyBru protocol ---------------------------------------------------
static const NimBLEUUID SERVICE_UUID("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
static const NimBLEUUID WEIGHT_UUID("6E400002-B5A3-F393-E0A9-E50E24DCCA9E");
static const NimBLEUUID COMMAND_UUID("6E400003-B5A3-F393-E0A9-E50E24DCCA9E");

constexpr size_t FRAME_LEN = 20;
constexpr uint8_t PRODUCT_ID = 0x03;
constexpr uint8_t MSG_WEIGHT = 0x0B;
constexpr uint8_t MSG_SYSTEM = 0x0A;
constexpr size_t RATE_HZ = 10;

// Pour profile — mirrors the PC sim: dead time, ramp, plateau, taper.
constexpr float DEAD_TIME = 4.0f;
constexpr float RAMP = 3.0f;
constexpr float PEAK_FLOW = 2.1f;   // g/s
constexpr float TAPER_AFTER = 20.0f;

NimBLECharacteristic *gWeightChar = nullptr;

struct State {
  bool running = false;
  float t0 = 0;
  float weight = 0;
  float tareOffset = 0;
  unsigned long lastAdv = 0;
  unsigned long lastStep = 0;  // dt source for the pour integrator
};
State g;

// ---- Touch debounce ---------------------------------------------------------
bool touchPressed(int pin) {
  return touchRead(pin) < TOUCH_THRESHOLD;
}

bool waitRelease(int pin, unsigned long timeoutMs) {
  unsigned long start = millis();
  while (millis() - start < timeoutMs) {
    if (!touchPressed(pin)) return true;
    delay(20);
  }
  return false;
}

// ---- Protocol helpers -------------------------------------------------------
// XOR checksum over bytes [0..FRAME_LEN-2], last byte carries the sum.
uint8_t checksum(const uint8_t *b, size_t n) {
  uint8_t c = 0;
  for (size_t i = 0; i < n - 1; i++) c ^= b[i];
  return c;
}

void buildWeightFrame(byte *f, float grams) {
  memset(f, 0, FRAME_LEN);
  f[0] = PRODUCT_ID;
  f[1] = MSG_WEIGHT;
  f[6] = 43;                     // ASCII '+': positive by default
  long h = (long)(grams * 100.0f + 0.5f);
  if (h < 0) { h = -h; f[6] = 45; }   // ASCII '-' when negative
  if (h > 0xFFFFFF) h = 0xFFFFFF;
  f[7] = (h >> 16) & 0xFF;
  f[8] = (h >> 8) & 0xFF;
  f[9] = h & 0xFF;
  f[FRAME_LEN - 1] = checksum(f, FRAME_LEN);
}

// True if `data` is a WeighMyBru tare command (checksum-validated, or the bare
// documented literal 03 0A 01 01 00 08).
bool isTareCmd(const uint8_t *d, size_t len) {
  if (len < 6 || d[0] != PRODUCT_ID || d[1] != MSG_SYSTEM) return false;
  uint8_t c = 0;
  for (size_t i = 0; i < len - 1; i++) c ^= d[i];
  return c == d[len - 1] || d[5] == 0x08;
}

// ---- GATT server ------------------------------------------------------------
class ServerCallbacks : public NimBLEServerCallbacks {
 public:
  void onConnect(NimBLEServer *) override {
    Serial.println(">> client connected");
  }
  void onDisconnect(NimBLEServer *server) override {
    Serial.println("<< client disconnected");
    // Restart advertising so a dropped peer can find us again.
    NimBLEDevice::startAdvertising();
  }
};

class CommandCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c) override {
    std::string v = c->getValue();
    if (isTareCmd((const uint8_t *)v.data(), v.size())) {
      g.tareOffset += g.weight;
      g.weight = 0.0f;
      Serial.println("    >> TARE received — zeroed");
    } else {
      Serial.printf("    >> cmd: %s\n", std::string(v.begin(), v.end()).c_str());
    }
  }
};

// ---- Pour model (same shape as the PC sim) ----------------------------------
void updatePour(float dt) {
  if (!g.running) return;
  float t = (float)(millis()) / 1000.0f - g.t0;
  float flow = 0.0f;
  if (t < DEAD_TIME) {
    flow = 0.0f;
  } else if (t < DEAD_TIME + RAMP) {
    flow = PEAK_FLOW * (t - DEAD_TIME) / RAMP;
  } else if (t < TAPER_AFTER) {
    flow = PEAK_FLOW;
  } else {
    flow = max(0.15f, PEAK_FLOW * (1.0f - (t - TAPER_AFTER) / 25.0f));
  }
  g.weight += flow * dt;
}

// ---- Web UI control surface (drive pour/tare from a browser) ---------------
WebServer webServer(80);

void handleRoot() {
  const char *page =
      "<!doctype html><html><head><meta charset=utf-8>"
      "<meta name=viewport content='width=device-width,initial-scale=1'>"
      "<title>WeighMyBru Scale</title><style>"
      "body{font:18px system-ui;background:#11151c;color:#e8edf5;display:flex;"
      "flex-direction:column;align-items:center;gap:24px;padding:30px}"
      "h1{font-size:16px;letter-spacing:.14em;text-transform:uppercase;color:#7d8899}"
      "#w{font-size:96px;font-weight:700;font-variant-numeric:tabular-nums}"
      "button{font:700 18px system-ui;padding:18px 30px;border-radius:14px;border:0;"
      "background:#2563eb;color:#fff;min-width:170px;cursor:pointer}"
      "button.alt{background:#334155}button:active{transform:translateY(1px)}"
      "#st{color:#7d8899;font-size:14px}</style></head><body>"
      "<h1>WeighMyBru Scale (XIAO)</h1>"
      "<div id=w>0.00<small>g</small></div><div id=st>idle</div>"
      "<div style='display:flex;gap:12px;flex-wrap:wrap;justify-content:center'>"
      "<button onclick='go(\"pour\")' id=pb>Start pour</button>"
      "<button class=alt onclick='go(\"tare\")'>Tare</button>"
      "<button class=alt onclick='go(\"reset\")'>Reset</button></div>"
      "<script>let l=0,lt=0;async function go(a){await fetch('/api/'+a,{method:'POST'})}"
      "async function t(){try{const r=await fetch('/api/state');const s=await r.json();"
      "document.getElementById('w').innerHTML=s.weight.toFixed(2)+'<small>g</small>';"
      "const n=Date.now()/1000;if(lt){const f=(s.weight-l)/Math.max(.001,n-lt);"
      "document.getElementById('st').textContent=(s.pouring?'pouring':'idle')+' — flow '+"
      "(f>0?f:0).toFixed(2)+' g/s';}l=s.weight;lt=n;"
      "document.getElementById('pb').textContent=s.pouring?'Stop pour':'Start pour';}"
      "catch(e){}}setInterval(t,200);t()</script></body></html>";
  webServer.send(200, "text/html", page);
}

void handleState() {
  char buf[96];
  snprintf(buf, sizeof(buf),
           "{\"weight\":%.2f,\"pouring\":%s}", g.weight,
           g.running ? "true" : "false");
  webServer.send(200, "application/json", buf);
}

void handlePour() {
  g.running = !g.running;
  if (g.running) {
    g.t0 = (float)(millis()) / 1000.0f;
    g.lastStep = millis();
  }
  Serial.println(g.running ? "  -- pour start (web)" : "  -- pour stop (web)");
  handleState();
}

void handleTare() {
  g.tareOffset += g.weight;
  g.weight = 0.0f;
  Serial.println("  -- tare (web)");
  handleState();
}

void handleReset() {
  g.weight = 0.0f;
  g.tareOffset = 0.0f;
  g.running = false;
  Serial.println("  -- reset (web)");
  handleState();
}

// ----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== WeighMyBru scale (XIAO S3) ===");
  Serial.printf("Touch D3 (GPIO%u) = pour start/stop, D8 (GPIO%u) = tare\n",
                TOUCH_POUR, TOUCH_TARE);

  NimBLEDevice::init("WeighMyBru-Sim");
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);  // max TX

  NimBLEServer *server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  NimBLEService *svc = server->createService(SERVICE_UUID);

  gWeightChar = svc->createCharacteristic(
      WEIGHT_UUID,
      NIMBLE_PROPERTY::NOTIFY | NIMBLE_PROPERTY::READ);
  // Non-const handle so we can write to it as the peripheral owner.
  gWeightChar->setValue((uint8_t *)"\0", 1);

  NimBLECharacteristic *cmdChar = svc->createCharacteristic(
      COMMAND_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  cmdChar->setCallbacks(new CommandCallbacks());

  svc->start();

  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setName("WeighMyBru-Sim");
  adv->setScanResponse(true);
  adv->setMinInterval(40);  // ~40ms — fast rediscovery
  adv->setMaxInterval(80);
  // Start advertising BEFORE joining WiFi so BLE is up immediately (the machine
  // can connect while WiFi connects in the background).
  NimBLEDevice::startAdvertising();
  Serial.println("advertising as WeighMyBru-Sim");
  g.t0 = (float)(millis()) / 1000.0f;

  // Join WiFi for the web control surface.
  Serial.printf("joining WiFi '%s'...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long wstart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wstart < 15000) {
    delay(200);
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("WiFi up: http://%s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("WiFi failed to connect (BLE still works)");
  }

  webServer.on("/", handleRoot);
  webServer.on("/api/state", HTTP_GET, handleState);
  webServer.on("/api/pour", HTTP_POST, handlePour);
  webServer.on("/api/tare", HTTP_POST, handleTare);
  webServer.on("/api/reset", HTTP_POST, handleReset);
  webServer.begin();
  Serial.println("web UI ready at /");
}

void loop() {
  webServer.handleClient();

  static unsigned long lastSend = 0;
  static bool lastPour = false, lastTare = false;

  // Touch handling (edge-triggered, debounced)
  bool pNow = touchPressed(TOUCH_POUR);
  if (pNow && !lastPour) {
    if (waitRelease(TOUCH_POUR, 300)) {
      g.running = !g.running;
      if (g.running) {
        g.t0 = (float)(millis()) / 1000.0f;
        g.lastStep = millis();
      }
      Serial.println(g.running ? "  -- pour start" : "  -- pour stop");
    }
  }
  lastPour = pNow;

  bool tNow = touchPressed(TOUCH_TARE);
  if (tNow && !lastTare) {
    if (waitRelease(TOUCH_TARE, 300)) {
      g.tareOffset += g.weight;
      g.weight = 0.0f;
      Serial.println("  -- tare (local)");
    }
  }
  lastTare = tNow;

  // Integrate pour, stream at 10 Hz. `now` and dt are measured from a
  // dedicated last-step clock, NOT lastSend (which only updates inside the
  // RATE_HZ block). Integrating on every loop pass with lastSend's wide dt
  // compounded the weight — the pour ran away to ~50 g/s.
  unsigned long now = millis();
  if (g.running) {
    if (g.lastStep == 0) g.lastStep = now;
    float dt = (now - g.lastStep) / 1000.0f;
    if (dt > 0) {
      if (dt > 0.25f) dt = 0.25f;  // clamp: a stall (e.g. touch block) must not explode weight
      updatePour(dt);
      g.lastStep = now;
    }
  }

  if (now - lastSend >= (1000 / RATE_HZ)) {
    byte f[FRAME_LEN];
    buildWeightFrame(f, g.weight);
    if (gWeightChar != nullptr) {
      gWeightChar->setValue(f, FRAME_LEN);
      if (gWeightChar->getSubscribedCount() > 0) {
        gWeightChar->notify();
      }
    }
    lastSend = now;
  }
}