#include "BLEScalePlugin.h"
#include "remote_scales.h"
#include "remote_scales_plugin_registry.h"
#include <cmath> // For isfinite()
#include <display/core/Controller.h>
#include <scales/acaia.h>
#include <scales/bookoo.h>
#include <scales/decent.h>
#include <scales/difluid.h>
#include <scales/dot.h>
#include <scales/eclair.h>
#include <scales/eureka.h>
#include <scales/felicitaScale.h>
#include <scales/myscale.h>
#include <scales/timemore.h>
#include <scales/varia.h>
#include "WeighMyBruTimerScales.h" // library WeighMyBru driver + timer control (DeLongscali timer_sync_plan.txt)
#include <DlzLog.h>
#include <esp_coexist.h>

void on_ble_measurement(float value) {
    if (&BLEScales != nullptr) {
        BLEScales.onMeasurement(value);
    }
}

BLEScalePlugin BLEScales;

BLEScalePlugin::BLEScalePlugin() = default;

BLEScalePlugin::~BLEScalePlugin() noexcept {
    try {
        // Disable active flag first to stop processing
        active = false;

        // Give any running callbacks time to complete
        delay(100);

        // Ensure proper cleanup
        disconnect();

        if (scanner != nullptr) {
            // Stop scanning first
            scanner->stopAsyncScan();
            // Give it time to actually stop
            delay(50);
            delete scanner;
            scanner = nullptr;
        }
    } catch (...) {
        // Swallow: destructors must not propagate exceptions.
        // NimBLE + Arduino delay() calls don't throw in practice; belt-and-braces.
    }
}

void BLEScalePlugin::setup(Controller *controller, PluginManager *manager) {
    if (controller == nullptr || manager == nullptr) {
        ESP_LOGE("BLEScalePlugin", "Invalid controller or manager passed to setup");
        return;
    }

    this->controller = controller;
    this->pluginManager = manager;
    this->pluginRegistry = RemoteScalesPluginRegistry::getInstance();

    // Apply scale plugins with error checking
    AcaiaScalesPlugin::apply();
    BookooScalesPlugin::apply();
    DecentScalesPlugin::apply();
    DifluidScalesPlugin::apply();
    EclairScalesPlugin::apply();
    EurekaScalesPlugin::apply();
    FelicitaScalePlugin::apply();
    TimemoreScalesPlugin::apply();
    VariaScalesPlugin::apply();
    WeighMyBruTimerScalePlugin::apply(); // replaces the library's WeighMyBrewScalePlugin: same scales + timer control
    myscalePlugin::apply();
    TimemoreDotScalesPlugin::apply();

    // Initialize scanner with error handling
    this->scanner = new (std::nothrow) RemoteScalesScanner();
    if (this->scanner == nullptr) {
        ESP_LOGE("BLEScalePlugin", "Failed to create RemoteScalesScanner - out of memory");
        return;
    }

    manager->on("controller:bluetooth:connect", [this](Event const &) {
        if (this->controller != nullptr && this->controller->getMode() != MODE_STANDBY) {
            ESP_LOGI("BLEScalePlugin", "Resuming scanning");
            // Do NOT call scan() here — this handler runs on the display main
            // loop (plugin-manager dispatch), and scan() blocks on the NimBLE
            // host. Blocking this task drops the status stream, the loopback
            // pump believes the controller link died, and the scale gets
            // dropped (BLE_FREEZE_FINDINGS.md). Just mark active; the BLE task
            // picks the scan up in its own duty-cycle.
            active = true;
            wantScan = true;  // cut to a fresh burst now instead of waiting for the rest window
        }
    });
    manager->on("controller:bluetooth:disconnect", [this](Event const &) {
        ESP_LOGW("BLEScalePlugin", "Controller disconnected, stopping BLE scan");
        active = false;
    });
    // All of these run on the display MAIN LOOP (plugin-manager dispatch).
    // They set flags only; the BLE task (pluginLoop) performs the actual BLE
    // work off the main loop. Direct BLE calls here — scan(), tare(), the
    // delay(50) — block the status stream + loopback pump and drop the scale
    // at exactly the shot boundaries (BLE_FREEZE_FINDINGS.md).
    manager->on("controller:mode:change", [this](Event const &event) {
        if (event.getInt("value") != MODE_STANDBY) {
            ESP_LOGI("BLEScalePlugin", "Resuming scanning");
            active = true;
            wantScan = true;  // cut to a fresh burst now instead of waiting for the rest window
        } else {
            active = false;
        }
    });
    // Scale shot clock (DeLongscali timer_sync_plan.txt): pre-start (BREW and
    // MANUAL) resets it and tares, the shot start starts it, the pump stop
    // stops it. A flush fires brew:start/brew:end without a pre-start, so a
    // start only counts within 2 s of a pre-start and a stop is only sent for a
    // clock we started. MANUAL fires no brew:start/brew:end, only the generic
    // process events; the mode check keeps steam, hot water and grind out.
    manager->on("controller:brew:prestart", [this](Event const &) {
        prestartAt = millis();
        normalHoldSince = prestartAt; // Bluetooth back to normal before the shot starts
        requestResetTimer = true;
        requestTare = true;
        wakeBleTask();
    });
    manager->on("controller:grind:start", [this](Event const &) {
        normalHoldSince = millis();
        requestTare = true;
        wakeBleTask();
    });
    manager->on("controller:brew:start", [this](Event const &) {
        if (millis() - prestartAt < 2000) {
            clockStarted = true;
            requestStartTimer = true;
            wakeBleTask();
        }
    });
    manager->on("controller:brew:end", [this](Event const &) {
        if (clockStarted) {
            clockStarted = false;
            requestStopTimer = true;
            wakeBleTask();
        }
    });
    // this->controller: inside setup() the bare name is the parameter, which the
    // lambdas do not capture.
    manager->on("controller:process:start", [this](Event const &) {
        processRunning = true;
        wakeBleTask();
        if (this->controller != nullptr && this->controller->getMode() == MODE_MANUAL &&
            millis() - prestartAt < 2000) {
            clockStarted = true;
            requestStartTimer = true;
            wakeBleTask();
        }
    });
    manager->on("controller:process:end", [this](Event const &) {
        normalHoldSince = millis();
        processRunning = false;
        if (this->controller != nullptr && this->controller->getMode() == MODE_MANUAL && clockStarted) {
            clockStarted = false;
            requestStopTimer = true;
            wakeBleTask();
        }
    });
}

