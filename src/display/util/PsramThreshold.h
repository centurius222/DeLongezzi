#ifndef PSRAMTHRESHOLD_H
#define PSRAMTHRESHOLD_H

#include <stddef.h>

// Memory requests of this size and up go to PSRAM (heap_caps_malloc_extmem_enable): set at boot in
// main.cpp and put back after every WebSocket buffer in PsramWsBuffer.h, one value for both
// (2026-10-19, review finding 4.1: the buffer put back the SDK default 4096, so 256 held only until
// the first page message and blocks of 256 B-4 KB filled the fast memory for the rest of the run).
constexpr size_t PSRAM_MALLOC_THRESHOLD = 256;

#endif // PSRAMTHRESHOLD_H
