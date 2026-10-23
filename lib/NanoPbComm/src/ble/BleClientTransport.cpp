#include "BleClientTransport.h"
#include "BleServerTransport.h" // full type needed for enableMergedLoopback
#include "LoopbackPair.h"

void BleClientTransport::init(const String &deviceName) {
#ifdef DELONGEZZI_NO_BLE
    // 2026-10-10: BLE compiled out. This is the only call to NimBLEDevice::init() in the image;
    // skipping it means the NimBLE host never starts, so the radio stays free for Wi-Fi and
    // setSleep(false) is legal.
    (void)deviceName;
    return;
#endif
#ifdef GAGGIMATE_MERGED
    // Single-board build: the peer (BleServerTransport) is linked through the
    // static loopback pair armed by enableMergedLoopback(), so none of the
    // client/scanner machinery below is needed for the controller link.
    //
    // BUT the NimBLE STACK still has to come up: BLEScalePlugin uses the same
    // stack for Bluetooth scales, and this is the only place anything calls
    // NimBLEDevice::init(). Returning early here left it uninitialised, so
    // NimBLEDevice::getScan() found nothing and scales could never be
    // discovered on a merged build — silently, with no error anywhere.
    NimBLEDevice::init(deviceName.c_str());
    NimBLEDevice::setPower(ESP_PWR_LVL_P9);
    NimBLEDevice::setMTU(256);
    _client = NimBLEDevice::createClient();
    _scanner = NimBLEDevice::getScan();
    if (_client == nullptr) {
        ESP_LOGE(LOG_TAG, "Failed to create BLE client");
        return;
    }
    _client->setClientCallbacks(this);
    // Do NOT call scan() here. On a real two-board build this starts the
    // continuous scan that finds the controller peer, and maintain() keeps it
    // alive. On merged there is no peer to find (the link is the in-process
    // loopback) and maintain() returns early, so the scan would run FOREVER,
    // never stopped by anything, on NimBLEDevice::getScan() — the SAME scanner
    // the BLE scale plugin must use. Its bursts then lose the radio to this
    // hog: discovery times out with serviceDiscoveredCB() rc=13
    // (BLE_HS_ETIMEOUT) and the scale "connects then disappears". Leave
    // scanning entirely to BLEScalePlugin.
    return;
#endif
    NimBLEDevice::init(deviceName.c_str());
    NimBLEDevice::setPower(ESP_PWR_LVL_P9);
    NimBLEDevice::setMTU(256);
    _client = NimBLEDevice::createClient();
    _scanner = NimBLEDevice::getScan();
    if (_client == nullptr) {
        ESP_LOGE(LOG_TAG, "Failed to create BLE client");
        return;
    }
    _client->setClientCallbacks(this);
    scan();
}

#ifdef GAGGIMATE_MERGED
// One-shot wiring for the merged build: create the loopback pair and hand each
// transport its end. Returns false if allocation failed (transports left
// unarmed -> everything reports disconnected, which is fail-visible).
bool enableMergedLoopback(BleClientTransport &clientTransport, BleServerTransport &serverTransport) {
    LoopbackTransport *clientEnd = nullptr;
    LoopbackTransport *serverEnd = nullptr;
    if (!LoopbackTransport::enableLoopback(&clientEnd, &serverEnd))
        return false;
    clientTransport.armLoopback(clientEnd);
    serverTransport.armLoopback(serverEnd);
    return true;
}
#endif

void BleClientTransport::scan() {
    _readyForConnection = false;
    _scanner->clearDuplicateCache();
    _scanner->setAdvertisedDeviceCallbacks(this, true);
    _scanner->setInterval(1000);
    _scanner->setWindow(50);
    _scanner->setMaxResults(0);
    _scanner->setDuplicateFilter(false);
    _scanner->setActiveScan(false);
    _scanner->start(0, nullptr, false); // 0 = continuous
}

void BleClientTransport::maintain() {
#ifdef GAGGIMATE_MERGED
    return; // no scan to maintain on the virtual link
#endif
    if (_client == nullptr || _scanner == nullptr)
        return; // init() failed to create the client/scanner
    if (!_readyForConnection && !_client->isConnected() && !_scanner->isScanning()) {
        ESP_LOGI(LOG_TAG, "Scan stalled, restarting");
        scan();
    }
}