void BLEScalePlugin::wakeBleTask() {
    if (bleTaskHandle != nullptr) {
        xTaskNotifyGive(bleTaskHandle);
    }
}

void BLEScalePlugin::loop() {
    // Runs on the display main loop, but the actual BLE work happens on the
    // dedicated plugin task below (pluginLoop) — the display loop only pokes
    // it. NimBLE calls block (connect up to 30 s, scan starts are host-task
    // synchronized); running them inline here was the dashboard freeze
    // documented in BLE_FREEZE_FINDINGS.md.
    if (bleTaskHandle == nullptr) {
        xTaskCreatePinnedToCore(bleTask, "BLEScaleTask", 4608, this, 1, &bleTaskHandle, 1); // used ~2.5 KB (measured peak 2026-10-09 after a shot with the scale; trimmed to free fast memory)
    }
    // No BLE work here: all real timing happens in the plugin task. This used
    // to vTaskDelay(UPDATE_INTERVAL_MS), which paused the whole display loop
    // (status push, loopback pump, every plugin) for 1 s per pass (2026-09-24).

    // Tare pressed on the DeLongscali scale: do what the panel's Tare does after
    // a shot (req:tare), clear the finished shot, idle only. No tare is sent
    // back: the scale already zeroed itself, and a BLE tare now would average
    // the finger's weight into the zero.
    if (WeighMyBruTimerScales::takeTarePressed() && controller != nullptr && !controller->isActive()) {
        controller->clear();
    }
}

void BLEScalePlugin::bleTask(void *arg) {
    auto *self = static_cast<BLEScalePlugin *>(arg);
    for (;;) {
        self->pluginLoop();
        // Up to UPDATE_INTERVAL_MS as before, but wakeBleTask() ends the wait at
        // once. update() keeps its own 1 s gate, so heartbeats do not speed up.
        ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(UPDATE_INTERVAL_MS));
    }
}

