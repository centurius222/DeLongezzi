#ifndef PRESSURE_SENSOR_PLUGIN_H
#define PRESSURE_SENSOR_PLUGIN_H

#include <display/core/Controller.h>
#include <display/core/Plugin.h>
#include <display/core/PluginManager.h>
#include <display/core/Settings.h>

// Local analog pressure input on the display board itself (no BLE controller
// needed). Mode is a runtime setting so swapping the bench pot for the real
// 0.5-4.5V transducer requires no reflash.
class PressureSensorPlugin : public Plugin {
  public:
    void setup(Controller *controller, PluginManager *pluginManager) override;
    void loop() override;

  private:
    Controller *controller = nullptr;
    Settings *settings = nullptr;
    unsigned long lastSample = 0;
    float ema = 0.0f;
    bool emaInit = false;
};

#endif // PRESSURE_SENSOR_PLUGIN_H
