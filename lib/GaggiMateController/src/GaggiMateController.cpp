#include "GaggiMateController.h"
#include "utilities.h"
#include <Arduino.h>
#include <ExtensionIOXL9555.hpp>
#include <peripherals/DimmedPump.h>
#include <peripherals/SimplePump.h>

#include <cmath>
#include <utility>

GaggiMateController::GaggiMateController(String version) : _version(std::move(version)) {}

char albaSwTxBuffer[128];
char albaSwRxBuffer[128];

// OUTSTANDING_ISSUES #4: after reset the pins are inputs with no pull, so the heater
// and pump relay inputs floated until heater->setup() / the pump ran, more than 5 s
// after the delay below, and a relay could switch on from noise. Drive them off
// first. Only the relays this machine has (no brew valve, no alt relay); the
// pressure sensor is an input and is left alone. Later setup configures them as before.
void GaggiMateController::outputsOff() {
    pinMode(_config.heaterPin, OUTPUT);
    digitalWrite(_config.heaterPin, LOW);
    pinMode(_config.pumpPin, OUTPUT);
    digitalWrite(_config.pumpPin, _config.pumpOn ? LOW : HIGH);
}

void GaggiMateController::setup() {
    outputsOff();
    delay(5000);
    detectAddon();

    this->thermocouple = new Max31865Thermocouple(
        _config.maxCsPin, _config.maxMosiPin, _config.maxMisoPin, _config.maxSckPin, [this](float temperature) { /* noop */ },
        [this]() { thermalRunawayShutdown(); });
    this->heater = new Heater(
        this->thermocouple, _config.heaterPin, [this]() { thermalRunawayShutdown(); },
        [this](float Kp, float Ki, float Kd, float Kff) { _comms.sendAutotuneResult(Kp, Ki, Kd, Kff); },
        [this]() { _comms.sendError(ERROR_CODE_AUTOTUNE_TIMEOUT); });
    this->valve = new SimpleRelay(_config.valvePin, _config.valveOn);
    this->alt = new SimpleRelay(_config.altPin, _config.altOn);
    if (_config.capabilites.pressure) {
        this->adc = new ADSAdc(_config.pressureSda, _config.pressureScl, 1);
        this->pressureSensor = new PressureSensor(this->adc);
    }
    if (_config.capabilites.dimming) {
        pump = new DimmedPump(_config.pumpPin, _config.pumpSensePin, pressureSensor);
    } else {
        pump = new SimplePump(_config.pumpPin, _config.pumpOn, _config.capabilites.ssrPump ? 1000.0f : 5000.0f);
    }
    this->brewBtn = new DigitalInput(_config.brewButtonPin, [this](const bool state) { _comms.sendButtonState(0, state); });
    this->steamBtn = new DigitalInput(_config.steamButtonPin, [this](const bool state) { _comms.sendButtonState(1, state); });

    // 4-Pin peripheral port
    albaComms = new SoftWire(_config.sunriseSdaPin, _config.sunriseSclPin);
    albaComms->setTxBuffer(albaSwTxBuffer, sizeof(albaSwTxBuffer));
    albaComms->setRxBuffer(albaSwRxBuffer, sizeof(albaSwRxBuffer));
    albaComms->setTimeout_ms(200);
    albaComms->setDelay_us(20);
    albaComms->begin();
    this->ledController = new LedController(albaComms);
    this->distanceSensor = new DistanceSensor(albaComms, [this](int distance) { _comms.sendTofMeasurement(distance); });
    if (this->ledController->isAvailable()) {
        _config.capabilites.ledControls = true;
        _config.capabilites.tof = true;
        _comms.onLedControl([this](uint8_t channel, uint8_t brightness) { ledController->setChannel(channel, brightness); });
    }

    gm::DeviceCapabilities capabilities = gaggimate_Capabilities_init_zero;
    capabilities.dimming = _config.capabilites.dimming;
    capabilities.pressure = _config.capabilites.pressure;
    capabilities.tof = _config.capabilites.tof;
    capabilities.led_control = _config.capabilites.ledControls;
    if (this->gearpumpAddon != nullptr) {
        capabilities.addons_count = 1;
        capabilities.addons[0] = gaggimate_Addon_init_zero;
        capabilities.addons[0].type = 7;
    }
    _comms.init("GPBLS", _config.name.c_str(), _version, capabilities);

    if (_config.capabilites.ledControls) {
        this->ledController->setup();
    }
    if (_config.capabilites.tof) {
        this->distanceSensor->setup();
    }

    this->thermocouple->setup();
    this->heater->setup();
    this->valve->setup();
    this->alt->setup();
    this->pump->setup();
    if (this->gearpumpAddon != nullptr) {
        this->gearpumpAddon->setup(this->pump->getPumpPowerPtr());
        auto dimmedPump = static_cast<DimmedPump *>(pump);
        dimmedPump->setBinaryMode(true);
    }
    this->brewBtn->setup();
    this->steamBtn->setup();
    if (_config.capabilites.pressure) {
        this->adc->setup();
        pressureSensor->setup();
        _comms.onPressureScale([this](float scale) { this->pressureSensor->setScale(scale); });
    }
    // Set up thermal feedforward for main heater if pressure/dimming capability exists
    if (heater && _config.capabilites.dimming && _config.capabilites.pressure) {
        auto dimmedPump = static_cast<DimmedPump *>(pump);
        float *pumpFlowPtr = dimmedPump->getPumpFlowPtr();
        int *valveStatusPtr = dimmedPump->getValveStatusPtr();

        heater->setThermalFeedforward(pumpFlowPtr, 23.0f, valveStatusPtr);
        heater->setFeedforwardScale(0.0f);
    }
    if (heater && _config.capabilites.dimming) {
        heater->setMainsCounter(&g_psmZeroCrossCount); // heat-up check only with mains present
    }
    // Initialize last ping time
    lastPingTime = millis();

    // Output control is split into per-component, device-numbered messages. Each
    // arrives independently (or batched together in one frame for an atomic
    // update). Control messages feed the connection watchdog via handlePing().
    _comms.onBoilerControl([this](uint8_t index, BoilerControlMode mode, float setpoint) {
        if (index != 0) { // single boiler today; reject unknown devices
            ESP_LOGW(LOG_TAG, "Ignoring boiler control for unsupported index %u", index);
            return;
        }
        handlePing();
        if (errorState != ERROR_CODE_NONE) {
            return;
        }
        if (mode == BoilerControlMode::Temperature) {
            this->heater->setSetpoint(setpoint);
        } else {
            // Pressure-regulated boiler not supported by this hardware yet.
            ESP_LOGW(LOG_TAG, "Boiler pressure mode requested but unsupported");
        }
    });
    _comms.onPumpControl([this](uint8_t index, PumpControlMode mode, float power, float pressure, float flow) {
        if (index != 0) { // single pump today; reject unknown devices
            ESP_LOGW(LOG_TAG, "Ignoring pump control for unsupported index %u", index);
            return;
        }
        handlePing();
        if (errorState != ERROR_CODE_NONE) {
            return;
        }
#ifdef GAGGIMATE_MERGED
        // A Diagnostics pump test owns the pump for its window (2026-10-20, review 2.2): the
        // display's full control resend with every 2 s keepalive (audit S1-H3) sends "power 0"
        // while nothing brews, and stopped the test after ~2 s. That idle "off" is ignored while
        // the test runs; any other pump command ends the test and applies as usual. The test's
        // own timer (diagTestLoop) still switches the pump off at the end.
        if (testActiveUntil != 0 && !heaterTestActive && millis() < testActiveUntil) {
            if (mode == PumpControlMode::Power && power == 0.0f) {
                return;
            }
            stopDiagTests();
        }
#endif
        // NaN reaches the PSM cast as full power (audit S1-H5): stop instead.
        if (!std::isfinite(power) || !std::isfinite(pressure) || !std::isfinite(flow)) {
            ESP_LOGE(LOG_TAG, "Pump control with a non-finite value, pump off");
            this->pump->setPower(0);
            return;
        }
        if (mode == PumpControlMode::Power) {
            this->pump->setPower(power);
            if (power == 0.0f) {
                if (gearpumpAddon != nullptr) {
                    gearpumpAddon->stop();
                }
            }
            return;
        }
        if (!_config.capabilites.dimming) {
            return;
        }
        auto dimmedPump = static_cast<DimmedPump *>(pump);
        if (mode == PumpControlMode::Pressure) {
            dimmedPump->setPressureTarget(pressure, flow);
        } else { // PumpControlMode::Flow
            dimmedPump->setFlowTarget(flow, pressure);
        }
    });
    // Binary outputs: index 0 = brew valve, index 1 = alt relay.
    _comms.onRelayControl([this](uint8_t index, bool open) {
        if (index == 1) {
            // Alt relay: independent function, no watchdog/error gating (matches
            // the previous dedicated alt-control path).
            this->alt->set(open);
            return;
        }
        if (index != 0) { // only 0 (brew valve) and 1 (alt) exist
            ESP_LOGW(LOG_TAG, "Ignoring relay control for unsupported index %u", index);
            return;
        }
        handlePing();
        if (errorState != ERROR_CODE_NONE) {
            return;
        }
        this->valve->set(open);
        if (_config.capabilites.dimming) {
            static_cast<DimmedPump *>(pump)->setValveState(open);
        }
    });
    _comms.onPidSettings([this](float Kp, float Ki, float Kd, float Kf) {
        // A typo like "nan" in Settings > PID would make the heater output NaN
        // (audit S1-H5); keep the current gains.
        if (!std::isfinite(Kp) || !std::isfinite(Ki) || !std::isfinite(Kd) || !std::isfinite(Kf) || Kp < 0 || Ki < 0 ||
            Kd < 0 || Kf < 0) {
            ESP_LOGE(LOG_TAG, "Rejected PID settings %f,%f,%f,%f", Kp, Ki, Kd, Kf);
            return;
        }
        this->heater->setTunings(Kp, Ki, Kd);

        // Apply thermal feedforward parameters if available
        this->heater->setFeedforwardScale(Kf);
    });
    _comms.onPumpSettings([this](gm::PumpSettings settings) {
        if (_config.capabilites.dimming) {
            auto dimmedPump = static_cast<DimmedPump *>(pump);
            // Check if this is a flow measurement call (a and b are flow measurements, c and d are nan)
            // A cleared or broken pump model would make every flow command NaN
            // (audit S1-H5); keep the current model.
            if (!std::isfinite(settings.a) || !std::isfinite(settings.b) ||
                (isnan(settings.c) != isnan(settings.d))) {
                ESP_LOGE(LOG_TAG, "Rejected pump model %f,%f,%f,%f", settings.a, settings.b, settings.c, settings.d);
            } else if (isnan(settings.c) && isnan(settings.d)) {
                if (settings.a > 0 && settings.b > 0) {
                    dimmedPump->setPumpFlowCoeff(settings.a, settings.b); // a = oneBarFlow, b = nineBarFlow
                } else {
                    ESP_LOGE(LOG_TAG, "Rejected pump flow %f,%f", settings.a, settings.b);
                }
            } else if (!std::isfinite(settings.c) || !std::isfinite(settings.d)) {
                ESP_LOGE(LOG_TAG, "Rejected pump model %f,%f,%f,%f", settings.a, settings.b, settings.c, settings.d);
            } else {
                dimmedPump->setPumpFlowPolyCoeffs(settings.a, settings.b, settings.c,
                                                  settings.d); // a, b, c, d are polynomial coefficients
            }
            if (this->gearpumpAddon != nullptr) {
                dimmedPump->setGains(settings.commutationGain, settings.convergenceGain, settings.integralGain);
                // Slip model is only meaningful for the positive-displacement gear/rotary-vane pump.
                dimmedPump->setPumpSlipPolyCoeffs(settings.slipA, settings.slipB, settings.slipC, settings.slipD);
            }
        }
        if (this->gearpumpAddon != nullptr) {
            gearpumpAddon->setMaxPower(settings.maxBLDCPower);
        }
    });
    _comms.onPing([this]() { handlePing(); });
    _comms.onAutotune([this](uint32_t testTimeSec, uint32_t windowSize, uint32_t heaterWattage) {
        handlePing();
        if (errorState != ERROR_CODE_NONE) { // don't re-engage the heater while faulted
            return;
        }
        this->heater->autotune(static_cast<int>(testTimeSec), static_cast<int>(windowSize), static_cast<int>(heaterWattage));
    });
    _comms.onTare([this]() {
        if (!_config.capabilites.dimming) {
            return;
        }
        auto dimmedPump = static_cast<DimmedPump *>(pump);
        dimmedPump->tare();
    });
    ESP_LOGI(LOG_TAG, "Initialization done");
}