void BLEScalePlugin::pluginLoop() {
#ifdef DELONGEZZI_NO_BLE
    // 2026-10-10: BLE compiled out - keep the task alive but never touch the radio.
    vTaskDelay(1000 / portTICK_PERIOD_MS);
    return;
#endif
    // Derive `active` from the mode rather than trusting that every transition
    // into it arrived as an event. It used to be set ONLY by the mode:change and
    // bluetooth:connect handlers, so a boot straight into a non-standby mode —
    // the normal case, since the startup mode is restored from settings — left
    // it false with the machine sitting in Brew. Nothing then scanned, and the
    // block below cancelled any scan the Connections tab asked for within
    // milliseconds of the request. The tab showed "No scales found" and its
    // Scan button did nothing at all until you toggled the mode by hand.
    if (controller != nullptr) {
        const bool shouldBeActive = controller->getMode() != MODE_STANDBY;
        if (shouldBeActive && !active) {
            ESP_LOGI("BLEScalePlugin", "Mode is not standby, starting scan");
            doScan();
        }
        active = shouldBeActive;
    }
    // The Bluetooth page's Scan button, done here instead of on the web task.
    if (scanRequested) {
        scanRequested = false;
        doScan();
    }
    if (doConnect && scale == nullptr && !connectInProgress) {
        // The blocking NimBLE connect runs inside connectTask on this same
        // plugin task; see BLE_FREEZE_FINDINGS.md (BLOCKING CALL #1) — it must
        // never run on the display loop. We are already on the plugin task,
        // so this is the right context: just do it synchronously here.
        establishConnection();
        doConnect = false;
    }
    // Shot-boundary BLE commands, performed here on the BLE task where they can
    // block safely (tare does a command write + delay(50); the timer calls a write).
    // Each request is taken once BEFORE acting: they used to be cleared after the
    // tare's delay(50), which wiped a request set during that pass unseen (the
    // shot start lands 200 ms after pre-start). Order: the last shot's stop, the
    // reset BEFORE the tares (a clock still running makes the DeLongscali scale
    // refuse a tare in ESPRESSO AUTO), the double tare, then the start.
    const bool doStop = requestStopTimer;
    requestStopTimer = false;
    const bool doReset = requestResetTimer;
    requestResetTimer = false;
    const bool doTare = requestTare;
    requestTare = false;
    const bool doStart = requestStartTimer;
    requestStartTimer = false;
    const bool timerOk = scale != nullptr && scale->isConnected() && scale->hasTimerControl();
    if (doStop && timerOk) {
        scale->stopTimer();
    }
    if (doReset && timerOk) {
        scale->resetTimer();
    }
    if (doTare && scale != nullptr && scale->isConnected()) {
        scale->tare();
        delay(50);
        if (scale != nullptr && scale->isConnected()) {
            scale->tare();
        }
    }
    if (doStart && timerOk) {
        scale->startTimer();
    }
    if (!active) {
        if (scale != nullptr) {
            disconnect();
        }
        if (scanner->isScanRunning()) {
            scanner->stopAsyncScan();
        }
        scanBursting = false;
    } else if (scale == nullptr && !doConnect) {
        // Duty-cycle the hunt for a scale. Scanning continuously is what starves
        // WiFi and freezes the UI; see SCAN_BURST_MS in the header for the
        // measurements. Only while nothing is attached — a live connection is
        // cheap and must never be interrupted by this.
        const unsigned long now = millis();
        if (scanPhaseSince == 0) {
            scanPhaseSince = now;
            scanBursting = true;
            // Start this burst for real. At boot (and on leaving standby after a
            // session) the mode handlers set `active` before this task runs, so
            // scan() above never fires and the wantScan request below is skipped
            // because a burst is already marked as running. The first burst then
            // ran with the scanner off and the scale was only found after the
            // rest window: 42 s after boot (boot log 2026-09-24).
            if (!scanner->isScanRunning()) {
                scanner->restartAsyncScan();
            }
        }
        // A mode-change/connect handler asked for an immediate burst. Cut the
        // rest window short and start a fresh burst now — this is what makes
        // first connect ~2s instead of waiting out up to 22s of REST. Same
        // restartAsyncScan (LRU cache), same burst: no extra radio load beyond
        // starting the scan earlier.
        if (wantScan && !scanBursting) {
            scanBursting = true;
            scanPhaseSince = now;
            scanner->restartAsyncScan();
            ESP_LOGI("BLEScalePlugin", "Forcing fresh scan burst (mode-change)");
            wantScan = false;
        }
        if (scanBursting && now - scanPhaseSince >= SCAN_BURST_MS) {
            scanBursting = false;
            scanPhaseSince = now;
            wantScan = false;
            if (scanner->isScanRunning()) {
                scanner->stopAsyncScan();
            }
            ESP_LOGD("BLEScalePlugin", "Scan burst over, resting to give WiFi the radio");
        } else if (!scanBursting && now - scanPhaseSince >= SCAN_REST_MS) {
            scanBursting = true;
            scanPhaseSince = now;
            // Same LRU-cache trap as scan(): a burst restart via
            // initializeAsyncScan() alone never clears alreadySeenAddresses.
            scanner->restartAsyncScan();
            ESP_LOGD("BLEScalePlugin", "Resuming scan burst");
        }
    } else {
        // Connected (or connecting): no scan phase to run.
        scanPhaseSince = 0;
        scanBursting = false;
    }
    const unsigned long now = millis();
    if (now - lastUpdate > UPDATE_INTERVAL_MS) {
        lastUpdate = now;
        update();
    }
    updateBtStandby();
    refreshSnapshot();
}

