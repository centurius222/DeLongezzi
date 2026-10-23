#ifndef BLESCALEPLUGIN_H
#define BLESCALEPLUGIN_H
#include "../core/Plugin.h"
#include "remote_scales.h"
#include "remote_scales_plugin_registry.h"
#include <mutex>

void on_ble_measurement(float value);

constexpr unsigned long UPDATE_INTERVAL_MS = 1000;
constexpr unsigned int RECONNECTION_TRIES = 15;
// A healthy BLE scale delivers its first weight notification within ~1 s of
// connecting. Waiting longer than this for one means the ATT layer is wedged
// (service discovery stalled) — see BLEScalePlugin::update() for the teardown.
constexpr unsigned long SUBSCRIBE_TIMEOUT_MS = 5000;

// BLE scanning is duty-cycled, because it is what actually breaks the web UI.
// Measured on the machine: while a scale was connected the status stream held
// exactly 2Hz for minutes on end; every stall (0 messages for 5s at a time,
// ~45s in a row) happened while it was scanning for one. A connected link is
// cheap — short periodic connection events — but the scanner listens at a 20%
// duty AND scans actively, transmitting a scan request for every advertisement
// it hears. WiFi loses the shared radio and the whole UI freezes; the firmware
// stays responsive underneath (commands still acknowledged in 0.33s), which is
// what makes it read as a hang rather than a fault.
//
// So: scan in bursts and leave the radio alone in between. Worst-case discovery
// is BURST+REST, which is a fair trade for a UI that never freezes.
//
// Tuning the NimBLE scan parameters directly was tried and reverted: stopping
// and restarting the scan to apply them broke discovery outright (the machine
// stopped seeing an advertiser it had found seconds before, active or passive),
// and turning active scan off breaks it by itself, because BlueZ publishes the
// local name in the SCAN RESPONSE and the name is what drivers match on. The
// library's own settings are left alone; only WHEN it scans is ours to choose.
constexpr unsigned long SCAN_BURST_MS = 8000;
constexpr unsigned long SCAN_REST_MS = 22000;

// Bluetooth standby between shots (2026-10-19); see updateBtStandby().
constexpr unsigned long BT_NORMAL_HOLD_MS = 10000;      // normal from a pre-start/grind start, and 10 s after a process
constexpr unsigned long BT_STANDBY_REASSERT_MS = 10000; // the radio-sharing state is set again this often

class BLEScalePlugin : public Plugin {
  public:
    BLEScalePlugin();
    ~BLEScalePlugin();

    void setup(Controller *controller, PluginManager *pluginManager) override;
    void loop() override;
    ;

    // connect() and scan() are requests: the BLE task does the Bluetooth work (audit S4-M1).
    void connect(const std::string &uuid);
    void scan();
    void disconnect();
    void onMeasurement(float value) const;
    // Read by other tasks (status stream, web pages): a summary the BLE task refreshes every
    // pass, never the scale object, which the BLE task deletes on every disconnect (audit
    // S4-M1). At most ~1 s old.
    bool isConnected() const { return snapshot().connected; };
    std::string getName() const { return snapshot().name; };
    std::string getUUID() const { return snapshot().address; };
    int getRSSI() const { return snapshot().rssi; };

    std::vector<DiscoveredDevice> getDiscoveredScales() const;
    void tare();

    // Accessors for the native scale fields that drivers optionally expose
    // (see RemoteScales). Each returns a sentinel value if not supported.
    float getFlowRate() const { return scale != nullptr && scale->hasFlowRate() ? scale->getFlowRate() : 0.0f; }
    bool hasFlowRate() const { return scale != nullptr && scale->hasFlowRate(); }
    uint8_t getBatteryLevel() const { return snapshot().battery; }
    bool hasBatteryLevel() const { return snapshot().hasBattery; }
    ScaleWeightUnit getWeightUnit() const {
        return scale != nullptr && scale->hasWeightUnit() ? scale->getWeightUnit() : ScaleWeightUnit::UNKNOWN;
    }
    bool hasWeightUnit() const { return scale != nullptr && scale->hasWeightUnit(); }
    uint32_t getScaleTimerMs() const { return scale != nullptr && scale->hasScaleTimer() ? scale->getScaleTimerMs() : 0; }
    bool hasScaleTimer() const { return scale != nullptr && scale->hasScaleTimer(); }

  private:
    struct Snapshot {
        bool connected = false;
        std::string name, address;
        int rssi = 0;
        bool hasBattery = false;
        uint8_t battery = REMOTE_SCALES_BATTERY_UNKNOWN;
    };
    // snapMutex is only held to copy in or out, never across a NimBLE call (a lock held
    // while waiting for the BLE host, which is inside our weight callback, would freeze).
    mutable std::mutex snapMutex;
    Snapshot snap;
    unsigned long lastRssiAt = 0;
    Snapshot snapshot() const {
        std::lock_guard<std::mutex> guard(snapMutex);
        return snap;
    }
    void refreshSnapshot(); // BLE task only
    void doScan();          // BLE task only (scan() asks for it)
    volatile bool scanRequested = false;
    void update();
    void onProcessStart() const;
    void pollScaleMetadata();

