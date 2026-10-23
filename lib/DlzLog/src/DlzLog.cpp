#include "DlzLog.h"

#include <Arduino.h>
#include <LittleFS.h>
#include <WiFi.h>
#include <esp_attr.h>
#include <esp_core_dump.h>
#include <esp_heap_caps.h>
#include <esp_system.h>
#include <esp_spi_flash.h>
#include <esp_timer.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <algorithm>

// 7000 B of the 8 KB RTC slow memory (~60-80 lines). The magic tells a kept ring
// from the random contents after a power-on.
#define DLZ_MAGIC 0xD12A1062u
#define DLZ_SIZE 7000u

struct DlzRing {
    uint32_t magic;
    uint32_t head;      // next write position
    uint32_t wrapped;   // the ring went round at least once
    uint32_t bootCount; // boots since the last power-on
    uint32_t wdtCount;  // task watchdog firings this run
    char buf[DLZ_SIZE];
};

static RTC_NOINIT_ATTR DlzRing ring;
static portMUX_TYPE ringLock = portMUX_INITIALIZER_UNLOCKED;
// This run's long log (2026-10-19): every line also goes here, 64 KB in PSRAM. Written only while
// the flash cache is on (PSRAM is reached through it), so a line from the watchdog interrupt
// during a flash write is in the ring only.
#define DLZ_BIG_SIZE (64u * 1024u)
static char *bigBuf = nullptr;
static uint32_t bigHead = 0;
static bool bigWrapped = false;
static char *prevCopy = nullptr; // the previous run's ring, oldest first (PSRAM)
static size_t prevLen = 0;
static uint32_t lastWdtLogged = 0;

// Failed memory requests (2026-10-16): which size, memory type and task ran out. The hook can
// run anywhere, so it only counts into this table (RAM code, spinlock); dlzlog_tick writes it.
struct AllocFail {
    uint32_t size;
    uint32_t caps;
    TaskHandle_t task;
    const char *fn;
    uint32_t count;
    uint32_t logged;
    uint32_t firstMs;
    // memory of the requested kind at the moment of the last failure (not later when logged)
    uint32_t atFree;
    uint32_t atLargest;
    uint32_t atBlocks;
    uint32_t minLargest; // smallest "largest piece" seen at any of these failures
    int32_t atAct;       // web requests alive then
    bool atKnown;        // false: flash was busy, the memory could not be read
};
static AllocFail allocFails[8];
static volatile uint32_t allocFailOverflow = 0;

static void IRAM_ATTR allocFailed(size_t size, uint32_t caps, const char *fn) {
    const bool isr = xPortInIsrContext();
    TaskHandle_t task = isr ? nullptr : xTaskGetCurrentTaskHandle();
    // The memory of the kind that was asked for, right now. The info functions are in flash,
    // so only while flash is readable (not inside a flash operation) and not in an interrupt.
    multi_heap_info_t in = {};
    const bool known = !isr && spi_flash_cache_enabled();
    if (known) {
        heap_caps_get_info(&in, caps);
    }
    portENTER_CRITICAL_SAFE(&ringLock);
    AllocFail *slot = nullptr;
    for (auto &f : allocFails) {
        if (f.count && f.size == size && f.caps == caps && f.task == task) {
            slot = &f;
            break;
        }
        if (!f.count && !slot)
            slot = &f;
    }
    if (slot && !slot->count) {
        slot->size = size;
        slot->caps = caps;
        slot->task = task;
        slot->fn = fn;
        slot->firstMs = (uint32_t)(esp_timer_get_time() / 1000);
        slot->minLargest = UINT32_MAX;
    }
    if (slot) {
        slot->count++;
        slot->atKnown = known;
        slot->atAct = dlzlog_activeRequests;
        if (known) {
            slot->atFree = in.total_free_bytes;
            slot->atLargest = in.largest_free_block;
            slot->atBlocks = in.free_blocks;
            if (in.largest_free_block < slot->minLargest)
                slot->minLargest = in.largest_free_block;
        }
    }
    else
        allocFailOverflow++;
    portEXIT_CRITICAL_SAFE(&ringLock);
}

