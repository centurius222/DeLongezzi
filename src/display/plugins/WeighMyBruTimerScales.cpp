// Copy of gaggimate/esp-arduino-ble-scales v1.0.2 src/scales/weighmybru.* with
// WeighMyBrewScales -> WeighMyBruTimerScales, WeighMyBrewScalePlugin ->
// WeighMyBruTimerScalePlugin, WeighMyBrewMessageType -> WmbTimerMsgType, so it
// can sit next to the library copy (which still compiles, unused), plus timer
// control: start / stop / reset in the WeighMyBru2 format (0x02 / 0x03 / 0x04,
// byte 3 = 0x01), so the DeLongscali scale shows the machine's shot time.
// Plan: DeLongscali timer_sync_plan.txt (2026-09-23).

#include "WeighMyBruTimerScales.h"
#include "remote_scales_plugin_registry.h"

/*
Handle protocol for WeighMyBru scale
*/
const size_t RECEIVE_PROTOCOL_LENGTH = 20;

const NimBLEUUID serviceUUID("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
const NimBLEUUID weightCharacteristicUUID("6E400002-B5A3-F393-E0A9-E50E24DCCA9E");
const NimBLEUUID commandCharacteristicUUID("6E400003-B5A3-F393-E0A9-E50E24DCCA9E");

//-----------------------------------------------------------------------------------/
//---------------------------        PUBLIC       -----------------------------------/
//-----------------------------------------------------------------------------------/
WeighMyBruTimerScales::WeighMyBruTimerScales(const DiscoveredDevice& device) : RemoteScales(device) {}

bool WeighMyBruTimerScales::connect() {
  if (RemoteScales::clientIsConnected()) {
    RemoteScales::log("Already connected\n");
    return true;
  }

  RemoteScales::log("Connecting to %s[%s]\n", RemoteScales::getDeviceName().c_str(), RemoteScales::getDeviceAddress().c_str());
  bool result = RemoteScales::clientConnect();
  if (!result) {
    RemoteScales::clientCleanup();
    return false;
  }

  if (!performConnectionHandshake()) {
    return false;
  }
  subscribeToNotifications();
  RemoteScales::setWeight(0.f);
  return true;
}

void WeighMyBruTimerScales::disconnect() {
  RemoteScales::clientCleanup();
}

bool WeighMyBruTimerScales::isConnected() {
  return RemoteScales::clientIsConnected();
}

void WeighMyBruTimerScales::update() {
  if (markedForReconnection) {
    RemoteScales::log("Marked for disconnection. Will attempt to reconnect.\n");
    RemoteScales::clientCleanup();
    connect();
    markedForReconnection = false;
  }
  else {
    sendHeartbeat();
    RemoteScales::log("Heartbeat sent.\n");
  }
}

bool WeighMyBruTimerScales::tare() {
  if (!isConnected()) return false;
  RemoteScales::log("Tare sent");
  uint8_t payload[6] = { 0x03, 0x0a, 0x01, 0x01, 0x00, 0x08 };
  sendMessage(WmbTimerMsgType::SYSTEM, payload, sizeof(payload));

  return true;
};

// Timer commands (added), WeighMyBru2 format, framed like tare() above:
// sendMessage() replaces the last byte with the XOR of the others.
void WeighMyBruTimerScales::startTimer() {
  if (!isConnected()) return;
  RemoteScales::log("Timer start sent");
  uint8_t payload[6] = { 0x03, 0x0a, 0x02, 0x01, 0x00, 0x00 };   // wire: 03 0A 02 01 00 0A
  sendMessage(WmbTimerMsgType::SYSTEM, payload, sizeof(payload));
}

void WeighMyBruTimerScales::stopTimer() {
  if (!isConnected()) return;
  RemoteScales::log("Timer stop sent");
  uint8_t payload[6] = { 0x03, 0x0a, 0x03, 0x01, 0x00, 0x00 };   // wire: 03 0A 03 01 00 0B
  sendMessage(WmbTimerMsgType::SYSTEM, payload, sizeof(payload));
}

void WeighMyBruTimerScales::resetTimer() {
  if (!isConnected()) return;
  RemoteScales::log("Timer reset sent");
  uint8_t payload[6] = { 0x03, 0x0a, 0x04, 0x01, 0x00, 0x00 };   // wire: 03 0A 04 01 00 0C
  sendMessage(WmbTimerMsgType::SYSTEM, payload, sizeof(payload));
}

//-----------------------------------------------------------------------------------/
//---------------------------       PRIVATE       -----------------------------------/
//-----------------------------------------------------------------------------------/
volatile bool WeighMyBruTimerScales::s_tarePressed = false;

void WeighMyBruTimerScales::notifyCallback(
  NimBLERemoteCharacteristic* pBLERemoteCharacteristic,
  uint8_t* pData,
  size_t length,
  bool isNotify
) {
  dataBuffer.insert(dataBuffer.end(), pData, pData + length);
  bool result = true;
  while (result) {
    result = decodeAndHandleNotification();
  }
}

/*
Handle WeighMyBru protocol
*/
bool WeighMyBruTimerScales::decodeAndHandleNotification() {
  // Minimum message length check (20 bytes based on protocol definition)
  if (dataBuffer.size() < RECEIVE_PROTOCOL_LENGTH) {
    return false;
  }

  WmbTimerMsgType messageType = static_cast<WmbTimerMsgType>(dataBuffer[1]);
  uint8_t productNumber = dataBuffer[0];

  const size_t messageLength = RECEIVE_PROTOCOL_LENGTH;

  // Handle different message types
  if (productNumber == 0x03 && messageType == WmbTimerMsgType::WEIGHT) {
    // Checksum validation: XOR of Header1 ^ Header2 ^ Data0 ^ Data1 ^ ... ^ DataN should equal DataSUM
    uint8_t checksum = dataBuffer[0];
    for (size_t i = 1; i < messageLength - 1; i++) {
      checksum ^= dataBuffer[i];
    }

    // The last byte in the message is DataSUM
    uint8_t dataSUM = dataBuffer[messageLength - 1];

    if (checksum != dataSUM) {
      RemoteScales::log("Checksum failed: calc[%02X] but actual[%02X]. Discarding.\n",
        checksum, dataSUM);
      dataBuffer.erase(dataBuffer.begin(), dataBuffer.begin() + messageLength);
      return false;
    }

    float weight = (dataBuffer[7] << 16) | (dataBuffer[8] << 8) | dataBuffer[9];

    if (dataBuffer[6] == 45) { // Check if the value is negative
      weight = -weight;
    }

    RemoteScales::setWeight(weight * 0.01f); // Convert to floating point
  }
  else if (productNumber == 0x03 && messageType == WmbTimerMsgType::TARE_PRESSED) {
    uint8_t checksum = dataBuffer[0];
    for (size_t i = 1; i < messageLength - 1; i++) {
      checksum ^= dataBuffer[i];
    }
    if (checksum == dataBuffer[messageLength - 1]) {
      s_tarePressed = true;
    }
  }
  else if (productNumber == 0x03 && messageType == WmbTimerMsgType::SYSTEM) {
    WeighMyBruTimerScales::tare();
  }
  else {
    RemoteScales::log("Unknown message type %02X: %s\n", messageType, RemoteScales::byteArrayToHexString(dataBuffer.data(), messageLength).c_str());
  }

    // Remove processed message from the buffer
  dataBuffer.erase(dataBuffer.begin(), dataBuffer.begin() + messageLength);

    // Return whether there's more data to process
  return dataBuffer.size() >= RECEIVE_PROTOCOL_LENGTH;
}

bool WeighMyBruTimerScales::performConnectionHandshake() {
  RemoteScales::log("Performing handshake\n");

  service = RemoteScales::clientGetService(serviceUUID);
  if (service != nullptr) {
    RemoteScales::log("Got Service\n");
  }
  else {
    clientCleanup();
    return false;
  }

  weightCharacteristic = service->getCharacteristic(weightCharacteristicUUID);
  commandCharacteristic = service->getCharacteristic(commandCharacteristicUUID);
  if (weightCharacteristic == nullptr || commandCharacteristic == nullptr) {
    clientCleanup();
    return false;
  }
  RemoteScales::log("Got weightCharacteristic and commandCharacteristic\n");

  sendNotificationRequest();
  RemoteScales::log("Sent notification request\n");
  lastHeartbeat = millis();
  return true;
}

void WeighMyBruTimerScales::sendNotificationRequest() {
  uint8_t payload[] = { 0, 0, 0, 0, 0, 0 };
  sendEvent(payload, 6);
  RemoteScales::log("Sent event.\n");
}

void WeighMyBruTimerScales::sendEvent(const uint8_t* payload, size_t length) {
  auto bytes = std::make_unique<uint8_t[]>(length + 1);
  bytes[0] = static_cast<uint8_t>(length + 1);

  for (size_t i = 0; i < length; ++i) {
    bytes[i + 1] = payload[i] & 0xFF;
  }

  sendMessage(WmbTimerMsgType::SYSTEM, bytes.get(), length + 1);
}

void WeighMyBruTimerScales::sendHeartbeat() {
  if (!isConnected()) {
    return;
  }

  uint32_t now = millis();
  if (now - lastHeartbeat < 2000) {
    return;
  }

  uint8_t payload1[] = { 0x02,0x00 };
  sendMessage(WmbTimerMsgType::SYSTEM, payload1, 2);
  sendNotificationRequest();
  uint8_t payload2[] = { 0x00 };
  sendMessage(WmbTimerMsgType::SYSTEM, payload2, 1);
  lastHeartbeat = now;
}

void WeighMyBruTimerScales::subscribeToNotifications() {
  RemoteScales::log("subscribeToNotifications\n");

  auto callback = [this](NimBLERemoteCharacteristic* characteristic, uint8_t* data, size_t length, bool isNotify) {
    notifyCallback(characteristic, data, length, isNotify);
    };

  if (weightCharacteristic->canNotify()) {
    RemoteScales::log("Registering callback for weight characteristic\n");
    weightCharacteristic->subscribe(true, callback);
  }

  if (commandCharacteristic->canNotify()) {
    RemoteScales::log("Registering callback for command characteristic\n");
    commandCharacteristic->subscribe(true, callback);
  }
}

void WeighMyBruTimerScales::sendMessage(WmbTimerMsgType msgType, const uint8_t* payload, size_t length, bool waitResponse) {

  auto bytes = std::make_unique<uint8_t[]>(length);

  memcpy(bytes.get(), payload, length);

  // Checksum Calculation (XOR of all bytes except checksum byte)
  uint8_t checksum = bytes[0];
  for (size_t i = 1; i < length - 1; i++) {
    checksum ^= bytes[i];
  }
  bytes[length - 1] = checksum;

  commandCharacteristic->writeValue(bytes.get(), length, waitResponse);
}
