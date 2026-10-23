#include "Controller.h"
#include "ArduinoJson.h"
#include "esp_coexist.h"
#include "esp_sntp.h"
#include "esp_partition.h"
#include "esp_wifi.h"
#include <DlzLog.h>
#include <LittleFS.h>
#include <SD_MMC.h>
#include <algorithm>
#include <cmath>
#include <ctime>
#include <display/plugins/WaterLevelPlugin.h>
#include <display/config.h>
#include <display/core/constants.h>
#include <display/core/process/BrewProcess.h>
#include <display/core/process/GrindProcess.h>
#include <display/core/process/ManualProcess.h>
#include <display/core/process/PumpProcess.h>
#include <display/core/process/SteamProcess.h>
#include <display/core/static_profiles.h>
#include <display/core/zones.h>
#include <display/plugins/AutoWakeupPlugin.h>
#include <display/plugins/BoilerFillPlugin.h>
#include <display/plugins/LedControlPlugin.h>
#include <display/plugins/ShotHistoryPlugin.h>
#include <display/plugins/SmartGrindPlugin.h>
#include <display/plugins/WebUIPlugin.h>
#ifndef GAGGIMATE_SIM // network/BLE plugins are device-only
#include <display/plugins/BLEScalePlugin.h>
#include <display/plugins/HomekitPlugin.h>
#include <display/plugins/ImprovPlugin.h>
#include <display/plugins/MQTTPlugin.h>
#include <display/plugins/NetworkWatchdogPlugin.h>
#include <display/plugins/WifiStaWatchdogPlugin.h>
#include <display/plugins/mDNSPlugin.h>
#endif
#include <display/util/PsramAllocator.h>
#ifndef GAGGIMATE_HEADLESS
#ifdef GAGGIMATE_SIM
#include <SdlDriver.h> // desktop SDL panel stands in for the hardware drivers
#else
#include <Preferences.h>
#include <display/drivers/AmoledDisplayDriver.h>
#include <display/drivers/LilyGoDriver.h>
#include <display/drivers/WaveshareDriver.h>
#endif
#endif

const String LOG_TAG = F("Controller");

void Controller::setup() {
    mode = MODE_STANDBY;

    // Web assets are served from this partition. LittleFS (not SPIFFS): SPIFFS
    // has no directory tree, so stat()/exists() is O(whole filesystem) and a
    // miss scans every page -- the web handler does that synchronously in the
    // async_tcp task for every request, which under a multi-tab load burst
    // pegged CPU0 for >5s and tripped the task watchdog (reboot). LittleFS
    // lookups are O(path). maxOpenFiles 16 for concurrent asset serving. [GM-90]
    if (!LittleFS.begin(false, "/littlefs", 16)) {
        // Format only a storage that was never formatted (a new board reads all
        // 0xFF). Any other mount error keeps the data: format-on-fail wiped every
        // profile, shot and theme after one bad mount (audit S2-M5).
        const esp_partition_t *part = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_ANY, "spiffs");
        bool blank = part != nullptr;
        uint8_t buf[256];
        for (size_t off = 0; blank && off < 8192; off += sizeof(buf)) {
            if (esp_partition_read(part, off, buf, sizeof(buf)) != ESP_OK) {
                blank = false;
                break;
            }
            for (uint8_t b : buf) {
                if (b != 0xFF) {
                    blank = false;
                    break;
                }
            }
        }
        if (blank && LittleFS.begin(true, "/littlefs", 16)) {
            ESP_LOGW("Controller", "Storage was blank: formatted (new board)");
        } else {
            ESP_LOGE("Controller", "Storage mount FAILED - not formatting, the data is kept");
            dlzlog("storage mount FAILED");
        }
    }
    dlzlog_persist();
    dlzlog_mem("storage");

#ifndef GAGGIMATE_HEADLESS
    setupPanel();
#endif

    pluginManager = new PluginManager();
#ifndef GAGGIMATE_HEADLESS
    ui = new DefaultUI(this, driver, pluginManager);
    if (driver->supportsSDCard() && driver->installSDCard()) {
        sdcard = true;
        ESP_LOGI(LOG_TAG, "SD Card detected and mounted");
        ESP_LOGI(LOG_TAG, "Used: %lluMB, Capacity: %lluMB", SD_MMC.usedBytes() / 1024 / 1024, SD_MMC.cardSize() / 1024 / 1024);
    }
#endif
    FS *fs = &LittleFS;
    if (sdcard) {
        fs = &SD_MMC;
    }
    profileManager = new ProfileManager(fs, "/p", settings, pluginManager);
    profileManager->setup();
#ifndef GAGGIMATE_SIM // mDNS/HomeKit are device-only
    if (settings.isHomekit())
        pluginManager->registerPlugin(new HomekitPlugin(settings.getWifiSsid(), settings.getWifiPassword()));
    else
        pluginManager->registerPlugin(new mDNSPlugin());
#endif
    if (settings.isBoilerFillActive()) {
        pluginManager->registerPlugin(new BoilerFillPlugin());
    }
    if (settings.isSmartGrindActive()) {
        pluginManager->registerPlugin(new SmartGrindPlugin());
    }
#ifndef GAGGIMATE_SIM // MQTT/HomeAssistant is device-only
    if (settings.isHomeAssistant()) {
        pluginManager->registerPlugin(new MQTTPlugin());
    }
#endif
    pluginManager->registerPlugin(new WebUIPlugin());
#ifndef GAGGIMATE_SIM // WiFi watchdogs and BLE scales are device-only
    pluginManager->registerPlugin(new NetworkWatchdogPlugin());
    pluginManager->registerPlugin(new WifiStaWatchdogPlugin());
    pluginManager->registerPlugin(new ImprovPlugin());
#endif
    pluginManager->registerPlugin(&ShotHistory);
#ifndef GAGGIMATE_SIM
    pluginManager->registerPlugin(&BLEScales);
#endif
    pluginManager->registerPlugin(new LedControlPlugin());
    pluginManager->registerPlugin(new AutoWakeupPlugin());
    // Bench plugins (PressureSensorPlugin/PumpSimPlugin) retired: they were
    // ADC-pot stand-ins for pre-hardware testing. PressureSensorPlugin kept
    // overwriting the real ADS1115 pressure with floating-pin noise from
    // GPIO3 (the old bench pot pin), causing dashboard graph jitter.
    // Pressure now comes solely from the controller half's sensor data.
    pluginManager->registerPlugin(new WaterLevelPlugin());
    pluginManager->setup(this);
    dlzlog_mem("plugins");

    pluginManager->on("profiles:profile:save", [this](Event const &event) {
        String id = event.getString("id");
        if (id == profileManager->getSelectedProfile().id) {
            this->handleProfileUpdate();
        }
    });

    pluginManager->on("profiles:profile:select", [this](Event const &event) { this->handleProfileUpdate(); });

#ifndef GAGGIMATE_HEADLESS
    ui->init();
#endif
    this->onScreenReady();

    updateLastAction();
    // The shot logic (progress, weight stop, phases, control, keepalive ping). On core 0 it
    // sat below the web server (async_tcp prio 10) and Wi-Fi, so a burst of page loads
    // delayed weight stops (audit S2-M1). Without a screen, core 1 is nearly idle (main
    // loop prio 1, controller half prio 2), so it runs there; with a screen, core 1 draws
    // it, so it stays on core 0 as in the original.
#ifdef GAGGIMATE_HEADLESS
    constexpr BaseType_t logicCore = 1;
#else
    constexpr BaseType_t logicCore = 0;
#endif
    if (xTaskCreatePinnedToCore(loopLogicTask, "Controller::loopLogic", configMINIMAL_STACK_SIZE * 6, this, 3, &logicTaskHandle,
                                logicCore) != pdPASS) {
        // No shot logic means no control at all: start over rather than run without it.
        ESP_LOGE("Controller", "Shot logic task could not be created, restarting");
        delay(1000);
        ESP.restart();
    }
}

void Controller::onScreenReady() { screenReady = true; }

void Controller::onTargetToggle() { settings.setVolumetricTarget(!settings.isVolumetricTarget()); }

void Controller::onTargetChange(ProcessTarget target) { settings.setVolumetricTarget(target == ProcessTarget::VOLUMETRIC); }

void Controller::connect() {
    lastPing = millis();
    connectStartTime = millis();
    pluginManager->trigger("controller:startup");

    dlzlog_mem("before-wifi");
    setupWifi();
    dlzlog_mem("wifi");
    setupBluetooth();
    dlzlog_mem("bluetooth");
    pluginManager->on("ota:update:start", [this](Event const &) { this->updating = true; });
    pluginManager->on("ota:update:end", [this](Event const &) { this->updating = false; });

    updateLastAction();
    initialized = true;
}

