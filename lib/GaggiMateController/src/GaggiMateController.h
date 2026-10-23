#ifndef GAGGIMATECONTROLLER_H
#define GAGGIMATECONTROLLER_H
#include "ControllerConfig.h"
#include "GaggiMateServer.h"
#include <peripherals/DigitalInput.h>
#include <peripherals/DistanceSensor.h>
#include <peripherals/FlowSensor.h>
#include <peripherals/Heater.h>
#include <peripherals/LedController.h>
#include <peripherals/Max31865Thermocouple.h>
#include <peripherals/PressureSensor.h>
#include <peripherals/Pump.h>
#include <peripherals/SimpleRelay.h>
#include <peripherals/addons/GearpumpAddon.h>

constexpr double PING_TIMEOUT_SECONDS = 20.0;

class GaggiMateController {
  public:
    // Heater and pump pins driven off. Called first thing at boot (see setup()).
    void outputsOff();
    GaggiMateController(String version);
    void setup(void);
    void loop(void);

#ifdef GAGGIMATE_MERGED
    // Single-board build: merged main needs to wire the server transport into
    // the loopback pair (replaces the BLE radio link to a separate display).
    GaggiMateServer &getServer() { return _comms; }

    // Snapshot of device health for the diagnostics web endpoint. Filled from
    // the live peripherals; read from the display half via /api/diagnostics.
    struct Diagnostics {
        // MAX31865 (boiler temperature)
        bool maxPresent = false;
        float temperature = 0.0f;
        uint16_t maxRtd = 0;
        uint8_t maxFault = 0;
        int maxErrorCount = 0;
        // ADS1115 (pressure transducer, 0x48)
        bool adsConnected = false;
        int adsRaw = 0;
        float adsVolts = 0.0f;
        float pressureBar = 0.0f;
        // Actuators
        float heaterDuty = 0.0f; // 0..100 %
        float pumpPower = 0.0f;  // 0..100 %
        // Pump dimmer (PSM): zero-cross counter ticks only when mains is
        // present on the sense pin; cps is the last full-second measurement
        // taken at setup().
        long pumpZeroCross = 0;
        unsigned int pumpCps = 0;
        // Controller-lib error state (ERROR_CODE_* from constants.h)
        uint32_t errorCode = 0;
    };
    Diagnostics getDiagnostics();

    // Bench actuator tests (Diagnostics page). Time-boxed; auto-off is enforced
    // by diagTestLoop() which runs from loop(). Refused while any controller-lib
    // error state is active. These bypass PID/process logic entirely — they are
    // wiring/actuator verification tools, not brewing paths.
    bool startDiagPumpTest(float percent, uint32_t durationMs);
    bool startDiagHeaterTest(uint32_t durationMs);
    void stopDiagTests();
    void diagTestLoop();
    bool isDiagTestActive();
    bool isDiagHeaterTest();
#endif
    // Heat-up check switch (Settings > Machine) and its last trip.
    void setHeatUpCheck(bool on) {
        if (heater != nullptr)
            heater->setRiseCheck(on);
    }
    Heater::RiseTrip getHeatUpTrip() const { return heater != nullptr ? heater->getRiseTrip() : Heater::RiseTrip{}; }

  private:
    void detectAddon();
    void handlePing();
    void handlePingTimeout(void);
    void thermalRunawayShutdown(void);
    void startPidAutotune(void);
    void stopPidAutotune(void);
    void sendSensorData(void);
    void handleSerialCommand(char c);

    ControllerConfig _config = GM_PRO_LEGO;
    GaggiMateServer _comms;

    Max31865Thermocouple *thermocouple = nullptr;
    Heater *heater = nullptr;
    SimpleRelay *valve = nullptr;
    SimpleRelay *alt = nullptr;
    Pump *pump = nullptr;
    DigitalInput *brewBtn = nullptr;
    DigitalInput *steamBtn = nullptr;
    PressureSensor *pressureSensor = nullptr;
    LedController *ledController = nullptr;
    DistanceSensor *distanceSensor = nullptr;
    ADSAdc *adc = nullptr;
    FlowSensor *flowSensor = nullptr;

    GearpumpAddon *gearpumpAddon = nullptr;

    SoftWire *albaComms = nullptr;

    String _version;
    unsigned long lastPingTime = 0;
    size_t errorState = ERROR_CODE_NONE;

    // Bench test state (diag tests). testActiveUntil==0 means no test running.
    unsigned long testActiveUntil = 0;
    bool heaterTestActive = false;

    const char *LOG_TAG = "GaggiMateController";
};

#endif // GAGGIMATECONTROLLER_H
