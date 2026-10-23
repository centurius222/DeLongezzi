// Copy of gaggimate/esp-arduino-ble-scales v1.0.2 src/scales/weighmybru.* with
// WeighMyBrewScales -> WeighMyBruTimerScales, WeighMyBrewScalePlugin ->
// WeighMyBruTimerScalePlugin, WeighMyBrewMessageType -> WmbTimerMsgType, so it
// can sit next to the library copy (which still compiles, unused), plus timer
// control: start / stop / reset in the WeighMyBru2 format (0x02 / 0x03 / 0x04,
// byte 3 = 0x01), so the DeLongscali scale shows the machine's shot time.
// Plan: DeLongscali timer_sync_plan.txt (2026-09-23).

#pragma once
#include "remote_scales.h"
#include "remote_scales_plugin_registry.h"
#include <Arduino.h>
#include <NimBLEDevice.h>
#include <NimBLEUtils.h>
#include <NimBLEScan.h>
#include <vector>
#include <memory>

enum class WmbTimerMsgType : uint8_t {
  SYSTEM = 0x0A,
  WEIGHT = 0x0B,
  TARE_PRESSED = 0xA1  // DeLongscali: pad tare pressed on the scale
};

class WeighMyBruTimerScales : public RemoteScales {

public:
  // Set when the scale reports its pad tare (TARE_PRESSED); BLEScalePlugin::loop()
  // takes it and clears the finished shot like the panel's Tare (user 2026-09-24).
  static bool takeTarePressed() { bool t = s_tarePressed; s_tarePressed = false; return t; }
  WeighMyBruTimerScales(const DiscoveredDevice& device);
  void update() override;
  bool connect() override;
  void disconnect() override;
  bool isConnected() override;
  bool tare() override;
  // Timer control (added): BLEScalePlugin starts, stops and resets the scale's
  // shot clock with the machine's shot.
  bool hasTimerControl() const override { return true; }
  void startTimer() override;
  void stopTimer() override;
  void resetTimer() override;

private:
  static volatile bool s_tarePressed;
  std::string weightUnits;
  float time;
  uint8_t battery;

  uint32_t lastHeartbeat = 0;

  bool markedForReconnection = false;

  NimBLERemoteService* service;
  NimBLERemoteCharacteristic* weightCharacteristic;
  NimBLERemoteCharacteristic* commandCharacteristic;

  std::vector<uint8_t> dataBuffer;

  bool performConnectionHandshake();
  void subscribeToNotifications();

  void sendMessage(WmbTimerMsgType msgType, const uint8_t* payload, size_t length, bool waitResponse = false);
  void sendEvent(const uint8_t* payload, size_t length);
  void sendHeartbeat();
  void sendNotificationRequest();
  void notifyCallback(NimBLERemoteCharacteristic* pBLERemoteCharacteristic, uint8_t* pData, size_t length, bool isNotify);
  bool decodeAndHandleNotification();
};

class WeighMyBruTimerScalePlugin {
public:
  static void apply() {
    RemoteScalesPlugin plugin = RemoteScalesPlugin{
      .id = "plugin-weighmybru-timer",
      .handles = [](const DiscoveredDevice& device) { return WeighMyBruTimerScalePlugin::handles(device); },
      .initialise = [](const DiscoveredDevice& device) -> std::unique_ptr<RemoteScales> { return std::make_unique<WeighMyBruTimerScales>(device); },
    };
    RemoteScalesPluginRegistry::getInstance()->registerPlugin(plugin);
  }
private:
  static bool handles(const DiscoveredDevice& device) {
    const std::string& deviceName = device.getName();
    return !deviceName.empty() && (deviceName.find("WeighMyBru") == 0);
  }
};