#ifndef GAGGIMATE_HEADLESS
// NVS values for the cached panel detection result (GM-140) — only append, never renumber
enum PanelModel : uint8_t { PANEL_UNKNOWN = 0, PANEL_LILYGO = 1, PANEL_AMOLED = 2, PANEL_WAVESHARE = 3 };

void Controller::setupPanel() {
#ifdef GAGGIMATE_SIM
    driver = SdlDriver::getInstance(); // desktop SDL panel
    driver->init();
#else
    // The panel can't change after flashing, so cache the detection result in NVS
    // and skip the multi-second probing chain on subsequent boots (GM-140).
    Preferences panelPrefs;
    panelPrefs.begin("panel", false);
    uint8_t model = panelPrefs.getUChar("driver", PANEL_UNKNOWN);
    if (model != PANEL_UNKNOWN) {
        // Drop the cache before init so a crash here falls back to full detection
        panelPrefs.remove("driver");
        switch (model) {
        case PANEL_LILYGO:
            driver = LilyGoDriver::getInstance();
            break;
        case PANEL_AMOLED:
            if (AmoledDisplayDriver::getInstance()->selectVariant(panelPrefs.getChar("variant", -1)))
                driver = AmoledDisplayDriver::getInstance();
            break;
        case PANEL_WAVESHARE:
            driver = WaveshareDriver::getInstance();
            break;
        }
    }
    if (driver == nullptr) {
        if (LilyGoDriver::getInstance()->isCompatible()) {
            driver = LilyGoDriver::getInstance();
            model = PANEL_LILYGO;
        } else if (AmoledDisplayDriver::getInstance()->isCompatible()) {
            driver = AmoledDisplayDriver::getInstance();
            model = PANEL_AMOLED;
            panelPrefs.putChar("variant", AmoledDisplayDriver::getInstance()->getVariant());
        } else if (WaveshareDriver::getInstance()->isCompatible()) {
            driver = WaveshareDriver::getInstance();
            model = PANEL_WAVESHARE;
        } else {
            Serial.println("No compatible display driver found");
            delay(10000);
            ESP.restart();
        }
    }
    driver->init();
    panelPrefs.putUChar("driver", model);
    panelPrefs.end();
#endif
}
#endif

// Parse a comma-separated float string ("a,b,c,d") into `out`. Missing fields
// are left at `def` -- used so pump-model coeffs can carry NaN to signal
// two-point flow-measurement mode, and an absent PID Kf defaults to 0.
static void parseFloatCsv(const String &csv, float *out, size_t count, float def) {
    for (size_t i = 0; i < count; i++)
        out[i] = def;
    int start = 0;
    for (size_t i = 0; i < count; i++) {
        if (start > csv.length())
            break;
        int comma = csv.indexOf(',', start);
        String token = (comma < 0) ? csv.substring(start) : csv.substring(start, comma);
        token.trim();
        if (token.length() > 0)
            out[i] = token.toFloat();
        if (comma < 0)
            break;
        start = comma + 1;
    }
}

void Controller::setupBluetooth() {
    comms.init("GPBLC");
    comms.onConnectionChanged([this](bool connected) {
        // Force a full control resend after any (re)connect -- the controller
        // starts with no state and updateControl() otherwise only sends deltas.
        controlStateSent = false;
        if (connected) {
            // Re-assert the connection interval for the fresh link (e.g. tight
            // again if we reconnected mid-shot).
            applyConnectionPriority(true);
        } else if (initialized) {
            pluginManager->trigger("controller:bluetooth:disconnect");
            waitingForController = true;
            setMode(MODE_STANDBY);
        }
    });
    comms.onSystemInfo([this](const char *hardware, const char *version, uint32_t protocolVersion, bool dimming, bool pressure,
                              bool ledControl, bool tof, vector<uint32_t> addons) {
        onSystemInfo(hardware, version, protocolVersion, dimming, pressure, ledControl, tof, addons);
    });
    comms.onIncompatibleController([this](const String &info) { onIncompatibleController(info); });
    // A controller OTA streams the firmware over this BLE link; the relaxed idle
    // interval makes that crawl. Force a low-latency interval for the duration of
    // a controller flash, then restore. (A display OTA is Wi-Fi-bound, so leave
    // BLE relaxed to keep radio airtime for the download.)
    pluginManager->on("ota:update:start", [this](Event const &event) {
        if (event.getString("component") != "display") {
            connLowLatency = true;
            comms.setLowLatency(true);
            // Streaming firmware over BLE -> BLE must win the shared radio, same
            // as during a shot. Without this it would run against the new
            // idle WiFi-preference and crawl. Restored by applyConnectionPriority
            // on ota:update:end. [GM-90]
            esp_coex_preference_set(ESP_COEX_PREFER_BT);
        }
    });
    pluginManager->on("ota:update:end", [this](Event const &) { applyConnectionPriority(true); });
    comms.onSensorData([this](float temp, float pressure, float puckFlow, float pumpFlow, float puckResistance, float pumpPower,
                              float heaterPower) {
        onTempRead(temp);
        this->pressure = pressure;
        this->currentPuckFlow = puckFlow;
        this->currentPumpFlow = pumpFlow;
        this->currentPumpPower = pumpPower;
        this->currentHeaterPower = heaterPower;
        this->currentPuckResistance = puckResistance;
        pluginManager->trigger("boiler:pressure:change", "value", pressure);
        pluginManager->trigger("pump:puck-flow:change", "value", puckFlow);
        pluginManager->trigger("pump:flow:change", "value", pumpFlow);
        pluginManager->trigger("pump:puck-resistance:change", "value", puckResistance);
    });
    comms.onButtonState([this](uint8_t index, bool pressed) {
        const int status = pressed ? 1 : 0;
        String behavior = settings.getButtonBehavior(index);
        ESP_LOGV("Controller", "Button %d changed to %d, behavior: %s", index, status, behavior);
        if (behavior == "" || behavior == "none") {
            return;
        }
        if (behavior == "brew") {
            handleBrewButton(status);
            return;
        }
        if (behavior == "steam") {
            handleSteamButton(status);
            return;
        }
        if (behavior == "water") {
            handleWaterButton(status);
            return;
        }
        if (behavior == "flush") {
            // Flush is a one-shot fixed-duration BrewProcess. Trigger on
            // press only; release does nothing so the user can't
            // accidentally cancel mid-flush by letting go (push button)
            // or flipping the rocker back. onFlush() itself is a no-op
            // if a process is already active, so rapid presses don't
            // queue.
            //
            // Ensure we land in MODE_BREW so the flush UI renders, but
            // only when no other process is currently running. Mutating
            // mode mid-process would orphan the active mode's UI while
            // onFlush() silently no-ops on the re-entrancy guard. The
            // setMode guard mirrors the pattern other button handlers
            // use when they need to switch modes safely.
            if (status) {
                if (getMode() == MODE_STANDBY) {
                    deactivateStandby();
                }
                if (getMode() != MODE_BREW && !isActive()) {
                    setMode(MODE_BREW);
                }
                onFlush();
            }
            return;
        }
        handleProfileButton(status, behavior);
    });
    comms.onError([this](int error) {
        // Autotune timeout = info-level, not runaway. Controller already
        // preserved NVS PID. Clear autotuning flag, fire dedicated Web UI
        // event. Don't latch this->error (would gate future setupBluetooth).
        if (error == ERROR_CODE_AUTOTUNE_TIMEOUT) {
            ESP_LOGW(LOG_TAG, "Autotune timed out — previous PID preserved");
            autotuning = false;
            pluginManager->trigger("controller:autotune:failed");
            return;
        }
        if (error != ERROR_CODE_TIMEOUT && error != this->error) {
            this->error = error;
            deactivate();
            setMode(MODE_STANDBY);
            pluginManager->trigger(F("controller:error"));
            ESP_LOGE(LOG_TAG, "Received error %d", error);
        }
    });
    comms.onAutotuneResult([this](float Kp, float Ki, float Kd, float Kf) {
        ESP_LOGI(LOG_TAG, "Received autotune values: Kp=%.3f, Ki=%.3f, Kd=%.3f, Kf=%.3f (combined)", Kp, Ki, Kd, Kf);
        // Guard: older controller firmware could emit zero/NaN gains (#672
        // class). Reject — keep existing PID, surface as "Autotune Failed".
        if (!std::isfinite(Kp) || !std::isfinite(Ki) || !std::isfinite(Kd) || !std::isfinite(Kf) || Kp <= 0.0f ||
            (Kp + Ki + Kd) <= 0.0f) {
            ESP_LOGW(LOG_TAG, "Rejecting autotune result: invalid gains, preserving existing PID");
            autotuning = false;
            pluginManager->trigger("controller:autotune:failed");
            return;
        }
        char pid[64];
        // Store in simplified format with combined Kf
        snprintf(pid, sizeof(pid), "%.3f,%.3f,%.3f,%.3f", Kp, Ki, Kd, Kf);
        settings.setPid(String(pid));
        pluginManager->trigger("controller:autotune:result");
        autotuning = false;
    });
    comms.onVolumetricMeasurement(
        [this](float value) { onVolumetricMeasurement(value, VolumetricMeasurementSource::FLOW_ESTIMATION); });
    comms.onTofMeasurement([this](uint32_t value) {
        tofDistance = static_cast<int>(value);
        ESP_LOGV(LOG_TAG, "Received new TOF distance: %d", tofDistance);
        pluginManager->trigger("controller:tof:change", "value", tofDistance);
    });
    pluginManager->trigger("controller:bluetooth:init");
}

