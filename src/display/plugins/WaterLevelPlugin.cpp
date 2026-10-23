#include "WaterLevelPlugin.h"
#include <Arduino.h>

WaterLevelPlugin *gWaterLevel = nullptr;

static const int TOUCH_PIN = 12;              // GPIO12 (water level touch, see pins.txt)
static const unsigned long SAMPLE_MS = 250;   // 4 Hz
static const float EMA_ALPHA = 0.15f;

void WaterLevelPlugin::setup(Controller *c, PluginManager *pm) {
    settings = &c->getSettings();
    gWaterLevel = this;
}

void WaterLevelPlugin::calibrateEmpty() { settings->setWaterLevelEmpty((int)ema); }
void WaterLevelPlugin::calibrateFull() { settings->setWaterLevelFull((int)ema); }

void WaterLevelPlugin::loop() {
    unsigned long now = millis();
    if (now - lastSample < SAMPLE_MS) return;
    lastSample = now;

    uint32_t raw = touchRead(TOUCH_PIN);
    if (!emaInit) { ema = (float)raw; emaInit = true; }
    ema += EMA_ALPHA * ((float)raw - ema);

    int empty = settings->getWaterLevelEmpty();
    int full = settings->getWaterLevelFull();
    if (empty != 0 && full != 0 && empty != full) {
        percent = (ema - (float)empty) / ((float)full - (float)empty) * 100.0f;
        if (percent < 0.0f) percent = 0.0f;
        if (percent > 100.0f) percent = 100.0f;
    } else {
        percent = -1.0f; // uncalibrated
    }
}