#ifndef DIMMEDPUMP_H
#define DIMMEDPUMP_H
#include "PSM.h"
#include "PressureController/PressureController.h"
#include "PressureSensor.h"
#include "Pump.h"
#include <Arduino.h>

// Raw zero-cross tick counter (diagnostics), defined in DimmedPump.cpp.
// PSM::_counter is NOT usable as a "mains present" indicator: calculateSkip()
// only increments it on cycles that deliver a power pulse (_a += _value), so
// at pump power 0 the counter freezes even while zero crosses arrive. PSM
// exposes a weak onPSMInterrupt() hook that fires on EVERY zero-cross
// interrupt; the override in DimmedPump.cpp increments this counter, giving a
// true mains-presence signal for /api/diagnostics (pumpZeroCross). Weak-symbol
// override: PSM.cpp's empty definition is discarded at link time.
extern volatile long g_psmZeroCrossCount;

class DimmedPump : public Pump {
  public:
    enum class ControlMode { POWER, PRESSURE, FLOW };

    DimmedPump(uint8_t ssr_pin, uint8_t sense_pin, PressureSensor *pressureSensor);
    ~DimmedPump() = default;

    void setup() override;
    void loop() override;
    void setPower(float setpoint) override;

    float getCoffeeVolume();
    float getPumpFlow();
    float getPuckFlow();
    float getPuckResistance();
    float getPressureTarget() { return _ctrlPressure; }
    float getFlowTarget() { return _ctrlFlow; }
    float *getPumpPowerPtr() override { return &_power; } // For external pump control
    float *getPumpFlowPtr() { return &_currentFlow; }     // For thermal feedforward
    int *getValveStatusPtr() { return &_valveStatus; }    // For thermal feedforward valve state
    // Diagnostics access to the dimmer state (see GaggiMateController::Diagnostics).
    // cps() is NOT safe to call from a polling endpoint: it blocks for a full
    // second while freezing/overwriting the live dimmer state (_range, _value,
    // _divider). We therefore expose g_psmZeroCrossCount (ticks with mains
    // present, static with mains off) and the last-known cps measured during
    // setup().
    long getZeroCrossCounter() { return g_psmZeroCrossCount; }
    unsigned int getLastCps() { return _cps; }
    void tare();

    void setFlowTarget(float targetFlow, float pressureLimit);
    void setPressureTarget(float targetPressure, float flowLimit);
    void setPumpFlowCoeff(float oneBarFlow, float nineBarFlow);
    void setPumpFlowPolyCoeffs(float a, float b, float c, float d);
    void setPumpSlipPolyCoeffs(float a, float b, float c, float d);
    void setGains(float commutationGain, float convergenceGain, float integralGain);
    void stop();
    void fullPower();
    void setValveState(bool open);
    void setBinaryMode(bool binaryMode);

  private:
    uint8_t _ssr_pin;
    uint8_t _sense_pin;
    PSM _psm;
    PressureSensor *_pressureSensor;
    PressureController _pressureController;

    xTaskHandle taskHandle;

    ControlMode _mode = ControlMode::POWER;
    float _power = 0.0f;
    float _controllerPower = 0.0f;
    float _ctrlPressure = 0.0f;
    float _ctrlFlow = 0.0f;
    float _currentPressure = 0.0f;
    float _currentFlow = 0.0f;
    float _lastPressure = 0.0f;
    int _valveStatus = 0;
    int _cps = MAX_FREQ;
    bool _binaryMode = false;

    float _opvPressure = 0.0f;

    static constexpr float BASE_FLOW_RATE = 0.25f;
    static constexpr float MAX_PRESSURE = 15.0f;
    static constexpr float MAX_FREQ = 60.0f;

    void updatePower();
    void onPressureUpdate(float pressure);

    const char *LOG_TAG = "DimmedPump";
    static void loopTask(void *arg);
};

#endif // DIMMEDPUMP_H
