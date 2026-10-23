#include "LoopbackPair.h"

// Every queued blob is malloc'd as [4-byte little-endian length][payload] so a
// single allocation carries both (atomic enqueue, one free on dequeue).
namespace {
constexpr size_t LEN_HEADER = 4;

inline uint32_t readLen(const uint8_t *blob) {
    return static_cast<uint32_t>(blob[0]) | (static_cast<uint32_t>(blob[1]) << 8) | (static_cast<uint32_t>(blob[2]) << 16) |
           (static_cast<uint32_t>(blob[3]) << 24);
}

// Matches the friend declaration in LoopbackTransport (file scope so the
// compiler binds it to the declared friend, not an internal-linkage overload).
} // namespace

void loopbackDeliver(LoopbackTransport *to, const uint8_t *data, size_t length) {
    if (to == nullptr || !to->isConnected() || to->_rxQueue == nullptr || length == 0 ||
        length > LoopbackTransport::MAX_DATAGRAM)
        return;
    uint8_t *blob = static_cast<uint8_t *>(malloc(LEN_HEADER + length));
    if (blob == nullptr)
        return;
    blob[0] = length & 0xFF;
    blob[1] = (length >> 8) & 0xFF;
    blob[2] = (length >> 16) & 0xFF;
    blob[3] = (length >> 24) & 0xFF;
    memcpy(blob + LEN_HEADER, data, length);
    if (xQueueSend(to->_rxQueue, &blob, 0) != pdTRUE)
        free(blob); // queue full: drop
}

bool LoopbackTransport::enableLoopback(LoopbackTransport **clientEnd, LoopbackTransport **serverEnd) {
    auto *c = new LoopbackTransport();
    auto *s = new LoopbackTransport();
    if (c == nullptr || s == nullptr) {
        delete c;
        delete s;
        return false;
    }
    c->_rxQueue = xQueueCreate(QUEUE_LENGTH, sizeof(uint8_t *));
    s->_rxQueue = xQueueCreate(QUEUE_LENGTH, sizeof(uint8_t *));
    if (c->_rxQueue == nullptr || s->_rxQueue == nullptr) {
        if (c->_rxQueue)
            vQueueDelete(c->_rxQueue);
        if (s->_rxQueue)
            vQueueDelete(s->_rxQueue);
        delete c;
        delete s;
        return false;
    }
    c->_peer = s;
    s->_peer = c;
    *clientEnd = c;
    *serverEnd = s;
    return true;
}

void LoopbackTransport::connect() {
    _connected = true;
    if (_peer != nullptr)
        _peer->_connected = true;
    emitConnection(true);
    if (_peer != nullptr)
        _peer->emitConnection(true);
}

bool LoopbackTransport::send(const uint8_t *data, size_t length) {
    if (!_connected || data == nullptr || length == 0)
        return false;
    loopbackDeliver(_peer, data, length);
    return true;
}

void LoopbackTransport::pump() {
    if (_rxQueue == nullptr)
        return;
    uint8_t *blob = nullptr;
    while (xQueueReceive(_rxQueue, &blob, 0) == pdTRUE) {
        if (blob != nullptr) {
            emitData(blob + LEN_HEADER, readLen(blob));
            free(blob);
        }
    }
}