void BLEScalePlugin::updateBtStandby() {
    const bool connected = scale != nullptr && scale->isConnected();
    if (connected != lastConnected) {
        lastConnected = connected;
        dlzlog("SCALE %s", connected ? "connected" : "disconnected");
    }
    const unsigned long now = millis();
    const unsigned long holdSince = normalHoldSince;
    const bool busy = processRunning || (holdSince != 0 && now - holdSince < BT_NORMAL_HOLD_MS);
    // only when switched on (Settings > Bluetooth, off by default: untested with most scales), with
    // a scale connected and weights flowing; while hunting for one, scanning stays normal
    const bool enabled = controller != nullptr && controller->getSettings().isBtStandby();
    const int want = enabled && connected && hasReceivedMeasurement && !busy ? 1 : 0;
    if (want == btStandby && now - btStandbyAt < BT_STANDBY_REASSERT_MS)
        return;
    if (want != btStandby)
        dlzlog("BT standby %s", want ? "on" : "off");
    btStandby = want;
    btStandbyAt = now;
    if (want)
        esp_coex_status_bit_set(ESP_COEX_ST_TYPE_BLE, ESP_COEX_BLE_ST_MESH_STANDBY);
    else
        esp_coex_status_bit_clear(ESP_COEX_ST_TYPE_BLE, ESP_COEX_BLE_ST_MESH_STANDBY);
}

void BLEScalePlugin::refreshSnapshot() {
    // Read the scale here, on the BLE task (the only one that deletes it), then publish.
    Snapshot next;
    if (scale != nullptr && scale->isConnected()) {
        next.connected = true;
        next.name = scale->getDeviceName();
        next.address = scale->getDeviceAddress();
        next.hasBattery = scale->hasBatteryLevel();
        next.battery = next.hasBattery ? scale->getBatteryLevel() : REMOTE_SCALES_BATTERY_UNKNOWN;
        // RSSI is a round trip to the radio: every few seconds is plenty for the page.
        const unsigned long now = millis();
        if (lastRssiAt == 0 || now - lastRssiAt >= 5000) {
            lastRssiAt = now;
            next.rssi = scale->getRSSI();
        } else {
            next.rssi = snapshot().rssi;
        }
    } else {
        lastRssiAt = 0;
    }
    std::lock_guard<std::mutex> guard(snapMutex);
    snap = next;
}