static bool logAllocFails() {
    bool any = false;
    for (auto &f : allocFails) {
        portENTER_CRITICAL(&ringLock);
        const AllocFail c = f;
        f.logged = f.count;
        portEXIT_CRITICAL(&ringLock);
        if (c.count == c.logged)
            continue;
        any = true;
        // "at fail": that kind of memory at the moment of the last failure, read inside the hook
        if (c.atKnown)
            dlzlog("ALLOCFAIL x%u size=%u caps=0x%x task=%s first=%lu.%03lu atFail free=%u largest=%u blocks=%u act=%d minLargest=%u",
                   (unsigned)(c.count - c.logged), (unsigned)c.size, (unsigned)c.caps, c.task ? pcTaskGetName(c.task) : "ISR",
                   (unsigned long)(c.firstMs / 1000), (unsigned long)(c.firstMs % 1000), (unsigned)c.atFree,
                   (unsigned)c.atLargest, (unsigned)c.atBlocks, (int)c.atAct, (unsigned)c.minLargest);
        else
            dlzlog("ALLOCFAIL x%u size=%u caps=0x%x task=%s first=%lu.%03lu atFail unknown (flash busy) act=%d",
                   (unsigned)(c.count - c.logged), (unsigned)c.size, (unsigned)c.caps, c.task ? pcTaskGetName(c.task) : "ISR",
                   (unsigned long)(c.firstMs / 1000), (unsigned long)(c.firstMs % 1000), (int)c.atAct);
    }
    if (allocFailOverflow) {
        dlzlog("ALLOCFAIL %u more of other kinds (table full)", (unsigned)allocFailOverflow);
        allocFailOverflow = 0;
    }
    return any;
}

volatile uint32_t dlzlog_sendFails = 0;
volatile int32_t dlzlog_activeRequests = 0;
volatile uint32_t dlzlog_requests = 0;

// Raw append, also used from the watchdog interrupt, so IRAM and no library calls.
static void IRAM_ATTR ringPut(const char *s, size_t n) {
    const bool big = bigBuf != nullptr && spi_flash_cache_enabled();
    portENTER_CRITICAL_SAFE(&ringLock);
    for (size_t i = 0; i < n; i++) {
        ring.buf[ring.head++] = s[i];
        if (ring.head >= DLZ_SIZE) {
            ring.head = 0;
            ring.wrapped = 1;
        }
    }
    if (big) {
        for (size_t i = 0; i < n; i++) {
            bigBuf[bigHead++] = s[i];
            if (bigHead >= DLZ_BIG_SIZE) {
                bigHead = 0;
                bigWrapped = true;
            }
        }
    }
    portEXIT_CRITICAL_SAFE(&ringLock);
}

static size_t ringCopy(char *out, size_t cap) {
    if (cap == 0)
        return 0;
    size_t n = 0;
    portENTER_CRITICAL(&ringLock);
    const uint32_t head = ring.head;
    if (ring.wrapped) {
        for (uint32_t i = head; i < DLZ_SIZE && n + 1 < cap; i++)
            out[n++] = ring.buf[i];
    }
    for (uint32_t i = 0; i < head && n + 1 < cap; i++)
        out[n++] = ring.buf[i];
    portEXIT_CRITICAL(&ringLock);
    out[n] = 0;
    // After a wrap the first line is cut: start at the next whole line.
    if (ring.wrapped) {
        char *nl = (char *)memchr(out, '\n', n);
        if (nl) {
            size_t skip = nl + 1 - out;
            memmove(out, nl + 1, n - skip + 1);
            n -= skip;
        }
    }
    return n;
}

static const char *resetName(esp_reset_reason_t r) {
    switch (r) {
    case ESP_RST_POWERON:
        return "POWERON";
    case ESP_RST_EXT:
        return "EXT_PIN";
    case ESP_RST_SW:
        return "SOFTWARE";
    case ESP_RST_PANIC:
        return "PANIC/CRASH";
    case ESP_RST_INT_WDT:
        return "INT_WDT";
    case ESP_RST_TASK_WDT:
        return "TASK_WDT";
    case ESP_RST_WDT:
        return "OTHER_WDT";
    case ESP_RST_DEEPSLEEP:
        return "DEEPSLEEP";
    case ESP_RST_BROWNOUT:
        return "BROWNOUT";
    case ESP_RST_SDIO:
        return "SDIO";
    default:
        return "UNKNOWN";
    }
}

