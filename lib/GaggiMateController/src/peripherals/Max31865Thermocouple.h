#ifndef MAX31865THERMOCOUPLE_H
#define MAX31865THERMOCOUPLE_H

#include "TemperatureSensor.h"
#include <Adafruit_MAX31865.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

constexpr int MAX31865_UPDATE_INTERVAL = 250;
constexpr int MAX31865_ERROR_WINDOW = 20;
constexpr float MAX31865_MAX_ERROR_RATE = 0.5f;
constexpr int MAX31865_MAX_ERRORS = static_cast<int>(static_cast<float>(MAX31865_ERROR_WINDOW) * MAX31865_MAX_ERROR_RATE);

// PT1000, 3-wire configuration
constexpr float MAX31865_REF_RESISTOR = 4300.0f; // Ohm, matching the PT1000 breakout
constexpr float MAX31865_RTD_NOMINAL = 1000.0f;  // Ohm at 0°C
constexpr int MAX31865_WIRES = 3;                // 3-wire PT1000

using temperature_callback_t = std::function<void(float)>;
using temperature_error_callback_t = std::function<void()>;

class Max31865Thermocouple : public TemperatureSensor {
  public:
    Max31865Thermocouple(int csPin, int mosiPin, int misoPin, int sckPin,
                         const temperature_callback_t &callback,
                         const temperature_error_callback_t &error_callback);
    float read() override;
    bool isErrorState() override;

    // Diagnostics accessors (values from the last loop() pass)
    uint16_t getLastRtd() const { return lastRtd; }
    uint8_t getLastFault() const { return lastFault; }
    int getErrorCount() const { return errorCount; }

    void setup();
    void loop();

  private:
    Adafruit_MAX31865 *max31865;
    xTaskHandle taskHandle;

    int errorCount = 0;
    std::array<int, MAX31865_ERROR_WINDOW> resultBuffer{};
    size_t resultCount = 0;
    size_t bufferIndex = 0;

    float temperature = .0f;

    int csPin = 0;
    int mosiPin = 0;
    int misoPin = 0;
    int sckPin = 0;

    uint16_t lastRtd = 0;
    uint8_t lastFault = 0;

    temperature_callback_t callback;
    temperature_error_callback_t error_callback;

    const char *LOG_TAG = "Max31865Thermocouple";
    static void monitorTask(void *arg);
};

#endif // MAX31865THERMOCOUPLE_H