bool BleClientTransport::connectToServer() {
#ifdef GAGGIMATE_MERGED
    if (_loopback == nullptr) {
        ESP_LOGE(LOG_TAG, "Merged connectToServer: loopback NOT armed (enableMergedLoopback failed?)");
        return false;
    }
    if (_loopback->isConnected()) {
        return true; // already up
    }
    // Bring the virtual link up on BOTH ends (each emits connection(true),
    // driving the Endpoint connection handlers exactly as a BLE link-up).
    // connect() is idempotent.
    ESP_LOGI(LOG_TAG, "Merged connectToServer: bringing loopback up");
    _loopback->connect();
    return true;
#endif
    if (!_haveServerAddress)
        return false;

    ESP_LOGI(LOG_TAG, "Connecting to advertised device");
    unsigned int tries = 0;
    do {
        if (tries >= MAX_CONNECT_RETRIES) {
            ESP_LOGE(LOG_TAG, "Connection timeout, rescanning");
            scan();
            return false;
        }
        if (!_client->connect(_serverAddress)) {
            ESP_LOGW(LOG_TAG, "Connect failed, retrying");
            delay(500);
        }
        tries++;
    } while (!_client->isConnected());
    applyConnParams(); // baseline for the new connection (idle unless set active)

    NimBLERemoteService *service = _client->getService(NimBLEUUID(gm_proto::SERVICE_UUID));
    if (service == nullptr) {
        ESP_LOGE(LOG_TAG, "Service not found");
        _client->disconnect();
        scan();
        return false;
    }

    _writeChar = service->getCharacteristic(NimBLEUUID(gm_proto::RX_CHAR_UUID));
    _notifyChar = service->getCharacteristic(NimBLEUUID(gm_proto::TX_CHAR_UUID));
    if (_writeChar == nullptr || _notifyChar == nullptr) {
        // The controller advertises the GaggiMate service but lacks the framed
        // comms characteristics -> old/incompatible firmware. Keep the link up
        // (the OTA service lives on a separate service and stays reachable) and
        // report incompatibility so the display can offer an OTA recovery, the
        // same way it handles a protocol-version mismatch.
        ESP_LOGW(LOG_TAG, "Comms characteristics missing -- incompatible controller firmware (OTA only)");
        _writeChar = nullptr;
        _notifyChar = nullptr;
        _readyForConnection = false;
        _incompatible = true;
        // Read the legacy read-only INFO characteristic (present on old
        // controllers too) so the display can show the real hardware/version.
        String info;
        NimBLERemoteCharacteristic *infoChar = service->getCharacteristic(NimBLEUUID(gm_proto::INFO_CHAR_UUID));
        if (infoChar != nullptr && infoChar->canRead())
            info = String(infoChar->readValue().c_str());
        if (_onIncompatible)
            _onIncompatible(info);
        return true; // link intentionally kept; do not disconnect/rescan
    }

    // Without the notify subscription we would connect but never receive data;
    // treat a failed subscribe as a failed connection.
    if (!_notifyChar->canNotify() ||
        !_notifyChar->subscribe(true, std::bind(&BleClientTransport::notifyCallback, this, std::placeholders::_1,
                                                std::placeholders::_2, std::placeholders::_3, std::placeholders::_4))) {
        ESP_LOGE(LOG_TAG, "Failed to subscribe to TX characteristic");
        _client->disconnect();
        scan();
        return false;
    }

    _readyForConnection = false;
    _incompatible = false;
    ESP_LOGI(LOG_TAG, "Connected, MTU: %d", _client->getMTU());
    emitConnection(true);
    return true;
}

void BleClientTransport::disconnect() {
#ifdef GAGGIMATE_MERGED
    return; // virtual link is permanent in merged builds
#endif
    _readyForConnection = false;
    _haveServerAddress = false;
    if (_client && _client->isConnected())
        _client->disconnect();
}

void BleClientTransport::setLowLatency(bool active) {
    _lowLatency = active;
    applyConnParams();
}

void BleClientTransport::applyConnParams() {
    if (_client == nullptr || !_client->isConnected())
        return;
    if (_lowLatency)
        _client->updateConnParams(ACTIVE_MIN_INTERVAL, ACTIVE_MAX_INTERVAL, CONN_LATENCY, CONN_TIMEOUT);
    else
        _client->updateConnParams(IDLE_MIN_INTERVAL, IDLE_MAX_INTERVAL, CONN_LATENCY, CONN_TIMEOUT);
}

bool BleClientTransport::send(const uint8_t *data, size_t length) {
#ifdef GAGGIMATE_MERGED
    if (_loopback != nullptr)
        return _loopback->send(data, length);
    return false;
#endif
    if (!isConnected() || _writeChar == nullptr || data == nullptr || length == 0)
        return false;
    return _writeChar->writeValue(data, length, false); // write without response
}

bool BleClientTransport::isConnected() const {
#ifdef GAGGIMATE_MERGED
    if (_loopback != nullptr)
        return _loopback->isConnected();
    return false;
#endif
    return _client != nullptr && _client->isConnected();
}

void BleClientTransport::onResult(NimBLEAdvertisedDevice *advertisedDevice) {
    if (!advertisedDevice->haveServiceUUID())
        return;
    if (advertisedDevice->isAdvertisingService(NimBLEUUID(gm_proto::SERVICE_UUID))) {
        ESP_LOGI(LOG_TAG, "Found controller, ready to connect");
        _scanner->stop();
        // Take a value copy of the address now -- the device object is freed as
        // soon as this callback returns (see _serverAddress note in the header).
        _serverAddress = advertisedDevice->getAddress();
        _haveServerAddress = true;
        _readyForConnection = true;
    }
}

void BleClientTransport::onDisconnect(NimBLEClient *client) {
    (void)client;
    ESP_LOGI(LOG_TAG, "Disconnected, will rescan");
    _writeChar = nullptr;
    _notifyChar = nullptr;
    _incompatible = false;
    emitConnection(false);
    scan();
}

void BleClientTransport::notifyCallback(NimBLERemoteCharacteristic *characteristic, uint8_t *data, size_t length, bool) {
    (void)characteristic;
    emitData(data, length);
}

#ifdef GAGGIMATE_MERGED
void BleClientTransport::armLoopback(LoopbackTransport *end) {
    _loopback = end;
    // Forward the Endpoint's data/connection callbacks to the loopback end.
    // In merged mode all traffic flows through the LoopbackTransport pair; the
    // Endpoint registered its onData/onConnectionChange on THIS (Ble*Transport)
    // object, but pump()/emitData run on the loopback end. Without forwarding,
    // received frames are silently dropped (null _dataCb) and the controller
    // half's ping watchdog latches ERROR_CODE_TIMEOUT.
    end->onData([this](const uint8_t *data, size_t length) { emitData(data, length); });
    end->onConnectionChange([this](bool connected) { emitConnection(connected); });
}

void BleClientTransport::pumpLoopback() {
    if (_loopback != nullptr)
        _loopback->pump();
}
#endif
