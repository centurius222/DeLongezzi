#ifndef NANOPBCOMM_LOOPBACK_PAIR_H
#define NANOPBCOMM_LOOPBACK_PAIR_H

#include "../Transport.h"
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

/**
 * In-process transport pair for single-board builds (GAGGIMATE_MERGED).
 *
 * Stock GaggiMate runs the display and the controller on two separate
 * ESP32s linked by BLE (BleClientTransport <-> BleServerTransport). On a
 * single-board build both halves run in one chip; instead of talking over
 * the radio, the two BLE transports are replaced by a matched pair of
 * LoopbackTransport ends that deliver datagrams to each other directly:
 *
 *   display (GaggiMateClient) --[clientLoopback]--> controller (GaggiMateServer)
 *   controller                --[serverLoopback]--> display
 *
 * Datagrams are handed off through a FreeRTOS queue rather than a direct
 * synchronous call: send() may run on the Endpoint dispatch task while the
 * receiving Endpoint expects its callbacks on its own loop context (mirrors
 * the BLE host task semantics closely enough that the ACK/retransmit state
 * machine stays intact). Each queued blob is heap-copied, matching the
 * value semantics of a BLE characteristic write.
 *
 * Connection lifecycle: enableLoopback() arms the pair (both ends report
 * disconnected); connect() makes both ends emit connection=true, which
 * triggers the Endpoint connection handlers (SystemInfo push etc.) exactly
 * as a BLE link-up would.
 */
class LoopbackTransport : public Transport {
  public:
    // Pair two ends. Returns false if allocation failed (pair left unarmed).
    static bool enableLoopback(LoopbackTransport **clientEnd, LoopbackTransport **serverEnd);

    // Bring the virtual link up: both ends emit connection(true). Call once
    // after both Endpoints have begun().
    void connect();

    bool send(const uint8_t *data, size_t length) override;
    bool isConnected() const override { return _connected; }

    // Drive inbound delivery. Call frequently from the receiving side's loop
    // context (the Endpoint pumps its own queue from whatever task calls it).
    void pump();

  private:
    QueueHandle_t _rxQueue = nullptr;
    LoopbackTransport *_peer = nullptr;
    volatile bool _connected = false;

    static constexpr int QUEUE_LENGTH = 32;
    static constexpr size_t MAX_DATAGRAM = 1024; // nanopb frames stay well under MTU 256 * batches

    friend void loopbackDeliver(LoopbackTransport *to, const uint8_t *data, size_t length);
};

#endif // NANOPBCOMM_LOOPBACK_PAIR_H
