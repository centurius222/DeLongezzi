#include "main.h"
#include <DlzLog.h>
#include <WiFi.h>
#include <version.h>
#include <esp_heap_caps.h>
#include <display/util/PsramThreshold.h>
#include <esp_log.h>
#include <driver/gpio.h>
#include <esp_task_wdt.h>

#ifndef GAGGIMATE_HEADLESS
#include <lvgl.h>
#endif

#ifdef GAGGIMATE_MERGED
// ============================================================================
// De'longezzi single-board build (GAGGIMATE_MERGED):
// display half (Controller/web UI) + controller half (GaggiMateController
// hardware drivers: MAX31865, ADS1115, heater SSR, dimmed pump) in ONE image.
//
// The two halves talk through an in-process loopback transport that replaces
// the stock BLE radio link (see LoopbackPair.h) - protocol state machines are
// unchanged, only the wire is virtual.
// ============================================================================

#include <GaggiMateController.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

Controller controller;                 // display half (from main.h)
GaggiMateController gmController{BUILD_GIT_VERSION}; // controller half

#if defined(GAGGIMATE_MERGED) && defined(GAGGIMATE_HEADLESS)
// Diagnostics bridge: WebUIPlugin (display half) reads device health from the
// controller half through this C-style mirror interface. The mirror struct
// can't be shared via a header (the controller headers collide with lib/OTA
// global constexprs in WebUIPlugin.cpp's TU), so both TUs declare identical
// layouts; the static_assert pins them in sync at compile time.
struct GmDiagnosticsMirror {
    bool maxPresent;
    float temperature;
    uint16_t maxRtd;
    uint8_t maxFault;
    int maxErrorCount;
    bool adsConnected;
    int adsRaw;
    float adsVolts;
    float pressureBar;
    float heaterDuty;
    float pumpPower;
    long pumpZeroCross;
    unsigned int pumpCps;
    uint32_t errorCode;
};
bool getGmDiagnosticsMirror(GmDiagnosticsMirror &out) {
    static_assert(sizeof(GmDiagnosticsMirror) == sizeof(GaggiMateController::Diagnostics),
                  "GmDiagnosticsMirror out of sync with GaggiMateController::Diagnostics");
    GaggiMateController::Diagnostics d = gmController.getDiagnostics();
    __builtin_memcpy(&out, &d, sizeof(d));
    return true;
}

// Bridge for the Diagnostics-page bench actuator tests (WebUIPlugin ->
// controller half). Returns false when the controller lib refused (error
// state, sensor fault) so the UI can show it.
bool gmStartDiagPumpTest(float percent, uint32_t durationMs) {
    return gmController.startDiagPumpTest(percent, durationMs);
}
bool gmStartDiagHeaterTest(uint32_t durationMs) {
    return gmController.startDiagHeaterTest(durationMs);
}
bool gmStopDiagTests() {
    gmController.stopDiagTests();
    return true;
}
bool gmDiagTestActive() {
    return gmController.isDiagTestActive();
}
bool gmDiagHeaterTest() {
    return gmController.isDiagHeaterTest();
}
// Heat-up check (Settings > Machine): switch, and the last trip for the page.
void gmSetHeatUpCheck(bool on) { gmController.setHeatUpCheck(on); }
bool gmGetHeatUpTrip(float &from, float &to, float &target, uint32_t &agoSec) {
    const Heater::RiseTrip t = gmController.getHeatUpTrip();
    if (!t.tripped)
        return false;
    from = t.from;
    to = t.to;
    target = t.target;
    agoSec = (millis() - t.at) / 1000;
    return true;
}
#endif

// The GaggiMateController::loop() blocks ~250ms per pass (telemetry cadence +
// its own ping watchdog), so it gets a dedicated task on core 1. The display's
// logic task is pinned to core 0 (Controller.cpp), WiFi/async_tcp on core 0 as
// well; the PID/monitor tasks inside the controller lib spawn their own tasks.
[[noreturn]] static void gmControllerTask(void *) {
    // Own Arduino-loop emulation: setup once, then loop forever.
    gmController.setup();
    while (true) {
        gmController.loop();
        // loop() already blocks internally (delay(250)); yield to the IDLE task
        // so the watchdog stays happy on core 1.
        taskYIELD();
    }
}
#endif