void Controller::onSystemInfo(const char *hardware, const char *version, uint32_t protocolVersion, bool dimming, bool pressure,
                              bool ledControl, bool tof, vector<uint32_t> addons) {
    const bool mismatch = protocolVersion != gm_proto::PROTOCOL_VERSION;
    systemInfo = SystemInfo{.hardware = String(hardware),
                            .version = String(version),
                            .capabilities =
                                SystemCapabilities{
                                    .dimming = dimming,
                                    .pressure = pressure,
                                    .ledControl = ledControl,
                                    .tof = tof,
                                    .addons = addons,
                                },
                            .protocolVersion = protocolVersion,
                            .protocolMismatch = mismatch};
    ESP_LOGI(LOG_TAG, "System info: %s %s (proto=%u local=%u dm=%d ps=%d led=%d tof=%d)", hardware, version, protocolVersion,
             gm_proto::PROTOCOL_VERSION, dimming, pressure, ledControl, tof);
    if (mismatch) {
        ESP_LOGW(LOG_TAG, "Protocol version mismatch: controller=%u display=%u -- control inhibited, OTA only", protocolVersion,
                 gm_proto::PROTOCOL_VERSION);
        pluginManager->trigger("controller:protocol:mismatch", "value", static_cast<int>(protocolVersion));
    } else {
        setPressureScale();
        setPidSettings();
        setPumpModelCoeffs();
        configResendUntil = millis() + CONFIG_RESEND_WINDOW_MS;
        lastConfigResend = millis();
    }

    if (!loaded) {
        loaded = true;
        if (!mismatch && settings.getStartupMode() == MODE_STANDBY)
            activateStandby();
        pluginManager->trigger("controller:ready");
        setMode(settings.getStartupMode());
    }
    pluginManager->trigger("controller:bluetooth:connect");
}

void Controller::onIncompatibleController(const String &infoJson) {
    waitingForController = false;

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, infoJson);
    if (err) {
        ESP_LOGW(LOG_TAG, "Incompatible controller, no readable info (%s)", err.c_str());
        onSystemInfo("Legacy controller", "0.0.0", 0, false, false, false, false, {});
        return;
    }
    String hardware = doc["hw"].as<String>();
    String version = doc["v"].as<String>();
    if (hardware.isEmpty())
        hardware = "Legacy controller";
    if (version.isEmpty())
        version = "0.0.0";
    onSystemInfo(hardware.c_str(), version.c_str(), 0, doc["cp"]["dm"].as<bool>(), doc["cp"]["ps"].as<bool>(),
                 doc["cp"]["led"].as<bool>(), doc["cp"]["tof"].as<bool>(), {});
}