void GaggiMateController::loop() {
    unsigned long now = millis();
    diagTestLoop(); // time-box enforcement for bench actuator tests
    if (lastPingTime < now && (now - lastPingTime) / 1000 > PING_TIMEOUT_SECONDS) {
        handlePingTimeout();
    }
    sendSensorData();
    if (errorState != ERROR_CODE_NONE) {
        ESP_LOGW("GaggiMateController", "Error state: %d", errorState);
    }
    delay(250);
#ifndef GAGGIMATE_MERGED
    // Single board: the USB port belongs to Wi-Fi setup over USB (Improv); reading it
    // here for the 'S' debug key swallowed Improv's bytes at random (2026-10-14).
    if (Serial.available()) {
        while (Serial.available()) {
            char c = Serial.read();
            handleSerialCommand(c);
        }
    }
#endif
}

void GaggiMateController::detectAddon() {
#ifdef GAGGIMATE_MERGED
    // Single-board build: detectAddon() probes an I2C bus on ext2/ext3
    // (Wire.begin(8, 2) with GM_PRO_LEGO pins). GPIO8 is the MAX31865 CS on
    // De'longezzi - beginning Wire on it would glitch CS during the scan.
    // No gearpump addon exists on a single-board build.
    ESP_LOGI(LOG_TAG, "Merged build: skipping addon detection (GPIO8 is MAX31865 CS)");
    return;
#endif
    Wire.begin(_config.ext3Pin, _config.ext2Pin, 400000);
    for (uint8_t addr = XL9555_SLAVE_ADDRESS0; addr <= XL9555_SLAVE_ADDRESS7; ++addr) {
        Wire.beginTransmission(addr);
        if (Wire.endTransmission(addr) == 0) {
            ESP_LOGI(LOG_TAG, "Found an extension at address 0x%X", addr);
            if (addr == 0x26) {
                ESP_LOGI(LOG_TAG, "Identified addon as Gearpump Addon");
                gearpumpAddon = new GearpumpAddon(addr, _config.ext3Pin, _config.ext2Pin, _config.ext1Pin);
            }
        }
    }
}