// The task watchdog fires (panic is off, so the chip keeps running). Mark it in the
// ring right away: if the stall ends in a restart this is the last word.
extern "C" void IRAM_ATTR esp_task_wdt_isr_user_handler(void) {
    ring.wdtCount++;
    char line[40];
    uint32_t ms = (uint32_t)(esp_timer_get_time() / 1000);
    char num[12];
    int k = 0;
    do {
        num[k++] = '0' + ms % 10;
        ms /= 10;
    } while (ms && k < 11);
    int n = 0;
    line[n++] = '[';
    while (k)
        line[n++] = num[--k];
    static const DRAM_ATTR char text[] = "ms] TASK WATCHDOG fired\n"; // in RAM: flash may be busy
    const char *msg = text;
    while (*msg)
        line[n++] = *msg++;
    ringPut(line, n);
}

static void shutdownNote() {
    dlzlog("RESTART via esp_restart (requests=%u act=%d)", (unsigned)dlzlog_requests, (int)dlzlog_activeRequests);
}

uint32_t dlzlog_bootCount(void) { return ring.bootCount; }

void dlzlog_boot(void) {
    const bool kept = ring.magic == DLZ_MAGIC && ring.head < DLZ_SIZE;
    const uint32_t prevWdt = kept ? ring.wdtCount : 0;
    if (kept) {
        prevCopy = (char *)heap_caps_malloc(DLZ_SIZE + 1, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        if (prevCopy)
            prevLen = ringCopy(prevCopy, DLZ_SIZE + 1);
    }
    const uint32_t boots = kept ? ring.bootCount + 1 : 1;
    if (!bigBuf)
        bigBuf = (char *)heap_caps_malloc(DLZ_BIG_SIZE, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    portENTER_CRITICAL(&ringLock);
    ring.magic = DLZ_MAGIC;
    ring.head = 0;
    ring.wrapped = 0;
    ring.bootCount = boots;
    ring.wdtCount = 0;
    portEXIT_CRITICAL(&ringLock);

    const esp_reset_reason_t r = esp_reset_reason();
    size_t cdAddr = 0, cdSize = 0;
    const bool core = esp_core_dump_image_get(&cdAddr, &cdSize) == ESP_OK && cdSize > 0;
    dlzlog("BOOT #%u reset=%s(%d) prevRun=%s prevWdt=%u coredump=%u B", (unsigned)boots, resetName(r), (int)r,
           kept ? "kept" : "lost(power cut)", (unsigned)prevWdt, core ? (unsigned)cdSize : 0u);
    esp_register_shutdown_handler(shutdownNote);
    heap_caps_register_failed_alloc_callback(allocFailed);
}

void dlzlog_persist(void) {
    if (!LittleFS.exists("/dlzlog"))
        LittleFS.mkdir("/dlzlog");
    if (!prevCopy)
        return;
    LittleFS.remove("/dlzlog/prev3.txt");
    LittleFS.rename("/dlzlog/prev2.txt", "/dlzlog/prev3.txt");
    LittleFS.rename("/dlzlog/prev1.txt", "/dlzlog/prev2.txt");
    File f = LittleFS.open("/dlzlog/prev1.txt", "w");
    const bool ok = f && f.write((const uint8_t *)prevCopy, prevLen) == prevLen;
    if (f)
        f.close();
    dlzlog("saved previous run (%u B) to /dlzlog/prev1.txt%s", (unsigned)prevLen, ok ? "" : " FAILED");
    heap_caps_free(prevCopy);
    prevCopy = nullptr;
}

void dlzlog(const char *fmt, ...) {
    char line[200];
    const uint32_t ms = millis();
    int n = snprintf(line, sizeof(line), "[%lu.%03lu] ", (unsigned long)(ms / 1000), (unsigned long)(ms % 1000));
    va_list ap;
    va_start(ap, fmt);
    int m = vsnprintf(line + n, sizeof(line) - n - 1, fmt, ap);
    va_end(ap);
    if (m < 0)
        m = 0;
    n += m;
    if (n > (int)sizeof(line) - 2)
        n = sizeof(line) - 2;
    line[n++] = '\n';
    ringPut(line, n);
}

size_t dlzlog_read(char *out, size_t cap) { return ringCopy(out, cap); }

size_t dlzlog_allSize(void) { return bigBuf ? DLZ_BIG_SIZE : DLZ_SIZE; }

// Copied outside the lock (64 KB with interrupts off would be too long): lines written meanwhile
// can overwrite the oldest part of the copy, which is then dropped up to the next whole line.
size_t dlzlog_readAll(char *out, size_t cap) {
    if (!bigBuf)
        return ringCopy(out, cap);
    if (cap == 0)
        return 0;
    portENTER_CRITICAL(&ringLock);
    const uint32_t head = bigHead;
    const bool wrapped = bigWrapped;
    portEXIT_CRITICAL(&ringLock);
    size_t n = 0;
    if (wrapped) {
        const size_t part = std::min((size_t)(DLZ_BIG_SIZE - head), cap - 1);
        memcpy(out, bigBuf + head, part);
        n = part;
    }
    const size_t part = std::min((size_t)head, cap - 1 - n);
    memcpy(out + n, bigBuf, part);
    n += part;
    out[n] = 0;
    portENTER_CRITICAL(&ringLock);
    const uint32_t headNow = bigHead;
    portEXIT_CRITICAL(&ringLock);
    size_t skip = 0;
    if (wrapped) {
        // bytes written since the snapshot landed on the oldest part of what was copied
        skip = (headNow + DLZ_BIG_SIZE - head) % DLZ_BIG_SIZE;
        if (skip > n)
            skip = n;
        // and the first line is cut either way: start at the next whole line
        char *nl = (char *)memchr(out + skip, '\n', n - skip);
        skip = nl ? (size_t)(nl + 1 - out) : n;
    }
    if (skip) {
        memmove(out, out + skip, n - skip + 1);
        n -= skip;
    }
    return n;
}

void dlzlog_mem(const char *stage) {
    multi_heap_info_t in, dma;
    heap_caps_get_info(&in, MALLOC_CAP_INTERNAL);
    heap_caps_get_info(&dma, MALLOC_CAP_DMA);
    dlzlog("MEM %s int=%u/%u blocks=%u min=%u dma=%u/%u ps=%u", stage, (unsigned)in.total_free_bytes, (unsigned)in.largest_free_block,
           (unsigned)in.free_blocks, (unsigned)in.minimum_free_bytes, (unsigned)dma.total_free_bytes,
           (unsigned)dma.largest_free_block, (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
}

// Tasks by name (FreeRTOS keeps 15 characters) and the stack each reserves, in bytes, from the
// code and sdkconfig; 0 = size not known here. No task list API in this build
// (CONFIG_FREERTOS_USE_TRACE_FACILITY off), so tasks not named here are not shown.
struct KnownTask {
    const char *name;
    uint32_t reserved;
};
static const KnownTask knownTasks[] = {
    {"loopTask", 6144},           {"async_tcp", 6144},
    {"tiT", 2560},                {"sys_evt", 2048},
    {"arduino_events", 4096},     {"Tmr Svc", 3120},
    {"wifi", 0},                  {"esp_timer", 0},
    {"ipc0", 0},                  {"ipc1", 0},
    {"btController", 0},          {"nimble_host", 3072},
    {"mdns", 0},                  {"GaggiMateController", 4096},
    {"Controller::loopLogic", 4608}, {"Settings::loop", 3072},
    {"ShotHistoryPlugin::loop", 4608}, {"BLEScaleTask", 4608},
    {"WebBackground", 4096},      {"GaggiMateServer", 4096},
    {"GmDispatch", 4096},         {"Heater::loop", 3072},
    {"Max31865Thermocouple::monitor", 3072}, {"Max31855Thermocouple::monitor", 3072},
    {"NtcThermocouple::monitor", 3072}, {"ADSAdc::loop", 3072},
    {"DimmedPump::loop", 3072},   {"SimplePump::loop", 6144},
    {"DigitalInput::loop", 3072}, {"FlowSensor::loop", 3072},
    {"DistanceSensor::loop", 3072}, {"GearpumpAddon::loop", 3072},
};

size_t dlzlog_stacks(char *out, size_t cap) {
    size_t n = 0;
    uint32_t sumReserved = 0, sumUsed = 0;
    auto put = [&](const char *fmt, auto... a) {
        if (n < cap) {
            int k = snprintf(out + n, cap - n, fmt, a...);
            if (k > 0)
                n += (size_t)k < cap - n ? (size_t)k : cap - n - 1;
        }
    };
    put("tasks: %u running; name / reserved / lowest unused / peak used (bytes)\n", (unsigned)uxTaskGetNumberOfTasks());
    for (const auto &t : knownTasks) {
        char name[configMAX_TASK_NAME_LEN];
        strncpy(name, t.name, sizeof(name) - 1);
        name[sizeof(name) - 1] = 0;
        TaskHandle_t h = xTaskGetHandle(name);
        if (!h)
            continue;
        const uint32_t unused = uxTaskGetStackHighWaterMark(h);
        if (t.reserved) {
            put("%-16s %5u %5u %5u\n", name, (unsigned)t.reserved, (unsigned)unused, (unsigned)(t.reserved - unused));
            sumReserved += t.reserved;
            sumUsed += t.reserved - unused;
        } else {
            put("%-16s     ? %5u     ?\n", name, (unsigned)unused);
        }
    }
    put("known sizes: reserved %u, peak used %u, could free up to %u\n", (unsigned)sumReserved, (unsigned)sumUsed,
        (unsigned)(sumReserved - sumUsed));
    multi_heap_info_t in;
    heap_caps_get_info(&in, MALLOC_CAP_INTERNAL);
    put("internal now: free %u, largest %u, blocks %u, lowest ever %u\n", (unsigned)in.total_free_bytes,
        (unsigned)in.largest_free_block, (unsigned)in.free_blocks, (unsigned)in.minimum_free_bytes);
    return n;
}

void dlzlog_tick(void) {
    static bool lowMem = false;
    const uint32_t now = millis();
    if (ring.wdtCount != lastWdtLogged) {
        lastWdtLogged = ring.wdtCount;
        dlzlog("watchdog count now %u", (unsigned)lastWdtLogged);
    }
    // the memory tracker (AllocTrack, HOLD lines) was removed in build 923: its wrapper sat in the
    // allocation chain that overflowed ipc1 at start (crash dumps 903/921/922, 2026-10-18)
    logAllocFails();
    const size_t largest = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    // Edge-triggered: the moment internal memory gets too chopped for a Wi-Fi TX buffer.
    if (!lowMem && largest < 4096) {
        lowMem = true;
        multi_heap_info_t in, dma;
        heap_caps_get_info(&in, MALLOC_CAP_INTERNAL);
        heap_caps_get_info(&dma, MALLOC_CAP_DMA);
        dlzlog("LOWMEM internal largest=%u free=%u blocks=%u dma=%u/%u act=%d", (unsigned)largest, (unsigned)in.total_free_bytes,
               (unsigned)in.free_blocks, (unsigned)dma.total_free_bytes, (unsigned)dma.largest_free_block,
               (int)dlzlog_activeRequests);
    } else if (lowMem && largest > 8192) {
        lowMem = false;
        dlzlog("memory back: internal largest=%u", (unsigned)largest);
    }
    // 3-12 s after boot: a MEM line whenever internal free memory moved by 1 KB or more, to time
    // the ~48 KB taken after the web server starts (2026-10-16)
    static size_t lastFree = 0;
    if (now >= 3000 && now <= 12000) {
        const size_t freeNow = heap_caps_get_free_size(MALLOC_CAP_INTERNAL);
        if (lastFree == 0 || freeNow + 1024 <= lastFree || freeNow >= lastFree + 1024) {
            char stage[16];
            snprintf(stage, sizeof(stage), "t=%lu.%02lus", (unsigned long)(now / 1000), (unsigned long)(now % 1000 / 10));
            dlzlog_mem(stage);
            lastFree = freeNow;
        }
    }
    // memory after start-up, when everything late (Wi-Fi, scale, web pages) has come up
    static uint8_t memStep = 0;
    static const uint32_t memAt[] = {10000, 30000, 60000, 300000};
    if (memStep < 4 && now >= memAt[memStep]) {
        char stage[12];
        snprintf(stage, sizeof(stage), "t=%lus", (unsigned long)(memAt[memStep] / 1000));
        dlzlog_mem(stage);
        memStep++;
    }
    // The heartbeat line (memory, Wi-Fi, request counts every 1-5 min) was removed in build 967
    // (2026-10-22, user: as little logging as possible); 966 keeps it for diagnosis.
}