void BLEScalePlugin::update() {
    // Graceful failure - if controller is null, just disable ourselves
    if (controller == nullptr) {
        ESP_LOGW("BLEScalePlugin", "Controller is null, disabling BLE scale");
        active = false;
        return;
    }

    // Don't update volumetric override if scale access might fail
    bool hasConnectedScale = false;
    if (scale != nullptr) {
        // Check if scale pointer is valid before accessing
        hasConnectedScale = scale->isConnected();
    }

    if (controller->isVolumetricAvailable())
        controller->setVolumetricOverride(hasConnectedScale);

    if (!active)
        return;

    if (scale != nullptr) {
        // Call scale update with error checking
        scale->update();
        if (!hasConnectedScale) {
            reconnectionTries++;
            if (reconnectionTries > RECONNECTION_TRIES) {
                ESP_LOGW("BLEScalePlugin", "Max reconnection attempts reached, disconnecting");
                disconnect();
                if (scanner != nullptr) {
                    scanner->restartAsyncScan();
                }
            }
        } else if (!hasReceivedMeasurement) {
            // "Connected" but silent: on most failed sessions the link comes up
            // and service discovery NEVER completes — no subscribe, no
            // heartbeats reach the scale, and the connection sits dead until
            // the ~30 s supervision timeout kills it. The UI shows connected
            // the whole time. Real sessions deliver a weight notification
            // within a couple of seconds, so absence of one means the ATT
            // layer is wedged. Tear down immediately and hunt again — this is
            // what turns "connects then disappears for 45 s" into a fast
            // self-correcting retry.
            const unsigned long sinceConnect = millis() - connectArmedAt;
            if (sinceConnect > SUBSCRIBE_TIMEOUT_MS) {
                ESP_LOGW("BLEScalePlugin", "Connected but no notifications for %lu ms — killing dead link",
                         (unsigned long)SUBSCRIBE_TIMEOUT_MS);
                disconnect();
                if (scanner != nullptr) {
                    scanner->restartAsyncScan();
                }
            }
        } else {
            // Live session: poll slow-changing metadata (battery, unit).
            // Flow rate is emitted inline with each weight measurement.
            pollScaleMetadata();
        }
    } else if (controller->getSettings().getSavedScale() != "" && scanner != nullptr) {
        // Protected scanner access with null checks
        auto discoveredScales = scanner->getDiscoveredScales();
        for (const auto &d : discoveredScales) {
            if (d.getAddress().toString() == controller->getSettings().getSavedScale().c_str()) {
                ESP_LOGI("BLEScalePlugin", "Connecting to last known scale");
                connect(d.getAddress().toString());
                break;
            }
        }
    }
}

void BLEScalePlugin::connect(const std::string &uuid) {
    if (uuid.empty()) {
        ESP_LOGE("BLEScalePlugin", "Cannot connect with empty UUID");
        return;
    }
    if (controller == nullptr) {
        ESP_LOGE("BLEScalePlugin", "Controller is null, cannot save scale setting");
        return;
    }

    {
        std::lock_guard<std::mutex> guard(snapMutex); // also read by the BLE task
        this->uuid = uuid;
    }
    doConnect = true;
    connectArmedAt = millis();
    hasReceivedMeasurement = false;
    controller->getSettings().setSavedScale(uuid.data());
}


void BLEScalePlugin::scan() {
    // From the web page: only a request, the BLE task scans on its next pass (woken now).
    scanRequested = true;
    wakeBleTask();
}

void BLEScalePlugin::doScan() {
    if (scale != nullptr && scale->isConnected()) {
        return;
    }
    if (scanner == nullptr) {
        ESP_LOGE("BLEScalePlugin", "Scanner not initialized, cannot start scan");
        return;
    }
    // restartAsyncScan, not initializeAsyncScan: initializeAsyncScan() returns
    // early when isRunning is already true (remote_scales.cpp:93-94) and does
    // NOT clear alreadySeenAddresses — the scanner then refuses to ever
    // re-emit an address it emitted in a previous burst. After one drop, every
    // later scan comes up empty forever ("Device ... not found").
    scanner->restartAsyncScan();
    // An explicit scan request restarts the duty cycle at a burst, so pressing
    // Scan during a rest window acts immediately instead of appearing dead.
    scanPhaseSince = millis();
    scanBursting = true;
}