void GaggiMateController::handlePing() {
    if (errorState == ERROR_CODE_TIMEOUT) {
        errorState = ERROR_CODE_NONE;
    }
    lastPingTime = millis();
    ESP_LOGV(LOG_TAG, "Ping received, system is alive");
}

void GaggiMateController::handlePingTimeout() {
    // Turn off the heater and pump as a safety measure
    this->heater->setSetpoint(0);
    this->pump->setPower(0);
    this->valve->set(false);
    this->alt->set(false);
    // On the healthy->timeout transition, drop the BLE link. An in-band error
    // notify can be silently swallowed on a wedged GATT (the failure mode this
    // is here to recover from), but LL_TERMINATE_IND propagates reliably at
    // the link layer. The display's existing disconnect path then rebuilds
    // the link and re-sends control state. loop() re-enters every 250 ms while
    // timed out -- guard so we don't repeatedly bounce the connection or spam
    // the log.
    if (errorState != ERROR_CODE_TIMEOUT) {
        ESP_LOGE(LOG_TAG, "Ping timeout detected. Turning off heater and pump for safety.");
        if (!_comms.isUpdating())
            _comms.disconnect();
    }
    errorState = ERROR_CODE_TIMEOUT;
}

void GaggiMateController::thermalRunawayShutdown() {
    ESP_LOGE(LOG_TAG, "Thermal runaway detected! Turning off heater and pump!\n");
    // Turn off the heater and pump immediately
    this->heater->setSetpoint(0);
    this->pump->setPower(0);
    this->valve->set(false);
    this->alt->set(false);
    errorState = ERROR_CODE_RUNAWAY;
    _comms.sendError(ERROR_CODE_RUNAWAY);
}

