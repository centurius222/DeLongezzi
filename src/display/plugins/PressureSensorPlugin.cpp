#include "PressureSensorPlugin.h"
#include <Arduino.h>

static const int PRESSURE_PIN = 3;           // GPIO3 (D2/A2) - pot wiper / transducer signal
static const unsigned long SAMPLE_MS = 50;   // 20 Hz
static const float EMA_ALPHA = 0.25f;        // smoothing

void PressureSensorPlugin::setup(Controller *c, PluginManager *pm) {
    controller = c;
    settings = &c->getSettings();
    analogReadResolution(12);
}

void PressureSensorPlugin::loop() {
    unsigned long now = millis();
    if (now - lastSample < SAMPLE_MS) return;
    lastSample = now;

    // millivolts at the ADC pin
    uint32_t mv = analogReadMilliVolts(PRESSURE_PIN);
    float pinV = mv / 1000.0f;

    float bar;
    if (settings->getPressureSensorMode() == 1) {
        // Transducer mode: 0.5-4.5V sensor through 10k/20k divider (x0.667).
        float sensorV = pinV / 0.667f;
        bar = (sensorV - 0.5f) / 4.0f * 16.0f;
    } else {
        // Pot mode (bench): full 0-3.3V sweep maps to 0-16 bar.
        bar = pinV / 3.3f * 16.0f;
    }
    if (bar < 0) bar = 0;

    if (!emaInit) { ema = bar; emaInit = true; }
    ema += EMA_ALPHA * (bar - ema);

    controller->setCurrentPressure(ema);
}
