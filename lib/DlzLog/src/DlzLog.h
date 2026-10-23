#pragma once
// Permanent event log (2026-10-16). A text ring in RTC slow memory: it survives
// panics, watchdog and software restarts (not a power cut). At each boot the
// previous run's ring is copied aside and, once storage is mounted, saved to
// /dlzlog/prev1.txt (older runs move to prev2, prev3). Read it at /api/log.
// Lines start with uptime in seconds.milliseconds.
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Call first thing in setup(): takes the previous run's ring and writes the BOOT line.
void dlzlog_boot(void);
uint32_t dlzlog_bootCount(void); // this start's number (BOOT #n); 1 after a power-on
// Call once LittleFS is mounted: saves the previous run's ring to storage.
void dlzlog_persist(void);
// One line (no newline needed). Safe from any task, not from an interrupt.
void dlzlog(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
// Copies the current ring, oldest first, into out (at most cap-1 bytes + NUL). Returns length.
size_t dlzlog_read(char *out, size_t cap);
// This run's long log (64 KB in PSRAM, about 600 lines, 2026-10-19; the 7 KB ring above held
// about 70, too few for a test round). The same lines; lost at a restart. Oldest first, as above;
// falls back to the ring when PSRAM could not be had.
size_t dlzlog_readAll(char *out, size_t cap);
size_t dlzlog_allSize(void);
// Counters shared with the web server library.
extern volatile uint32_t dlzlog_sendFails;    // AsyncClient::send() refused (TCP/Wi-Fi out of memory)
extern volatile int32_t dlzlog_activeRequests; // web requests alive right now
extern volatile uint32_t dlzlog_requests;      // web requests finished since boot
// Called from the main loop: writes a memory/Wi-Fi heartbeat line now and then.
void dlzlog_tick(void);
// One MEM line: internal RAM after a startup step (who takes how much fast memory).
void dlzlog_mem(const char *stage);
// Text report of every known task's stack: reserved, lowest unused, peak used (GET /api/log?stacks=1).
size_t dlzlog_stacks(char *out, size_t cap);

#ifdef __cplusplus
}
#endif