void GaggiMateController::sendSensorData() {
    const float pumpPower = *pump->getPumpPowerPtr();
    const float heaterPower = heater ? heater->getDutyCycle() : 0.0f;
    if (_config.capabilites.pressure) {
        // Flow/volumetric come from the DimmedPump; only cast when this board
        // actually has one (pressure and dimming are configured independently).
        float puckFlow = 0.0f;
        float pumpFlow = 0.0f;
        float puckResistance = 0.0f;
        // Sensor + (optional) volumetric ride in one frame.
        gm::Payload batch[2];
        size_t n = 0;
        if (_config.capabilites.dimming) {
            auto dimmedPump = static_cast<DimmedPump *>(pump);
            puckFlow = dimmedPump->getPuckFlow();
            pumpFlow = dimmedPump->getPumpFlow();
            puckResistance = dimmedPump->getPuckResistance();
            if (this->valve->getState()) {
                batch[n++] = _comms.buildVolumetricMeasurement(dimmedPump->getCoffeeVolume());
            }
        }
        batch[n++] = _comms.buildSensorData(this->thermocouple->read(), this->pressureSensor->getPressure(), puckFlow, pumpFlow,
                                            puckResistance, pumpPower, heaterPower);
        _comms.sendUnreliableBatch(batch, n); // telemetry: fire-and-forget
    } else {
        _comms.sendSensorData(this->thermocouple->read(), 0.0f, 0.0f, 0.0f, 0.0f, pumpPower, heaterPower);
    }
}