void BLEScalePlugin::disconnect() {
    if (scale != nullptr) {
        // Readers see "disconnected" before the scale goes away.
        {
            std::lock_guard<std::mutex> guard(snapMutex);
            snap = Snapshot{};
            uuid = "";
            cachedScales.clear();
        }
        // Add small delay to let any pending callbacks complete
        delay(50);

        // Check if scale is still valid before calling disconnect
        if (scale) {
            scale->disconnect();
        }

        scale = nullptr;
        doConnect = false;
        reconnectionTries = 0;
        hasReceivedMeasurement = false;
        connectArmedAt = 0;
        // Reset metadata caches so we re-emit change events when a new scale
        // connects (possibly a different model with different capabilities).
        lastBatteryLevel = REMOTE_SCALES_BATTERY_UNKNOWN;
        lastWeightUnit = ScaleWeightUnit::UNKNOWN;
        warnedOunceMidBrew = false;
    }
}

void BLEScalePlugin::onProcessStart() const {
    if (scale != nullptr && scale->isConnected()) {
        // Double tare with validation
        scale->tare();
        delay(50);

        // Check if scale is still connected before second tare
        if (scale != nullptr && scale->isConnected()) {
            scale->tare();
        }
    }
}

void BLEScalePlugin::pollScaleMetadata() {
    if (scale == nullptr || !scale->isConnected() || pluginManager == nullptr) {
        return;
    }
    auto *pm = pluginManager;

    // Battery % -- fire event only on change so consumers can subscribe without
    // being hammered at 1 Hz with duplicate values.
    if (scale->hasBatteryLevel()) {
        const uint8_t pct = scale->getBatteryLevel();
        if (pct != lastBatteryLevel && pct != REMOTE_SCALES_BATTERY_UNKNOWN) {
            lastBatteryLevel = pct;
            pm->trigger("scale:battery:change", "value", static_cast<int>(pct));
        }
    }
}

void BLEScalePlugin::tare() {
    // UI-driven tare: set the flag, the BLE task performs it off the main loop.
    requestTare = true;
}

void BLEScalePlugin::connectTask(void *arg) {
    auto *self = static_cast<BLEScalePlugin *>(arg);
    // Re-check state on the worker: doConnect could have been cleared (mode
    // went standby, or disconnect()) between the plugin loop arming this task
    // and it running. Connecting into a torn-down state would fight the main
    // loop for the NimBLE host.
    if (self->doConnect && self->active && self->scale == nullptr) {
        self->establishConnection();
        // establishConnection may have produced a scale while the loop went
        // inactive; honour the latest state, don't leave a connection the
        // loop believes is gone.
        if (self->scale != nullptr && !self->active) {
            self->scale->disconnect();
            self->scale = nullptr;
        }
    }
    self->doConnect = false;
    self->connectInProgress = false;
    vTaskDelete(nullptr);
}

void BLEScalePlugin::establishConnection() {
    std::string uuid;
    {
        std::lock_guard<std::mutex> guard(snapMutex); // the web task may be setting it
        uuid = this->uuid;
    }
    if (uuid.empty()) {
        ESP_LOGE("BLEScalePlugin", "Cannot establish connection with empty UUID");
        return;
    }

    ESP_LOGI("BLEScalePlugin", "Connecting to %s", uuid.c_str());
    if (scanner == nullptr) {
        ESP_LOGE("BLEScalePlugin", "Scanner not initialized, cannot establish connection");
        return;
    }

    scanner->stopAsyncScan();
    // NimBLE's scan stop is ASYNC: the host processes it on its own task. A
    // GATT discovery started while that stop is still in flight fails with
    // rc=13 (BLE_HS_EBUSY) — observed on the serial log as
    // "serviceDiscoveredCB() rc=13 / Could not retrieve services" on every
    // attempt. Give the host one tick to finish the stop before the connect
    // and discovery sequence starts.
    delay(250);

    auto discoveredScales = scanner->getDiscoveredScales();
    bool deviceFound = false;

    for (const auto &d : discoveredScales) {
        if (d.getAddress().toString() == uuid) {
            deviceFound = true;
            reconnectionTries = 0;

            auto factory = RemoteScalesFactory::getInstance();
            if (factory == nullptr) {
                ESP_LOGE("BLEScalePlugin", "RemoteScalesFactory instance is null");
                return;
            }

            scale = factory->create(d);
            if (!scale) {
                ESP_LOGE("BLEScalePlugin", "Connection to device %s failed", d.getName().c_str());
                return;
            }

            // The scale library's messages ("Heartbeat sent." ...) are not printed to USB (build 967).
            scale->setLogCallback([](std::string) {});

            scale->setWeightUpdatedCallback([](float weight) {
                // Check if we're in an ISR context
                if (xPortInIsrContext()) {
                    // Skip measurement to avoid FreeRTOS deadlocks from interrupt context
                    return;
                }
                // Safe to call directly from task context with null check
                if (&BLEScales != nullptr) {
                    BLEScales.onMeasurement(weight);
                }
            });

            bool connectResult = scale->connect();
            if (connectResult) {
                // The dead-link watchdog's 5 s starts now that the link is up. It used to
                // count from connect(), so the 250 ms wait, the connect and service
                // discovery ate into it and a slow but good link could be killed right
                // after it came up. hasReceivedMeasurement stays as it is: the first
                // weight can already have arrived (subscribe happens inside connect()).
                connectArmedAt = millis();
            } else {
                ESP_LOGW("BLEScalePlugin", "Failed to connect to scale, retrying scan");
                disconnect();
                if (scanner != nullptr) {
                    scanner->restartAsyncScan();
                }
            }
            break;
        }
    }

    if (!deviceFound) {
        ESP_LOGW("BLEScalePlugin", "Device %s not found in discovered scales", uuid.c_str());
        if (scanner != nullptr) {
            scanner->restartAsyncScan();
        }
    }
}

