#include "ImprovPlugin.h"

#include <ImprovWiFiLibrary.h>
#include <WiFi.h>
#include <display/core/Controller.h>
#include <version.h>
#if ARDUINO_USB_MODE && ARDUINO_USB_CDC_ON_BOOT
#include <hal/usb_serial_jtag_ll.h>
#endif

static ImprovPlugin *instance = nullptr;

static ImprovTypes::ChipFamily currentChipFamily() { return ImprovTypes::CF_ESP32_S3; }

// 2026-10-23 (build 970): the USB serial driver (HWCDC, Arduino-ESP32 2.0.17) can keep a reply
// in its send buffer when it was written while it took the PC for not listening, and sends it
// only with the next write. ESP Web Tools waits for the "device info" reply with no time limit,
// so its Wi-Fi step never came. Start the send now, as HWCDC::write() does when connected.
static void sendUsbNow() {
#if ARDUINO_USB_MODE && ARDUINO_USB_CDC_ON_BOOT
    usb_serial_jtag_ll_txfifo_flush();
    usb_serial_jtag_ll_ena_intr_mask(USB_SERIAL_JTAG_INTR_SERIAL_IN_EMPTY);
#endif
}

void ImprovPlugin::setup(Controller *_controller, PluginManager *pluginManager) {
    controller = _controller;
    instance = this;

    Settings &settings = controller->getSettings();
    firmwareVersion = BUILD_GIT_VERSION;
    deviceName = settings.getMdnsName();
    // 2026-10-23 (build 971): the web flasher's "Visit Device" link. The library puts the board's
    // IP in for {LOCAL_IPV4}; the .local name didn't open on every computer.
    deviceUrl = "http://{LOCAL_IPV4}/";

    improv = new ImprovWiFi(&Serial);
    // "DeLongezzi" = the web flasher's manifest name, so the flasher knows the installed firmware
    // (it offered "Install DeLongezzi" again while this said "GaggiMate").
    improv->setDeviceInfo(currentChipFamily(), "DeLongezzi", firmwareVersion.c_str(), deviceName.c_str(), deviceUrl.c_str());
    improv->setCustomConnectWiFi(onConnectWifi);
    improv->onImprovConnected(onConnected);
}

void ImprovPlugin::loop() {
    if (improv == nullptr) {
        return;
    }
    // The library reads one byte per handleSerial() call; drain the RX buffer
    // each pass so a multi-byte command isn't dribbled out over many 50ms loops.
    bool handled = false;
    while (!rebootPending && Serial.available() > 0) {
        improv->handleSerial();
        handled = true;
    }
    if (handled) {
        sendUsbNow();
    }
    if (rebootPending) {
        Serial.flush(); // let the Improv success/device-URL response drain first
        delay(200);
        ESP.restart();
    }
}

bool ImprovPlugin::onConnectWifi(const char *ssid, const char *password) {
    if (instance == nullptr || instance->controller == nullptr) {
        return false;
    }
    // 2026-10-23 (build 971): join the network first (the hotspot stays up), so a wrong password
    // is reported to the flasher at once and the address sent back is the real IP. Saved only
    // when it worked; setupWifi() connects the same way after the restart.
    sendUsbNow(); // the library's "provisioning" state goes out before the wait
    Settings &settings = instance->controller->getSettings();
    const String oldSsid = settings.getWifiSsid();
    const String oldPassword = settings.getWifiPassword();
    if (WiFi.getMode() == WIFI_AP) {
        WiFi.mode(WIFI_AP_STA);
    }
    WiFi.begin(ssid, password);
    for (int i = 0; i < 120 && WiFi.status() != WL_CONNECTED; i++) { // up to 12 s
        delay(100);
    }
    if (WiFi.status() != WL_CONNECTED) {
        ESP_LOGW("ImprovPlugin", "Could not join '%s' via Improv", ssid);
        if (!oldSsid.isEmpty()) {
            WiFi.begin(oldSsid.c_str(), oldPassword.c_str()); // back to the network it had
        } else {
            WiFi.disconnect(); // a new board stops trying; its hotspot stays
        }
        return false;
    }
    settings.setWifiSsid(String(ssid));
    settings.setWifiPassword(String(password));
    settings.save(true); // synchronous persist before the reboot
    ESP_LOGI("ImprovPlugin", "Joined '%s' via Improv, saved, rebooting", ssid);
    return true;
}

void ImprovPlugin::onConnected(const char *ssid, const char *password) {
    if (instance != nullptr) {
        instance->rebootPending = true;
    }
}
