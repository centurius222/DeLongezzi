#include "Max31865Thermocouple.h"
#include <Arduino.h>
#include <SPI.h>
#include <freertos/FreeRTOS.h>

Max31865Thermocouple::Max31865Thermocouple(const int csPin, const int mosiPin, const int misoPin, const int sckPin,
                                           const temperature_callback_t &callback,
                                           const temperature_error_callback_t &error_callback)
    : taskHandle(nullptr), csPin(csPin), mosiPin(mosiPin), misoPin(misoPin), sckPin(sckPin) {
    max31865 = new Adafruit_MAX31865(csPin, mosiPin, misoPin, sckPin);
    this->callback = callback;
    this->error_callback = error_callback;
}

float Max31865Thermocouple::read() { return isErrorState() ? 0.0f : temperature; }

bool Max31865Thermocouple::isErrorState() { return temperature <= 0 || errorCount >= MAX31865_MAX_ERRORS; }

void Max31865Thermocouple::setup() {
    max31865->begin(MAX31865_3WIRE); // PT1000 wired 3-wire on De'longezzi

    xTaskCreate(monitorTask, "Max31865Thermocouple::monitor", configMINIMAL_STACK_SIZE * 4, this, 1, &taskHandle);
}

void Max31865Thermocouple::loop() {
    if (errorCount >= MAX31865_MAX_ERRORS || temperature > MAX_SAFE_TEMP) {
        ESP_LOGE(LOG_TAG, "RTD failure! Error Count: %d, Temperature: %.2f\n", errorCount, temperature);
        error_callback();
        return;
    }
    // If buffer has been filled up, remove the previous result from the error count
    if (resultCount == MAX31865_ERROR_WINDOW) {
        errorCount -= resultBuffer[bufferIndex];
    } else {
        ++resultCount;
    }

    float temp = 0.0f;
    uint16_t rtd = max31865->readRTD();
    lastRtd = rtd;

    if (rtd == 0 || rtd == 0xFFFF) {
        ESP_LOGE(LOG_TAG, "Failed to read RTD: %u\n", rtd);
        temp = 0.0f;
    } else {
        uint8_t fault = max31865->readFault();
        lastFault = fault;
        if (fault) {
            ESP_LOGE(LOG_TAG, "RTD fault 0x%02X: ", fault);
            max31865->clearFault();
            temp = 0.0f;
        } else {
            temp = max31865->temperature(MAX31865_RTD_NOMINAL, MAX31865_REF_RESISTOR);
        }
    }

    if (temp <= 0.0f) {
        ESP_LOGE(LOG_TAG, "Temperature reported below 0°C: %.2f\n", temp);
    }

    resultBuffer[bufferIndex] = temp <= 0.0f ? 1 : 0;
    errorCount += resultBuffer[bufferIndex];
    bufferIndex = (bufferIndex + 1) % MAX31865_ERROR_WINDOW;

    if (temp <= 0.0f)
        return;
    temperature = 0.2f * temp + 0.8f * temperature;
    ESP_LOGV(LOG_TAG, "Updated temperature: %2f\n", temperature);
    callback(temperature);
}

[[noreturn]] void Max31865Thermocouple::monitorTask(void *arg) {
    TickType_t lastWake = xTaskGetTickCount();
    auto *thermocouple = static_cast<Max31865Thermocouple *>(arg);
    while (true) {
        thermocouple->loop();
        xTaskDelayUntil(&lastWake, pdMS_TO_TICKS(MAX31865_UPDATE_INTERVAL));
    }
}
