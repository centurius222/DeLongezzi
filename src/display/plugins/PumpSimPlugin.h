#ifndef PUMP_SIM_PLUGIN_H
#define PUMP_SIM_PLUGIN_H

#include <display/core/Controller.h>
#include <display/core/Plugin.h>
#include <display/core/PluginManager.h>
#include <Adafruit_NeoPixel.h>

// Simulated pump with PID-structured control loop (P-only tuning for bench).
// Idle:  pixel0 = current pressure gradient (pot), pixel1 = dim purple.
// Brew:  pixel1 = profile target gradient, pixel0 = pump power (loop output).
// Same power signal later drives the TRIAC dimmer for the real pump.
class PumpSimPlugin : public Plugin {
  public:
    void setup(Controller *controller, PluginManager *pluginManager) override;
    void loop() override;

  private:
    uint32_t barToColor(float bar, uint8_t brightness);

    Controller *controller = nullptr;
    Adafruit_NeoPixel pixel{2, 1, NEO_GRBW + NEO_KHZ800}; // 2 RGBW pixels, GPIO1
    unsigned long lastUpdate = 0;

    // PID state (Ki/Kd zeroed = P-only for the bench)
    float Kp = 25.0f;   // % pump power per bar of error
    float Ki = 0.0f;
    float Kd = 0.0f;
    float integral = 0.0f;
    float lastError = 0.0f;
    float pumpPower = 0.0f; // 0-100 %
};

#endif // PUMP_SIM_PLUGIN_H