void BLEScalePlugin::onMeasurement(float value) const {
    // First notification of the session: the ATT layer is alive. This is what
    // the dead-link watchdog in update() waits for.
    if (!hasReceivedMeasurement) {
        hasReceivedMeasurement = true;
        ESP_LOGI("BLEScalePlugin", "First notification received — link is live");
    }
    // Rate limiting to prevent callback flooding
    unsigned long now = millis();
    if (now - lastMeasurementTime < MIN_MEASUREMENT_INTERVAL_MS) {
        return; // Drop measurement to prevent flooding
    }
    lastMeasurementTime = now;

    // Multiple safety checks to prevent crashes
    if (controller == nullptr) {
        return; // Silently ignore if controller is null
    }

    // Check if we're being destroyed or in an unsafe state
    if (!active) {
        return; // Don't process measurements when not active
    }

    // Validate the measurement value
    if (!isfinite(value) || value < -1000.0f || value > 10000.0f) {
        ESP_LOGW("BLEScalePlugin", "Invalid measurement value: %f, ignoring", value);
        return;
    }

    // Safe to call controller method
    controller->onVolumetricMeasurement(value, VolumetricMeasurementSource::BLUETOOTH);

    // If the scale driver also provides native flow rate (e.g. Bookoo), emit
    // it on the same tick so consumers get it at the scale's native cadence
    // (~10 Hz) without having to poll. Controller.onVolumetricMeasurement
    // updates lastBluetoothMeasurement timestamps as a side effect; we reuse
    // a lighter path here since flow is not gating shot state.
    if (scale != nullptr && scale->hasFlowRate() && pluginManager != nullptr) {
        pluginManager->trigger("controller:volumetric-measurement:scale-flow:change", "value", scale->getFlowRate());
    }
}

std::vector<DiscoveredDevice> BLEScalePlugin::getDiscoveredScales() const {
    if (scanner == nullptr) {
        ESP_LOGW("BLEScalePlugin", "Scanner not initialized, returning empty device list");
        return std::vector<DiscoveredDevice>();
    }
    auto current = scanner->getDiscoveredScales();
    // The scanner library CLEARS its list on every scan restart
    // (remote_scales.cpp:95 cleanupDiscoveredScales inside
    // initializeAsyncScan). With the duty-cycled bursts that means the list
    // empties every burst boundary and the Connections tab shows "No scales
    // found" during the repopulation gap even though the device is right
    // there. Reconcile against a persistent cache so the UI keeps showing
    // last-known devices across burst restarts.
    std::lock_guard<std::mutex> guard(snapMutex); // web task reads, BLE task clears
    if (!current.empty()) {
        cachedScales = current; // refresh cache whenever the scan sees anything
    }
    if (!cachedScales.empty()) {
        return cachedScales;
    }
    return current;
}