#ifdef GAGGIMATE_MERGED
GaggiMateController::Diagnostics GaggiMateController::getDiagnostics() {
    // Called from the display half (web server task) while the controller task
    // may be mid-loop. All fields read here are atomically-sized (bool/int/
    // float on ESP32) and diagnostics-only, so lock-free reads are safe: a
    // torn float would be corrected by the next 2s poll.
    Diagnostics d;
    if (thermocouple != nullptr) {
        d.maxPresent = !thermocouple->isErrorState();
        d.temperature = thermocouple->read();
        d.maxRtd = thermocouple->getLastRtd();
        d.maxFault = thermocouple->getLastFault();
        d.maxErrorCount = thermocouple->getErrorCount();
    }
    if (adc != nullptr) {
        d.adsConnected = adc->isConnected();
        d.adsRaw = adc->getValue(0);
        d.adsVolts = adc->getLastVoltage(0);
    }
    if (pressureSensor != nullptr) {
        d.pressureBar = pressureSensor->getPressure();
    }
    if (heater != nullptr) {
        d.heaterDuty = heater->getDutyCycle();
    }
    if (pump != nullptr) {
        d.pumpPower = *pump->getPumpPowerPtr();
        auto *dimmedPump = static_cast<DimmedPump *>(pump);
        d.pumpZeroCross = dimmedPump->getZeroCrossCounter();
        d.pumpCps = dimmedPump->getLastCps();
    }
    d.errorCode = static_cast<uint32_t>(errorState);
    return d;
}

bool GaggiMateController::isDiagTestActive() {
    // Called from the web server task; atomically-sized reads only.
    return testActiveUntil != 0 && millis() < testActiveUntil;
}

bool GaggiMateController::isDiagHeaterTest() { return heaterTestActive; }

// ---------------------------------------------------------------------------
// Bench actuator tests (Diagnostics page). Direct actuator drive, no PID, no
// process machinery, no BLE/display involvement. Every test is time-boxed and
// auto-off is enforced in diagTestLoop() from loop(), so a wedged HTTP handler
// or lost browser tab can never leave the pump or SSR energised.
// ---------------------------------------------------------------------------

bool GaggiMateController::startDiagPumpTest(float percent, uint32_t durationMs) {
    if (errorState != ERROR_CODE_NONE || pump == nullptr) {
        ESP_LOGW(LOG_TAG, "Diag pump test REFUSED (errorState=%u)", (unsigned)errorState);
        return false;
    }
    if (percent <= 0.0f || percent > 100.0f) {
        return false;
    }
    // Cap the duration hard at 1 min regardless of what the request asked for
    // (bench voltage-measurement runs need longer than the original 30 s; the
    // UI's "1 min" button sends exactly this).
    const uint32_t capped = durationMs > 60000u ? 60000u : durationMs;
    // If an SSR test is somehow still active, clear it first — the two tests
    // are mutually exclusive and a stale forced heater output is a hazard.
    if (heaterTestActive) {
        heater->setForcedOutput(false);
        heaterTestActive = false;
    }
    testActiveUntil = millis() + capped;
    pump->setPower(percent);
    ESP_LOGW(LOG_TAG, "DIAG pump test: %.0f%% for %u ms", percent, (unsigned)capped);
    return true;
}

