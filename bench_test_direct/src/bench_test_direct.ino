// De'longezzi bench test — standalone, no GaggiMate code.
// Direct hardware test of pump dimmer (PSM) + heater SSR.
// AP "BenchTest" (open) -> http://192.168.4.1

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <PSM.h>

// Pins — must match pins.txt / ControllerConfig.h GM_PRO_LEGO
constexpr uint8_t PIN_PUMP_DIM = 21;
constexpr uint8_t PIN_PUMP_ZC = 9;
constexpr uint8_t PIN_SSR = 14;

// PSM: sensePin (ZC), controlPin (DIM), range=100 => duty is a percentage.
// Edge must be FALLING to match DimmedPump in the real firmware - the dimmer
// board's ZC output pulses LOW at each mains zero crossing.
PSM psm(PIN_PUMP_ZC, PIN_PUMP_DIM, 100, FALLING, 2, 4);

WebServer server(80);
bool pumpOn = false;
bool ssrOn = false;

void handleRoot() {
    String html = R"HTML(<!doctype html><html><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Bench Test</title><style>
body{font-family:sans-serif;background:#111;color:#eee;text-align:center;padding:20px}
button{font-size:22px;padding:18px 30px;margin:12px;border-radius:12px;border:none;width:90%}
.pump{background:#d33;color:#fff}.ssr{background:#e90;color:#fff}
.stop{background:#333;color:#eee}.small{font-size:14px;color:#999}
.state{font-size:18px;margin:14px 0}b{color:#6f6}
</style></head><body><h2>De'longezzi Bench</h2>
<div class=state>ZC ticks: <b>__ZC__</b></div>
<div class=state>Pump: <b>__PUMP__</b> &nbsp; SSR: <b>__SSR__</b></div>
<button class=pump onclick="f('pump')">PUMP 100% ON/OFF</button>
<button class=ssr onclick="f('ssr')">SSR ON/OFF</button>
<button class=stop onclick="f('stop')">STOP ALL</button>
<p class=small>Manual latches, no timers. Boiler must be cold for SSR test.</p>
<script>function f(k){fetch('/api?k='+k).then(()=>location.reload())}</script>
</body></html>)HTML";
    html.replace("__ZC__", String(psm.getCounter()));
    html.replace("__PUMP__", pumpOn ? "ON 100%" : "off");
    html.replace("__SSR__", ssrOn ? "ON" : "off");
    server.send(200, "text/html", html);
}

void handleApi() {
    String k = server.arg("k");
    if (k == "pump") {
        pumpOn = !pumpOn;
        psm.set(pumpOn ? 100 : 0);
    } else if (k == "ssr") {
        ssrOn = !ssrOn;
        digitalWrite(PIN_SSR, ssrOn ? HIGH : LOW);
    } else if (k == "stop") {
        pumpOn = false;
        ssrOn = false;
        psm.set(0);
        digitalWrite(PIN_SSR, LOW);
    }
    server.send(200, "application/json", "{\"ok\":true}");
}

void setup() {
    Serial.begin(115200);
    pinMode(PIN_SSR, OUTPUT);
    digitalWrite(PIN_SSR, LOW);
    psm.set(0);

    WiFi.mode(WIFI_AP);
    WiFi.softAP("BenchTest");
    server.on("/", handleRoot);
    server.on("/api", handleApi);
    server.begin();
    Serial.println("Bench test up: http://192.168.4.1");
}

void loop() {
    server.handleClient();
    delay(10);
}
