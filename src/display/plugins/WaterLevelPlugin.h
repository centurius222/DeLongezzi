#ifndef WATER_LEVEL_PLUGIN_H
#define WATER_LEVEL_PLUGIN_H

#include <display/core/Controller.h>
#include <display/core/Plugin.h>
#include <display/core/PluginManager.h>
#include <display/core/Settings.h>

// Capacitive water level via copper tape on the tank (touch pin GPIO4).
// Calibration (empty/full raw counts) stored in settings; level = percent
// between them. Raw value exposed for electrode geometry testing.
class WaterLevelPlugin : public Plugin {
  public:
    void setup(Controller *controller, PluginManager *pluginManager) override;
    void loop() override;

    float getPercent() const { return percent; }
    uint32_t getRaw() const { return (uint32_t)ema; }
    bool isLow() const { return percent >= 0 && percent < 15.0f; }
    void calibrateEmpty();
    void calibrateFull();

  private:
    Settings *settings = nullptr;
    unsigned long lastSample = 0;
    float ema = 0.0f;
    bool emaInit = false;
    float percent = -1.0f; // -1 = uncalibrated
};

extern WaterLevelPlugin *gWaterLevel;

#endif // WATER_LEVEL_PLUGIN_H