bool GaggiMateController::startDiagHeaterTest(uint32_t durationMs) {
    if (errorState != ERROR_CODE_NONE || heater == nullptr) {
        ESP_LOGW(LOG_TAG, "Diag heater test REFUSED (errorState=%u)", (unsigned)errorState);
        return false;
    }
    // Never force the SSR with a faulted or hot boiler: a shorted RTD reads 0
    // and full-power into an unmonitored boiler is exactly the runaway case.
    const float temp = thermocouple ? thermocouple->read() : 0.0f;
    if (thermocouple == nullptr || thermocouple->isErrorState() || temp > 120.0f) {
        ESP_LOGW(LOG_TAG, "Diag heater test REFUSED (sensor fault or temp %.1f C)", temp);
        return false;
    }
    const uint32_t capped = durationMs > 5000u ? 5000u : durationMs;
    testActiveUntil = millis() + capped;
    heaterTestActive = true;
    // Heater task would otherwise force the pin LOW (setpoint 0 path); the
    // forced mode makes the Heater task hold the pin HIGH for the window.
    heater->setForcedOutput(true);
    ESP_LOGW(LOG_TAG, "DIAG heater SSR test: ON for %u ms (temp %.1f C)", (unsigned)capped, temp);
    return true;
}

void GaggiMateController::stopDiagTests() {
    if (testActiveUntil == 0) {
        return;
    }
    testActiveUntil = 0;
    if (pump != nullptr) {
        pump->setPower(0);
    }
    if (heaterTestActive) {
        heater->setForcedOutput(false);
        heaterTestActive = false;
    }
    ESP_LOGW(LOG_TAG, "DIAG tests stopped, actuators off");
}

void GaggiMateController::diagTestLoop() {
    if (testActiveUntil != 0 && millis() >= testActiveUntil) {
        ESP_LOGW(LOG_TAG, "DIAG test window elapsed, actuators off");
        stopDiagTests();
    }
}

#endif

void GaggiMateController::handleSerialCommand(char c) {
    if (c == 'S') {
        ESP_LOGI("Controller", "");
        ESP_LOGI("Controller", "╔════════════════╗");
        ESP_LOGI("Controller", "║ Status Summary ║");
        ESP_LOGI("Controller", "╠════════════════╝");
        ESP_LOGI("Controller", "║");
        ESP_LOGI("Controller", "╠═ Error codes");
        ESP_LOGI("Controller", "║  ├─ Controller Error: %d", errorState);
        ESP_LOGI("Controller", "║  └─ Thermocouple Error: %d", thermocouple->isErrorState());
        ESP_LOGI("Controller", "║");
        ESP_LOGI("Controller", "╠═ Readings");
        if (_config.capabilites.pressure) {
            auto dimmedPump = static_cast<DimmedPump *>(pump);
            ESP_LOGI("Controller", "║  ├─ Pressure: %.2f", pressureSensor->getPressure());
            ESP_LOGI("Controller", "║  ├─ Flow: %.2f", dimmedPump->getPumpFlow());
            ESP_LOGI("Controller", "║  ├─ Pump Power: %.2f", dimmedPump->getPowerTarget());
        }
        ESP_LOGI("Controller", "║  └─ Temperature: %.2f", thermocouple->read());
        ESP_LOGI("Controller", "║");
        ESP_LOGI("Controller", "╠═ Control");
        if (_config.capabilites.pressure) {
            auto dimmedPump = static_cast<DimmedPump *>(pump);
            ESP_LOGI("Controller", "║  ├─ Pressure: %.2f", dimmedPump->getPressureTarget());
            ESP_LOGI("Controller", "║  ├─ Flow: %.2f", dimmedPump->getFlowTarget());
            ESP_LOGI("Controller", "║  ├─ Pump Power: %.2f", dimmedPump->getPowerTarget());
        }
        ESP_LOGI("Controller", "║  └─ Temperature: %.2f", heater->getSetpoint());
        ESP_LOGI("Controller", "║");

        size_t free = heap_caps_get_free_size(MALLOC_CAP_DEFAULT | MALLOC_CAP_INTERNAL);
        size_t largest = heap_caps_get_largest_free_block(MALLOC_CAP_DEFAULT | MALLOC_CAP_INTERNAL);
        size_t total = heap_caps_get_total_size(MALLOC_CAP_DEFAULT | MALLOC_CAP_INTERNAL);
        float fragmentation = 100 - (largest * 100) / free;
        ESP_LOGI("Controller", "╠═ Memory");
        ESP_LOGI("Controller", "║  ├─ Heap: %d / %d (%.2f%%)", (total - free), total, (100.0f * (total - free)) / total);
        ESP_LOGI("Controller", "║  └─ Fragmentation: %.2f%%", fragmentation);
        ESP_LOGI("Controller", "");
    } else {
        ESP_LOGI("Controller", "Unrecognized Input! Available commands: S (Status)");
    }
}
