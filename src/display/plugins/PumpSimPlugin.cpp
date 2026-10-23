#include "PumpSimPlugin.h"
#include <display/core/process/BrewProcess.h>

static const unsigned long UPDATE_MS = 50;

void PumpSimPlugin::setup(Controller *c, PluginManager *pm) {
    controller = c;
    pixel.begin();
    pixel.clear();
    pixel.show();
}

uint32_t PumpSimPlugin::barToColor(float bar, uint8_t brightness) {
    float frac = bar / 15.0f;
    if (frac < 0.0f) frac = 0.0f;
    if (frac > 1.0f) frac = 1.0f;
    uint16_t hue = (uint16_t)(43690.0f * (1.0f - frac)); // blue -> red
    return pixel.gamma32(pixel.ColorHSV(hue, 255, brightness));
}

void PumpSimPlugin::loop() {
    unsigned long now = millis();
    if (now - lastUpdate < UPDATE_MS) return;
    float dt = (now - lastUpdate) / 1000.0f;
    lastUpdate = now;

    float actual = controller->getCurrentPressure();
    float target = 0.0f;
    Process *proc = controller->getProcess();
    if (proc != nullptr && proc->isActive() && proc->getType() == MODE_BREW) {
        target = static_cast<BrewProcess *>(proc)->getPumpPressure();
    }
    bool brewing = target > 0.1f;

    if (brewing) {
        // PID (P-only while Ki/Kd = 0)
        float error = target - actual;
        integral += error * dt;
        float derivative = (error - lastError) / dt;
        lastError = error;

        pumpPower = Kp * error + Ki * integral + Kd * derivative;
        if (pumpPower < 0.0f) pumpPower = 0.0f;
        if (pumpPower > 100.0f) pumpPower = 100.0f;

        // pixel0: pump power. Green = driving, red = maxed, dim white = target met.
        if (pumpPower > 97.0f) {
            pixel.setPixelColor(0, pixel.Color(60, 0, 0, 0)); // maxed, can't reach target
        } else if (pumpPower < 1.0f) {
            pixel.setPixelColor(0, pixel.Color(0, 0, 0, 6)); // satisfied: pump off, dim white
        } else {
            uint8_t b = (uint8_t)(pumpPower / 100.0f * 60.0f);
            pixel.setPixelColor(0, pixel.Color(0, b < 2 ? 2 : b, 0, 0));
        }
        // pixel1: live profile target as heat gradient
        pixel.setPixelColor(1, barToColor(target, 60));
    } else {
        integral = 0.0f;
        lastError = 0.0f;
        pumpPower = 0.0f;
        // idle: pixel0 mirrors pot pressure, pixel1 dim purple
        if (actual < 0.3f) {
            pixel.setPixelColor(0, pixel.Color(0, 0, 10, 0));
        } else {
            pixel.setPixelColor(0, barToColor(actual, 60));
        }
        pixel.setPixelColor(1, pixel.Color(8, 0, 8, 0));
    }
    pixel.show();
}