void setup() {
    // Permanent log first, so the reset reason and previous run are kept (2026-10-16).
    dlzlog_boot();
    // The GPIO interrupt service, installed here at the start (2026-10-18). Installing it runs on
    // ESP-IDF's 1 KB "ipc1" helper; when the pump driver did it (PSM::PSM -> attachInterrupt, about
    // 5.8 s in, while WebBackground keeps parking core 1 for storage) an interrupt landing during
    // the install overflowed ipc1 (all four crash dumps: the controller task waiting on ipc1 in
    // gpio_isr_register_on_core_static). Here nothing else runs yet. attachInterrupt() later finds
    // it installed and only sets up its pin. Same core (1) and flags as Arduino would use.
    // Measured on build 927: 0 crashes in 20 restarts, ipc1 lowest spare 204 B on every start.
    gpio_install_isr_service((int)ARDUINO_ISR_FLAG);
    dlzlog("firmware built %s", BUILD_TIMESTAMP);
    dlzlog_mem("boot");
#ifdef GAGGIMATE_MERGED
    // Relays off before anything else (the merged build's controller half only
    // starts several seconds later). See GaggiMateController::outputsOff().
    gmController.outputsOff();
#endif
    // Blocks of 256 bytes and up go to the 8 MB PSRAM (the SDK default is 4096;
    // 512 from 2026-09-24). Skill baseline: never below 256 - the storage layer's
    // own 128-byte read buffers must stay in internal RAM; at 128 they land in
    // PSRAM and every storage read takes a slow detour (WebBackground WDT trips,
    // async_tcp stuck inside flash ops serving theme pages).
    // Held for the whole run since 2026-10-19 (PsramThreshold.h; before, the first page message reset it).
    heap_caps_malloc_extmem_enable(PSRAM_MALLOC_THRESHOLD);
    // Wi-Fi TX from the elastic dynamic pool (eureka-era spec): lets the driver
    // size buffers to demand instead of pinning a fixed pool that fragments
    // internal RAM during page/video bursts.
    WiFi.useStaticBuffers(false);
    Serial.begin(115200);
    // 2026-10-12: USB logging OFF. Two decoded cores showed async_tcp BLOCKED inside
    // log_printfv writing per-event web log lines to an undrained USB-CDC port, stalling
    // core-0 tasks for up to a minute. Keep ESP_LOG_ERROR so real faults still print.
    // 2026-10-22 (build 967): no USB logging at all (user); faults are in /api/log and Diagnostics.
    // Serial itself stays open for Improv Wi-Fi setup over USB.
    esp_log_level_set("*", ESP_LOG_NONE);
    // 2026-10-12: task watchdog 5 s -> 15 s. Decoded cores: LittleFS flash
    // bookkeeping can hold core 0 past 5 s (churned filesystem), tripping
    // task_wdt_isr -> abort -> restart loop. 15 s covers the worst measured
    // ambient stall instead of rebooting through it.
    // 2026-10-12 evening: panic=false. The 15 s WDT was still aborting the chip
    // when async_tcp sat inside a flash op (restore-write GC) past the budget.
    // Reboot is the worst outcome: Wi-Fi/config churn + lost state. With panic
    // off the WDT logs and the stall heals when the flash op finishes.
    esp_task_wdt_init(15, false);
#ifdef GAGGIMATE_MERGED
    // Wire the two halves together before anything pumps: create the loopback
    // pair and arm both transports. The GM controller side connects when the
    // display's comms loop calls connectToServer() (Controller::loop), which
    // brings the virtual link up on both ends and fires SystemInfo push.
    if (!enableMergedLoopback(controller.getClientController()->transportForLoopback(),
                              gmController.getServer().transportForLoopback())) {
        ESP_LOGE("main", "Failed to create loopback pair - display will wait for a controller forever");
    }
    // used ~2.1 KB (measured peak 2026-10-09 after a shot with the scale; trimmed to free fast memory)
    xTaskCreatePinnedToCore(gmControllerTask, "GaggiMateController", 4096, nullptr, 2, nullptr, 1);
    dlzlog_mem("controller-half");
#endif
    controller.setup();
    dlzlog_mem("setup-done");
}

// The Arduino main loop (status stream, plugins): used ~3.5 KB of 8 KB (measured peak 2026-10-09 after a shot with the scale; trimmed to free fast memory)
SET_LOOP_TASK_STACK_SIZE(6144);

void loop() {
    extern void noteSlow(const char *what, const void *who, unsigned long ms);
    const unsigned long t = millis();
    controller.loop();
    noteSlow("main loop", nullptr, millis() - t); // the whole pass (Diagnostics "slow")
    delay(50);
}