void Controller::setupWifi() {
    // Persist the known default WPA2 AP password on first start (see constants.h);
    // a board that already has one keeps it.
    if (settings.getWifiApPassword().isEmpty()) {
        settings.setWifiApPassword(DEFAULT_WIFI_AP_PASSWORD);
    }

    // Persistent "portal mode" toggle from the UI (/api/portal): true -> come up as the AP/portal,
    // false -> direct connection. The state sticks across reboots until the UI toggles it back.
    const bool forceAp = settings.getBootIntoAp();
    // No built-in Wi-Fi (user 2026-09-25): a board with no saved Wi-Fi (new or
    // fully erased) skips the connect attempt and opens the "GaggiMate" hotspot
    // for setup. Saving Wi-Fi details on its Settings page restarts it into that
    // network (WebUIPlugin::handleSettings), and the firmware image carries no
    // Wi-Fi password. WifiStaWatchdogPlugin arms itself once the details exist.
    const bool noWifi = settings.getWifiSsid().isEmpty();

    if (!forceAp && !noWifi) {
        WiFi.setHostname(settings.getMdnsName().c_str());
        WiFi.mode(WIFI_STA);
#ifdef DELONGEZZI_NO_BLE
        // 2026-10-10: no BLE - the NimBLE host never starts, so modem sleep can be off. This
        // is what removes the 15 s web stall; without it the low-latency routing path applies.
        WiFi.setSleep(false);
#endif
        WiFi.setAutoReconnect(true);
        WiFi.config(INADDR_NONE, INADDR_NONE, INADDR_NONE, INADDR_NONE);

        WiFi.onEvent(
            [this](WiFiEvent_t, WiFiEventInfo_t info) {
                const auto &g = info.got_ip.ip_info;
                const uint32_t ip = g.ip.addr;
                const uint32_t gw = g.gw.addr;
                ESP_LOGI(LOG_TAG, "STA got IP: %u.%u.%u.%u gw=%u.%u.%u.%u", (unsigned)(ip & 0xff), (unsigned)((ip >> 8) & 0xff),
                         (unsigned)((ip >> 16) & 0xff), (unsigned)((ip >> 24) & 0xff), (unsigned)(gw & 0xff),
                         (unsigned)((gw >> 8) & 0xff), (unsigned)((gw >> 16) & 0xff), (unsigned)((gw >> 24) & 0xff));
                dlzlog("WIFI got IP %u.%u.%u.%u", (unsigned)(ip & 0xff), (unsigned)((ip >> 8) & 0xff),
                       (unsigned)((ip >> 16) & 0xff), (unsigned)((ip >> 24) & 0xff));
                wifiDropLogged = false; // the next disconnect is logged again
                wifiConnectedPending = true;
            },
            WiFiEvent_t::ARDUINO_EVENT_WIFI_STA_GOT_IP);
        WiFi.onEvent(
            [](WiFiEvent_t, WiFiEventInfo_t info) {
                const auto &c = info.wifi_sta_connected;
                ESP_LOGI(LOG_TAG, "STA connected: ssid=%.*s bssid=%02x:%02x:%02x:%02x:%02x:%02x ch=%u authmode=%u",
                         (int)c.ssid_len, c.ssid, c.bssid[0], c.bssid[1], c.bssid[2], c.bssid[3], c.bssid[4], c.bssid[5],
                         c.channel, c.authmode);
            },
            WiFiEvent_t::ARDUINO_EVENT_WIFI_STA_CONNECTED);
        WiFi.onEvent(
            [this](WiFiEvent_t, WiFiEventInfo_t info) {
                const auto &d = info.wifi_sta_disconnected;
                const char *name = WiFi.disconnectReasonName(static_cast<wifi_err_reason_t>(d.reason));
                ESP_LOGW(LOG_TAG, "STA disconnected: reason=%u (%s) bssid=%02x:%02x:%02x:%02x:%02x:%02x ssid=%.*s", d.reason,
                         name && *name ? name : "vendor/unknown", d.bssid[0], d.bssid[1], d.bssid[2], d.bssid[3], d.bssid[4],
                         d.bssid[5], (int)d.ssid_len, d.ssid);
                // Only the first disconnect until Wi-Fi is back (build 967, 2026-10-22): the library
                // retries a missing router at once and forever, and each failed try is an event.
                if (!wifiDropLogged) {
                    wifiDropLogged = true;
                    dlzlog("WIFI disconnected reason=%u (%s)", d.reason, name && *name ? name : "vendor/unknown");
                }
                wifiDisconnectedPending = true;
            },
            WiFiEvent_t::ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
        WiFi.onEvent(
            [](WiFiEvent_t, WiFiEventInfo_t) {
                ESP_LOGW(LOG_TAG, "STA lost IP");
                dlzlog("WIFI lost IP");
            },
                     WiFiEvent_t::ARDUINO_EVENT_WIFI_STA_LOST_IP);
        WiFi.onEvent(
            [](WiFiEvent_t, WiFiEventInfo_t info) {
                ESP_LOGW(LOG_TAG, "STA authmode changed: %u -> %u", info.wifi_sta_authmode_change.old_mode,
                         info.wifi_sta_authmode_change.new_mode);
            },
            WiFiEvent_t::ARDUINO_EVENT_WIFI_STA_AUTHMODE_CHANGE);

        const String staSsid = settings.getWifiSsid();
        const String staPass = settings.getWifiPassword();
        ESP_LOGI(LOG_TAG, "Connecting to %s", staSsid.c_str());
        WiFi.begin(staSsid.c_str(), staPass.c_str());
        WiFi.setTxPower(WIFI_POWER_19_5dBm);
        for (int attempts = 0; attempts < WIFI_CONNECT_ATTEMPTS; attempts++) {
            if (WiFi.status() == WL_CONNECTED) {
                break;
            }
            delay(500);
        }
        if (WiFi.status() == WL_CONNECTED) {
            ESP_LOGI(LOG_TAG, "Connected to %s with IP address %s", settings.getWifiSsid().c_str(),
                     WiFi.localIP().toString().c_str());
        } else {
            ESP_LOGW(LOG_TAG, "[fallback] router '%s' not reachable after %d s (status %d): opening the hotspot",
                     staSsid.c_str(), WIFI_CONNECT_ATTEMPTS / 2, (int)WiFi.status());
            // Setup-portal fallback (restored 2026-10-13, fixed 2026-10-14): open the
            // portal hotspot ALONGSIDE the STA client (WIFI_AP_STA below) so a wrong
            // SSID/password can be fixed from the phone at http://4.4.4.1/.
            portalFallback = true;
            // The library retries "network not found" at once and forever
            // (WiFiGeneric.cpp _isReconnectableReason); every retry scans all channels
            // and the hotspot hops along, so a phone could not stay on it. Off while
            // the hotspot is up: loop() tries the router itself, once a minute, only
            // with nobody on the hotspot.
            WiFi.setAutoReconnect(false);
        }
        // Clock either way: SNTP syncs as soon as the network is up (it used to be
        // set up only when the first connect worked).
        configTzTime(resolve_timezone(settings.getTimezone()), NTP_SERVER);
        setenv("TZ", resolve_timezone(settings.getTimezone()), 1);
        tzset();
        sntp_set_sync_mode(SNTP_SYNC_MODE_SMOOTH);
        sntp_setservername(0, NTP_SERVER);
        sntp_init();
    }
    if (forceAp || noWifi || portalFallback) {
        isApConnection = true;
        const String apPassword = settings.getWifiApPassword();
        // WPA2 requires >= 8 chars; fall back to an open AP if somehow shorter.
        const bool secured = apPassword.length() >= WIFI_AP_PASSWORD_MIN_LENGTH;
        // Portal fallback (restored 2026-10-13): keep the STA client alive
        // (WIFI_AP_STA) so the machine still joins the router by itself once
        // it is reachable; forced-portal and no-Wi-Fi boards are AP-only.
        WiFi.mode(portalFallback ? WIFI_AP_STA : WIFI_AP);
        WiFi.softAPConfig(WIFI_AP_IP, WIFI_AP_IP, WIFI_SUBNET_MASK);
        WiFi.softAP(WIFI_AP_SSID, secured ? apPassword.c_str() : nullptr);
        WiFi.setTxPower(WIFI_POWER_19_5dBm);
        if (portalFallback) {
            // A phone that walked away counts as "on the hotspot" until the hotspot
            // drops it (ESP-IDF default about 5 min) and holds off the router tries.
            esp_wifi_set_inactive_time(WIFI_IF_AP, 60);
        }
        // Credentials block so headless users can read the AP login from serial.
        ESP_LOGI(LOG_TAG, "========================================");
        ESP_LOGI(LOG_TAG, "  WiFi Access Point started");
        ESP_LOGI(LOG_TAG, "  SSID:     %s", WIFI_AP_SSID);
        if (secured) {
            ESP_LOGI(LOG_TAG, "  Password: %s", apPassword.c_str());
        } else {
            ESP_LOGI(LOG_TAG, "  Password: <open network>");
        }
        ESP_LOGI(LOG_TAG, "  Web UI:   http://%s/", WIFI_AP_IP.toString().c_str());
        ESP_LOGI(LOG_TAG, "========================================");
    }

    pluginManager->on("ota:update:start", [this](Event const &) { this->updating = true; });
    pluginManager->on("ota:update:end", [this](Event const &) { this->updating = false; });

    // STA path: STA_GOT_IP handler already set wifiConnectedPending; loop()
    // dispatches controller:wifi:connect from there. AP path has no STA_GOT_IP,
    // so it needs the explicit trigger here.
    if (isApConnection) {
        pluginManager->trigger("controller:wifi:connect", "AP", 1);
    }
}

void Controller::loop() {
    dlzlog_tick();
    // Act on WiFi link-state changes flagged by the (small-stack) event task here
    // on the main loop. Disconnect before connect so a flap is ordered correctly.
    if (wifiDisconnectedPending) {
        wifiDisconnectedPending = false;
        pluginManager->trigger("controller:wifi:disconnect");
    }
    if (wifiConnectedPending) {
        wifiConnectedPending = false;
        // Remember the router's address for the hotspot page (saved only when it changes;
        // here on the main loop, not in the small-stack Wi-Fi event).
        const String ip = WiFi.localIP().toString();
        if (ip != "0.0.0.0" && ip != settings.getLastIp())
            settings.setLastIp(ip);
        // Portal fallback: a router try connected. Restart onto the normal startup
        // path rather than switching the hotspot off live (that switch happens in the
        // closed Wi-Fi driver; plan 2026-10-14). Tries stop meanwhile (below).
        if (portalFallback && !fallbackRestartPending) {
            fallbackRestartPending = true;
            ESP_LOGW(LOG_TAG, "[fallback] router reachable again: restarting onto it%s",
                     isActive() ? " once the shot ends" : "");
        }
        pluginManager->trigger("controller:wifi:connect", "AP", isApConnection ? 1 : 0);
    }
    if (portalFallback) {
        // One router try a minute, never with a device on the hotspot (a try scans
        // the channels and the hotspot would hop along), none once one worked.
        const int onHotspot = WiFi.softAPgetStationNum();
        if (!fallbackRestartPending && millis() - lastFallbackTry >= 60000) {
            lastFallbackTry = millis();
            if (onHotspot == 0) {
                ESP_LOGW(LOG_TAG, "[fallback] trying the router '%s'", settings.getWifiSsid().c_str());
                WiFi.begin(settings.getWifiSsid().c_str(), settings.getWifiPassword().c_str());
            } else {
                ESP_LOGW(LOG_TAG, "[fallback] %d device(s) on the hotspot: no router try", onHotspot);
            }
        }
        if (fallbackRestartPending && !isActive()) { // never mid-shot
            ESP_LOGW(LOG_TAG, "[fallback] restarting now");
            settings.save(true); // pending setting changes reach NVS first
            delay(200);
            ESP.restart();
        }
    }

    pluginManager->loop();

    if (screenReady && !initialized) {
        connect();
    }

    if (initialized) {
        extern void noteSlow(const char *what, const void *who, unsigned long ms);
        const unsigned long t = millis();
        comms.loop(); // drive the comms send pump + retransmit
        noteSlow("comms", nullptr, millis() - t);
    }

    unsigned long now = millis();

    // A config burst right after a reconnect can be lost in the unstable BLE window,
    // and a spurious ACK then stops the reliable layer retrying. Re-send until it lands.
    if (comms.isConnected() && now < configResendUntil && (now - lastConfigResend) >= CONFIG_RESEND_INTERVAL_MS) {
        setPressureScale();
        setPidSettings();
        setPumpModelCoeffs();
        lastConfigResend = now;
    }

    // If BLE scanning has been running for a while without finding the controller,
    // notify the UI so it can update the startup label accordingly.
    if (!waitingForController && initialized && !comms.isConnected() &&
        (now - connectStartTime) > CONTROLLER_WAITING_TIMEOUT_MS) {
        waitingForController = true;
        pluginManager->trigger("controller:bluetooth:waiting");
    }

    if (comms.isReadyForConnection() && comms.connectToServer()) {
        waitingForController = false;
    }
}

void Controller::loopLogic() {
    if (isErrorState()) {
        loopControl();
        return;
    }

    // Check if steam is ready
    if (mode == MODE_STEAM && !steamReady && currentTemp + 5.f > getTargetTemp()) {
        activate();
        steamReady = true;
    }

    // Process lifecycle under the lock (GM-147); events and NVS writes deferred past unlock.
    std::vector<const char *> events;
    double newBrewDelay = -1.0;
    double newGrindDelay = -1.0;
    {
        std::lock_guard<std::recursive_mutex> guard(processMutex);

        // Handle current process
        if (currentProcess != nullptr) {
            updateLastAction();
            if (currentProcess->getType() == MODE_BREW) {
                auto brewProcess = static_cast<BrewProcess *>(currentProcess);
                brewProcess->updatePressure(pressure);
                brewProcess->updateFlow(currentPumpFlow);
            }
            currentProcess->progress();
            if (!isActiveLocked()) {
                deactivateLocked(events);
            }
        }

        // Handle last process - Calculate auto delay
        if (lastProcess != nullptr && !lastProcess->isComplete()) {
            lastProcess->progress();
        }
        if (lastProcess != nullptr && lastProcess->isComplete() && !processCompleted && settings.isDelayAdjust()) {
            processCompleted = true;
            if (lastProcess->getType() == MODE_BREW) {
                if (auto *brewProcess = static_cast<BrewProcess *>(lastProcess);
                    brewProcess->target == ProcessTarget::VOLUMETRIC) {
                    newBrewDelay = brewProcess->getNewDelayTime();
                }
            } else if (lastProcess->getType() == MODE_GRIND) {
                if (auto *grindProcess = static_cast<GrindProcess *>(lastProcess);
                    grindProcess->target == ProcessTarget::VOLUMETRIC) {
                    newGrindDelay = grindProcess->getNewDelayTime();
                }
            }
        }
    }
    dispatchEvents(events);
    const double brewDelayBefore = settings.getBrewDelay();
    const double grindDelayBefore = settings.getGrindDelay();
    if (newBrewDelay >= 0) {
        settings.setBrewDelay(newBrewDelay);
    }
    if (newGrindDelay >= 0) {
        settings.setGrindDelay(newGrindDelay);
    }
    // Tell open Settings pages about a learned delay, or their next Save sends
    // the older value back (audit S7-M2).
    if (settings.getBrewDelay() != brewDelayBefore || settings.getGrindDelay() != grindDelayBefore) {
        pluginManager->trigger("controller:settings:learned");
    }

    unsigned long now = millis();

    if (grindActiveUntil != 0 && now > grindActiveUntil)
        deactivateGrind();
    if (mode != MODE_STANDBY && settings.getStandbyTimeout() > 0 && now > lastAction + settings.getStandbyTimeout())
        activateStandby();

    loopControl();
}

void Controller::loopControl() {
    if (initialized) {
        unsigned long now = millis();

        // Keepalive: updateControl() only sends control deltas now, so a steady-state
        // session would otherwise go silent. A periodic ping keeps the controller's
        // connection watchdog fed (sent in all states, including error). Skip it for
        // an incompatible controller -- it can't parse the frame anyway.
        if (comms.isConnected() && !systemInfo.protocolMismatch && now - lastPing >= PING_INTERVAL) {
            comms.sendPing();
            lastPing = now;
            // Full control state with every keepalive (audit S1-H3): after a ping
            // timeout the controller zeroes heater and pump, and on the merged
            // loopback no reconnect ever happens to trigger a resend, so the boiler
            // stayed off while the screen showed it heating.
            controlStateSent = false;
        }

        updateControl();
    }
}

bool Controller::isUpdating() const { return updating; }

bool Controller::isAutotuning() const { return autotuning; }

bool Controller::isReady() const { return !isUpdating() && !isErrorState() && !isAutotuning(); }

bool Controller::isVolumetricAvailable() const {
#ifdef NIGHTLY_BUILD
    return isBluetoothScaleHealthy() || systemInfo.capabilities.dimming;
#else
    return isBluetoothScaleHealthy();
#endif
}

void Controller::autotune(int testTime, int samples, int heaterWattage) {
    if (isActive() || !isReady()) {
        return;
    }
    if (mode != MODE_STANDBY) {
        activateStandby();
    }
    autotuning = true;
    comms.sendAutotune(testTime, samples, heaterWattage);
    pluginManager->trigger("controller:autotune:start");
}

void Controller::startProcess(Process *process) {
    std::vector<const char *> events;
    {
        std::lock_guard<std::recursive_mutex> guard(processMutex);
        startProcessLocked(process, events);
    }
    dispatchEvents(events);
}

void Controller::startProcessLocked(Process *process, std::vector<const char *> &events) {
    if (isActiveLocked() || !isReady()) {
        ESP_LOGW("Controller", "startProcess REFUSED: active=%d ready=%d", isActiveLocked(), isReady());
        delete process;
        return;
    }
    processCompleted = false;
    this->currentProcess = process;
    applyConnectionPriority(); // shot started -> tight BLE interval
    events.push_back("controller:process:start");
    updateLastAction();
}

void Controller::dispatchEvents(const std::vector<const char *> &events) {
    for (const auto *eventId : events) {
        pluginManager->trigger(eventId);
    }
}

void Controller::applyConnectionPriority(bool force) {
    // A running process needs responsive 10Hz control; idle does not. Track the
    // last requested state so we only renegotiate on transitions.
    const bool lowLatency = currentProcess != nullptr;
    if (force || lowLatency != connLowLatency) {
        connLowLatency = lowLatency;
        comms.setLowLatency(lowLatency);
        // Steer the shared-radio coexistence arbiter to match. WiFi and BLE
        // share one 2.4GHz radio; the arbiter decides who wins on contention.
        // During a shot the BLE control loop (7.5-10ms interval, pressure/flow
        // feedback) must win, so prefer BT. When idle there is no tight BLE
        // deadline, so prefer WiFi to keep the web UI / network responsive --
        // the chronic coex failure mode is WiFi getting starved and the whole
        // IP stack wedging. Default coex preference is BALANCE; nobody set this
        // before. Best-effort: ignore the return (no-op if coex inactive). [GM-90]
#ifdef GAGGIMATE_MERGED
        // The merged build has NO BLE control link. Display and controller run
        // on one chip and talk over an in-process loopback, so preferring BT
        // during a shot starves WiFi to protect a radio link that does not
        // exist — the UI freezes for tens of seconds while a shot pulls, which
        // is exactly when you want to reach the stop button.
        //
        // The only BLE user here is the scale: a low-rate notify stream with no
        // hard deadline, which held a connection for four minutes with zero
        // drops under WiFi preference. So WiFi wins unconditionally, shot or no
        // shot.
        //
        // BALANCE was tried here first and is measurably worse than either
        // extreme: in standby, with nothing scanning and no scale attached, the
        // status stream went silent for ~55s and then dumped 119 queued
        // messages in one burst. Under PREFER_WIFI the same state holds a clean
        // 2Hz. Do not "compromise" this value.
        (void)lowLatency;
        esp_coex_preference_set(ESP_COEX_PREFER_WIFI);
#else
        esp_coex_preference_set(lowLatency ? ESP_COEX_PREFER_BT : ESP_COEX_PREFER_WIFI);
#endif
    }
}

float Controller::getTargetTemp() const {
    switch (mode) {
    case MODE_BREW:
    case MODE_GRIND: {
        std::lock_guard<std::recursive_mutex> guard(processMutex);
        Process *proc = currentProcess;
        if (proc != nullptr && proc->isActive() && proc->getType() == MODE_BREW) {
            auto brewProcess = static_cast<BrewProcess *>(proc);
            return brewProcess->getTemperature();
        }
        return profileManager->getSelectedProfile().temperature;
    }
    case MODE_STEAM:
        return settings.getTargetSteamTemp();
    case MODE_WATER:
        return settings.getTargetWaterTemp();
    case MODE_MANUAL:
        // NOT a MODE_BREW fallthrough: manual owns its temperature, so
        // switching profiles never moves the manual target.
        return settings.getTargetManualTemp();
    default:
        return 0;
    }
}

void Controller::setTargetTemp(float temperature) {
    pluginManager->trigger("boiler:targetTemperature:change", "value", temperature);
    switch (mode) {
    case MODE_BREW:
    case MODE_GRIND:
        profileManager->getSelectedProfile().temperature = temperature;
        break;
    case MODE_STEAM:
        settings.setTargetSteamTemp(static_cast<int>(temperature));
        break;
    case MODE_WATER:
        settings.setTargetWaterTemp(static_cast<int>(temperature));
        break;
    case MODE_MANUAL:
        settings.setTargetManualTemp(static_cast<int>(temperature));
        break;
    default:;
    }
    updateLastAction();
}

void Controller::setManualPressureTarget(float pressure) {
    // Persisted (Settings::targetManualPressure), like the manual temperature
    // and weight, so the pressure you left is the one you get after a reboot.
    settings.setTargetManualPressure(std::clamp(pressure, MANUAL_MIN_PRESSURE, MANUAL_MAX_PRESSURE));
    // Riding the slider counts as activity, or the standby timeout could fire
    // mid-shot while nothing else is being touched.
    updateLastAction();
}

void Controller::setManualWeightTarget(float grams) {
    // <= 0 means "off": the shot then runs until the stop button. Read once by
    // activate() when the ManualProcess is built, so changing it mid-shot does
    // not mutate a running process. Persisted (Settings::targetManualWeight),
    // so the target you set is still armed after a reboot.
    const float clamped = std::clamp(grams, 0.0f, MANUAL_MAX_WEIGHT);
    settings.setTargetManualWeight(clamped);
    // Re-arm a RUNNING manual shot too. Arming the stop-at-weight mid-shot used
    // to do nothing — the process kept its target of 0 (no stop) because it was
    // captured at activate(). The panel's tap-to-arm and +/- both land here, so
    // this is what makes "I set 36g mid-pull" actually stop at 36g.
    {
        std::lock_guard<std::recursive_mutex> guard(processMutex);
        if (currentProcess != nullptr && currentProcess->getType() == MODE_MANUAL) {
            static_cast<ManualProcess *>(currentProcess)->setWeightTarget(clamped);
        }
    }
    updateLastAction();
}

void Controller::setPressureScale(void) {
    if (systemInfo.capabilities.pressure) {
        comms.sendPressureScale(settings.getPressureScaling());
    }
}

void Controller::setPumpModelCoeffs(void) {
    if (systemInfo.capabilities.dimming) {
        // Default missing coeffs to NaN so a two-value "a,b" string keeps its
        // flow-measurement semantics (c,d NaN) on the controller side.
        float coeffs[4];
        parseFloatCsv(settings.getPumpModelCoeffs(), coeffs, 4, NAN);
        // a and b are always needed; a cleared or broken field would make the pump
        // model NaN (audit S1-H5), so fall back to the default model.
        if (!std::isfinite(coeffs[0]) || !std::isfinite(coeffs[1]))
            parseFloatCsv(DEFAULT_PUMP_MODEL_COEFFS, coeffs, 4, NAN);
        bool gearpumpEnabled = systemInfo.capabilities.hasAddon(7);
        // Slip is gear-pump only; send zeros otherwise so it stays a no-op.
        float slip[4] = {0.0f, 0.0f, 0.0f, 0.0f};
        if (gearpumpEnabled) {
            parseFloatCsv(settings.getPumpSlipCoeffs(), slip, 4, 0.0f);
        }
        comms.sendPumpSettings(coeffs[0], coeffs[1], coeffs[2], coeffs[3],
                               gearpumpEnabled ? settings.getCommutationGain() : DEFAULT_COMMUTATION_GAIN,
                               gearpumpEnabled ? settings.getConvergenceGain() : DEFAULT_CONVERGENCE_GAIN,
                               gearpumpEnabled ? settings.getIntegralGain() : DEFAULT_INTEGRAL_GAIN, settings.getMaxPumpPower(),
                               slip[0], slip[1], slip[2], slip[3]);
    }
}

void Controller::setPidSettings() {
    float pid[4];
    parseFloatCsv(settings.getPid(), pid, 4, 0.0f);
    comms.sendPidSettings(pid[0], pid[1], pid[2], pid[3]);
#ifdef GAGGIMATE_MERGED
    extern void gmSetHeatUpCheck(bool on);
    gmSetHeatUpCheck(settings.isHeatUpCheck());
#endif
}

int Controller::getTargetGrindDuration() const { return settings.getTargetGrindDuration(); }

void Controller::setTargetGrindDuration(int duration) {
    Event event = pluginManager->trigger("controller:grindDuration:change", "value", duration);
    settings.setTargetGrindDuration(event.getInt("value"));
    updateLastAction();
}

void Controller::setTargetGrindVolume(double volume) {
    Event event = pluginManager->trigger("controller:grindVolume:change", "value", static_cast<float>(volume));
    settings.setTargetGrindVolume(event.getFloat("value"));
    updateLastAction();
}

void Controller::raiseTemp() {
    float temp = getTargetTemp();
    temp = constrain(temp + 1.0f, MIN_TEMP, MAX_TEMP);
    setTargetTemp(temp);
}

void Controller::lowerTemp() {
    float temp = getTargetTemp();
    temp = constrain(temp - 1.0f, MIN_TEMP, MAX_TEMP);
    setTargetTemp(temp);
}

void Controller::raiseBrewTarget() {
    if (isVolumetricAvailable() && profileManager->getSelectedProfile().isVolumetric()) {
        profileManager->getSelectedProfile().adjustVolumetricTarget(1);
    } else {
        profileManager->getSelectedProfile().adjustDuration(1);
    }
    handleProfileUpdate();
}

void Controller::lowerBrewTarget() {
    if (isVolumetricAvailable() && profileManager->getSelectedProfile().isVolumetric()) {
        profileManager->getSelectedProfile().adjustVolumetricTarget(-1);
    } else {
        profileManager->getSelectedProfile().adjustDuration(-1);
    }
    handleProfileUpdate();
}

void Controller::raiseGrindTarget() {
    if (settings.isVolumetricTarget() && isVolumetricAvailable()) {
        double newTarget = settings.getTargetGrindVolume() + 0.5;
        if (newTarget > BREW_MAX_VOLUMETRIC) {
            newTarget = BREW_MAX_VOLUMETRIC;
        }
        setTargetGrindVolume(newTarget);
    } else {
        int newDuration = getTargetGrindDuration() + 1000;
        if (newDuration > BREW_MAX_DURATION_MS) {
            newDuration = BREW_MAX_DURATION_MS;
        }
        setTargetGrindDuration(newDuration);
    }
}

void Controller::lowerGrindTarget() {
    if (settings.isVolumetricTarget() && isVolumetricAvailable()) {
        double newTarget = settings.getTargetGrindVolume() - 0.5;
        if (newTarget < BREW_MIN_VOLUMETRIC) {
            newTarget = BREW_MIN_VOLUMETRIC;
        }
        setTargetGrindVolume(newTarget);
    } else {
        int newDuration = getTargetGrindDuration() - 1000;
        if (newDuration < BREW_MIN_DURATION_MS) {
            newDuration = BREW_MIN_DURATION_MS;
        }
        setTargetGrindDuration(newDuration);
    }
}

void Controller::updateControl() {
    // Never drive a controller whose protocol version we don't match -- the
    // commands could be misinterpreted (OTA recovery still works; see onSystemInfo).
    if (systemInfo.protocolMismatch) {
        return;
    }

    // Hold the process lock across the deref: deactivate()/clear() on other tasks
    // can delete the process mid-computation (GM-147). comms sends are queued
    // (pumped from comms.loop()), so no cross-task blocking happens under the lock.
    std::lock_guard<std::recursive_mutex> guard(processMutex);
    Process *proc = currentProcess;
    bool active = isActiveLocked();

    float targetTemp = getTargetTemp();
    if (targetTemp > .0f) {
        targetTemp = targetTemp + static_cast<float>(settings.getTemperatureOffset());
    }

    bool altRelayActive = false;
    if (active && proc->isAltRelayActive()) {
        if (proc->getType() == MODE_GRIND && settings.getAltRelayFunction() == ALT_RELAY_GRIND) {
            altRelayActive = true;
        }
    }

    // Build the per-component commands, then deliver boiler + pump + valve + alt
    // together in a single batched frame so the controller applies them as one
    // atomic update.
    BoilerCommand boiler;
    boiler.index = 0;
    boiler.setpoint = targetTemp;
    PumpCommand pump;
    pump.index = 0;
    RelayCommand relay; // index 0 = brew valve
    relay.index = 0;

    bool handled = false;
    if (active && systemInfo.capabilities.pressure) {
        // Manual mode: the pump follows a live pressure target the user is
        // riding, not a profile. Keyed on the MODE rather than the process type
        // so there is no doubt which branch owns the pump here.
        if (mode == MODE_MANUAL) {
            relay.open = false; // no brew valve on this build
            pump.mode = PumpControlMode::Pressure;
            pump.pressure = getManualPressureTarget();
            pump.flow = 0.0f;
            targetPressure = pump.pressure;
            targetFlow = 0.0f;
            handled = true;
        } else if (proc->getType() == MODE_STEAM) {
            targetPressure = settings.getSteamPumpCutoff();
            targetFlow = proc->getPumpValue() * 0.1f;
            relay.open = false;
            pump.mode = PumpControlMode::Flow; // flow target, pressure as the limit
            pump.flow = targetFlow;
            pump.pressure = targetPressure;
            handled = true;
        } else if (proc->getType() == MODE_BREW) {
            auto *brewProcess = static_cast<BrewProcess *>(proc);
            if (brewProcess->isAdvancedPump()) {
                const bool pressureTarget = brewProcess->getPumpTarget() == PumpTarget::PUMP_TARGET_PRESSURE;
                relay.open = brewProcess->isRelayActive();
                pump.mode = pressureTarget ? PumpControlMode::Pressure : PumpControlMode::Flow;
                pump.pressure = brewProcess->getPumpPressure();
                pump.flow = brewProcess->getPumpFlow();
                targetPressure = brewProcess->getPumpPressure();
                targetFlow = brewProcess->getPumpFlow();
                handled = true;
            }
        }
    }

    if (!handled) {
        targetPressure = 0.0f;
        targetFlow = 0.0f;
        relay.open = active && proc->isRelayActive();
        pump.mode = PumpControlMode::Power;
        pump.power = active ? proc->getPumpValue() : 0;
    }

    // Only send components that changed since the last update. The controller is
    // stateful and every message is acknowledged, so re-sending unchanged values
    // each cycle is unnecessary; a periodic ping (see loop()) keeps the watchdog
    // fed when nothing changes. controlStateSent is reset on (re)connect to force
    // a full resend.
    gm::Payload batch[4];
    size_t count = 0;
    if (!controlStateSent || boiler != lastBoiler)
        batch[count++] = comms.buildBoilerControl(boiler.index, boiler.mode, boiler.setpoint);
    if (!controlStateSent || pump != lastPump)
        batch[count++] = comms.buildPumpControl(pump.index, pump.mode, pump.power, pump.pressure, pump.flow);
    if (!controlStateSent || relay != lastRelay)
        batch[count++] = comms.buildRelayControl(relay.index, relay.open); // index 0 = brew valve
    if (!controlStateSent || altRelayActive != lastAlt)
        batch[count++] = comms.buildRelayControl(1, altRelayActive); // index 1 = alt relay

    if (count > 0)
        comms.sendBatch(batch, count);

    lastBoiler = boiler;
    lastPump = pump;
    lastRelay = relay;
    lastAlt = altRelayActive;
    controlStateSent = true;
}

void Controller::activate() {
    ESP_LOGI("Controller", "activate(): mode=%d", getMode());
    if (isActive())
        return;
    clear();
    comms.tare();
    // NOTE for manual mode: this block is what points onVolumetricMeasurement()
    // at the scale. It is NOT gated on mode (only the brew:prestart trigger
    // below is), so manual gets BLUETOOTH for free whenever the scale is
    // healthy. When it is not, the source stays INACTIVE and a weight target
    // simply never fires — correct here, because the FLOW_ESTIMATION fallback
    // is valve-gated and this build has no brew valve.
    if (isVolumetricAvailable()) {
#ifdef NIGHTLY_BUILD
        currentVolumetricSource =
            isBluetoothScaleHealthy() ? VolumetricMeasurementSource::BLUETOOTH : VolumetricMeasurementSource::FLOW_ESTIMATION;
#else
        currentVolumetricSource = VolumetricMeasurementSource::BLUETOOTH;
#endif
        // Tares the BLE scale (BLEScalePlugin is the only listener). MANUAL
        // belongs here as much as BREW: its process compares scale weight
        // against a target, so without a tare the leftover in the cup counts as
        // yield — a shot would end in milliseconds with the previous pour still
        // sitting on the platform. Gating this on BREW alone meant manual mode
        // never tared at all.
        if (mode == MODE_BREW || mode == MODE_MANUAL) {
            pluginManager->trigger("controller:brew:prestart");
        }
    }
    delay(200);
    switch (mode) {
    case MODE_BREW:
        // No loadable profile at all (BrewProcess reads phases.at(0)): refuse instead
        // of crashing on every Brew press.
        if (profileManager->getSelectedProfile().phases.empty()) {
            ESP_LOGE("Controller", "Brew refused: the selected profile has no steps");
            break;
        }
        startProcess(new BrewProcess(profileManager->getSelectedProfile(),
                                     profileManager->getSelectedProfile().isVolumetric() && isVolumetricAvailable()
                                         ? ProcessTarget::VOLUMETRIC
                                         : ProcessTarget::TIME,
                                     settings.getBrewDelay()));
        break;
    case MODE_STEAM:
        startProcess(new SteamProcess(STEAM_SAFETY_DURATION_MS, settings.getSteamPumpPercentage()));
        break;
    case MODE_WATER:
        startProcess(new PumpProcess());
        break;
    case MODE_MANUAL:
        // No profile: runs until deactivate(), the weight target, or the
        // safety duration. The weight target is read HERE, once, so changing it
        // mid-shot cannot mutate a running process. It only fires when the
        // scale is feeding measurements — see the volumetric-source note above.
        startProcess(new ManualProcess(getManualWeightTarget(), settings.getBrewDelay()));
        break;
    default:;
    }
    bool brewStarted;
    bool manualStarted;
    {
        std::lock_guard<std::recursive_mutex> guard(processMutex);
        brewStarted = currentProcess != nullptr && currentProcess->getType() == MODE_BREW;
        manualStarted = currentProcess != nullptr && currentProcess->getType() == MODE_MANUAL;
    }
    if (brewStarted) {
        pluginManager->trigger("controller:brew:start");
    }
    // Its own event, not brew:start: the brew:start/end listeners (scale,
    // MQTT, ...) stay profile-only. Shot History records manual runs from it.
    if (manualStarted) {
        pluginManager->trigger("controller:manual:start");
    }
}

void Controller::deactivate() {
    std::vector<const char *> events;
    {
        std::lock_guard<std::recursive_mutex> guard(processMutex);
        deactivateLocked(events);
    }
    dispatchEvents(events);
}

void Controller::deactivateLocked(std::vector<const char *> &events) {
    if (currentProcess == nullptr) {
        return;
    }
    delete lastProcess;
    lastProcess = currentProcess;
    currentProcess = nullptr;
    lastProcess->end(); // stamp the end time; see Process::end
    applyConnectionPriority(); // shot ended -> relaxed BLE interval
    if (lastProcess->getType() == MODE_BREW) {
        events.push_back("controller:brew:end");
    } else if (lastProcess->getType() == MODE_GRIND) {
        events.push_back("controller:grind:end");
    } else if (lastProcess->getType() == MODE_MANUAL) {
        events.push_back("controller:manual:end");
    }
    events.push_back("controller:process:end");
    updateLastAction();
}

void Controller::clear() {
    std::vector<const char *> events;
    {
        std::lock_guard<std::recursive_mutex> guard(processMutex);
        clearLocked(events);
    }
    dispatchEvents(events);
}

void Controller::clearLocked(std::vector<const char *> &events) {
    processCompleted = true;
    if (lastProcess != nullptr && lastProcess->getType() == MODE_BREW) {
        events.push_back("controller:brew:clear");
    } else if (lastProcess != nullptr && lastProcess->getType() == MODE_MANUAL) {
        events.push_back("controller:manual:clear");
    }
    delete lastProcess;
    lastProcess = nullptr;
    currentVolumetricSource = VolumetricMeasurementSource::INACTIVE;
}

void Controller::activateGrind() {
    pluginManager->trigger("controller:grind:start");
    if (isGrindActive())
        return;
    clear();
    if (settings.isVolumetricTarget() && isVolumetricAvailable()) {
        currentVolumetricSource = VolumetricMeasurementSource::BLUETOOTH;
        startProcess(new GrindProcess(ProcessTarget::VOLUMETRIC, 0, settings.getTargetGrindVolume(), settings.getGrindDelay()));
    } else {
        startProcess(
            new GrindProcess(ProcessTarget::TIME, settings.getTargetGrindDuration(), settings.getTargetGrindVolume(), 0.0));
    }
}

void Controller::deactivateGrind() {
    deactivate();
    clear();
}

void Controller::activateStandby() {
    setMode(MODE_STANDBY);
    deactivate();
}

void Controller::deactivateStandby() {
    deactivate();
    setMode(MODE_BREW);
}

void Controller::wakeFromStandby() {
    deactivate();
    setMode(wakeMode);
}

bool Controller::isActive() const {
    std::lock_guard<std::recursive_mutex> guard(processMutex);
    return isActiveLocked();
}

bool Controller::isGrindActive() const {
    std::lock_guard<std::recursive_mutex> guard(processMutex);
    return currentProcess != nullptr && currentProcess->isActive() && currentProcess->getType() == MODE_GRIND;
}

int Controller::getMode() const { return mode; }

void Controller::setMode(int newMode) {
    const int previousMode = mode;
    Event modeEvent = pluginManager->trigger("controller:mode:change", "value", newMode);
    mode = modeEvent.getInt("value");
    if (mode == MODE_STANDBY && previousMode != MODE_STANDBY) {
        wakeMode = previousMode == MODE_MANUAL ? MODE_MANUAL : MODE_BREW;
    }
    steamReady = false;

    updateLastAction();
    setTargetTemp(getTargetTemp());
    setPidSettings();
}

void Controller::onTempRead(float temperature) {
    float temp = temperature - static_cast<float>(settings.getTemperatureOffset());
    Event event = pluginManager->trigger("boiler:currentTemperature:change", "value", temp);
    currentTemp = event.getFloat("value");
}

void Controller::updateLastAction() { lastAction = millis(); }

void Controller::onOTAUpdate() {
    activateStandby();
    updating = true;
}

void Controller::onProfileSave() const { profileManager->saveProfile(profileManager->getSelectedProfile()); }

void Controller::onProfileSaveAsNew() {
    Profile &profile = profileManager->getSelectedProfile();
    profile.label = "Copy of " + profileManager->getSelectedProfile().label;
    profile.id = generateShortID();
    settings.setSelectedProfile(profile.id);
    profileManager->saveProfile(profileManager->getSelectedProfile());
    profileManager->addFavoritedProfile(profile.id);
}

void Controller::onVolumetricMeasurement(double measurement, VolumetricMeasurementSource source) {
    if (source == VolumetricMeasurementSource::FLOW_ESTIMATION) {
        currentCoffeeVolume = static_cast<float>(measurement);
        pluginManager->trigger(F("controller:volumetric-measurement:estimation:change"),
                               "value", static_cast<float>(measurement));
        return;
    }
    if (source == VolumetricMeasurementSource::BLUETOOTH) {
        // BLE notifications arrive on the NimBLE task. Feed the process volume
        // HERE, synchronously, exactly as ef46ba1 did — a queue drained on the
        // control task races the process lifecycle (the logic task calls
        // progress()/isFinished() before the drain lands the volume, so a
        // volumetric brew's currentVolume reads 0 every tick, the progress bar
        // stalls, and a volume-targeted shot never stops). The mutex is held
        // across the deref, which is the real safety (GM-147).
        pluginManager->trigger(F("controller:volumetric-measurement:bluetooth:change"),
                               "value", static_cast<float>(measurement));
        lastBluetoothMeasurement = millis();

        std::lock_guard<std::recursive_mutex> guard(processMutex);
        if (currentProcess != nullptr) {
            currentProcess->updateVolume(measurement);
        }
        if (lastProcess != nullptr && !lastProcess->isComplete()) {
            lastProcess->updateVolume(measurement);
        }
    }
}

bool Controller::isBluetoothScaleHealthy() const {
    unsigned long timeSinceLastBluetooth = millis() - lastBluetoothMeasurement;
    return (timeSinceLastBluetooth < BLUETOOTH_GRACE_PERIOD_MS) || volumetricOverride;
}

void Controller::onFlush() {
    // Allocate outside the lock; reachable from the UI, AsyncTCP and BLE tasks (GM-147).
    auto *flush = new BrewProcess(FLUSH_PROFILE, ProcessTarget::TIME, settings.getBrewDelay());
    std::vector<const char *> events;
    {
        std::lock_guard<std::recursive_mutex> guard(processMutex);
        if (isActiveLocked()) {
            delete flush;
            return;
        }
        clearLocked(events);
        startProcessLocked(flush, events);
        events.push_back("controller:brew:start");
    }
    dispatchEvents(events);
}

void Controller::onVolumetricDelete() {
    if (profileManager->getSelectedProfile().isVolumetric()) {
        profileManager->getSelectedProfile().removeVolumetricTarget();
    }
}

void Controller::handleBrewButton(int brewButtonStatus) {
    if (brewButtonStatus) {
        switch (getMode()) {
        case MODE_STANDBY:
            wakeFromStandby();
            break;
        case MODE_BREW:
            if (!isActive()) {
                deactivateStandby();
                clear();
                activate();
            } else if (settings.isMomentaryButtons()) {
                deactivate();
                clear();
            }
            break;
        case MODE_WATER:
            activate();
            break;
        case MODE_STEAM:
            deactivate();
            setMode(MODE_BREW);
        default:
            break;
        }
    } else if (!settings.isMomentaryButtons()) {
        if (getMode() == MODE_BREW) {
            if (isActive()) {
                deactivate();
                clear();
            } else {
                clear();
            }
        } else if (getMode() == MODE_WATER) {
            deactivate();
        }
    }
}

void Controller::handleSteamButton(int steamButtonStatus) {
    if (steamButtonStatus) {
        if (getMode() != MODE_STEAM) {
            setMode(MODE_STEAM);
        }
    } else if (!settings.isMomentaryButtons() && getMode() == MODE_STEAM) {
        deactivate();
        setMode(MODE_BREW);
    }
}

void Controller::handleWaterButton(int buttonStatus) {
    if (buttonStatus) {
        switch (getMode()) {
        case MODE_WATER:
            if (!isActive()) {
                activate();
            }
            break;
        default:
            setMode(MODE_WATER);
            break;
        }
    } else if (!settings.isMomentaryButtons() && getMode() == MODE_WATER && isActive()) {
        deactivate();
    }
}

void Controller::handleProfileButton(int buttonStatus, String id) {
    if (buttonStatus && getMode() == MODE_STANDBY) {
        wakeFromStandby();
        return;
    }
    if (!buttonStatus && !settings.isMomentaryButtons()) {
        deactivate();
        clear();
    }
    if (buttonStatus) {
        if (getMode() != MODE_BREW) {
            setMode(MODE_BREW);
        }
        if (isActive()) {
            deactivate();
            clear();
            return;
        }
        std::vector<String> profileIds = profileManager->listProfiles();
        if (std::find(profileIds.begin(), profileIds.end(), id) != profileIds.end()) {
            profileManager->selectProfile(id);
            activate();
        }
    }
}

void Controller::handleProfileUpdate() {
    pluginManager->trigger("boiler:targetTemperature:change", "value", profileManager->getSelectedProfile().temperature);
    pluginManager->trigger("controller:targetDuration:change", "value", profileManager->getSelectedProfile().getTotalDuration());
    pluginManager->trigger("controller:targetVolume:change", "value", profileManager->getSelectedProfile().getTotalVolume());
}

void Controller::loopLogicTask(void *arg) {
    TickType_t lastWake = xTaskGetTickCount();
    auto *controller = static_cast<Controller *>(arg);
    unsigned long lastPass = 0, minuteStart = millis();
    while (true) {
        // Diagnostics: the longest gap between passes, per minute (this minute and the last).
        const unsigned long now = millis();
        if (lastPass != 0 && now - lastPass > controller->logicGapNow)
            controller->logicGapNow = now - lastPass;
        lastPass = now;
        if (now - minuteStart >= 60000) {
            controller->logicGapPrev = controller->logicGapNow;
            controller->logicGapNow = 0;
            minuteStart = now;
        }
        controller->loopLogic();
        // caller of updateControl(), so while asleep the machine simply is not
        // listening — upstream can afford that because nothing on their standby
        // screen is interactive, but the manual panel puts a live control there.
        // Measured 5022ms from a standby mode change to the boiler being
        // commanded at 1000ms. Still lazier than the 100ms this same line uses
        // whenever the machine is awake, so the mechanism is well proven.
        xTaskDelayUntil(&lastWake, pdMS_TO_TICKS(controller->getMode() == MODE_STANDBY ? 200 : PROGRESS_INTERVAL));
    }
}