    void establishConnection();

    // establishConnection() ends in NimBLEClient::connect(), which BLOCKS until
    // the peer answers or m_connectTimeout expires — 30 SECONDS by default
    // (NimBLEClient.cpp:63). PluginManager::loop() runs every plugin on ONE task
    // in sequence (Controller.cpp:574), and WebUIPlugin::loop() — which
    // publishes the status stream the whole web UI is drawn from — runs in that
    // same sequence. One slow connect therefore parks the entire interface.
    //
    // The connect runs on its own short-lived task now; the plugin loop starts
    // it and returns. connectInProgress keeps it to one at a time.
    static void connectTask(void *arg);
    volatile bool connectInProgress = false;
    static void bleTask(void *arg);
    xTaskHandle bleTaskHandle = nullptr;
    void pluginLoop();

    // Request flags set by the main-loop event handlers, consumed by the BLE
    // task (pluginLoop). Keeps shot-boundary BLE commands off the main loop.
    volatile bool requestTare = false;
    volatile bool requestStopTimer = false;
    // Scale shot clock (DeLongscali timer_sync_plan.txt): reset at pre-start,
    // start at the shot start, stop at the pump stop. A start counts only
    // within 2 s of a pre-start (a flush has none), and a stop is sent only
    // for a shot whose clock we started, so a flush never touches the clock.
    volatile bool requestResetTimer = false;
    volatile bool requestStartTimer = false;
    volatile unsigned long prestartAt = 0;
    volatile bool clockStarted = false;
    // Run pluginLoop now instead of within UPDATE_INTERVAL_MS, so shot-boundary
    // commands reach the scale at once (the clock would start up to 1 s late).
    void wakeBleTask();
    // Set by mode-change/bluetooth-connect handlers: cut the scan rest window
    // short and start a fresh burst immediately (faster first connect).
    volatile bool wantScan = false;

    // Bluetooth standby (2026-10-19, a switch in Settings > Bluetooth since 938, off by default).
    // With a scale connected, Wi-Fi ran 2.5-3x slower than with it off (935: pictures 50-125 KB/s
    // against 250-300 KB/s), and a slower scale link (930) did not change that, so it is how the
    // chip shares its one radio while a link is up (937 with it: about a third faster). Between shots the
    // radio-sharing is told Bluetooth is on standby (ESP-IDF's BLE status, made for BLE Mesh);
    // from a pre-start or grind start, through any process and 10 s after it, it is back to
    // normal. A test: scale drops show as "SCALE disconnected" in the log. BLE task only, except
    // the two flags below, which the main-loop handlers set.
    void updateBtStandby();
    volatile bool processRunning = false;
    volatile unsigned long normalHoldSince = 0; // last pre-start, grind start or process end (0 = none)
    int btStandby = -1;                         // the state set last (-1 = not yet)
    unsigned long btStandbyAt = 0;
    bool lastConnected = false;

    bool active = false;
    bool doConnect = false;
    std::string uuid;

    unsigned long lastUpdate = 0;
    unsigned long scanPhaseSince = 0; // when the current burst/rest phase began
    bool scanBursting = false;        // true while a burst is running
    unsigned int reconnectionTries = 0;

    // Cached scale-metadata values used to avoid firing an event for each
    // unchanged poll tick. Reset when the scale disconnects.
    uint8_t lastBatteryLevel = REMOTE_SCALES_BATTERY_UNKNOWN;
    ScaleWeightUnit lastWeightUnit = ScaleWeightUnit::UNKNOWN;

    // Dead-link watchdog state. hasReceivedMeasurement flips on the first
    // weight notification of a session; connectArmedAt stamps when the
    // connection attempt started. Both reset in disconnect().
    mutable bool hasReceivedMeasurement = false;
    unsigned long connectArmedAt = 0;

    // Persistent cache of the last known-discovered scales. The RemoteScales
    // scanner clears its own list on every burst restart, which makes the
    // Connections tab flicker between found and "No scales found"; this keeps
    // showing last-known devices across bursts. Cleared on disconnect/reset.
    // mutable: refreshed in getDiscoveredScales() which is const.
    mutable std::vector<DiscoveredDevice> cachedScales;

    // Latch so the mid-brew oz warning + volumetric abort fires once per
    // transition into ounces, not once per sample at ~10 Hz. Reset on
    // disconnect and when the unit returns to grams.
    mutable bool warnedOunceMidBrew = false;

    // Rate limiting for callbacks
    mutable unsigned long lastMeasurementTime = 0;
    static constexpr unsigned long MIN_MEASUREMENT_INTERVAL_MS = 10; // Max 100 measurements per second

    Controller *controller = nullptr;
    PluginManager *pluginManager = nullptr;
    RemoteScalesPluginRegistry *pluginRegistry = nullptr;
    RemoteScalesScanner *scanner = nullptr;
    std::unique_ptr<RemoteScales> scale = nullptr;
};

extern BLEScalePlugin BLEScales;

#endif // BLESCALEPLUGIN_H
