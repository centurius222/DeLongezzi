#include <cmath>
#include <atomic>
#include <map>
#include <mutex>
#include "WebUIPlugin.h"
#include "MiniWifiPage.h"
#include <DNSServer.h>
#include <LittleFS.h>
#include <algorithm>
#include <AsyncJson.h>
#include <esp_flash.h>
#include <esp_ota_ops.h>
#include <esp_spi_flash.h>
#include <time.h>
#include <SD_MMC.h>
#include <algorithm>
#include <display/plugins/WaterLevelPlugin.h>
#ifdef GAGGIMATE_MERGED
// Diagnostics: merged-only fields for /api/diagnostics are filled by
// fillMergedDiagnostics() (defined at the BOTTOM of this file - it must come
// after all includes because ble_ota_dfu.hpp transitively included by the
// controller headers collides with lib/OTA global constexprs).
void fillMergedDiagnostics(JsonDocument &doc);
#endif
#include <display/core/Controller.h>
#include <display/core/ProfileManager.h>
#include <display/core/process/BrewProcess.h>
#include <display/core/process/GrindProcess.h>
#include <display/core/process/ManualProcess.h>
#include <display/models/profile.h>
#include <display/plugins/BLEScalePlugin.h>
#include <display/plugins/ShotHistoryPlugin.h>
#include <display/util/PsramStlAllocator.h>
#include <display/util/PsramWsBuffer.h>
#include <display/webassets/web_ui_manifest.h>
#include <esp32-hal-psram.h>
#include <DlzLog.h>
#include <esp_core_dump.h>
#include <esp_err.h>
#include <esp_heap_caps.h>
#include <esp_partition.h>
#include <lwip/tcp.h>
#include <mbedtls/platform.h>
#include <string>
#include <unordered_map>
#include <vector>
#include <version.h>

// Incoming WebSocket payloads (profile uploads reserve up to 64 KB) are
// reassembled here. Back the character storage with PSRAM so these large,
// transient buffers don't spike the scarce internal SRAM. The map nodes
// themselves stay on the default heap (tiny: an id + a string handle).
using PsramString = std::basic_string<char, std::char_traits<char>, PsramStlAllocator<char>>;
// Long-lived data kept in PSRAM explicitly: plain malloc put blocks up to 4 KB in fast memory
// (PsramWsBuffer.h reset the limit to 4096 until 2026-10-19, see PsramThreshold.h), and lists
// stored that way held 27.8 KB of it for good (2026-10-17, Delongezzi911 logs_callers911.txt).
template <typename T> using PsramVector = std::vector<T, PsramStlAllocator<T>>;
static std::unordered_map<uint32_t, PsramString> rxBuffers;
// Connection health for Settings > Diagnostics (user 2026-10-09: the tablet stopped following
// the machine while the laptop did). Per WebSocket client, plus the status cadence. Lock order:
// ws.clientsLock() first, then wsStatsMutex (the connect/disconnect events run under the first).
struct WsClientStat {
    String ip;
    unsigned long connectedAt = 0;
    unsigned long lastStatusAt = 0;
    unsigned long zeroWindowSince = 0; // 2026-10-10: peer stopped ACKing (TCP window pinned)
    uint32_t sent = 0;
    uint32_t skipped = 0;
    size_t lastQueue = 0;
    bool droppedByMachine = false; // set just before the machine closes it (no update for 5 s)
};
// Who ended connections (Diagnostics): the machine (stuck 5 s) or the device (page reload,
// sleep, its own no-update check, network).
static uint32_t wsEndedByMachine = 0, wsEndedByDevice = 0;
static String wsLastMachineEndIp, wsLastDeviceEndIp;
static unsigned long wsLastMachineEndAt = 0, wsLastDeviceEndAt = 0;
static std::map<uint32_t, WsClientStat> wsStats;
static std::mutex wsStatsMutex;
static uint32_t wsClosedBehind = 0; // closed while updates were still queued for it
static String wsLastBehindIp;
static unsigned long wsLastBehindAt = 0;
static size_t wsLastBehindQueue = 0;
static unsigned long statusLastAt = 0, statusMinuteStart = 0, statusGapNow = 0, statusGapPrev = 0;
// Request log (Diagnostics "requests", user 2026-10-09: a theme change made a page wait ~15 s;
// this shows what each device asked for, how long each took and free memory at the start).
// The last 40 requests plus markers ("changed sent"); guarded by reqLogMutex.
struct ReqEntry {
    uint32_t seq = 0;
    unsigned long at = 0;
    unsigned long doneAt = 0; // 0: not finished (yet)
    uint8_t ip = 0;           // last number of the device's address
    char what[44] = {};
    uint32_t heap = 0;
};
static ReqEntry reqLog[40];
static uint32_t reqSeq = 0;
static std::mutex reqLogMutex;
static int reqLogAdd(uint8_t ip, const String &what) {
    std::lock_guard<std::mutex> guard(reqLogMutex);
    const int slot = reqSeq % 40;
    ReqEntry &e = reqLog[slot];
    e.seq = ++reqSeq;
    e.at = millis();
    e.doneAt = 0;
    e.ip = ip;
    strncpy(e.what, what.c_str(), sizeof(e.what) - 1);
    e.what[sizeof(e.what) - 1] = 0;
    e.heap = ESP.getFreeHeap();
    return slot;
}
static std::mutex rxMutex; // rxBuffers: async_tcp (data) and the main loop (disconnect cleanup)
static WebUIPlugin *g_webUIPlugin = nullptr;
// Main-loop hold-ups of 300 ms or more, the last 8 (Diagnostics "slow"; user 2026-10-09: the
// status stream stopped for ~10 s now and then). Written on the main loop only.
struct SlowEvent {
    const char *what = nullptr;
    const void *who = nullptr;
    unsigned long ms = 0;
    unsigned long at = 0;
};
static SlowEvent slowEvents[8];
static int slowNext = 0;
void noteSlow(const char *what, const void *who, unsigned long ms) {
    if (ms < 300)
        return;
    // no SLOW log line since build 967 (2026-10-22); the last 8 stay in /api/diagnostics
    slowEvents[slowNext] = SlowEvent{what, who, ms, millis()};
    slowNext = (slowNext + 1) % 8;
}

// Serialize a JsonDocument straight into a PSRAM-backed WebSocket message
// buffer — one exact-sized allocation, off the internal heap. [GM-139]
// Custom pictures uploaded from Settings: the splash and the sidebar logo
// (user 2026-09-24). The page shrinks still pictures in the browser and sends
// animated ones as is (up to 100 KB — see CUSTOM_IMAGE_MAX_BYTES). Each lives in LittleFS, is written via a
// temp file so a failed upload never leaves half a picture, and gets a new tag
// per upload so browsers revalidate (ETag / 304) instead of re-downloading it.
// GET <uri> serves it (404 = use the built-in one), POST <uri> uploads, POST
// <resetUri> deletes. One upload at a time.
struct CustomImage {
    const char *path;
    const char *tmpPath;
    const char *tagPath;
    // Is there one: -1 not looked yet, 0 no, 1 yes. Kept so each page load's GET answers at once;
    // looking for a missing file in storage took ~0.2 s (the splash and logo, every Settings load).
    mutable volatile int8_t present = -1;
    // PSRAM cache of the uploaded file (2026-10-13): the file was re-read from
    // LittleFS on every Settings load, which stalled the loop and could wedge
    // async_tcp. ramPrev is the previous generation, freed only when a newer
    // upload lands, so an in-flight response never reads freed memory.
    mutable uint8_t *ram = nullptr;
    mutable size_t ramLen = 0;
    mutable uint8_t *ramPrev = nullptr;
};
static const CustomImage SPLASH_IMAGE{"/splash.img", "/splash.tmp", "/splash.tag"};
static const CustomImage LOGO_IMAGE{"/logo.img", "/logo.tmp", "/logo.tag"};
// Brew button: the animation, and its first frame as the idle still.
static const CustomImage BREW_ANIM_IMAGE{"/brewbtn.img", "/brewbtn.tmp", "/brewbtn.tag"};
static const CustomImage BREW_STILL_IMAGE{"/brewstill.img", "/brewstill.tmp", "/brewstill.tag"};
// Uploads are capped well below the old 2 MB: large files made the custom
// picture slow to serve from LittleFS on every Settings load and could
// wedge the async_tcp task (2026-10-13). Still pictures from the Settings
// page are shrunk in the browser; 100 KB covers them plus small animations.
static constexpr size_t CUSTOM_IMAGE_MAX_BYTES = 100 * 1024;
static File imageUpload;
static bool imageUploadSeen = false;
static bool imageUploadFailed = false;
// Why the last upload failed (shown in the Settings page status); nullptr when
// nothing failed yet. Written in the upload callback, read by the POST
// completion handler.
static const char *imageUploadError = nullptr;

// Still pictures arrive as WebP (JPEG where the browser cannot encode WebP);
// animated ones as uploaded (WebP, GIF or PNG). Tell them apart.
// The content type from a file's first 12 bytes (also used on an upload's first chunk).
static const char *contentTypeOf(const uint8_t *head) {
    if (head[0] == 0xFF && head[1] == 0xD8)
        return "image/jpeg";
    if (head[0] == 0x89 && head[1] == 'P')
        return "image/png";
    if (head[0] == 'G' && head[1] == 'I' && head[2] == 'F')
        return "image/gif";
    // Brew button videos: MP4 ("ftyp" box) and WebM (EBML header).
    if (head[4] == 'f' && head[5] == 't' && head[6] == 'y' && head[7] == 'p')
        return "video/mp4";
    if (head[0] == 0x1A && head[1] == 0x45 && head[2] == 0xDF && head[3] == 0xA3)
        return "video/webm";
    return "image/webp";
}

static const char *imageContentType(const char *path) {
    uint8_t head[12] = {0};
    File f = LittleFS.open(path, "r");
    if (f) {
        f.read(head, sizeof(head));
        f.close();
    }
    return contentTypeOf(head);
}

static String imageTag(const char *tagPath) {
    File f = LittleFS.open(tagPath, "r");
    String tag = f ? f.readString() : String();
    if (f) {
        f.close();
    }
    return tag;
}

// PSRAM cache for custom images (2026-10-13). Serving the file from LittleFS on
// every Settings load took seconds and could wedge async_tcp; images are capped
// at CUSTOM_IMAGE_MAX_BYTES, so a full copy in PSRAM is cheap. The previous
// generation is kept until the next swap so an in-flight response never reads
// freed memory.
static void customImageLoad(const CustomImage *img) {
    File f = LittleFS.open(img->path, "r");
    if (!f) {
        return;
    }
    const size_t size = f.size();
    if (size == 0 || size > CUSTOM_IMAGE_MAX_BYTES) {
        f.close();
        return;
    }
    uint8_t *buf = (uint8_t *)ps_malloc(size + 1); // +1 so content-type sniffing can NUL-terminate
    if (!buf) {
        f.close();
        return;
    }
    const size_t got = f.read(buf, size);
    f.close();
    if (got != size) {
        free(buf);
        return;
    }
    if (img->ramPrev) {
        free(img->ramPrev);
    }
    img->ramPrev = img->ram;
    img->ram = buf;
    img->ramLen = size;
}

static void customImageDiscard(const CustomImage *img) {
    if (img->ram) {
        free(img->ram);
        img->ram = nullptr;
    }
    if (img->ramPrev) {
        free(img->ramPrev);
        img->ramPrev = nullptr;
    }
    img->ramLen = 0;
}

static void serveCustomImage(AsyncWebServer &server, const char *uri, const char *resetUri, const CustomImage *img) {
    server.on(uri, HTTP_GET, [img](AsyncWebServerRequest *request) {
        if (img->present < 0)
            img->present = LittleFS.exists(img->path) ? 1 : 0;
        if (!img->present) {
            request->send(404);
            return;
        }
        const String tag = imageTag(img->tagPath);
        if (tag.length() && request->hasHeader("If-None-Match") && request->header("If-None-Match") == tag) {
            request->send(304);
            return;
        }
        // Serve from the PSRAM cache (loaded at upload, or on this first GET
        // after a reboot); the LittleFS-file response below took seconds and
        // could wedge async_tcp.
        if (!img->ram && img->present == 1) {
            customImageLoad(img);
        }
        if (img->ram) {
            AsyncWebServerResponse *resp = request->beginResponse(200, imageContentType(img->path), img->ram, img->ramLen);
            resp->addHeader("Cache-Control", "no-cache");
            if (tag.length()) {
                resp->addHeader("ETag", tag);
            }
            request->send(resp);
            return;
        }
        AsyncWebServerResponse *resp = request->beginResponse(LittleFS, img->path, imageContentType(img->path));
        resp->addHeader("Cache-Control", "no-cache");
        if (tag.length()) {
            resp->addHeader("ETag", tag);
        }
        request->send(resp);
    });
    server.on(
        uri, HTTP_POST,
        [](AsyncWebServerRequest *request) {
            const bool ok = imageUploadSeen && !imageUploadFailed;
            imageUploadSeen = false;
            if (ok) {
                request->send(200, "application/json", "{\"success\":true}");
            } else {
                const char *reason = imageUploadError ? imageUploadError : "upload failed";
                char body[128];
                snprintf(body, sizeof(body), "{\"success\":false,\"error\":\"%s\"}", reason);
                request->send(400, "application/json", body);
            }
        },
        [img](AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final) {
            if (index == 0) {
                imageUploadSeen = true;
                imageUploadFailed = false;
                imageUploadError = nullptr;
                if (imageUpload) {
                    imageUpload.close();
                }
                imageUpload = LittleFS.open(img->tmpPath, "w");
                imageUploadFailed = !imageUpload;
                if (imageUploadFailed) {
                    imageUploadError = "storage write failed (no space?)";
                }
            }
            if (!imageUploadFailed && len) {
                if (index + len > CUSTOM_IMAGE_MAX_BYTES) {
                    imageUploadFailed = true;
                    imageUploadError = "picture is larger than 100 KB";
                } else if (imageUpload.write(data, len) != len) {
                    imageUploadFailed = true;
                    imageUploadError = "storage write failed";
                }
            }
            if (final) {
                if (imageUpload) {
                    imageUpload.close();
                }
                img->present = -1; // look again
                if (imageUploadFailed) {
                    LittleFS.remove(img->tmpPath);
                } else {
                    LittleFS.remove(img->path);
                    imageUploadFailed = !LittleFS.rename(img->tmpPath, img->path);
                    if (imageUploadFailed) {
                        imageUploadError = "could not rename the uploaded file";
                    }
                    File tagFile = LittleFS.open(img->tagPath, "w");
                    if (tagFile) {
                        tagFile.printf("\"%lu-%u\"", millis(), (unsigned)(index + len));
                        tagFile.close();
                    }
                    if (!imageUploadFailed) {
                        customImageLoad(img); // refresh the PSRAM cache
                    }
                }
            }
        });
    server.on(resetUri, HTTP_POST, [img](AsyncWebServerRequest *request) {
        LittleFS.remove(img->path);
        LittleFS.remove(img->tagPath);
        img->present = 0;
        customImageDiscard(img); // drop the PSRAM cache as well
        request->send(200, "application/json", "{\"success\":true}");
    });
}

// "attachment; filename=delongezzi-<kind>[-YYYY-MM-DD]<ext>" (date once the clock is set).
static String backupDisposition(const char *kind, const char *ext = ".bin") {
    char date[16] = "";
    const time_t now = time(nullptr);
    if (now > 1700000000) {
        struct tm t;
        localtime_r(&now, &t);
        strftime(date, sizeof(date), "-%Y-%m-%d", &t);
    }
    return String("attachment; filename=\"delongezzi-") + kind + date + ext + "\"";
}

// "#rrggbb"
static bool isHexColor(const String &c) {
    if (c.length() != 7 || c[0] != '#')
        return false;
    for (int i = 1; i < 7; i++) {
        if (!isxdigit(static_cast<unsigned char>(c[i])))
            return false;
    }
    return true;
}

// A theme or holiday name (webTheme, holidayMode): empty or up to 16 lowercase
// letters; the page only applies names it knows.
static bool isThemeName(const String &t) {
    if (t.length() > 16)
        return false;
    for (size_t i = 0; i < t.length(); i++) {
        if (t[i] < 'a' || t[i] > 'z')
            return false;
    }
    return true;
}

// Holiday packs (web/holidays/<id>/, sent by scripts/upload_holidays.py) live in
// storage under /hol/<id>/ rather than in the firmware, whose area was nearly
// full (user 2026-09-26). GET /holidays/<id>/<file> serves them; CSS and SVG
// are stored gzipped as <file>.gz and sent that way. Each pack has one tag,
// renewed by every upload, so browsers revalidate (ETag / 304) instead of
// downloading it again. POST /api/holiday-file?path=<id>/<file> uploads one
// file, POST /api/holiday-clear?id=<id> deletes a pack. One upload at a time.
static constexpr size_t HOLIDAY_FILE_MAX_BYTES = 1024 * 1024;
static File holidayUpload;
static String holidayUploadPath;
static bool holidayUploadFailed = false;

// <id>/<file>: lowercase letters, digits, '_', '-', '.' and '/', no "..", and
// short enough for the file system's 64-character names.
static bool isHolidayPath(const String &p) {
    if (p.isEmpty() || p.length() > 48 || p[0] == '/' || p.indexOf("..") >= 0 || p.indexOf('/') <= 0)
        return false;
    for (size_t i = 0; i < p.length(); i++) {
        const char c = p[i];
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.' || c == '/'))
            return false;
    }
    return true;
}

static const char *holidayContentType(const String &path) {
    if (path.endsWith(".css"))
        return "text/css";
    if (path.endsWith(".svg"))
        return "image/svg+xml";
    if (path.endsWith(".webp"))
        return "image/webp";
    if (path.endsWith(".png"))
        return "image/png";
    if (path.endsWith(".jpg") || path.endsWith(".jpeg"))
        return "image/jpeg";
    if (path.endsWith(".ttf"))
        return "font/ttf"; // the custom themes' fonts (/holidays/fonts/, scripts/upload_fonts.py)
    if (path.endsWith(".otf"))
        return "font/otf";
    return "application/octet-stream";
}

// a file's room on the storage: whole 4 KB blocks
static size_t storageBlocks(size_t bytes) { return (bytes + 4095) & ~(size_t)4095; }

// Returns the room it freed (each file rounded up to whole blocks).
static size_t removeTree(const String &path) {
    File dir = LittleFS.open(path);
    if (!dir) {
        return 0;
    }
    if (!dir.isDirectory()) {
        const size_t size = dir.size();
        dir.close();
        LittleFS.remove(path);
        return storageBlocks(size);
    }
    size_t freed = 0;
    for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
        const String child = f.path();
        const bool isDir = f.isDirectory();
        const size_t size = isDir ? 0 : f.size();
        f.close();
        if (isDir) {
            freed += removeTree(child);
        } else {
            LittleFS.remove(child);
            freed += storageBlocks(size);
        }
    }
    dir.close();
    LittleFS.rmdir(path);
    return freed;
}

static String holidayTagPath(const String &id) { return "/hol/" + id + "/tag"; }

static void serveHolidays(AsyncWebServer &server) {
    server.on("/holidays/*", HTTP_GET, [](AsyncWebServerRequest *request) {
        const String rel = request->url().substring(strlen("/holidays/"));
        const String path = "/hol/" + rel;
        if (!isHolidayPath(rel) || (!LittleFS.exists(path) && !LittleFS.exists(path + ".gz"))) {
            request->send(404);
            return;
        }
        const String tag = imageTag(holidayTagPath(rel.substring(0, rel.indexOf('/'))).c_str());
        if (tag.length() && request->hasHeader("If-None-Match") && request->header("If-None-Match") == tag) {
            request->send(304);
            return;
        }
        // Only <file>.gz there: AsyncFileResponse sends that, gzip-encoded.
        AsyncWebServerResponse *resp = request->beginResponse(LittleFS, path, holidayContentType(path));
        resp->addHeader("Cache-Control", "no-cache");
        if (tag.length()) {
            resp->addHeader("ETag", tag);
        }
        request->send(resp);
    });
    server.on(
        "/api/holiday-file", HTTP_POST,
        [](AsyncWebServerRequest *request) {
            const bool ok = holidayUploadPath.length() && !holidayUploadFailed;
            holidayUploadPath = "";
            request->send(ok ? 200 : 400, "application/json", ok ? "{\"success\":true}" : "{\"success\":false}");
        },
        [](AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final) {
            if (index == 0) {
                if (holidayUpload) {
                    holidayUpload.close();
                }
                const String rel = request->hasArg("path") ? request->arg("path") : String();
                holidayUploadFailed = !isHolidayPath(rel);
                holidayUploadPath = holidayUploadFailed ? String() : "/hol/" + rel;
                if (!holidayUploadFailed) {
                    holidayUpload = LittleFS.open(holidayUploadPath + ".tmp", "w", true);
                    holidayUploadFailed = !holidayUpload;
                }
            }
            if (!holidayUploadFailed && len) {
                holidayUploadFailed = index + len > HOLIDAY_FILE_MAX_BYTES || holidayUpload.write(data, len) != len;
            }
            if (final) {
                if (holidayUpload) {
                    holidayUpload.close();
                }
                if (holidayUploadFailed) {
                    if (holidayUploadPath.length()) {
                        LittleFS.remove(holidayUploadPath + ".tmp");
                    }
                } else {
                    LittleFS.remove(holidayUploadPath);
                    holidayUploadFailed = !LittleFS.rename(holidayUploadPath + ".tmp", holidayUploadPath);
                    const String id = holidayUploadPath.substring(5, holidayUploadPath.indexOf('/', 5));
                    File tagFile = LittleFS.open(holidayTagPath(id), "w");
                    if (tagFile) {
                        tagFile.printf("\"%lu-%u\"", millis(), (unsigned)(index + len));
                        tagFile.close();
                    }
                }
            }
        });
    server.on("/api/holiday-clear", HTTP_POST, [](AsyncWebServerRequest *request) {
        const String id = request->hasArg("id") ? request->arg("id") : String();
        if (id.isEmpty() || !isThemeName(id)) {
            request->send(400, "application/json", "{\"success\":false}");
            return;
        }
        removeTree("/hol/" + id);
        request->send(200, "application/json", "{\"success\":true}");
    });
}

// Custom themes (docs/CUSTOM_THEMES_PLAN.txt, user 2026-09-30): a theme made in
// Settings from one picture on the Western layout, no build or flash. Each lives in
// LittleFS /ct/<id>/: page.webp (the picture, shrunk by the browser), meta.json
// (name, colour, clock, when it shows, the auto-fit) and tag (for the ETag).
// Ids are "u" + lowercase letters, up to 16: isThemeName() accepts them, so an id
// can be saved as holidayMode like a built-in holiday.
//   GET  /api/custom-themes                 {themes: [meta + id + tag], free, total}
//   GET  /custom/<id>/page.webp             the picture (ETag, 304 on repeat); thumb.webp its
//                                           small copy for the theme picker (long-press the logo)
//   POST /api/custom-theme-file?id=<id>     the picture (multipart), max 1 MB; &name=thumb the small copy
//   POST /api/custom-theme-meta?id=<id>     meta=<json> (form field), max 4 KB
//   POST /api/custom-theme-delete?id=<id>   removes it (403 when permanent); the chosen theme goes back to auto
static constexpr size_t CUSTOM_META_MAX_BYTES = 4096;
static constexpr size_t CUSTOM_MIN_FREE_BYTES = 1024 * 1024;
static File customUpload;
static String customUploadDir;
static String customUploadName = "page"; // "page" or "thumb"
// Every open page hears at once when settings, custom themes or videos change (a phone kept
// showing the old brew video until it reloaded): WebUIPlugin::loop sends
// {"tp":"evt:changed","what":["settings","themes","videos"]} and the page reads those again.
enum : uint8_t { CHANGED_SETTINGS = 1, CHANGED_THEMES = 2, CHANGED_VIDEOS = 4, CHANGED_THEME_PICK = 8 };
static uint8_t changedBits = 0; // set on the web server's task, sent and cleared by the loop
static void markChanged(uint8_t bits) { __atomic_fetch_or(&changedBits, bits, __ATOMIC_SEQ_CST); }

// The lists change any moment: never kept by the browser.
static void sendNoStore(AsyncWebServerRequest *request, const String &json) {
    AsyncWebServerResponse *resp = request->beginResponse(200, "application/json", json);
    resp->addHeader("Cache-Control", "no-store");
    request->send(resp);
}

static String customListJson;         // GET /api/custom-themes' list, kept between requests
static std::vector<std::pair<String, String>> customListTags; // id -> tag, from the same read
static std::mutex customListMutex;

// A picture's address carries its tag (?v=<tag>, the page builds it from the lists): while the
// tag matches, the file can't change, so the browser keeps it and doesn't ask again (the theme
// picker re-fetched every small picture each time it opened, about 0.25 s each).
// One big response's turn per device (2026-10-18; one turn for all since 2026-10-09): each device
// gets one picture, video or app file at a time, and at most HEAVY_LANES devices are sent to at
// once. With one turn for all, a lost Wi-Fi packet on the tablet (932 log: a 5 KB still stuck
// 7 s with the tablet's receive space open, the machine resending) stopped the laptop too, and
// the second device's picture always waited behind the first one's.
// The others wait (RESPONSE_TRY_AGAIN). A turn is given back at the last byte or when the request
// ends. A waiting file passes only when the sender in its way (its own device's, or with every
// lane taken the quietest one) has sent nothing for 5 s (a client that stopped reading); it then
// counts as that sender, so the next one waits another 5 s of silence. The old "any file that
// waited 3 s goes" let every queued file send at once, which ran the fast memory out (builds
// 899/900 proof, 2026-10-16).
static constexpr int HEAVY_LANES = 2;
static constexpr unsigned long HEAVY_STUCK_MS = 5000;
struct HeavyLane {
    bool used = false;
    uint32_t ip = 0;              // the device being sent to
    unsigned long progressAt = 0; // last time its sender sent a piece
};
static HeavyLane heavyLanes[HEAVY_LANES];
static portMUX_TYPE heavyLock = portMUX_INITIALIZER_UNLOCKED;
struct HeavyGate {
    uint32_t ip = 0;     // the asking device
    int lane = -1;       // the lane this response holds
    int waivedLane = -1; // >= 0: passed this lane's stuck sender
    bool take() {
        const unsigned long now = millis();
        bool waivedNow = false;
        portENTER_CRITICAL(&heavyLock);
        if (lane >= 0 || waivedLane >= 0) {
            heavyLanes[lane >= 0 ? lane : waivedLane].progressAt = now; // the sender is moving
            portEXIT_CRITICAL(&heavyLock);
            return true;
        }
        int own = -1, spare = -1, quietest = 0;
        for (int i = 0; i < HEAVY_LANES; i++) {
            if (heavyLanes[i].used && heavyLanes[i].ip == ip)
                own = i;
            else if (!heavyLanes[i].used && spare < 0)
                spare = i;
            if (heavyLanes[i].progressAt < heavyLanes[quietest].progressAt)
                quietest = i;
        }
        if (own < 0 && spare >= 0) {
            heavyLanes[spare].used = true;
            heavyLanes[spare].ip = ip;
            heavyLanes[spare].progressAt = now;
            lane = spare;
        } else {
            const int blocker = own >= 0 ? own : quietest;
            if (now - heavyLanes[blocker].progressAt > HEAVY_STUCK_MS) {
                heavyLanes[blocker].progressAt = now;
                waivedLane = blocker;
                waivedNow = true;
            }
        }
        const bool passed = lane >= 0 || waivedLane >= 0;
        portEXIT_CRITICAL(&heavyLock);
        if (waivedNow)
            dlzlog("GATE passed: sender stuck");
        return passed;
    }
    void give() {
        portENTER_CRITICAL(&heavyLock);
        if (lane >= 0) {
            heavyLanes[lane].used = false;
            lane = -1;
        }
        portEXIT_CRITICAL(&heavyLock);
    }
    ~HeavyGate() { give(); }
};
// 4, was 6 (2026-10-18): two devices loading at once ran fast memory down to 1-3 KB at 7 open
// (928 log: tablet refused, Wi-Fi stalled); each open request holds about 3 KB.
static constexpr int32_t OPEN_LIMIT = 4; // open web requests, the asking one included

// Small pictures kept in PSRAM (2026-10-20, THEME_PICS_950_PLAN.md): theme thumbnails and video
// stills. From storage each took ~0.2 s to start and counted against the 4-file limit, so Settings
// (23+ at once) got "busy" answers and broken pictures. Filled by the background task
// (fillSmallPictures). Each answer holds its own reference to the bytes, so replacing or dropping an
// entry never frees bytes still being sent; an entry is used only while its tag is the current one.
struct SmallPicture {
    PsramString tag;                // the tag these bytes belong to
    std::shared_ptr<uint8_t> bytes; // PSRAM; empty = tried for this tag and not loaded (see why)
    size_t len = 0;
    enum Why : uint8_t { Loaded, NoFile, Empty, TooBig, OverBudget, NoRoom, ReadError } why = Loaded;
    unsigned long triedAt = 0; // millis() of the try (NoRoom / ReadError are tried again after 5 minutes)
};
using SmallPictureMap =
    std::map<PsramString, SmallPicture, std::less<>, PsramStlAllocator<std::pair<const PsramString, SmallPicture>>>;
static SmallPictureMap smallPictures; // key: the storage path (/ct/<id>/thumb.webp, /vid/<id>/still)
static std::mutex smallPicturesMutex;
static size_t smallPicturesBytes = 0;                            // under smallPicturesMutex
static constexpr size_t SMALL_PICTURE_MAX = 64 * 1024;           // per file (thumbnails ~15 KB, stills <= 20 KB)
static constexpr size_t SMALL_PICTURES_BUDGET = 2 * 1024 * 1024; // all together (about 0.65 MB in 2026-10)

// From the PSRAM copy: no storage, no file, no turn to wait. false: not copied (yet), a newer picture,
// or fast memory low; the caller then takes the storage path, 4-file limit included.
static bool sendSmallPicture(AsyncWebServerRequest *request, const String &path, const char *type, const String &tag) {
    std::shared_ptr<uint8_t> bytes;
    size_t total = 0;
    {
        std::lock_guard<std::mutex> lock(smallPicturesMutex);
        const auto it = smallPictures.find(path.c_str());
        if (it == smallPictures.end() || !it->second.bytes || it->second.tag != tag.c_str())
            return false;
        bytes = it->second.bytes;
        total = it->second.len;
    }
    // Safety valve: fast memory really low -> back under the 4-file limit, which caps how many are open
    // (the storage path uses no less memory per picture).
    if (heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT) < 8192)
        return false;
    AsyncWebServerResponse *resp =
        request->beginResponse(type, total, [bytes, total](uint8_t *buf, size_t maxLen, size_t index) -> size_t {
            const size_t n = std::min(maxLen, total - index);
            memcpy(buf, bytes.get() + index, n);
            return n;
        });
    const bool versioned = tag.length() && request->hasArg("v") && request->arg("v") == tag;
    resp->addHeader("Cache-Control", versioned ? "public, max-age=31536000, immutable" : "no-cache");
    if (tag.length())
        resp->addHeader("ETag", tag);
    request->send(resp);
    return true;
}

static void sendTaggedFile(AsyncWebServerRequest *request, const String &path, const char *type, const String &tag) {
    // 304 first (2026-10-20): it needs no file, so it is never "busy"
    if (tag.length() && request->hasHeader("If-None-Match") && request->header("If-None-Match") == tag) {
        request->send(304);
        return;
    }
    // theme thumbnails and video stills from the PSRAM copy, when there is one for this tag
    if (sendSmallPicture(request, path, type, tag))
        return;
    // Busy: every open request holds about 3 KB of fast memory while it waits, and 11 at once
    // starved Wi-Fi (build 901 proof, 2026-10-16). Pictures and videos are turned away at once
    // and the page asks again in 1 s.
    if (dlzlog_activeRequests > OPEN_LIMIT) {
        AsyncWebServerResponse *busy = request->beginResponse(503);
        busy->addHeader("Retry-After", "1");
        busy->addHeader("Cache-Control", "no-store");
        request->send(busy); // not logged since build 967
        return;
    }
    File f = LittleFS.open(path, "r"); // one open, also the "is it there" check
    if (!f || f.isDirectory()) {
        request->send(404);
        return;
    }
    // One picture/video per device at a time (HeavyGate; user 2026-10-09, per device 2026-10-18):
    // the theme picker asks for every thumbnail and background at once, and each one in flight
    // holds network memory until sent; a burst ran fast memory down to ~0.5 KB (one picture took
    // 16 s, the status stream to every page stopped). The others wait their turn
    // (RESPONSE_TRY_AGAIN) instead of sending. The turn is given back when the last byte is read
    // or the request ends (destructor).
    struct HeavyFile {
        File f;
        HeavyGate gate;
        ~HeavyFile() { f.close(); }
    };
    auto state = std::make_shared<HeavyFile>();
    state->f = f;
    state->gate.ip = request->client()->getRemoteAddress();
    const size_t total = f.size();
    AsyncWebServerResponse *resp = request->beginResponse(
        type, total, [state, total](uint8_t *buf, size_t maxLen, size_t index) -> size_t {
            if (!state->gate.take())
                return RESPONSE_TRY_AGAIN;
            const size_t n = state->f.read(buf, maxLen);
            if (n == 0 || index + n >= total)
                state->gate.give();
            return n;
        });
    const bool versioned = tag.length() && request->hasArg("v") && request->arg("v") == tag;
    resp->addHeader("Cache-Control", versioned ? "public, max-age=31536000, immutable" : "no-cache");
    if (tag.length())
        resp->addHeader("ETag", tag);
    request->send(resp);
}
// Free storage for the pages' meters and the upload checks. LittleFS walks the whole storage to
// count (seconds with many files): done on the web server's task, that tripped the watchdog and
// restarted the machine (2026-10-02, the log's backtrace: lfs_fs_traverse in async_tcp). So
// WebUIPlugin::loop counts (at start, every 30 s, and after a theme or video changes) and the
// server only reads the number.
static volatile size_t storageFreeCache = 0;
static volatile size_t storageTotalCache = 0; // totalBytes() walks the storage too (esp_littlefs_info)
static volatile unsigned long storageFreeAt = 0; // 0: count again
static size_t storageFreeBytes() { return storageFreeCache; }
static size_t storageTotalBytes() { return storageTotalCache; }
// The count runs on its own low-priority task (user 2026-10-09): on the main loop it stopped the
// status stream ~2 s every 30 s, and up to 14 s right after a shot, so the tablet fell behind,
// was cut off and sat reconnecting. It counts at start, when asked, and every 15 minutes in standby.
static TaskHandle_t storageCountTask = nullptr;
// a count is owed (start, a video change, every 15 minutes in standby); a theme change alone doesn't owe one
static volatile bool storageCountDue = true;
// The timed count runs only while the machine is in standby (user 2026-10-20, build 953): the walk holds
// the storage for ~4.9 s. Set by the main loop (WebUIPlugin::loop), read by the background task.
static volatile bool machineInStandby = false;
// true while a walk runs (build 955): sent to the pages with the minutes since the last one
static volatile bool storageWalking = false;
// the timed walk in standby comes this long after the last one ended (build 956: also the countdown)
static constexpr uint32_t WALK_EVERY_MS = 15UL * 60 * 1000;
// when the machine last went into standby (build 957): the first timed walk comes 15 min after that
static volatile unsigned long standbySince = 0;
// Seconds until the timed walk (build 956): -2 none while in use (standby only), -1 not counted yet.
// Counted from the later of the last walk and the start of this standby (build 957).
static int32_t nextWalkSeconds() {
    if (!machineInStandby)
        return -2;
    const unsigned long at = storageFreeAt;
    if (!at)
        return -1;
    const unsigned long sb = standbySince;
    const unsigned long from = (sb && (long)(sb - at) > 0) ? sb : at;
    const uint32_t since = millis() - from;
    return since >= WALK_EVERY_MS ? 0 : (int32_t)((WALK_EVERY_MS - since + 999) / 1000);
}
static void backgroundWake() {
    if (storageCountTask != nullptr)
        xTaskNotifyGive(storageCountTask);
}
static void storageChanged() {
    storageCountDue = true;
    backgroundWake();
}
// A theme's files changed: the free figure moves by their size instead of counting the whole
// storage again (the count after each of a save's 3 writes held the theme list ~20 s, 2026-10-18);
// the count in standby (every 15 minutes) corrects any drift.
static void storageMoved(size_t freed, size_t taken) {
    if (!storageFreeAt)
        return; // not counted yet: the first count sets it
    const size_t f = storageFreeCache + freed;
    const size_t t = storageBlocks(taken);
    storageFreeCache = f > t ? f - t : 0;
}
// For ShotHistoryPlugin's cleanup after every shot (audit S8-M4): the counted figure (0 = not
// counted yet), and what it freed, added without a recount (a recount right after a shot was
// the 14 s freeze).
size_t webStorageFreeCached() { return storageFreeAt ? storageFreeCache : 0; }
void webStorageFreed(size_t bytes) {
    if (storageFreeAt)
        storageFreeCache = storageFreeCache + bytes;
}
static volatile bool customListValid = false; // false: rebuild (WebUIPlugin::loop)
static volatile bool customListReady = false; // a list has been built at least once
static volatile bool customListBuilding = false;
static bool customUploadFailed = false;

static bool isCustomThemeId(const String &id) { return id.length() > 1 && id[0] == 'u' && isThemeName(id); }

static String customTag(const String &id) { return imageTag(("/ct/" + id + "/tag").c_str()); }

static void writeCustomTag(const String &id, size_t size) {
    File tagFile = LittleFS.open("/ct/" + id + "/tag", "w");
    if (tagFile) {
        tagFile.printf("\"%lu-%u\"", millis(), (unsigned)size);
        tagFile.close();
    }
}

// The lists are also kept in files (2026-10-18: every storage lookup takes ~86 ms, so rebuilding
// them at start took ~28 s and the page gave up on the videos; Delongezzi920/921 measurements).
// A start loads the files instead. An edit deletes its file first and the background task writes
// it again once the list is updated, so a file that exists always matches storage; a missing one
// means a full read, as before. SAVED_LISTS_922_PLAN.md.
static constexpr const char *THEMES_FILE = "/lists/themes.json";
static constexpr const char *VIDEOS_FILE = "/lists/videos.json";
static constexpr const char *STORAGE_FILE = "/lists/storage.json";
static constexpr const char *BOOT_FILE = "/lists/boot";
static volatile bool customSaveDue = false;     // the list changed: write its file (background task)
static volatile bool videoSaveDue = false;
static volatile bool themesFileOnDisk = false;  // so an edit deletes it without asking storage first
static volatile bool videosFileOnDisk = false;

static void removeListFile(const char *path) {
    if (LittleFS.exists(path))
        LittleFS.remove(path);
}

// One read into PSRAM (Stream::readString adds one byte at a time).
static String readListFile(const char *path) {
    String text;
    if (!LittleFS.exists(path))
        return text;
    File f = LittleFS.open(path, "r");
    if (!f)
        return text;
    const size_t n = f.size();
    char *buf = (char *)heap_caps_malloc(n + 1, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (buf && f.read((uint8_t *)buf, n) == n) {
        buf[n] = 0;
        text = buf; // one exact block: PSRAM for the ~17 KB theme list (over 4 KB)
    }
    heap_caps_free(buf);
    f.close();
    return text;
}

static bool writeListTmp(const char *path, const String &text) {
    if (!LittleFS.exists("/lists"))
        LittleFS.mkdir("/lists");
    File f = LittleFS.open(String(path) + ".tmp", "w", true);
    const bool ok = f && f.print(text) == text.length();
    if (f)
        f.close();
    return ok;
}
// ok: the .tmp takes the file's place; else the .tmp goes and the file stays deleted
static void commitListTmp(const char *path, bool ok) {
    const String tmp = String(path) + ".tmp";
    removeListFile(path);
    if (ok)
        LittleFS.rename(tmp, path);
    else
        removeListFile(tmp.c_str()); // a half-written or out-of-date file is never used
}

// Reads every custom theme's settings from storage (slow: ~3 lookups of ~86 ms per theme).
// between: called after each theme (the background check does waiting theme edits there).
static void readAllThemes(String &json, std::vector<std::pair<String, String>> &tags, void (*between)() = nullptr) {
    JsonDocument doc(&psramAllocator); // PSRAM: it holds every theme until the end
    JsonArray list = doc.to<JsonArray>();
    File dir = LittleFS.open("/ct");
    if (dir && dir.isDirectory()) {
        for (File d = dir.openNextFile(); d; d = dir.openNextFile()) {
            if (between)
                between();
            if (!d.isDirectory())
                continue;
            const String id = d.name();
            if (!isCustomThemeId(id))
                continue;
            File meta = LittleFS.open("/ct/" + id + "/meta.json", "r");
            if (!meta)
                continue;
            JsonDocument m(&psramAllocator);
            const bool bad = deserializeJson(m, meta) != DeserializationError::Ok;
            meta.close();
            if (bad || !m.is<JsonObject>())
                continue;
            m["id"] = id;
            const String tag = customTag(id);
            m["tag"] = tag;
            tags.emplace_back(id, tag);
            list.add(m);
        }
    }
    json.reserve(measureJson(doc) + 1); // ~17 KB: one block, in PSRAM (over 4 KB)
    serializeJson(doc, json);
}

// The list GET /api/custom-themes answers with, from storage. Slow, so it runs on the background
// task, and only when the saved file is missing.
static void buildCustomList() {
    customListValid = true; // first: a theme saved while this runs marks it stale again
    customListBuilding = true;
    String json;
    std::vector<std::pair<String, String>> tags;
    readAllThemes(json, tags);
    {
        std::lock_guard<std::mutex> lock(customListMutex); // the web server reads it on its own task
        customListJson = std::move(json);
        customListTags.swap(tags);
    }
    customListBuilding = false;
    customSaveDue = true;
}

// A theme saved, given a picture, or deleted (web server's task): only its entry is redone by
// the background task, from its own 2 small files, instead of reading all 20+ themes again
// after each of a save's 3 writes (~20 s of "busy", 2026-10-18).
static String customPatchId;                     // under customListMutex
static uint32_t customPatchSeq = 0;              // under customListMutex: bumped by every change
static volatile bool customPatchBusy = false;    // queued or being redone: the list waits
static volatile unsigned long customPatchAt = 0; // the last change
static void customThemeChanged(const String &id) {
    {
        std::lock_guard<std::mutex> lock(customListMutex);
        if (customPatchBusy && customPatchId != id)
            customListValid = false; // two themes at once (backup import): all are read, as before
        customPatchId = id;
        customPatchSeq++;
        customPatchAt = millis();
        customPatchBusy = true;
        // the saved list no longer matches storage: gone first, written again after the redo
        if (themesFileOnDisk) {
            LittleFS.remove(THEMES_FILE);
            themesFileOnDisk = false;
        }
    }
    backgroundWake();
}

static void patchCustomList() {
    // one save is 3 writes close together (picture, settings, small picture): wait for a quiet
    // second, so every page gets one push and reads the list once, not three times
    while (customPatchBusy && millis() - customPatchAt < 1000)
        vTaskDelay(pdMS_TO_TICKS(100));
    String id;
    uint32_t seq;
    {
        std::lock_guard<std::mutex> lock(customListMutex);
        if (!customPatchBusy)
            return;
        id = customPatchId;
        seq = customPatchSeq;
    }
    bool changed = false;
    if (customListValid && customListReady) { // else the full read covers it
        // the entry exactly as buildCustomList() makes it; none if deleted or no settings yet
        JsonDocument m(&psramAllocator);
        bool has = false;
        const String metaPath = "/ct/" + id + "/meta.json";
        if (LittleFS.exists(metaPath)) {
            File meta = LittleFS.open(metaPath, "r");
            if (meta) {
                has = deserializeJson(m, meta) == DeserializationError::Ok && m.is<JsonObject>();
                meta.close();
            }
        }
        String tag;
        if (has) {
            tag = customTag(id);
            m["id"] = id;
            m["tag"] = tag;
        }
        // only this task writes the list, so it is read here without the lock
        JsonDocument doc(&psramAllocator);
        if (deserializeJson(doc, customListJson) != DeserializationError::Ok || !doc.is<JsonArray>()) {
            customListValid = false; // can't happen; if it does, all are read again
        } else {
            JsonArray list = doc.as<JsonArray>();
            size_t at = list.size();
            for (size_t i = 0; i < list.size(); i++)
                if (list[i]["id"] == id.c_str()) {
                    at = i;
                    break;
                }
            changed = true;
            if (has && at < list.size())
                list[at].set(m); // same place in the list
            else if (has)
                list.add(m);
            else if (at < list.size())
                list.remove(at);
            else
                changed = false; // a picture of a theme without settings yet: nothing listed
            if (changed) {
                String json;
                json.reserve(measureJson(doc) + 1); // ~17 KB: one block, in PSRAM (over 4 KB)
                serializeJson(doc, json);
                std::lock_guard<std::mutex> lock(customListMutex);
                customListJson = std::move(json);
                auto t = std::find_if(customListTags.begin(), customListTags.end(),
                                      [&](const std::pair<String, String> &p) { return p.first == id; });
                if (has && t != customListTags.end())
                    t->second = tag;
                else if (has)
                    customListTags.emplace_back(id, tag);
                else if (t != customListTags.end())
                    customListTags.erase(t);
            }
        }
    }
    {
        std::lock_guard<std::mutex> lock(customListMutex);
        if (customPatchSeq == seq)
            customPatchBusy = false; // changed again meanwhile: the new wake redoes it
    }
    customSaveDue = true; // changed or not: its file was deleted when the edit came in
    if (changed)
        markChanged(CHANGED_THEMES); // every page reads the new list
}

static void serveCustomThemes(AsyncWebServer &server, Controller *controller) {
    // The list of themes is kept in memory and only read again from storage after a theme
    // changes: reading 20+ themes took ~5 s, during which the machine answered nothing else.
    server.on("/api/custom-themes", HTTP_GET, [](AsyncWebServerRequest *request) {
        // Built by WebUIPlugin::loop, never here: on the server's own task the ~5 s it takes
        // stalled every request and the watchdog restarted the machine.
        // not built yet, or a theme just changed and the loop is reading them again: the page
        // asks again a moment later (a stale list made a just-saved theme look unsaved)
        // (or one theme is being redone: about a second, see patchCustomList())
        if (!customListReady || !customListValid || customListBuilding || customPatchBusy) {
            request->send(503, "application/json", "{\"busy\":true}");
            return;
        }
        String themes;
        {
            std::lock_guard<std::mutex> lock(customListMutex);
            themes = customListJson;
        }
        const String out = "{\"themes\":" + themes + ",\"free\":" +
                           String((uint32_t)storageFreeBytes()) + ",\"total\":" +
                           String((uint32_t)storageTotalBytes()) + "}";
        sendNoStore(request, out);
    });

    server.on("/custom/*", HTTP_GET, [](AsyncWebServerRequest *request) {
        const String rel = request->url().substring(strlen("/custom/"));
        const int slash = rel.indexOf('/');
        const String id = slash > 0 ? rel.substring(0, slash) : String();
        // page.webp, or thumb.webp (the theme picker's small picture)
        const bool thumb = rel == id + "/thumb.webp";
        const String path = "/ct/" + id + (thumb ? "/thumb.webp" : "/page.webp");
        if (!isCustomThemeId(id) || (!thumb && rel != id + "/page.webp")) {
            request->send(404);
            return;
        }
        // the tag from the loop's list (no file read); a theme not in it yet: from storage
        String tag;
        bool listed = false;
        {
            std::lock_guard<std::mutex> lock(customListMutex);
            for (const auto &t : customListTags)
                if (t.first == id) {
                    tag = t.second;
                    listed = true;
                    break;
                }
        }
        if (!listed || !customListValid || customPatchBusy)
            tag = customTag(id);
        sendTaggedFile(request, path, "image/webp", tag);
    });

    server.on(
        "/api/custom-theme-file", HTTP_POST,
        [](AsyncWebServerRequest *request) {
            const bool ok = customUploadDir.length() && !customUploadFailed;
            customUploadDir = "";
            request->send(ok ? 200 : 400, "application/json", ok ? "{\"success\":true}" : "{\"success\":false}");
        },
        [](AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final) {
            if (index == 0) {
                if (customUpload)
                    customUpload.close();
                const String id = request->hasArg("id") ? request->arg("id") : String();
                // name=thumb: the theme picker's small picture (thumb.webp), else the picture
                customUploadName = request->hasArg("name") && request->arg("name") == "thumb" ? "thumb" : "page";
                customUploadFailed = !isCustomThemeId(id) ||
                                     storageFreeBytes() < CUSTOM_MIN_FREE_BYTES;
                customUploadDir = customUploadFailed ? String() : "/ct/" + id;
                if (!customUploadFailed) {
                    LittleFS.mkdir("/ct");
                    LittleFS.mkdir(customUploadDir);
                    customUpload = LittleFS.open(customUploadDir + "/" + customUploadName + ".tmp", "w", true);
                    customUploadFailed = !customUpload;
                }
            }
            if (!customUploadFailed && len)
                customUploadFailed = index + len > HOLIDAY_FILE_MAX_BYTES || customUpload.write(data, len) != len;
            if (final) {
                if (customUpload)
                    customUpload.close();
                const String tmp = customUploadDir + "/" + customUploadName + ".tmp";
                const String dest = customUploadDir + "/" + customUploadName + ".webp";
                if (customUploadFailed) {
                    if (customUploadDir.length())
                        LittleFS.remove(tmp);
                } else {
                    size_t old = 0;
                    if (LittleFS.exists(dest)) { // a new theme has none yet
                        File o = LittleFS.open(dest, "r");
                        if (o) {
                            old = o.size();
                            o.close();
                        }
                    }
                    LittleFS.remove(dest);
                    customUploadFailed = !LittleFS.rename(tmp, dest);
                    // the small picture too: a new tag is a new address, so a browser that kept
                    // the old small picture (sendTaggedFile) fetches the new one
                    if (!customUploadFailed)
                        writeCustomTag(customUploadDir.substring(4), index + len);
                    storageMoved(storageBlocks(old), customUploadFailed ? 0 : index + len);
                    customThemeChanged(customUploadDir.substring(4));
                }
            }
        });

    server.on("/api/custom-theme-meta", HTTP_POST, [](AsyncWebServerRequest *request) {
        const String id = request->hasArg("id") ? request->arg("id") : String();
        const String meta = request->hasArg("meta") ? request->arg("meta") : String();
        JsonDocument check;
        if (!isCustomThemeId(id) || meta.isEmpty() || meta.length() > CUSTOM_META_MAX_BYTES ||
            deserializeJson(check, meta) != DeserializationError::Ok || !check.is<JsonObject>() || !LittleFS.exists("/ct/" + id + "/page.webp")) {
            request->send(400, "application/json", "{\"success\":false}");
            return;
        }
        File f = LittleFS.open("/ct/" + id + "/meta.tmp", "w", true);
        const bool ok = f && f.print(meta) == meta.length();
        if (f)
            f.close();
        if (ok) {
            LittleFS.remove("/ct/" + id + "/meta.json");
            LittleFS.rename("/ct/" + id + "/meta.tmp", "/ct/" + id + "/meta.json");
            customThemeChanged(id); // settings are at most 4 KB: the count in standby picks them up
        }
        request->send(ok ? 200 : 500, "application/json", ok ? "{\"success\":true}" : "{\"success\":false}");
    });

    server.on("/api/custom-theme-delete", HTTP_POST, [controller](AsyncWebServerRequest *request) {
        const String id = request->hasArg("id") ? request->arg("id") : String();
        if (!isCustomThemeId(id)) {
            request->send(400, "application/json", "{\"success\":false}");
            return;
        }
        // A permanent theme (meta "permanent": true) can't be deleted: Settings first unticks
        // Permanent (a meta save), then it is an ordinary custom theme again.
        File meta = LittleFS.open("/ct/" + id + "/meta.json", "r");
        if (meta) {
            JsonDocument m;
            const bool ok = deserializeJson(m, meta) == DeserializationError::Ok;
            meta.close();
            if (ok && m["permanent"].as<bool>()) {
                request->send(403, "application/json", "{\"success\":false,\"error\":\"permanent\"}");
                return;
            }
        }
        storageMoved(removeTree("/ct/" + id), 0);
        customThemeChanged(id);
        Settings &settings = controller->getSettings();
        if (settings.getHolidayMode() == id) {
            settings.setHolidayMode("auto");
            settings.save();
            markChanged(CHANGED_SETTINGS);
        }
        request->send(200, "application/json", "{\"success\":true}");
    });
}

// Brew button video library (Settings > Pictures, user 2026-10-02): every brew button video in
// one place, picked in Settings (one, or shuffled each shot) or by a theme. Up to 3 MB of video
// together. Each lives in LittleFS /vid/<id>/: video (MP4/WebM, or animated WebP/GIF), still
// (its first frame, for when the button is idle), name and tag (for the ETag). Ids are "v" +
// lowercase letters (isThemeName). The old single brew button (/brewbtn.img) becomes the
// first video ("vbrew") the first time the loop reads the library.
//   GET  /api/videos                      {videos: [{id, name, size, tag, type, picture?, once?}], used, budget, free}
//   GET  /vid/<id>/video | /vid/<id>/still
//   POST /api/video-file?id=<id>&part=video|still   (multipart); a video that would pass the
//                                         budget is refused: 413 {"error":"budget","left":<bytes>}
//   POST /api/video-name?id=<id>          name=<text, up to 32>
//   POST /api/video-loop?id=<id>          loop=1 (loops while brewing, the default) or 0 (plays once)
//   POST /api/video-delete?id=<id>        removes it (the setting's choice is cleared)
static constexpr size_t VIDEO_BUDGET_BYTES = 3 * 1024 * 1024;
static constexpr size_t VIDEO_STILL_MAX_BYTES = 256 * 1024;
static File videoUpload;
static String videoUploadDir;
static String videoUploadPart = "video";
static bool videoUploadFailed = false;
static bool videoUploadOverBudget = false;
static size_t videoUploadLeft = 0;
static String videoUploadType; // from the upload's first 12 bytes; empty: read it from the file
// GET /api/videos' list and each video's size and tag, read from storage by WebUIPlugin::loop
// (buildVideoList), never on the web server's task: ~5 LittleFS opens per video there held
// async_tcp long enough for the watchdog to restart the machine (2026-10-04 coredump: imageTag
// under the /api/videos handler). Uploads, renames and deletes mark it stale; the page asks
// again on 503 until the loop has read it.
struct VideoEntry {
    String id;
    size_t size = 0;      // the video part
    size_t stillSize = 0; // the still part (a still picture is stored as both parts, same bytes)
    String tag;
    String type;          // content type of the video part
    String name;
    bool once = false;    // plays once and holds the last frame
};
static PsramVector<VideoEntry> videoEntries; // PSRAM: see PsramVector
static String videoListJson;
static std::mutex videoListMutex;
static volatile bool videoListValid = false; // false: rebuild (WebUIPlugin::loop)
static volatile bool videoListReady = false; // a list has been built at least once
static volatile bool videoListBuilding = false;
static uint32_t videoEditSeq = 0; // under videoListMutex: bumped by every video edit

static bool isVideoId(const String &id) { return id.length() > 1 && id[0] == 'v' && isThemeName(id); }

static size_t fileSize(const String &path) {
    File f = LittleFS.open(path, "r");
    const size_t n = f ? f.size() : 0;
    if (f)
        f.close();
    return n;
}

// The bytes all videos take, leaving one id out (the one being replaced), from the loop's list.
static size_t videoBytesUsed(const String &except = String()) {
    size_t used = 0;
    std::lock_guard<std::mutex> lock(videoListMutex);
    for (const VideoEntry &v : videoEntries)
        if (v.id != except)
            used += v.size;
    return used;
}

// GET /api/videos' list from the entries in memory. Caller holds videoListMutex.
static String videoListToJson(const PsramVector<VideoEntry> &entries) {
    JsonDocument doc(&psramAllocator);
    JsonArray list = doc.to<JsonArray>();
    for (const VideoEntry &e : entries) {
        JsonObject v = list.add<JsonObject>();
        v["id"] = e.id;
        v["name"] = e.name.isEmpty() ? e.id : e.name;
        v["size"] = (uint32_t)e.size;
        v["tag"] = e.tag;
        if (e.size == e.stillSize)
            v["picture"] = true;
        v["type"] = e.type;
        if (e.once)
            v["once"] = true;
    }
    String json;
    serializeJson(doc, json);
    return json;
}

// One video changed (upload part, name, loop, delete): change its entry in memory instead of
// rebuilding the whole list from storage (6.8 s a pass, up to 3 passes per upload: 41 x 503 over
// 17 s in the 2026-10-17 log). change() returns false to remove the entry. create: add it when not
// listed yet (uploads). json: rewrite the list; notify: also tell the pages (evt:changed "videos").
template <typename F>
static void editVideo(const String &id, bool create, bool json, bool notify, F change) {
    {
        // the saved list no longer matches storage: gone first, written again once the list is
        // updated (videoSaveDue below); a background check running now drops its result
        std::lock_guard<std::mutex> lock(videoListMutex);
        videoEditSeq++;
        if (videosFileOnDisk) {
            LittleFS.remove(VIDEOS_FILE);
            videosFileOnDisk = false;
        }
    }
    if (!videoListReady || videoListBuilding) { // the full read at start is still running:
        videoListValid = false;                 // read it all again afterwards, as before
        return;
    }
    {
        std::lock_guard<std::mutex> lock(videoListMutex);
        auto it = std::find_if(videoEntries.begin(), videoEntries.end(),
                               [&](const VideoEntry &e) { return e.id == id; });
        if (it == videoEntries.end()) {
            if (!create)
                return;
            videoEntries.push_back(VideoEntry{});
            it = videoEntries.end() - 1;
            it->id = id;
        }
        if (!change(*it))
            videoEntries.erase(it);
        if (json) {
            videoListJson = videoListToJson(videoEntries);
            videoSaveDue = true;
        }
    }
    if (json)
        backgroundWake(); // writes the file
    if (notify)
        markChanged(CHANGED_VIDEOS);
}

static void writeTextFile(const String &path, const String &text) {
    File f = LittleFS.open(path, "w", true);
    if (f) {
        f.print(text);
        f.close();
    }
}

// Moves a file, copying it when the file system won't rename across folders.
static bool moveFile(const String &from, const String &to) {
    if (LittleFS.rename(from, to))
        return true;
    File in = LittleFS.open(from, "r");
    File out = LittleFS.open(to, "w", true);
    bool ok = in && out;
    uint8_t buf[1024];
    while (ok && in.available()) {
        const size_t n = in.read(buf, sizeof(buf));
        ok = n > 0 && out.write(buf, n) == n;
    }
    if (in)
        in.close();
    if (out)
        out.close();
    if (ok)
        LittleFS.remove(from);
    else
        LittleFS.remove(to);
    return ok;
}

// The single brew button picture of before becomes the library's first video.
static void migrateOldBrewButton(Settings &settings) {
    if (!LittleFS.exists(BREW_ANIM_IMAGE.path) || LittleFS.exists("/vid/vbrew/video"))
        return;
    LittleFS.mkdir("/vid");
    LittleFS.mkdir("/vid/vbrew");
    const bool moved = moveFile(BREW_ANIM_IMAGE.path, "/vid/vbrew/video");
    BREW_ANIM_IMAGE.present = -1; // look again: moved away
    if (!moved)
        return;
    if (LittleFS.exists(BREW_STILL_IMAGE.path))
        moveFile(BREW_STILL_IMAGE.path, "/vid/vbrew/still");
    BREW_STILL_IMAGE.present = -1;
    LittleFS.remove(BREW_ANIM_IMAGE.tagPath);
    LittleFS.remove(BREW_STILL_IMAGE.tagPath);
    writeTextFile("/vid/vbrew/name", "Brew button");
    writeTextFile("/vid/vbrew/tag", "\"m-" + String((unsigned)fileSize("/vid/vbrew/video")) + "\"");
    if (settings.getBrewVideo().isEmpty()) {
        settings.setBrewVideo("vbrew");
        settings.save();
    }
}

// Reads the library for GET /api/videos (and moves the old single brew button in first). Runs
// from WebUIPlugin::loop: on the web server's task its file opens tripped the watchdog.
// Every video's facts from storage (slow: ~7 lookups of ~86 ms per video). between: called after
// each video (the background check does waiting theme edits there).
static void readAllVideos(PsramVector<VideoEntry> &entries, void (*between)() = nullptr) {
    File dir = LittleFS.open("/vid");
    if (dir && dir.isDirectory()) {
        for (File d = dir.openNextFile(); d; d = dir.openNextFile()) {
            if (between)
                between();
            const String id = d.name();
            const bool isDir = d.isDirectory();
            d.close();
            if (!isDir || !isVideoId(id) || !LittleFS.exists("/vid/" + id + "/video"))
                continue;
            VideoEntry e;
            e.id = id;
            e.size = fileSize("/vid/" + id + "/video");
            // a still picture is kept as both files, the same bytes: the page shows no play button
            e.stillSize = fileSize("/vid/" + id + "/still");
            e.tag = imageTag(("/vid/" + id + "/tag").c_str());
            e.type = imageContentType(("/vid/" + id + "/video").c_str());
            File n = LittleFS.open("/vid/" + id + "/name", "r");
            e.name = n ? n.readString() : id;
            if (n)
                n.close();
            // plays once and holds its last frame instead of looping (MP4/WebM only)
            e.once = LittleFS.exists("/vid/" + id + "/once");
            entries.push_back(e);
        }
    }
}

// The library GET /api/videos answers with, from storage. Slow, so it runs on the background
// task, and only when the saved file is missing.
static void buildVideoList(Settings &settings) {
    videoListValid = true; // first: a change while this runs marks it stale again
    videoListBuilding = true;
    migrateOldBrewButton(settings);
    PsramVector<VideoEntry> entries;
    readAllVideos(entries);
    const String json = videoListToJson(entries);
    {
        std::lock_guard<std::mutex> lock(videoListMutex); // the web server reads it on its own task
        videoEntries.swap(entries);
        videoListJson = json;
        videoSaveDue = true;
    }
    videoListBuilding = false;
}

// Western and Pizza Friday were built-in themes until 2026-10-05; they are custom themes now
// (uwestern, upizzafriday), so a machine set to the old id follows them there.
static void migrateBuiltInThemes(Settings &settings) {
    const String mode = settings.getHolidayMode();
    const String moved = mode == "western" ? "uwestern" : mode == "pizza" ? "upizzafriday" : "";
    if (moved.isEmpty())
        return;
    settings.setHolidayMode(moved);
    settings.save();
}

// Background worker (user 2026-10-09): the theme list (3.4 s) and the video list (6.8 s) were
// built on the main loop at start and after every theme or video change, which froze the status
// stream to every page for ~10 s. They are built here now, with the storage count, so the main
// loop only asks. It runs at start, when asked (storageChanged()), and every 15 minutes in standby.
static Settings *bgSettings = nullptr;
static volatile bool themesMigrated = false;
// The saved lists (see THEMES_FILE): written on the background task, never over a newer edit.
static void saveThemesFile() {
    String text;
    uint32_t seq;
    {
        std::lock_guard<std::mutex> lock(customListMutex);
        if (customPatchBusy || !customListValid || customListBuilding)
            return; // an edit is still to be done: its own pass saves the list
        text = customListJson;
        seq = customPatchSeq;
    }
    const bool ok = writeListTmp(THEMES_FILE, text);
    std::lock_guard<std::mutex> lock(customListMutex); // edits delete the file under this lock
    const bool current = ok && seq == customPatchSeq && !customPatchBusy;
    commitListTmp(THEMES_FILE, current);
    themesFileOnDisk = current;
}

static void saveVideosFile() {
    String text;
    uint32_t seq;
    {
        std::lock_guard<std::mutex> lock(videoListMutex);
        if (!videoListValid || videoListBuilding)
            return; // a full read is due or running: it saves the list
        text = videoListJson;
        seq = videoEditSeq;
    }
    const bool ok = writeListTmp(VIDEOS_FILE, text);
    std::lock_guard<std::mutex> lock(videoListMutex);
    const bool current = ok && seq == videoEditSeq;
    commitListTmp(VIDEOS_FILE, current);
    videosFileOnDisk = current;
}

static bool loadSavedThemes() {
    String text = readListFile(THEMES_FILE);
    if (text.isEmpty())
        return false;
    JsonDocument doc(&psramAllocator);
    if (deserializeJson(doc, text) != DeserializationError::Ok || !doc.is<JsonArray>())
        return false;
    std::vector<std::pair<String, String>> tags; // the /custom/* pictures' tags, as a full read makes
    for (JsonObject t : doc.as<JsonArray>())
        tags.emplace_back(t["id"].as<String>(), t["tag"].as<String>());
    std::lock_guard<std::mutex> lock(customListMutex);
    customListJson = std::move(text);
    customListTags.swap(tags);
    themesFileOnDisk = true;
    return true;
}

static bool loadSavedVideos() {
    if (LittleFS.exists(BREW_ANIM_IMAGE.path))
        return false; // an old single brew button to move into the library: the full read does it
    String text = readListFile(VIDEOS_FILE);
    if (text.isEmpty())
        return false;
    JsonDocument doc(&psramAllocator);
    if (deserializeJson(doc, text) != DeserializationError::Ok || !doc.is<JsonArray>())
        return false;
    PsramVector<VideoEntry> entries;
    for (JsonObject v : doc.as<JsonArray>()) {
        VideoEntry e;
        e.id = v["id"].as<String>();
        e.name = v["name"].as<String>();
        e.size = v["size"] | 0u;
        // a still picture is stored as both parts, the same size (videoListToJson's "picture")
        e.stillSize = (v["picture"] | false) ? e.size : 0;
        e.tag = v["tag"].as<String>();
        e.type = v["type"].as<String>();
        e.once = v["once"] | false;
        entries.push_back(e);
    }
    std::lock_guard<std::mutex> lock(videoListMutex);
    videoEntries.swap(entries);
    videoListJson = std::move(text);
    videosFileOnDisk = true;
    return true;
}

// "MB available" from the start; the first storage count corrects it
static void loadSavedStorage() {
    const String text = readListFile(STORAGE_FILE);
    JsonDocument doc(&psramAllocator);
    if (text.isEmpty() || deserializeJson(doc, text) != DeserializationError::Ok)
        return;
    storageFreeCache = doc["free"] | 0u;
    storageTotalCache = doc["total"] | 0u;
}

// After a power-on or another build (the start number didn't follow on), the loaded lists are
// compared with storage in the background; nobody waits. An edit meanwhile keeps the list right
// on its own, so this result is then dropped and the check runs again on the next pass.
// Returns true when both lists were compared to the end.
static bool checkSavedLists(bool themes, bool videos) {
    bool complete = true;
    if (themes) {
        uint32_t seq;
        {
            std::lock_guard<std::mutex> lock(customListMutex);
            seq = customPatchSeq;
        }
        String json;
        std::vector<std::pair<String, String>> tags;
        readAllThemes(json, tags, patchCustomList); // a theme edit meanwhile is done in between
        bool changed = false;
        {
            std::lock_guard<std::mutex> lock(customListMutex);
            if (seq != customPatchSeq || customPatchBusy || !customListValid) {
                complete = false;
            } else if (json != customListJson) {
                customListJson = std::move(json);
                customListTags.swap(tags);
                changed = true;
                if (themesFileOnDisk) { // out of date: gone before anything else is saved
                    LittleFS.remove(THEMES_FILE);
                    themesFileOnDisk = false;
                }
            }
        }
        if (changed) {
            customSaveDue = true;
            markChanged(CHANGED_THEMES);
        }
    }
    if (videos) {
        uint32_t seq;
        {
            std::lock_guard<std::mutex> lock(videoListMutex);
            seq = videoEditSeq;
        }
        PsramVector<VideoEntry> entries;
        readAllVideos(entries, patchCustomList);
        const String json = videoListToJson(entries);
        bool changed = false;
        {
            std::lock_guard<std::mutex> lock(videoListMutex);
            if (seq != videoEditSeq || !videoListValid || videoListBuilding) {
                complete = false;
            } else if (json != videoListJson) {
                videoEntries.swap(entries);
                videoListJson = json;
                changed = true;
                if (videosFileOnDisk) {
                    LittleFS.remove(VIDEOS_FILE);
                    videosFileOnDisk = false;
                }
            }
        }
        if (changed) {
            videoSaveDue = true;
            markChanged(CHANGED_VIDEOS);
        }
    }
    return complete;
}

static uint32_t bootNumber = 0;
// this start's number, saved only while the lists on storage match it (see backgroundWork)
static void saveBootNumber() {
    if (writeListTmp(BOOT_FILE, String(bootNumber)))
        commitListTmp(BOOT_FILE, true);
}

// Fills the PSRAM copy of small pictures for sendSmallPicture() (2026-10-20, THEME_PICS_950_PLAN.md,
// option 2). Runs at the end of backgroundWork(), only when no list work is pending (a theme save's
// patch always goes first) and only after 5 s of quiet: LittleFS can't replace a file that is open,
// so a read here must never meet a save swapping that picture. At most 3 files per call; it wakes
// itself while it is quiet and untried pictures are left, so other work gets its turn in between.
// A changed picture is copied on the next quiet pass (the 5-minute wake at the latest); until then
// it is sent from storage, as before.
static void fillSmallPictures(bool listsSettled) {
    static uint32_t seenVideoSeq = 0;
    static unsigned long videoChangeAt = 0; // 0: no video edit seen since start
    static bool videoSeqKnown = false;
    static bool spaceFreed = false;
    if (!listsSettled || customPatchBusy || !customListValid || customListBuilding || !videoListValid ||
        videoListBuilding)
        return;
    const unsigned long now = millis();
    using PathTag = std::pair<PsramString, PsramString>;
    std::vector<PathTag, PsramStlAllocator<PathTag>> wanted; // storage path -> current tag
    unsigned long themeChangeAt;
    size_t themeCount;
    {
        std::lock_guard<std::mutex> lock(customListMutex);
        themeChangeAt = customPatchAt;
        for (const auto &t : customListTags) {
            PsramString p("/ct/");
            p += t.first.c_str();
            p += "/thumb.webp";
            wanted.emplace_back(std::move(p), PsramString(t.second.c_str()));
        }
        themeCount = wanted.size();
    }
    uint32_t videoSeq;
    {
        std::lock_guard<std::mutex> lock(videoListMutex);
        videoSeq = videoEditSeq;
        // every video, not only those with stillSize: the saved list leaves it 0 for real videos
        for (const VideoEntry &v : videoEntries) {
            PsramString p("/vid/");
            p += v.id.c_str();
            p += "/still";
            wanted.emplace_back(std::move(p), PsramString(v.tag.c_str()));
        }
    }
    if (!videoSeqKnown) { // the first pass after a start doesn't wait
        videoSeqKnown = true;
        seenVideoSeq = videoSeq;
    } else if (videoSeq != seenVideoSeq) {
        seenVideoSeq = videoSeq;
        videoChangeAt = now | 1;
    }
    const bool themesQuiet = themeChangeAt == 0 || now - themeChangeAt >= 5000;
    const bool videosQuiet = videoChangeAt == 0 || now - videoChangeAt >= 5000;
    // drop copies no longer listed or of another tag (no file is touched), and make due retries untried
    unsigned dropped = 0;
    {
        std::lock_guard<std::mutex> lock(smallPicturesMutex);
        for (auto it = smallPictures.begin(); it != smallPictures.end();) {
            const auto w =
                std::find_if(wanted.begin(), wanted.end(), [&](const PathTag &p) { return p.first == it->first; });
            const SmallPicture &pic = it->second;
            const bool stale = w == wanted.end() || w->second != pic.tag;
            const bool retry = (pic.why == SmallPicture::OverBudget && spaceFreed) ||
                               ((pic.why == SmallPicture::NoRoom || pic.why == SmallPicture::ReadError) &&
                                now - pic.triedAt >= 5UL * 60 * 1000);
            if (stale || retry) {
                if (stale && pic.bytes)
                    dropped++;
                smallPicturesBytes -= pic.len;
                it = smallPictures.erase(it);
            } else {
                ++it;
            }
        }
    }
    spaceFreed = dropped > 0; // the next pass tries the "over budget" ones again
    unsigned loaded = 0, failed = 0, tries = 0;
    bool more = false;
    for (size_t i = 0; i < wanted.size(); i++) {
        if (!(i < themeCount ? themesQuiet : videosQuiet))
            continue; // a save may still be writing: the next quiet pass
        const PathTag &w = wanted[i];
        {
            std::lock_guard<std::mutex> lock(smallPicturesMutex);
            if (smallPictures.find(w.first) != smallPictures.end())
                continue; // tried for this tag (other tags were dropped above)
        }
        if (tries == 3) {
            more = true;
            break;
        }
        tries++;
        SmallPicture pic;
        pic.tag = w.second;
        pic.triedAt = now;
        File f = LittleFS.open(w.first.c_str(), "r");
        if (!f || f.isDirectory()) {
            pic.why = SmallPicture::NoFile;
        } else {
            const size_t size = f.size();
            size_t used;
            {
                std::lock_guard<std::mutex> lock(smallPicturesMutex);
                used = smallPicturesBytes;
            }
            if (size == 0) {
                pic.why = SmallPicture::Empty;
            } else if (size > SMALL_PICTURE_MAX) {
                pic.why = SmallPicture::TooBig;
            } else if (used + size > SMALL_PICTURES_BUDGET) {
                pic.why = SmallPicture::OverBudget;
            } else if (auto *raw = static_cast<uint8_t *>(heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT))) {
                if (f.read(raw, size) == size) {
                    pic.bytes = std::shared_ptr<uint8_t>(raw, heap_caps_free, PsramStlAllocator<uint8_t>());
                    pic.len = size;
                    pic.why = SmallPicture::Loaded;
                } else {
                    heap_caps_free(raw);
                    pic.why = SmallPicture::ReadError;
                }
            } else {
                pic.why = SmallPicture::NoRoom; // PSRAM full: never into fast memory
            }
        }
        if (f)
            f.close();
        (pic.why == SmallPicture::Loaded ? loaded : failed)++;
        std::lock_guard<std::mutex> lock(smallPicturesMutex);
        smallPicturesBytes += pic.len;
        smallPictures[w.first] = std::move(pic);
    }
    if (more)
        backgroundWake(); // quiet and more untried: straight back, other work gets its turn first
    // the PICS cache line was removed in build 967 (2026-10-22)
}

static void backgroundWork() {
    static bool started = false;
    static bool checkThemes = false;
    static bool checkVideos = false;
    if (!started) {
        started = true;
        // the saved lists first: the pages wait for these
        if (loadSavedThemes()) {
            customListValid = true;
            customListReady = true;
            checkThemes = true;
        }
        if (loadSavedVideos()) {
            videoListValid = true;
            videoListReady = true;
            checkVideos = true;
        }
        loadSavedStorage();
        // the same firmware has run since the lists were saved: this start's number is the next one
        bootNumber = dlzlog_bootCount();
        const String saved = readListFile(BOOT_FILE);
        if (saved.length() && (uint32_t)saved.toInt() + 1 == bootNumber)
            checkThemes = checkVideos = false; // a plain restart: nothing can have changed them
    }
    if (!customListValid) {
        const bool again = customListReady;
        buildCustomList();
        customListReady = true;
        if (again)
            markChanged(CHANGED_THEMES); // a change, not the first read at start
    }
    patchCustomList(); // a theme saved or deleted: only its entry
    if (!themesMigrated && bgSettings != nullptr) {
        migrateBuiltInThemes(*bgSettings);
        themesMigrated = true;
    }
    if (!videoListValid && bgSettings != nullptr) {
        const bool again = videoListReady;
        buildVideoList(*bgSettings);
        videoListReady = true;
        if (again)
            markChanged(CHANGED_VIDEOS);
    }
    if (checkThemes || checkVideos) {
        if (checkSavedLists(checkThemes, checkVideos)) {
            checkThemes = checkVideos = false;
        }
    }
    if (customSaveDue) {
        customSaveDue = false;
        saveThemesFile();
    }
    if (videoSaveDue) {
        videoSaveDue = false;
        saveVideosFile();
    }
    // the check is done (or wasn't needed) and the lists are saved: the next plain restart may skip it
    static bool bootSaved = false;
    if (!bootSaved && !checkThemes && !checkVideos) {
        bootSaved = true;
        saveBootNumber();
    }
    // by time since the last count, so regular wakes (theme edits) can't keep putting it off; only in
    // standby (build 953), so the ~4.9 s walk doesn't hold storage while the machine is in use
    if (nextWalkSeconds() == 0) // in standby, 15 min after the later of the last walk and entering standby
        storageCountDue = true;
    if (storageCountDue) {
        storageCountDue = false;
        storageWalking = true;
        const size_t total = LittleFS.totalBytes();
        storageFreeCache = total - LittleFS.usedBytes();
        storageTotalCache = total;
        storageFreeAt = millis() | 1;
        storageWalking = false;
        if (writeListTmp(STORAGE_FILE, "{\"free\":" + String((uint32_t)storageFreeCache) + ",\"total\":" +
                                           String((uint32_t)storageTotalCache) + "}"))
            commitListTmp(STORAGE_FILE, true);
    }
    // last: small pictures into PSRAM, after any list work of this pass (2026-10-20)
    fillSmallPictures(!checkThemes && !checkVideos);
}
static void storageCountLoop(void *) {
    for (;;) {
        backgroundWork();
        // in standby, wake right when the timed walk is due (build 956), so the countdown shown is exact
        uint32_t wait = 5UL * 60 * 1000;
        const int32_t due = nextWalkSeconds();
        if (due >= 0 && (uint32_t)due * 1000 < wait)
            wait = (uint32_t)due * 1000 + 50;
        ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(wait));
    }
}
static void startStorageCount(Settings &settings) {
    if (storageCountTask == nullptr) {
        bgSettings = &settings;
        // Core 0 again (user 2026-10-14): on core 1 it shared the core with the status sender and
        // a WebSocket close race crashed there (loopTask, broadcastStatus) right after the move.
        // Known risk on core 0: a storage read or write stalls the OTHER core through its tiny
        // 1 KB "ipc" task; from core 0 that is ipc1, and the pump's zero-cross interrupt
        // (100-250/s, core 1) landing on it overflowed it at startup (crash report 2026-10-14:
        // ipc1 DoubleException, gpio_isr_loop on its stack; IPC_HELPER_PLAN.txt). Stack: ~3 KB used.
        // 5120, was 4096 (2026-10-20, build 951): with the picture fill (950) the lowest spare reached
        // 756 B in the 20-restart test; 1 KB more fast memory for a safe margin.
        xTaskCreatePinnedToCore(storageCountLoop, "WebBackground", 5120, nullptr, 1, &storageCountTask, 0);
    }
}

static void serveVideoLibrary(AsyncWebServer &server, Controller *controller) {
    server.on("/api/videos", HTTP_GET, [](AsyncWebServerRequest *request) {
        if (!videoListReady || !videoListValid || videoListBuilding) {
            request->send(503, "application/json", "{\"busy\":true}");
            return;
        }
        String videos;
        {
            std::lock_guard<std::mutex> lock(videoListMutex);
            videos = videoListJson;
        }
        const String out = "{\"videos\":" + videos + ",\"used\":" + String((uint32_t)videoBytesUsed()) +
                           ",\"budget\":" + String((uint32_t)VIDEO_BUDGET_BYTES) +
                           ",\"free\":" + String((uint32_t)storageFreeBytes()) + "}";
        sendNoStore(request, out);
    });
    server.on("/vid/*", HTTP_GET, [](AsyncWebServerRequest *request) {
        const String rel = request->url().substring(strlen("/vid/"));
        const int slash = rel.indexOf('/');
        const String id = slash > 0 ? rel.substring(0, slash) : String();
        const String part = slash > 0 ? rel.substring(slash + 1) : String();
        const String path = "/vid/" + id + "/" + part;
        if (!isVideoId(id) || (part != "video" && part != "still")) {
            request->send(404);
            return;
        }
        // tag and type from the loop's list (no file reads); not listed yet: from storage
        String tag;
        String type;
        {
            std::lock_guard<std::mutex> lock(videoListMutex);
            for (const VideoEntry &v : videoEntries)
                if (v.id == id) {
                    tag = v.tag;
                    type = part == "video" ? v.type : String("image/webp");
                    break;
                }
        }
        if (type.isEmpty() || !videoListValid) {
            tag = imageTag(("/vid/" + id + "/tag").c_str());
            type = imageContentType(path.c_str());
        }
        sendTaggedFile(request, path, type.c_str(), tag);
    });
    server.on(
        "/api/video-file", HTTP_POST,
        [](AsyncWebServerRequest *request) {
            const bool ok = videoUploadDir.length() && !videoUploadFailed;
            videoUploadDir = "";
            if (ok) {
                request->send(200, "application/json", "{\"success\":true}");
            } else if (videoUploadOverBudget) {
                request->send(413, "application/json",
                              "{\"success\":false,\"error\":\"budget\",\"left\":" + String((unsigned)videoUploadLeft) + "}");
            } else {
                request->send(400, "application/json", "{\"success\":false}");
            }
        },
        [](AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final) {
            if (index == 0) {
                if (videoUpload)
                    videoUpload.close();
                const String id = request->hasArg("id") ? request->arg("id") : String();
                videoUploadPart = request->hasArg("part") && request->arg("part") == "still" ? "still" : "video";
                videoUploadOverBudget = false;
                videoUploadType = len >= 12 ? String(contentTypeOf(data)) : String();
                const size_t used = videoBytesUsed(id);
                videoUploadLeft = used < VIDEO_BUDGET_BYTES ? VIDEO_BUDGET_BYTES - used : 0;
                videoUploadFailed = !isVideoId(id) ||
                                    storageFreeBytes() < CUSTOM_MIN_FREE_BYTES;
                videoUploadDir = videoUploadFailed ? String() : "/vid/" + id;
                if (!videoUploadFailed) {
                    LittleFS.mkdir("/vid");
                    LittleFS.mkdir(videoUploadDir);
                    videoUpload = LittleFS.open(videoUploadDir + "/" + videoUploadPart + ".tmp", "w", true);
                    videoUploadFailed = !videoUpload;
                }
            }
            if (!videoUploadFailed && len) {
                const size_t limit = videoUploadPart == "video" ? videoUploadLeft : VIDEO_STILL_MAX_BYTES;
                if (index + len > limit) {
                    videoUploadFailed = true;
                    videoUploadOverBudget = videoUploadPart == "video";
                } else {
                    videoUploadFailed = videoUpload.write(data, len) != len;
                }
            }
            if (final) {
                if (videoUpload)
                    videoUpload.close();
                const String tmp = videoUploadDir + "/" + videoUploadPart + ".tmp";
                if (videoUploadFailed) {
                    if (videoUploadDir.length())
                        LittleFS.remove(tmp);
                } else {
                    const String dest = videoUploadDir + "/" + videoUploadPart;
                    LittleFS.remove(dest);
                    videoUploadFailed = !LittleFS.rename(tmp, dest);
                    storageChanged();
                    if (!videoUploadFailed) {
                        const String tag = "\"" + String(millis()) + "-" + String((unsigned)(index + len)) + "\"";
                        writeTextFile(videoUploadDir + "/tag", tag);
                        // the list in memory, at once (no full read): the video part adds the entry
                        // (its still is not there yet), the still part writes the list, the name
                        // that follows tells the pages (2026-10-17)
                        const String id = videoUploadDir.substring(strlen("/vid/"));
                        const size_t n = index + len;
                        const bool still = videoUploadPart == "still";
                        const String type = videoUploadType.length() ? videoUploadType : String(imageContentType(dest.c_str()));
                        editVideo(id, true, still, false, [&](VideoEntry &e) {
                            (still ? e.stillSize : e.size) = n;
                            e.tag = tag;
                            if (!still)
                                e.type = type;
                            return true;
                        });
                    }
                }
            }
        });
    server.on("/api/video-name", HTTP_POST, [](AsyncWebServerRequest *request) {
        const String id = request->hasArg("id") ? request->arg("id") : String();
        String name = request->hasArg("name") ? request->arg("name") : String();
        name.trim();
        if (!isVideoId(id) || !LittleFS.exists("/vid/" + id) || name.isEmpty()) {
            request->send(400, "application/json", "{\"success\":false}");
            return;
        }
        writeTextFile("/vid/" + id + "/name", name.substring(0, 32));
        editVideo(id, false, true, true, [&](VideoEntry &e) {
            e.name = name.substring(0, 32);
            return true;
        });
        request->send(200, "application/json", "{\"success\":true}");
    });
    server.on("/api/video-loop", HTTP_POST, [](AsyncWebServerRequest *request) {
        const String id = request->hasArg("id") ? request->arg("id") : String();
        if (!isVideoId(id) || !LittleFS.exists("/vid/" + id) || !request->hasArg("loop")) {
            request->send(400, "application/json", "{\"success\":false}");
            return;
        }
        const bool once = request->arg("loop") == "0";
        if (once)
            writeTextFile("/vid/" + id + "/once", "1");
        else
            LittleFS.remove("/vid/" + id + "/once");
        editVideo(id, false, true, true, [&](VideoEntry &e) {
            e.once = once;
            return true;
        });
        request->send(200, "application/json", "{\"success\":true}");
    });
    server.on("/api/video-delete", HTTP_POST, [controller](AsyncWebServerRequest *request) {
        const String id = request->hasArg("id") ? request->arg("id") : String();
        if (!isVideoId(id)) {
            request->send(400, "application/json", "{\"success\":false}");
            return;
        }
        removeTree("/vid/" + id);
        storageChanged();
        editVideo(id, false, true, true, [](VideoEntry &) { return false; });
        Settings &settings = controller->getSettings();
        if (settings.getBrewVideo() == id) {
            settings.setBrewVideo("");
            settings.save();
            markChanged(CHANGED_SETTINGS);
        }
        request->send(200, "application/json", "{\"success\":true}");
    });
}

// Restart a moment later, so the answer to the current request reaches the page
// first; restarting right away cut it off. A Wi-Fi save on the hotspot waits 5 s, so the
// phone has time to show where to find the machine next (user 2026-10-14).
static void restartSoon(uint32_t delayMs = 1000) {
    xTaskCreate(
        [](void *arg) {
            vTaskDelay(pdMS_TO_TICKS((uint32_t)(uintptr_t)arg));
            ESP.restart();
        },
        "settingsRestart", 4096, (void *)(uintptr_t)delayMs, 1, nullptr);
}

static AsyncWebSocketSharedBuffer toWsBuffer(JsonDocument &doc) {
    const size_t len = measureJson(doc);
    auto buffer = makePsramWsBuffer(len);
    serializeJson(doc, buffer->data(), len);
    return buffer;
}

// Route mbedTLS allocations to PSRAM.
static void *mbedtlsPsramCalloc(size_t n, size_t size) { // NOSONAR
    void *p = heap_caps_calloc(n, size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (p == nullptr) {
        p = heap_caps_calloc(n, size, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    }
    return p;
}
static void mbedtlsPsramFree(void *p) { heap_caps_free(p); } // NOSONAR

WebUIPlugin::WebUIPlugin() : server(80), ws("/ws") { g_webUIPlugin = this; }

void WebUIPlugin::setup(Controller *_controller, PluginManager *_pluginManager) {
    // Redirect mbedTLS allocations to PSRAM before any TLS (OTA) handshake runs, so the
    // ~32 KB handshake buffers don't exhaust the scarce internal-DRAM pool. See mbedtlsPsramCalloc.
    (void)mbedtls_platform_set_calloc_free(mbedtlsPsramCalloc, mbedtlsPsramFree);
    this->controller = _controller;
    this->profileManager = _controller->getProfileManager();
    this->pluginManager = _pluginManager;
    this->ota = new GitHubOTA(
        BUILD_GIT_VERSION, controller->getSystemInfo().version,
        RELEASE_URL + (controller->getSettings().getOTAChannel() == "latest" ? "latest" : "tag/nightly"),
        [this](uint8_t phase) {
            pluginManager->trigger("ota:update:phase", "phase", phase);
            updateOTAProgress(phase, 0);
        },
        [this](uint8_t phase, int progress) {
            pluginManager->trigger("ota:update:progress", "progress", progress);
            updateOTAProgress(phase, progress);
        },
        "display-firmware.bin", "display-filesystem.bin", "board-firmware.bin");
    pluginManager->on("controller:wifi:connect", [this](Event const &event) {
        apMode = event.getInt("AP");
        start();
    });
    // Intentionally do NOT stop the server on a WiFi disconnect: the listen
    // socket survives a reconnect, and tearing it down only to rebind moments
    // later races AsyncTCP's async close (bind: -8) and churns sockets in the
    // recovery path. The server keeps listening; clients reconnect on their own.
    pluginManager->on("controller:wifi:disconnect", [this](Event const &) {
        ws.cleanupClients(); // drop dead websocket clients; keep the listener up
    });
    pluginManager->on("controller:ready", [this](Event const &) {
        ota->setControllerVersion(controller->getSystemInfo().version);
#ifdef GAGGIMATE_MERGED
        // Single-board build: no BLE client (loopback link), so controller OTA
        // over BLE is unavailable. Flashing is by USB wire only.
        return;
#else
        ota->init(controller->getClientController()->getClient());
#endif
    });
    pluginManager->on("controller:autotune:result", [this](Event const &event) {
        sendAutotuneResult();
        markChanged(CHANGED_SETTINGS); // new PID: open Settings pages take it in
    });
    // A brew/grind delay learned after a shot (Controller::loopLogic).
    pluginManager->on("controller:settings:learned", [](Event const &) { markChanged(CHANGED_SETTINGS); });
    pluginManager->on("controller:autotune:failed", [this](Event const &) { sendAutotuneFailed(); });

    // Forward shot history rebuild progress events to WebSocket clients
    pluginManager->on("evt:history-rebuild-progress", [this](Event const &event) {
        JsonDocument doc(&psramAllocator);
        doc["tp"] = "evt:history-rebuild-progress";
        doc["total"] = event.getInt("total");
        doc["current"] = event.getInt("current");
        doc["status"] = event.getString("status");
        broadcastJson(doc);
    });

    // Forward "shot saved to history" events to WebSocket clients, so the
    // dashboard can refetch the recent-shots buffer at the right time.
    pluginManager->on("evt:history-shot-saved", [this](Event const &event) {
        JsonDocument doc(&psramAllocator);
        doc["tp"] = "evt:history-shot-saved";
        doc["id"] = event.getInt("id");
        broadcastJson(doc);
    });

    // Forward live shot-finished stats (pressure/flow) to WebSocket clients, so
    // the dashboard's finished card can show them without waiting for the
    // history file write.
    pluginManager->on("evt:shot-finished-stats", [this](Event const &event) {
        JsonDocument doc(&psramAllocator);
        doc["tp"] = "evt:shot-finished-stats";
        doc["maxPressure"] = event.getFloat("maxPressure");
        doc["avgFlow"] = event.getFloat("avgFlow");
        broadcastJson(doc);
    });

    // Subscribe to Bluetooth scale weight updates
    pluginManager->on("controller:volumetric-measurement:bluetooth:change",
                      [this](Event const &event) { this->currentBluetoothWeight = event.getFloat("value"); });

    setupServer();
}

void WebUIPlugin::loop() {
    // first, before any early return: kept right while the server is down too (build 953)
    const bool standby = controller->getMode() == MODE_STANDBY;
    if (standby && !machineInStandby) {
        standbySince = millis() | 1; // build 957: the first walk comes 15 min into standby
        backgroundWake();            // the task re-times its sleep to that moment
    }
    machineInStandby = standby;
    if (updating) {
        // Pass which component is being flashed: a controller update streams the
        // firmware over BLE (wants a low-latency link), a display update is over
        // Wi-Fi (wants BLE to stay out of the radio's way). "" = both.
        pluginManager->trigger("ota:update:start", "component", updateComponent);
        ota->update(updateComponent != "display", updateComponent != "controller");
        pluginManager->trigger("ota:update:end");
        updating = false;
    }
    if (!serverRunning) {
        return;
    }
    // The theme and video lists are built by the background worker; here we only ask.
    startStorageCount(controller->getSettings());
    if (!customListValid || !videoListValid || !themesMigrated)
        storageChanged();
    // after the lists are rebuilt, so a page that asks again gets the new ones
    if (const uint8_t changed = __atomic_exchange_n(&changedBits, 0, __ATOMIC_SEQ_CST); changed && !ws.getClients().empty()) {
        JsonDocument doc;
        doc["tp"] = "evt:changed";
        JsonArray what = doc["what"].to<JsonArray>();
        if (changed & CHANGED_SETTINGS)
            what.add("settings");
        if (changed & CHANGED_THEMES)
            what.add("themes");
        if (changed & CHANGED_VIDEOS)
            what.add("videos");
        // a theme pick: the new value travels in the message, so no page reads it back (2026-10-16)
        if (changed & CHANGED_THEME_PICK) {
            what.add("theme");
            Settings &s = controller->getSettings();
            doc["holidayMode"] = s.getHolidayMode();
            doc["keepTheme"] = s.isKeepTheme();
        }
        ws.textAll(toWsBuffer(doc));
        reqLogAdd(0, "-- changed sent"); // marker in the request log
    }
    const unsigned long now = millis();
    // PERIODIC OTA CHECK DISABLED (2026-10-12) — this build is "update by wire
    // only" (OTA start is blocked in handleWebSocketData), so the check serves
    // nothing but a cosmetic badge — yet it runs a blocking mbedTLS TLS
    // handshake on the loop task, whose 6 KB stack sits at 6000/6144 of use
    // (both 2026-10-12 crash cores: loopTask StackOverflow/DoubleException,
    // sp 64 B past the stack bottom, at ~30 min uptime = the UPDATE_CHECK
    // INTERVAL fire). Even gated to "no clients connected", a BLE scan burst
    // (scale absent → 8 s scan hunts the radio) starves WiFi long enough to
    // drop every WS client → the gate opens → the check runs on the shaved
    // stack → reset. A user-triggered check would need a dedicated task with
    // its own stack; until then the badge stays stale.
    // if (!controller->isActive() && ws.getClients().empty() &&
    //     (lastUpdateCheck == 0 || now - lastUpdateCheck > UPDATE_CHECK_INTERVAL)) {
    //     const unsigned long t = millis();
    //     ota->checkForUpdates();
    //     noteSlow("update check", nullptr, millis() - t);
    //     pluginManager->trigger("ota:update:status", "value", ota->isUpdateAvailable());
    //     lastUpdateCheck = now;
    //     updateOTAStatus(ota->getCurrentVersion());
    // }
    if (now > lastStatus + STATUS_PERIOD && !ws.getClients().empty()) {
        lastStatus = now;
        statusDoc.clear();
        statusDoc["tp"] = "evt:status";
        statusDoc["ct"] = controller->getCurrentTemp();
        statusDoc["tt"] = controller->getTargetTemp();
        statusDoc["pr"] = controller->getCurrentPressure();
        statusDoc["fl"] = controller->getCurrentPumpFlow();
        statusDoc["pt"] = controller->getTargetPressure();
        statusDoc["m"] = controller->getMode();
        // storage walk (build 955): minutes since the last one ended (-1: none yet), 1 while one runs
        statusDoc["sw"] = storageFreeAt ? (int)((millis() - storageFreeAt) / 60000) : -1;
        statusDoc["wk"] = storageWalking ? 1 : 0;
        statusDoc["nw"] = nextWalkSeconds(); // build 956: seconds until the next timed walk (-2 not while in use)
        statusDoc["mp"] = controller->getManualPressureTarget();
        statusDoc["mw"] = controller->getManualWeightTarget();
        statusDoc["wm"] = controller->getWakeMode(); // the web "Wake machine" button wakes into this
        statusDoc["p"] = controller->getProfileManager()->getSelectedProfile().label;
        statusDoc["puid"] = controller->getProfileManager()->getSelectedProfile().id;
        statusDoc["cp"] = true; // local pressure sensor present
        statusDoc["cd"] = controller->getSystemInfo().capabilities.dimming;
        statusDoc["gp"] = controller->getSystemInfo().capabilities.hasAddon(7);
        statusDoc["tw"] = profileManager->getSelectedProfile().getTotalVolume(); // total target weight for the process
        statusDoc["bta"] = controller->isVolumetricAvailable() ? 1 : 0;
        statusDoc["bt"] =
            controller->isVolumetricAvailable() && controller->getProfileManager()->getSelectedProfile().isVolumetric() ? 1 : 0;
        statusDoc["btd"] = profileManager->getSelectedProfile().getTotalDuration();
        statusDoc["led"] = controller->getSystemInfo().capabilities.ledControl;
        statusDoc["gtd"] = controller->getTargetGrindDuration();
        statusDoc["gtv"] = controller->getSettings().getTargetGrindVolume();
        statusDoc["gt"] = controller->isVolumetricAvailable() && controller->getSettings().isVolumetricTarget() ? 1 : 0;
        statusDoc["gact"] = controller->isGrindActive() ? 1 : 0;
        statusDoc["wl"] = (gWaterLevel != nullptr && gWaterLevel->getPercent() >= 0)
                              ? gWaterLevel->getPercent()
                              : controller->getWaterLevel();
        statusDoc["tof"] = controller->getTofDistance();
        statusDoc["rssi"] = 0;
        statusDoc["lat"] = -1; // BLE round-trip latency (ms); -1 = not yet measured
        statusDoc["pw"] = controller->getCurrentPumpPower();
        statusDoc["hp"] = controller->getCurrentHeaterPower();
        statusDoc["err"] = controller->getError(); // 0 = fine; latched until a restart (Controller::onError)

        if (controller->getClientController()->getClient() != nullptr &&
            controller->getClientController()->getClient()->isConnected()) {
            statusDoc["rssi"] = controller->getClientController()->getClient()->getRssi();
        }
        if (controller->getClientController()->hasLatency()) {
            statusDoc["lat"] = controller->getClientController()->getLatencyMs();
        }

        bool bleConnected = BLEScales.isConnected();
        // Add Bluetooth scale weight information
        statusDoc["bw"] = bleConnected ? this->currentBluetoothWeight : 0; // current bluetooth weight
        statusDoc["cw"] = bleConnected ? this->currentBluetoothWeight : 0; // Use 'currentWeight' for forward compatbility
        statusDoc["bc"] = bleConnected;                                    // bluetooth scale connected status
        // Scale battery — only surfaced when the driver reports one and the
        // value isn't the UNKNOWN sentinel (255). UI omits the battery pill
        // entirely when `sbat` is absent, so disconnected/unknown scales don't
        // render a stale stub.
        if (bleConnected && BLEScales.hasBatteryLevel()) {
            const uint8_t pct = BLEScales.getBatteryLevel();
            if (pct != REMOTE_SCALES_BATTERY_UNKNOWN) {
                statusDoc["sbat"] = pct;
            }
        }

        // Deref under the process lock — other tasks delete the process at any time (GM-147).
        // Released before broadcastJson so the ws send never runs under the lock.
        std::unique_lock<std::recursive_mutex> processGuard(controller->getProcessLock());
        Process *process = controller->getProcess();
        if (process == nullptr) {
            process = controller->getLastProcess();
        }
        if (process != nullptr) {
            auto pObj = statusDoc["process"].to<JsonObject>();
            pObj["a"] = controller->isActive() ? 1 : 0;
            statusDoc["pkr"] = controller->getCurrentPuckResistance();
            statusDoc["pf"] = controller->getCurrentPuckFlow();
            statusDoc["tf"] = controller->getTargetFlow();
            if (process->getType() == MODE_BREW) {
                auto *brew = static_cast<BrewProcess *>(process);
                unsigned long ts = brew->isActive() && controller->isActive() ? millis() : brew->finished;
                pObj["s"] = brew->currentPhase.phase == PhaseType::PHASE_TYPE_BREW ? "brew" : "infusion";
                pObj["l"] = brew->isActive() ? brew->currentPhase.name.c_str() : "Finished";
                pObj["e"] = ts - brew->processStarted;
                const bool isVolumetric = brew->target == ProcessTarget::VOLUMETRIC && brew->currentPhase.hasVolumetricTarget() &&
                                          controller->isVolumetricAvailable();
                pObj["tt"] = isVolumetric ? "volumetric" : "time";
                if (isVolumetric) {
                    Target t = brew->currentPhase.getVolumetricTarget();
                    pObj["pt"] = t.value;
                    pObj["pp"] = brew->currentVolume;
                } else {
                    pObj["pt"] = brew->getPhaseDuration();
                    pObj["pp"] = ts - brew->currentPhaseStarted;
                }
            } else if (process->getType() == MODE_MANUAL) {
                // Manual has no phases, so it reports only elapsed time and, if
                // a weight target is armed, progress toward it.
                auto *manual = static_cast<ManualProcess *>(process);
                pObj["s"] = "manual";
                pObj["l"] = manual->isActive() ? "Manual" : "Finished";
                pObj["e"] = manual->getElapsed();
                const bool hasTarget = manual->getWeightTarget() > 0.0;
                pObj["tt"] = hasTarget ? "volumetric" : "time";
                pObj["pt"] = hasTarget ? manual->getWeightTarget() : 0;
                pObj["pp"] = hasTarget ? manual->getCurrentVolume() : manual->getElapsed();
                // Flow from the scale. statusDoc["pf"] above is the pump model's
                // estimate, which PressureController gates on the brew valve being
                // open — a hard zero for the whole shot on a build with no valve.
                // Only override when a scale is actually feeding us, so a
                // valve-equipped machine keeps the modelled value.
                if (controller->isVolumetricAvailable()) {
                    statusDoc["pf"] = manual->getFlowRate();
                }
            } else if (process->getType() == MODE_GRIND) {
                auto *grind = static_cast<GrindProcess *>(process);
                unsigned long ts = grind->isActive() && controller->isActive() ? millis() : grind->finished;
                pObj["s"] = "grind";
                pObj["l"] = grind->isActive() ? "Grinding" : "Finished";
                pObj["e"] = ts - grind->started;
                const bool isVolumetric = grind->target == ProcessTarget::VOLUMETRIC && controller->isVolumetricAvailable();
                pObj["tt"] = isVolumetric ? "volumetric" : "time";
                if (isVolumetric) {
                    pObj["pt"] = grind->grindVolume;
                    pObj["pp"] = grind->currentVolume;
                } else {
                    pObj["pt"] = grind->time;
                    pObj["pp"] = ts - grind->started;
                }
            }
        }
        processGuard.unlock();

        const unsigned long sendStart = millis();
        broadcastStatus(statusDoc);
        noteSlow("status send", nullptr, millis() - sendStart);
    }
    if (now > lastCleanup + CLEANUP_PERIOD) {
        lastCleanup = now;
        ws.cleanupClients();
    }
    if (now > lastDns + DNS_PERIOD && dnsServer != nullptr) {
        lastDns = now;
        dnsServer->processNextRequest();
    }
}

// Linear lookup over the embedded asset table (~60 entries) — a couple of
// strcmps per request, negligible next to the network round-trip.
static const WebAsset *findWebAsset(const String &path) {
    for (size_t i = 0; i < WEB_ASSETS_COUNT; i++) {
        if (path == WEB_ASSETS[i].path) {
            return &WEB_ASSETS[i];
        }
    }
    return nullptr;
}

// Text from settings into the mini Wi-Fi page: a name with < " or ' can't break the page (or the
// JavaScript string it also lands in).
static String htmlEscape(const String &in) {
    String out;
    for (char c : in) {
        if (c == '&')
            out += "&amp;";
        else if (c == '<')
            out += "&lt;";
        else if (c == '>')
            out += "&gt;";
        else if (c == '"')
            out += "&quot;";
        else if (c == '\'')
            out += "&#39;";
        else
            out += c;
    }
    return out;
}

void WebUIPlugin::serveWebAsset(AsyncWebServerRequest *request) {
    String path = request->url();
    // On the hotspot, the address itself opens the small Wi-Fi page instead of the full app
    // (MINI_WIFI_PAGE_PLAN.txt): ~1.8 MB of app files over the hotspot left the page blank
    // whenever one dropped. The app is still at /settings/wifi etc.
    if (apMode && (path.isEmpty() || path == "/" || path == WEB_UI_INDEX_PATH)) {
        Settings &settings = controller->getSettings();
        const String lastIp = htmlEscape(settings.getLastIp());
        const String host = htmlEscape(settings.getMdnsName());
        String html = MINI_WIFI_PAGE;
        html.replace("%SSID%", htmlEscape(settings.getWifiSsid()));
        html.replace("%LASTIPLINE%", lastIp.isEmpty() ? String("") : "Last known address on your router: http://" + lastIp);
        html.replace("%FINDAT%", lastIp.isEmpty()
                                     ? host + ".local on iPhone, Mac and Linux; on Android and Windows look up its "
                                              "number in your router&#39;s device list"
                                     : "http://" + lastIp + ", or " + host +
                                           ".local on iPhone, Mac and Linux; on Android and Windows use the number");
        AsyncWebServerResponse *resp = request->beginResponse(200, "text/html", html);
        resp->addHeader("Cache-Control", "no-store"); // never a stale copy
        request->send(resp);
        return;
    }
    if (path.isEmpty() || path == "/") {
        path = WEB_UI_INDEX_PATH;
    }

    const WebAsset *asset = findWebAsset(path);
    if (asset == nullptr && !path.startsWith("/assets/")) {
        // SPA client-side routes (e.g. /settings, /profiles) aren't real files —
        // fall back to index.html. A miss under /assets/ is a genuine 404, not a
        // route, so it is not rewritten.
        asset = findWebAsset(WEB_UI_INDEX_PATH);
    }
    if (asset == nullptr) {
        request->send(404, "text/plain", "Not found");
        return;
    }

    // Serve straight from the memory-mapped flash blob — no copy into RAM, no
    // filesystem read. AsyncProgmemResponse streams from the pointer in chunks.
    // Bigger app files take a turn like pictures and videos (HeavyGate): a fresh page load asks
    // for several at once and starved every page's status stream (user 2026-10-09).
    AsyncWebServerResponse *response;
    const uint8_t *data = gWebUiBlobStart + asset->offset;
    const size_t total = asset->length;
    if (total > 4096) {
        auto gate = std::make_shared<HeavyGate>();
        gate->ip = request->client()->getRemoteAddress();
        response = request->beginResponse(asset->contentType, total,
                                          [gate, data, total](uint8_t *buf, size_t maxLen, size_t index) -> size_t {
                                              if (!gate->take())
                                                  return RESPONSE_TRY_AGAIN;
                                              const size_t n = std::min(maxLen, total - index);
                                              memcpy(buf, data + index, n);
                                              if (index + n >= total)
                                                  gate->give();
                                              return n;
                                          });
    } else {
        response = request->beginResponse(200, asset->contentType, data, total);
    }
    if (asset->gzip) {
        response->addHeader("Content-Encoding", "gzip");
    }
    // Content-hashed build assets (/assets/<hash>.js) never change for a given URL — cache them forever. index.html and
    // other unhashed files must revalidate so a new build is picked up after an update. [GM-83]
    if (path.startsWith("/assets/")) {
        response->addHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
        response->addHeader("Cache-Control", "no-cache");
    }
    request->send(response);
}

void WebUIPlugin::setupServer() {
    // Every request goes into the request log, finished when its connection closes.
    server.addMiddleware([](AsyncWebServerRequest *request, ArMiddlewareNext next) {
        const char *m = request->method() == HTTP_GET ? "GET " : request->method() == HTTP_POST ? "POST " : "? ";
        const int slot = reqLogAdd(request->client() ? request->client()->remoteIP()[3] : 0, String(m) + request->url());
        uint32_t seq;
        {
            std::lock_guard<std::mutex> guard(reqLogMutex);
            seq = reqLog[slot].seq;
        }
        request->onDisconnect([slot, seq]() {
            std::lock_guard<std::mutex> guard(reqLogMutex);
            if (reqLog[slot].seq == seq)
                reqLog[slot].doneAt = millis() | 1;
        });
        next();
    });
   server.on("/test", [](AsyncWebServerRequest *request) {
        const WebAsset *a = findWebAsset("/index.html");
        if (!a) { request->send(404, "text/plain", "no index"); return; }
        request->send(request->beginResponse(200, a->contentType, gWebUiBlobStart + a->offset, a->length));
    });
    server.on("/blobtest", [](AsyncWebServerRequest *request) {
        const WebAsset *a = findWebAsset("/index.html");
        if (!a) { request->send(404, "text/plain", "no index"); return; }
        AsyncWebServerResponse *r = request->beginResponse(200, a->contentType, gWebUiBlobStart + a->offset, a->length);
        r->addHeader("Content-Encoding", "gzip");
        request->send(r);
    });
    server.on("/api/waterlevel", [](AsyncWebServerRequest *request) {
        if (request->hasArg("calibrate") && gWaterLevel != nullptr) {
            if (request->arg("calibrate") == "empty") gWaterLevel->calibrateEmpty();
            if (request->arg("calibrate") == "full") gWaterLevel->calibrateFull();
        }
        AsyncResponseStream *r = request->beginResponseStream("application/json");
        if (gWaterLevel == nullptr) { r->print("{\"error\":\"no plugin\"}"); }
        else r->printf("{\"raw\":%u,\"percent\":%.0f,\"low\":%s}", gWaterLevel->getRaw(),
                       gWaterLevel->getPercent(), gWaterLevel->isLow() ? "true" : "false");
        request->send(r);
    });
    // Custom splash picture and sidebar logo (see serveCustomImage). The page
    // asks /api/splash and /api/logo first and falls back to its built-in
    // /splash.webp and /logo.svg on a 404.
    serveCustomImage(server, "/api/splash", "/api/splash-reset", &SPLASH_IMAGE);
    serveCustomImage(server, "/api/logo", "/api/logo-reset", &LOGO_IMAGE);
    serveCustomImage(server, "/api/brewbutton-still", "/api/brewbutton-still-reset", &BREW_STILL_IMAGE);
    serveCustomImage(server, "/api/brewbutton", "/api/brewbutton-reset", &BREW_ANIM_IMAGE);
    serveHolidays(server);
    serveCustomThemes(server, controller);
    serveVideoLibrary(server, controller);
    // Backup & flashing (Settings > System, user 2026-09-24). This layout has one
    // app slot, so firmware can't be uploaded over Wi-Fi; the machine hands out
    // images instead, to be written at 0x0 over USB (esptool or its web page).
    // Full: the whole chip, an exact clone (settings incl. Wi-Fi password,
    // storage, firmware); refused while a shot runs so the copy is consistent.
    server.on("/api/backup/full", HTTP_GET, [this](AsyncWebServerRequest *request) {
        if (controller->isActive()) {
            request->send(409, "text/plain", "Not while a shot is running");
            return;
        }
        const size_t total = spi_flash_get_chip_size();
        AsyncWebServerResponse *resp = request->beginResponse(
            "application/octet-stream", total, [total](uint8_t *buf, size_t maxLen, size_t index) -> size_t {
                if (index >= total)
                    return 0;
                const size_t n = std::min({maxLen, total - index, (size_t)4096});
                return esp_flash_read(nullptr, buf, index, n) == ESP_OK ? n : 0;
            });
        resp->addHeader("Content-Disposition", backupDisposition("backup"));
        request->send(resp);
    });
    // New board: bootloader + partition table as flashed, NVS and the gap blank
    // (0xFF: no settings), then the running app partition. The app itself carries
    // the built-in home Wi-Fi (constants.h), so this file is private too.
    server.on("/api/backup/factory", HTTP_GET, [](AsyncWebServerRequest *request) {
        const esp_partition_t *app = esp_ota_get_running_partition();
        const size_t appAddr = app->address;
        const size_t total = app->address + app->size;
        AsyncWebServerResponse *resp = request->beginResponse(
            "application/octet-stream", total, [appAddr, total](uint8_t *buf, size_t maxLen, size_t index) -> size_t {
                if (index >= total)
                    return 0;
                size_t n = std::min({maxLen, total - index, (size_t)4096});
                if (index >= 0x9000 && index < appAddr) {
                    n = std::min(n, appAddr - index);
                    memset(buf, 0xFF, n);
                    return n;
                }
                if (index < 0x9000)
                    n = std::min(n, (size_t)0x9000 - index);
                return esp_flash_read(nullptr, buf, index, n) == ESP_OK ? n : 0;
            });
        resp->addHeader("Content-Disposition", backupDisposition("newboard"));
        request->send(resp);
    });
    server.on("/connecttest.txt", [](AsyncWebServerRequest *request) {
                request->redirect("http://logout.net");
    }); // windows 11 captive portal workaround
    server.on("/wpad.dat", [](AsyncWebServerRequest *request) {
        request->send(404);
    }); // Honestly don't understand what this is but a 404 stops win 10 keep calling this repeatedly and panicking the esp32
        // :)
    server.on("/generate_204",
              [](AsyncWebServerRequest *request) { request->redirect(LOCAL_URL); }); // android captive portal redirect
    server.on("/redirect", [](AsyncWebServerRequest *request) { request->redirect(LOCAL_URL); });            // microsoft redirect
    server.on("/hotspot-detect.html", [](AsyncWebServerRequest *request) { request->redirect(LOCAL_URL); }); // apple call home
    server.on("/canonical.html",
              [](AsyncWebServerRequest *request) { request->redirect(LOCAL_URL); });       // firefox captive portal call home
    server.on("/success.txt", [](AsyncWebServerRequest *request) { request->send(200); }); // firefox captive portal call home
    server.on("/ncsi.txt", [](AsyncWebServerRequest *request) { request->redirect(LOCAL_URL); }); // windows call home
    server.on("/api/settings", [this](AsyncWebServerRequest *request) { handleSettings(request); });
    // Settings file (Settings > Export / Import, user 2026-09-25): every setting
    // the machine keeps, by storage key, so a file restores all of them; the old
    // page export held only the Settings page fields. Not under "/api/settings/":
    // the handler above would catch those paths.
    server.on("/api/settings-export", HTTP_GET, [this](AsyncWebServerRequest *request) {
        AsyncResponseStream *response = request->beginResponseStream("application/json");
        JsonDocument doc(&psramAllocator);
        doc["format"] = "delongezzi-settings";
        doc["version"] = 1;
        controller->getSettings().exportAll(doc["settings"].to<JsonObject>());
        serializeJson(doc, *response);
        response->addHeader("Content-Disposition", backupDisposition("settings", ".json"));
        request->send(response);
    });
    auto *settingsImport = new AsyncCallbackJsonWebHandler(
        "/api/settings-import", [this](AsyncWebServerRequest *request, JsonVariant &json) {
            JsonObjectConst imported = json["settings"].as<JsonObjectConst>();
            if (json["format"] != "delongezzi-settings" || imported.isNull()) {
                request->send(400, "application/json", "{\"error\":\"not a DeLongezzi settings file\"}");
                return;
            }
            const int applied = controller->getSettings().importAll(imported);
            request->send(200, "application/json", String("{\"applied\":") + applied + "}");
            restartSoon(); // every part picks up the imported values (Wi-Fi, PID, ...)
        });
    settingsImport->setMethod(HTTP_POST);
    settingsImport->setMaxContentLength(32768);
    server.addHandler(settingsImport);
    // Shot Notes' bean bags (user 2026-10-09): one list for every device, in /beans.json.
    // Written to a temp file and swapped in only when complete (a full storage can't cut it).
    server.on("/api/beans", HTTP_GET, [](AsyncWebServerRequest *request) {
        if (!LittleFS.exists("/beans.json")) {
            request->send(200, "application/json", "[]");
            return;
        }
        AsyncWebServerResponse *resp = request->beginResponse(LittleFS, "/beans.json", "application/json");
        resp->addHeader("Cache-Control", "no-store");
        request->send(resp);
    });
    auto *beansSave = new AsyncCallbackJsonWebHandler("/api/beans", [](AsyncWebServerRequest *request, JsonVariant &json) {
        if (!json.is<JsonArray>() || json.as<JsonArray>().size() > 300) {
            request->send(400, "application/json", "{\"error\":\"not a bean list\"}");
            return;
        }
        File f = LittleFS.open("/beans.json.tmp", "w");
        if (!f) {
            request->send(500, "application/json", "{\"error\":\"could not write\"}");
            return;
        }
        const size_t need = measureJson(json);
        const size_t wrote = serializeJson(json, f);
        f.close();
        if (wrote != need) {
            LittleFS.remove("/beans.json.tmp");
            request->send(507, "application/json", "{\"error\":\"storage full\"}");
            return;
        }
        LittleFS.remove("/beans.json");
        LittleFS.rename("/beans.json.tmp", "/beans.json");
        request->send(200, "application/json", "{\"ok\":true}");
    });
    beansSave->setMethod(HTTP_POST);
    beansSave->setMaxContentLength(65536);
    server.addHandler(beansSave);
    // Setup Portal state for the Wi-Fi tab's button (2026-10-14): the page used to guess it from
    // its address, and a flip in the fallback hotspot turned the always-on portal ON.
    server.on("/api/portal", HTTP_GET, [this](AsyncWebServerRequest *request) {
        Settings &settings = controller->getSettings();
        const char *mode = settings.getWifiSsid().isEmpty() ? "setup"
                           : settings.getBootIntoAp()       ? "forced"
                           : controller->isPortalFallback() ? "fallback"
                                                            : "normal";
        request->send(200, "application/json", String("{\"mode\":\"") + mode + "\"}");
    });
    server.on("/api/portal", HTTP_POST, [this](AsyncWebServerRequest *request) {
        // Set (on=1) or clear the persistent portal mode, then reboot into it; no flipping, so a
        // press does what the button says. save(true) forces the synchronous NVS commit so the
        // flag survives ESP.restart() (batchUpdate does NOT write).
        const bool on = request->arg("on") == "1";
        ESP_LOGW("WebUIPlugin", "[portal] button: %s, restarting", on ? "into the Setup Portal" : "back to normal");
        Settings &settings = controller->getSettings();
        settings.setBootIntoAp(on);
        settings.save(true);
        request->send(200, "application/json", "{\"ok\":true}");
        ESP.restart();
    });
    server.on("/api/status", [this](AsyncWebServerRequest *request) {
        AsyncResponseStream *response = request->beginResponseStream("application/json");
        JsonDocument doc(&psramAllocator);
        doc["mode"] = controller->getMode();
        doc["tt"] = controller->getTargetTemp();
        doc["ct"] = controller->getCurrentTemp();
        serializeJson(doc, *response);
        request->send(response);
    });
    server.on("/api/scales/list", [this](AsyncWebServerRequest *request) { handleBLEScaleList(request); });
    // Device health snapshot (Settings > Diagnostics). Merged single-board
    // build only: reads controller-half peripherals through the diagnostics
    // bridge (fillMergedDiagnostics, defined at file bottom); non-merged
    // builds answer {"merged":false}.
    server.on("/api/diagnostics", [this](AsyncWebServerRequest *request) {
        AsyncResponseStream *response = request->beginResponseStream("application/json");
        JsonDocument doc(&psramAllocator);
        doc["merged"] = false;
        doc["heap"] = ESP.getFreeHeap();
        doc["uptime"] = millis() / 1000;
#ifdef GAGGIMATE_MERGED
        fillMergedDiagnostics(doc);
        doc["waterTouch"] = (uint32_t)touchRead(12); // GPIO12 water touch (pins.txt)
        {
            // Live bench-test state for the Diagnostics UI buttons: the
            // firmware timer is the authority, the UI just mirrors it.
            extern bool gmDiagTestActive();
            extern bool gmDiagHeaterTest();
            JsonDocument test;
            test["active"] = gmDiagTestActive();
            test["heater"] = gmDiagHeaterTest();
            doc["diagTest"] = test;
        }
#endif
        doc["rssi"] = WiFi.RSSI();
        {
            // Connection health: who is connected, whether updates queue up for them.
            const unsigned long now = millis();
            JsonObject wsDoc = doc["ws"].to<JsonObject>();
            JsonArray list = wsDoc["clients"].to<JsonArray>();
            std::lock_guard<std::recursive_mutex> clientsGuard(ws.clientsLock());
            std::lock_guard<std::mutex> statsGuard(wsStatsMutex);
            for (auto &c : ws.getClients()) {
                if (c.status() != WS_CONNECTED) {
                    continue;
                }
                JsonObject o = list.add<JsonObject>();
                o["id"] = c.id();
                o["queue"] = c.queueLen();
                auto it = wsStats.find(c.id());
                if (it != wsStats.end()) {
                    o["ip"] = it->second.ip;
                    o["upS"] = (now - it->second.connectedAt) / 1000;
                    o["sent"] = it->second.sent;
                    o["skipped"] = it->second.skipped;
                    o["lastStatusMs"] = it->second.lastStatusAt ? (long)(now - it->second.lastStatusAt) : -1L;
                }
            }
            wsDoc["closedWhileBehind"] = wsClosedBehind;
            if (wsLastBehindAt) {
                wsDoc["lastBehindIp"] = wsLastBehindIp;
                wsDoc["lastBehindAgoS"] = (now - wsLastBehindAt) / 1000;
                wsDoc["lastBehindQueue"] = wsLastBehindQueue;
            }
            wsDoc["statusMaxGapMs"] = statusGapPrev > statusGapNow ? statusGapPrev : statusGapNow;
            wsDoc["endedByMachine"] = wsEndedByMachine;
            if (wsLastMachineEndAt) {
                wsDoc["lastMachineEndIp"] = wsLastMachineEndIp;
                wsDoc["lastMachineEndAgoS"] = (now - wsLastMachineEndAt) / 1000;
            }
            wsDoc["endedByDevice"] = wsEndedByDevice;
            if (wsLastDeviceEndAt) {
                wsDoc["lastDeviceEndIp"] = wsLastDeviceEndIp;
                wsDoc["lastDeviceEndAgoS"] = (now - wsLastDeviceEndAt) / 1000;
            }
        }
        doc["logicMaxGapMs"] = controller->getLogicMaxGapMs();
        {
            JsonArray reqs = doc["requests"].to<JsonArray>();
            const unsigned long now = millis();
            std::lock_guard<std::mutex> guard(reqLogMutex);
            for (int i = 0; i < 40; i++) {
                const ReqEntry &e = reqLog[(reqSeq + 39 - i) % 40]; // newest first
                if (e.seq == 0)
                    continue;
                JsonObject o = reqs.add<JsonObject>();
                o["agoMs"] = now - e.at;
                o["ip"] = e.ip;
                o["what"] = e.what;
                o["heap"] = e.heap;
                if (e.doneAt)
                    o["tookMs"] = e.doneAt - e.at;
            }
        }
        {
            // Memory map (user 2026-10-09: free fast memory ran low). Per task: the part of its
            // reserved stack never used since start. Plus fast-memory totals and the big PSRAM.
            static const char *const names[] = {
                "loopTask", "async_tcp", "Controller::loopLogic", "GaggiMateController", "GaggiMateServer",
                "BLEScaleTask", "GmDispatch", "ShotHistoryPlugin::loop", "Settings::loop", "Heater::loop",
                "DimmedPump::loop", "ADSAdc::loop", "DigitalInput::loop", "Max31865Thermocouple::monitor",
                "WebBackground", "nimble_host", "tiT", "wifi", "esp_timer", "sys_evt", "arduino_events",
                "ipc0", "ipc1", "IDLE"};
            JsonObject tasks = doc["taskStackFree"].to<JsonObject>();
            for (const char *n : names) {
                // Task names are kept to 15 characters, and xTaskGetHandle() asserts (restarts the
                // machine) on a longer one: look up the stored, shortened name.
                char shortName[configMAX_TASK_NAME_LEN] = {};
                strncpy(shortName, n, configMAX_TASK_NAME_LEN - 1);
                TaskHandle_t h = xTaskGetHandle(shortName);
                if (h != nullptr)
                    tasks[n] = (uint32_t)uxTaskGetStackHighWaterMark(h);
            }
            JsonObject mem = doc["mem"].to<JsonObject>();
            mem["internalFree"] = (uint32_t)heap_caps_get_free_size(MALLOC_CAP_INTERNAL);
            mem["internalLargest"] = (uint32_t)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL);
            mem["internalLowest"] = (uint32_t)heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL);
            mem["internalTotal"] = (uint32_t)heap_caps_get_total_size(MALLOC_CAP_INTERNAL);
            mem["psramFree"] = (uint32_t)heap_caps_get_free_size(MALLOC_CAP_SPIRAM);
        }
        if (storageCountTask != nullptr) // bytes never used of the background worker's stack
            doc["bgStackFree"] = (uint32_t)uxTaskGetStackHighWaterMark(storageCountTask);
        {
            JsonArray slow = doc["slow"].to<JsonArray>();
            const unsigned long now = millis();
            for (int i = 0; i < 8; i++) {
                const SlowEvent &e = slowEvents[(slowNext + 7 - i) % 8]; // newest first
                if (e.what == nullptr)
                    continue;
                JsonObject o = slow.add<JsonObject>();
                String what = e.what;
                if (e.who != nullptr) {
                    what += e.who == g_webUIPlugin ? ":WebUI"
                            : e.who == &ShotHistory ? ":ShotHistory"
                            : e.who == &BLEScales   ? ":BLEScales"
                                                    : ":other";
                }
                o["what"] = what;
                o["ms"] = e.ms;
                o["agoS"] = (now - e.at) / 1000;
            }
        }
        serializeJson(doc, *response);
        request->send(response);
    });
    server.on("/api/scales/connect", [this](AsyncWebServerRequest *request) { handleBLEScaleConnect(request); });
#ifdef GAGGIMATE_MERGED
    // Diagnostics bench actuator tests. Direct drive of pump dimmer / heater
    // SSR, time-boxed on the controller-half side (30 s pump, 5 s SSR) with
    // auto-off in the controller loop. GET for simple fetch() use; responses
    // are JSON {"ok":true/false}. Merged build only.
    server.on("/api/test/pump", HTTP_GET, [](AsyncWebServerRequest *request) {
        const float percent = request->hasArg("power") ? request->arg("power").toFloat() : 0.0f;
        const uint32_t dur = request->hasArg("dur") ? (uint32_t)request->arg("dur").toInt() : 5000u;
        extern bool gmStartDiagPumpTest(float, uint32_t);
        const bool ok = percent > 0.0f && gmStartDiagPumpTest(percent, dur);
        ESP_LOGW("WebUI", "Diag pump test request: power=%.0f%% dur=%u -> %s", percent, (unsigned)dur,
                 ok ? "STARTED" : "REFUSED");
        request->send(200, "application/json", ok ? "{\"ok\":true}" : "{\"ok\":false}");
    });
    server.on("/api/test/heater", HTTP_GET, [](AsyncWebServerRequest *request) {
        const uint32_t dur = request->hasArg("dur") ? (uint32_t)request->arg("dur").toInt() : 3000u;
        extern bool gmStartDiagHeaterTest(uint32_t);
        const bool ok = gmStartDiagHeaterTest(dur);
        ESP_LOGW("WebUI", "Diag heater SSR test request: dur=%u -> %s", (unsigned)dur, ok ? "STARTED" : "REFUSED");
        request->send(200, "application/json", ok ? "{\"ok\":true}" : "{\"ok\":false}");
    });
    server.on("/api/test/stop", HTTP_GET, [](AsyncWebServerRequest *request) {
        extern bool gmStopDiagTests();
        gmStopDiagTests();
        request->send(200, "application/json", "{\"ok\":true}");
    });
#endif
    server.on("/api/scales/scan", [this](AsyncWebServerRequest *request) { handleBLEScaleScan(request); });
    server.on("/api/scales/info", [this](AsyncWebServerRequest *request) { handleBLEScaleInfo(request); });
    FS *fs = &LittleFS;
    if (controller->isSDCard()) {
        fs = &SD_MMC;
    }
    server.serveStatic("/api/history/", *fs, "/h/").setCacheControl("no-store");
    server.on("/api/history/index.bin", HTTP_GET, [this, fs](AsyncWebServerRequest *request) {
        // Serve the binary index file directly
        if (fs->exists("/h/index.bin")) {
            request->send(*fs, "/h/index.bin", "application/octet-stream");
        } else {
            request->send(404, "text/plain", "Index not found");
        }
    });
    server.on("/api/history/recent.bin", HTTP_GET, [this](AsyncWebServerRequest *request) {
        // The most recent non-deleted shots, newest first, as a regular shot
        // index (SIDX header + entries) — same binary format as index.bin,
        // just truncated, so clients reuse the index.bin parser.
        constexpr long MAX_RECENT_LIMIT = 50;
        long limit = 8;
        if (request->hasArg("limit")) {
            limit = constrain(request->arg("limit").toInt(), 1L, MAX_RECENT_LIMIT);
        }

        auto *entries = static_cast<ShotIndexEntry *>(ps_malloc(limit * sizeof(ShotIndexEntry)));
        if (entries == nullptr) {
            request->send(500, "text/plain", "Out of memory");
            return;
        }
        size_t count = ShotHistory.readRecentEntries(entries, limit);

        ShotIndexHeader header{};
        header.magic = SHOT_INDEX_MAGIC;
        header.version = SHOT_INDEX_VERSION;
        header.entrySize = SHOT_INDEX_ENTRY_SIZE;
        header.entryCount = count;
        header.nextId = 0; // meaningless for a partial view

        AsyncResponseStream *response = request->beginResponseStream("application/octet-stream");
        response->addHeader("Cache-Control", "no-store");
        response->write(reinterpret_cast<const uint8_t *>(&header), sizeof(header));
        response->write(reinterpret_cast<const uint8_t *>(entries), count * sizeof(ShotIndexEntry));
        free(entries);
        request->send(response);
    });
    // Permanent log (DlzLog): /api/log is this run (from RAM), /api/log?prev=1..3 an earlier run.
    server.on("/api/log", HTTP_GET, [](AsyncWebServerRequest *request) {
        if (request->hasParam("stacks")) {
            char *buf = static_cast<char *>(heap_caps_malloc(4096, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
            if (!buf) {
                request->send(500, "text/plain", "no memory");
                return;
            }
            dlzlog_stacks(buf, 4096);
            AsyncWebServerResponse *resp = request->beginResponse(200, "text/plain", buf);
            heap_caps_free(buf);
            resp->addHeader("Cache-Control", "no-store");
            request->send(resp);
            return;
        }
        if (request->hasParam("prev")) {
            const int n = request->getParam("prev")->value().toInt();
            const String path = String("/dlzlog/prev") + String(n < 1 || n > 3 ? 1 : n) + ".txt";
            AsyncWebServerResponse *resp = request->beginResponse(LittleFS, path, "text/plain");
            resp->addHeader("Cache-Control", "no-store");
            request->send(resp);
            return;
        }
        // This run's long log (64 KB, 2026-10-19), sent from one PSRAM copy in pieces.
        const size_t cap = dlzlog_allSize() + 1;
        char *buf = static_cast<char *>(heap_caps_malloc(cap, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
        if (!buf) {
            request->send(500, "text/plain", "no memory");
            return;
        }
        const size_t len = dlzlog_readAll(buf, cap);
        std::shared_ptr<char> text(buf, heap_caps_free);
        AsyncWebServerResponse *resp = request->beginResponse(
            "text/plain", len, [text, len](uint8_t *out, size_t maxLen, size_t index) -> size_t {
                const size_t n = std::min(maxLen, len - index);
                memcpy(out, text.get() + index, n);
                return n;
            });
        resp->addHeader("Cache-Control", "no-store");
        request->send(resp);
    });
    // Page timing notes (PAGE lines) were removed in build 967 (2026-10-22); an older page that
    // still sends one gets a plain 204.
    server.on("/api/log-note", HTTP_POST, [](AsyncWebServerRequest *request) { request->send(204); });
    server.on("/api/core-dump", HTTP_GET, [this](AsyncWebServerRequest *request) { handleCoreDumpDownload(request); });
    // The web UI is embedded in firmware flash and served from the memory-mapped blob (see serveWebAsset). It is no
    // longer in LittleFS, so OTA never touches the partition holding profiles/shots. The catch-all onNotFound handles
    // every path not claimed by an explicit server.on()/api route above. [GM-106]
    server.onNotFound([this](AsyncWebServerRequest *request) { serveWebAsset(request); });
    ws.onEvent(
        [this](AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len) {
            if (type == WS_EVT_CONNECT) {
                // Close (and let the browser reconnect) a client whose send
                // queue backs up, instead of keeping it open. With it kept open
                // (false), a client that stalls under load — e.g. while the UI
                // is fetching many shot files for statistics — never has its
                // queued frames / AsyncTCP buffers reclaimed, so they accumulate
                // in internal DRAM until the whole IP stack starves (web + ICMP
                // die, no recovery). Reclaiming via close is the safer failure
                // mode. (Was the v1.8.1 behaviour.)
                client->setCloseClientOnQueueFull(true);
                ESP_LOGI("WebUIPlugin", "WebSocket client connected (%d open connections)", server->getClients().size());
                {
                    std::lock_guard<std::mutex> statsGuard(wsStatsMutex);
                    WsClientStat &stat = wsStats[client->id()];
                    stat.ip = client->remoteIP().toString();
                    stat.connectedAt = millis();
                }
            } else if (type == WS_EVT_DISCONNECT) {
                ESP_LOGI("WebUIPlugin", "WebSocket client disconnected (%d open connections)", server->getClients().size());
                {
                    std::lock_guard<std::mutex> statsGuard(wsStatsMutex);
                    auto it = wsStats.find(client->id());
                    if (it != wsStats.end()) {
                        if (it->second.droppedByMachine) {
                            wsEndedByMachine++;
                            wsLastMachineEndIp = it->second.ip;
                            wsLastMachineEndAt = millis();
                        } else {
                            wsEndedByDevice++;
                            wsLastDeviceEndIp = it->second.ip;
                            wsLastDeviceEndAt = millis();
                        }
                        if (it->second.lastQueue > 0) {
                            wsClosedBehind++;
                            wsLastBehindIp = it->second.ip;
                            wsLastBehindAt = millis();
                            wsLastBehindQueue = it->second.lastQueue;
                        }
                        wsStats.erase(it);
                    }
                }
                std::lock_guard<std::mutex> rxGuard(rxMutex);
                rxBuffers.erase(client->id());
            } else if (type == WS_EVT_DATA) {
                ESP_LOGI("WebUIPlugin", "WS data from client %u: %u bytes", static_cast<unsigned>(client->id()),
                         static_cast<unsigned>(len));
                handleWebSocketData(server, client, type, arg, data, len);
            }
        });
    server.addHandler(&ws);
}

void WebUIPlugin::start() {
    if (serverRunning) {
        // Already listening. The 0.0.0.0:80 listen socket survives a WiFi
        // reconnect, so re-running end()+begin() only races AsyncTCP's async
        // socket close and fails to rebind ("bind: -8, port in use"). A transient
        // STA reconnect needs nothing done here.
        return;
    }
    server.begin();
    ESP_LOGI("WebUIPlugin", "Started webserver");
    dlzlog_mem("webserver");
    if (apMode) {
        dnsServer = new DNSServer();
        dnsServer->setTTL(3600);
        dnsServer->start(53, "*", WIFI_AP_IP);
        ESP_LOGI("WebUIPlugin", "Started catchall DNS for captive portal");
    }
    lastUpdateCheck = millis();
    serverRunning = true;
}

void WebUIPlugin::stop() {
    if (!serverRunning)
        return;
    ws.closeAll();
    server.end();
    if (dnsServer != nullptr) {
        dnsServer->stop();
        delete dnsServer;
        dnsServer = nullptr;
    }
    serverRunning = false;
    ESP_LOGI("WebUIPlugin", "WebUIPlugin stopped (wifi disconnected)");
}

void WebUIPlugin::handleWebSocketData(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg,
                                      uint8_t *data, size_t len) {

    auto *info = static_cast<AwsFrameInfo *>(arg);
    const uint32_t cid = client->id();

    // rxBuffers is also cleaned from the main loop now (a client's disconnect event fires
    // there, from cleanupClients), so it is only touched under rxMutex; a finished message
    // is moved out and handled without the lock.
    PsramString message;
    bool isFinal;
    {
        std::lock_guard<std::mutex> rxGuard(rxMutex);
        if (info->index == 0) {
            auto &fresh = rxBuffers[cid];
            fresh.clear();
            if (info->len <= 64 * 1024) {
                fresh.reserve(info->len);
            }
        }
        auto &pending = rxBuffers[cid];
        pending.append(reinterpret_cast<const char *>(data), len);
        isFinal = info->final && (info->index + len) == info->len;
        if (isFinal) {
            message = std::move(pending);
            rxBuffers.erase(cid);
        }
    }
    auto &buf = message;

    // If this is the final frame of the message, process it
    if (isFinal) {
        if (info->opcode == WS_TEXT) {
            ESP_LOGI("WebUIPlugin", "WS final frame: %.*s", (int)buf.size(), buf.c_str());
            JsonDocument doc(&psramAllocator);
            DeserializationError err = deserializeJson(doc, buf.c_str());
            if (!err) {
                String msgType = doc["tp"].as<String>();
                if (msgType.startsWith("req:profiles:")) {
                    handleProfileRequest(client->id(), doc);
                } else if (msgType == "req:ota-settings") {
                    handleOTASettings(client->id(), doc);
                } else if (msgType == "req:ota-start") {
                    /* OTA DISARMED - custom XIAO build; update by wire only */ ESP_LOGW("WebUI", "OTA start request BLOCKED (disarmed)");
                } else if (msgType == "req:autotune-start") {
                    handleAutotuneStart(client->id(), doc);
                } else if (msgType == "req:process:activate") {
                    controller->activate();
                } else if (msgType == "req:process:deactivate") {
                    controller->deactivate();
                    // Manual keeps the finished shot on screen. Stopping by hand
                    // should leave you the same frozen time, weight and average an
                    // automatic stop does — clearing here was the only reason the
                    // two ended differently, and it snapped the panel back to the
                    // cup before you could read anything. The tare is what clears
                    // it now. Every other mode clears immediately, as before:
                    // brew's shot history and delay learning both key off this.
                    if (controller->getMode() != MODE_MANUAL) {
                        controller->clear();
                    }
                } else if (msgType == "req:process:clear") {
                    controller->clear();
                } else if (msgType == "req:grind:activate") {
                    controller->activateGrind();
                } else if (msgType == "req:grind:deactivate") {
                    controller->deactivateGrind();
                } else if (msgType == "req:change-grind-target") {
                    if (doc["target"].is<uint8_t>()) {
                        auto target = doc["target"].as<uint8_t>();
                        controller->getSettings().setVolumetricTarget(target);
                    }
                } else if (msgType == "req:raise-temp") {
                    controller->raiseTemp();
                } else if (msgType == "req:lower-temp") {
                    controller->lowerTemp();
                } else if (msgType == "req:raise-grind-target") {
                    controller->raiseGrindTarget();
                } else if (msgType == "req:lower-grind-target") {
                    controller->lowerGrindTarget();
                } else if (msgType == "req:raise-brew-target") {
                    controller->raiseBrewTarget();
                } else if (msgType == "req:lower-brew-target") {
                    controller->lowerBrewTarget();
                } else if (msgType == "req:manual-pressure") {
                    // Live: read by updateControl() every cycle, so it takes
                    // effect mid-shot.
                    if (doc["pressure"].is<float>()) {
                        controller->setManualPressureTarget(doc["pressure"].as<float>());
                    }
                } else if (msgType == "req:manual-weight") {
                    // 0 = off (run until stopped). Read once when the process
                    // starts, so changing it mid-shot is deliberately inert.
                    if (doc["weight"].is<float>()) {
                        controller->setManualWeightTarget(doc["weight"].as<float>());
                    }
                } else if (msgType == "req:tare") {
                    // Manual tare from the panel. REFUSED while a shot is running:
                    // the weight target and the shot average are both measured from
                    // the scale, so zeroing mid-pull pulls the reference out from
                    // under them and the shot runs long. The panel hides the
                    // affordance too — this is the half that cannot be bypassed.
                    if (!controller->isActive()) {
                        BLEScales.tare();
                        // Also clears the finished shot, so the panel drops the
                        // frozen time and average and goes back to the cup.
                        // Taring between shots IS the reset ritual — you dump the
                        // puck, put a clean cup on, zero it — and leaving the last
                        // pull's numbers sitting there contradicts that. Safe here
                        // because this whole branch is idle-only: a paused shot
                        // (pressure slider at 0) still reads as active, so a soak
                        // cannot be cleared out from under you.
                        controller->clear();
                    }
                } else if (msgType == "req:change-mode") {
                    if (doc["mode"].is<uint8_t>()) {
                        auto mode = doc["mode"].as<uint8_t>();
                        controller->deactivate();
                        controller->clear();
                        controller->setMode(mode);
                    }
                } else if (msgType == "req:change-brew-target") {
                    if (doc["target"].is<uint8_t>()) {
                        auto target = doc["target"].as<uint8_t>();
                        controller->getSettings().setVolumetricTarget(target);
                    }
                } else if (msgType == "req:history:rebuild") {
                    // Handle rebuild asynchronously - send immediate ack, progress comes via events
                    JsonDocument resp(&psramAllocator);
                    resp["tp"] = "res:history:rebuild";
                    if (doc["rid"].is<const char *>()) {
                        resp["rid"] = doc["rid"];
                    }
                    resp["msg"] = "Rebuild started";
                    client->text(toWsBuffer(resp));
                    ShotHistory.startAsyncRebuild();
                } else if (msgType.startsWith("req:history")) {
                    JsonDocument resp(&psramAllocator);
                    ShotHistory.handleRequest(doc, resp);
                    client->text(toWsBuffer(resp));
                } else if (msgType == "req:theme") {
                    // A theme pick or the "Auto themes" switch over the open link: no new connection,
                    // no settings reply (2026-10-16). Same name check as the POST. Saved to flash by
                    // the settings task within 5 s (Settings::loopTask), not here in the web task.
                    const String mode = doc["holidayMode"] | "";
                    const bool modeOk = !mode.isEmpty() && isThemeName(mode);
                    const bool hasKeep = doc["keepTheme"].is<bool>();
                    const bool keep = doc["keepTheme"] | false;
                    if (modeOk || hasKeep) {
                        controller->getSettings().batchUpdate([&](Settings *s) {
                            if (modeOk)
                                s->setHolidayMode(mode);
                            if (hasKeep)
                                s->setKeepTheme(keep);
                        });
                        markChanged(CHANGED_THEME_PICK);
                    }
                } else if (msgType == "req:log-note") {
                    // page timing notes are no longer logged (build 967); ignored
                } else if (msgType == "req:hello") {
                    // A page tells why it (re)connected; into the request log (Diagnostics).
                    reqLogAdd(client->remoteIP()[3], String("hello: ") + doc["reason"].as<String>());
                } else if (msgType == "req:flush:start") {
                    handleFlushStart(client->id(), doc);
                }
            }
        }
    }
}

void WebUIPlugin::handleOTASettings(uint32_t clientId, JsonDocument &request) {
    if (request["update"].as<bool>()) {
        if (!request["channel"].isNull()) {
            controller->getSettings().setOTAChannel(request["channel"].as<String>() == "latest" ? "latest" : "nightly");
            ota->setReleaseUrl(RELEASE_URL + (controller->getSettings().getOTAChannel() == "latest" ? "latest" : "tag/nightly"));
            lastUpdateCheck = 0;
        }
    }
    updateOTAStatus("Checking...");
}

void WebUIPlugin::handleOTAStart(uint32_t clientId, JsonDocument &request) {
    updating = true;
    if (request["cp"].is<String>()) {
        updateComponent = request["cp"].as<String>();
    } else {
        updateComponent = "";
    }
}

void WebUIPlugin::handleAutotuneStart(uint32_t clientId, JsonDocument &request) {
    int testTime = request["time"].as<int>();
    int samples = request["samples"].as<int>();
    // Heater wattage drives combinedKff = TUNER_OUTPUT_SPAN / wattage on the
    // controller. 0 = "skip combinedKff derivation" — happens when older Web
    // UI builds omit the field. WebUI form default is 680 W (Gaggia Classic
    // Pro 2019 / E24, 230 V boiler).
    int heaterWattage = request["wattage"] | 0;
    controller->autotune(testTime, samples, heaterWattage);
}

void WebUIPlugin::handleProfileRequest(uint32_t clientId, JsonDocument &request) {
    // Allocate the response node pool from PSRAM — list responses can be tens
    // of KB and would otherwise fragment the ~300 KB internal heap.
    JsonDocument response(&psramAllocator);
    auto type = request["tp"].as<String>();
    ESP_LOGI("WebUIPlugin", "Handling request: %s", type.c_str());
    response["tp"] = String("res:") + type.substring(4);
    response["rid"] = request["rid"].as<String>();

    if (type == "req:profiles:list") {
        auto arr = response["profiles"].to<JsonArray>();
        for (auto const &id : profileManager->listProfiles()) {
            Profile profile{};
            // Skip entries whose JSON couldn't be opened or failed validation
            // (parseProfile returns false for missing label/type/phases). Without
            // this, corrupt or partial profile files surface as blank cards in
            // the UI — the user reported "blank Simple cards" originating here.
            if (!profileManager->loadProfile(id, profile)) {
                ESP_LOGW("WebUIPlugin", "Skipping unreadable profile %s in list response", id.c_str());
                continue;
            }
            auto p = arr.add<JsonObject>();
            if (request["minimal"].as<bool>()) {
                p["id"] = profile.id;
                p["label"] = profile.label;
            } else {
                writeProfile(p, profile);
            }
        }
    } else if (type == "req:profiles:load") {
        auto id = request["id"].as<String>();
        Profile profile;
        if (profileManager->loadProfile(id, profile)) {
            auto obj = response["profile"].to<JsonObject>();
            writeProfile(obj, profile);
        } else {
            response["error"] = F("Profile not found");
        }
    } else if (type == "req:profiles:save") {
        auto obj = request["profile"].as<JsonObject>();
        Profile profile;
        // A profile that doesn't parse (no steps, no name) used to be written anyway,
        // then failed to load and vanished from the list.
        if (!parseProfile(obj, profile) || profile.label.isEmpty()) {
            response["error"] = F("Not saved: a profile needs a name and at least one step");
        } else if (!profileManager->saveProfile(profile)) {
            response["error"] = F("Save failed: the machine's storage may be full");
        } else {
            auto respObj = response["profile"].to<JsonObject>();
            writeProfile(respObj, profile);
        }
    } else if (type == "req:profiles:delete") {
        auto id = request["id"].as<String>();
        if (!profileManager->deleteProfile(id)) {
            response["error"] = F("Delete failed");
        }
    } else if (type == "req:profiles:select") {
        auto id = request["id"].as<String>();
        if (profileManager->profileExists(id)) {
            profileManager->selectProfile(id);
        } else {
            response["error"] = F("Profile not found");
        }
    } else if (type == "req:profiles:favorite") {
        auto id = request["id"].as<String>();
        profileManager->addFavoritedProfile(id);
    } else if (type == "req:profiles:unfavorite") {
        auto id = request["id"].as<String>();
        profileManager->removeFavoritedProfile(id);
    } else if (type == "req:profiles:reorder") {
        // Expect an array of profile IDs in desired order
        if (request["order"].is<JsonArray>()) {
            std::vector<String> order;
            for (JsonVariant v : request["order"].as<JsonArray>()) {
                if (v.is<String>()) {
                    String id = v.as<String>();
                    if (!id.isEmpty() && std::find(order.begin(), order.end(), id) == order.end()) {
                        order.emplace_back(std::move(id));
                    }
                }
            }
            controller->getSettings().setProfileOrder(order);
        }
    }

    ws.text(clientId, toWsBuffer(response));
}

void WebUIPlugin::handleSettings(AsyncWebServerRequest *request) const {
    // Set when this save restarts the machine: Save & Restart, or Wi-Fi details
    // entered on the hotspot (see below).
    bool restarting = request->method() == HTTP_POST && request->hasArg("restart");
    bool wifiRestart = false; // Wi-Fi details saved on the hotspot: restart after 5 s
    if (request->method() == HTTP_POST) {
        if (request->hasArg("wifiSsid") || request->hasArg("wifiPassword")) {
            // Who sent Wi-Fi details, from which page (user 2026-10-15: a save on the hotspot that
            // nobody pressed). The password itself is never printed.
            const AsyncWebHeader *ref = request->getHeader("Referer");
            const AsyncWebHeader *agent = request->getHeader("User-Agent");
            const String pass = request->arg("wifiPassword");
            ESP_LOGW("WebUIPlugin", "[wifi-save] from %s page=%s name='%s' password=%s hotspotPage=%d restart=%d agent=%.70s",
                     request->client()->remoteIP().toString().c_str(), ref ? ref->value().c_str() : "-",
                     request->arg("wifiSsid").c_str(),
                     !request->hasArg("wifiPassword") ? "not-sent"
                     : pass == "---unchanged---"      ? "unchanged"
                     : pass.isEmpty()                 ? "empty"
                                                      : "new",
                     request->hasArg("wifiRetry"), request->hasArg("restart"), agent ? agent->value().c_str() : "-");
        }
        Settings &current = controller->getSettings();
        const String oldSsid = current.getWifiSsid();
        const String oldPass = current.getWifiPassword();
        controller->getSettings().batchUpdate([request](Settings *settings) {
            // Numbers change only when a value came in: an emptied box arrives as ""
            // and toInt()/toFloat() made it 0 (Pressure Scaling 0 = no pressure seen).
            const auto hasNumber = [request](const char *name) {
                return request->hasArg(name) && !request->arg(name).isEmpty();
            };
            // "manual" starts straight on the MANUAL screen (user 2026-09-24).
            if (request->hasArg("startupMode")) {
                const String mode = request->arg("startupMode");
                settings->setStartupMode(mode == "brew" ? MODE_BREW : mode == "manual" ? MODE_MANUAL : MODE_STANDBY);
            }
            // Brew button seconds over custom art: "#rrggbb" and 0-100.
            if (request->hasArg("brewNumColor")) {
                const String color = request->arg("brewNumColor");
                if (color.length() == 7 && color[0] == '#')
                    settings->setBrewNumColor(color);
            }
            if (hasNumber("brewNumOpacity"))
                settings->setBrewNumOpacity(constrain(request->arg("brewNumOpacity").toInt(), 0, 100));
            if (hasNumber("brewNumSize"))
                settings->setBrewNumSize(constrain(request->arg("brewNumSize").toInt(), 50, 160));
            if (hasNumber("chartTimer"))
                settings->setChartTimer(request->arg("chartTimer").toInt() ? 1 : 0);
            if (hasNumber("chartTimerOpacity"))
                settings->setChartTimerOpacity(constrain(request->arg("chartTimerOpacity").toInt(), 5, 100));
            if (hasNumber("chartTimerSize"))
                settings->setChartTimerSize(constrain(request->arg("chartTimerSize").toInt(), 40, 200));
            if (hasNumber("shotHistoryLimit")) {
                const int limit = request->arg("shotHistoryLimit").toInt();
                settings->setShotHistoryLimit(limit == 100 ? 100 : limit == 0 ? 0 : 50);
            }
            if (request->hasArg("saveManualShots"))
                settings->setSaveManualShots(request->arg("saveManualShots") != "0");
            if (request->hasArg("heatUpCheck")) {
                settings->setHeatUpCheck(request->arg("heatUpCheck") != "0");
#ifdef GAGGIMATE_MERGED
                extern void gmSetHeatUpCheck(bool on);
                gmSetHeatUpCheck(settings->isHeatUpCheck()); // takes effect at once
#endif
            }
            // saved the moment it's flipped (Settings > Bluetooth): only "1" turns it on
            if (request->hasArg("btStandby"))
                settings->setBtStandby(request->arg("btStandby") == "1");
            if (request->hasArg("lastGrinder") && request->arg("lastGrinder").length() <= 80)
                settings->setLastGrinder(request->arg("lastGrinder"));
            if (request->hasArg("lastBasket") && request->arg("lastBasket").length() <= 60)
                settings->setLastBasket(request->arg("lastBasket"));
            // Custom web theme colors (Settings > Theme > Custom).
            if (request->hasArg("themeBg") && isHexColor(request->arg("themeBg")))
                settings->setThemeBg(request->arg("themeBg"));
            if (request->hasArg("themeAccent") && isHexColor(request->arg("themeAccent")))
                settings->setThemeAccent(request->arg("themeAccent"));
            if (request->hasArg("themeText") && isHexColor(request->arg("themeText")))
                settings->setThemeText(request->arg("themeText"));
            if (request->hasArg("webTheme") && isThemeName(request->arg("webTheme")))
                settings->setWebTheme(request->arg("webTheme"));
            if (request->hasArg("holidayMode") && !request->arg("holidayMode").isEmpty() &&
                isThemeName(request->arg("holidayMode")))
                settings->setHolidayMode(request->arg("holidayMode"));
            if (request->hasArg("brewVideo") && isThemeName(request->arg("brewVideo")))
                settings->setBrewVideo(request->arg("brewVideo"));
            if (request->hasArg("keepTheme"))
                settings->setKeepTheme(request->arg("keepTheme") != "0");
            if (request->hasArg("brewVideoMode"))
                settings->setBrewVideoMode(request->arg("brewVideoMode") == "shuffle" ? "shuffle" : "fixed");
            if (request->hasArg("startupProfile"))
                settings->setStartupProfile(request->arg("startupProfile"));
            if (hasNumber("targetSteamTemp"))
                settings->setTargetSteamTemp(request->arg("targetSteamTemp").toInt());
            if (hasNumber("targetWaterTemp"))
                settings->setTargetWaterTemp(request->arg("targetWaterTemp").toInt());
            if (hasNumber("temperatureOffset"))
                settings->setTemperatureOffset(request->arg("temperatureOffset").toInt());
            if (hasNumber("pressureScaling")) {
                // 0 or junk would read 0 bar and run the pump flat out (audit S1-H4)
                const float ps = request->arg("pressureScaling").toFloat();
                if (std::isfinite(ps) && ps >= 1.0f && ps <= 50.0f)
                    settings->setPressureScaling(ps);
            }
            if (request->hasArg("pid"))
                settings->setPid(request->arg("pid"));
            if (request->hasArg("pumpModelCoeffs"))
                settings->setPumpModelCoeffs(request->arg("pumpModelCoeffs"));
            if (request->hasArg("pumpSlipCoeffs"))
                settings->setPumpSlipCoeffs(request->arg("pumpSlipCoeffs"));
            if (request->hasArg("wifiSsid"))
                settings->setWifiSsid(request->arg("wifiSsid"));
            if (request->hasArg("mdnsName"))
                settings->setMdnsName(request->arg("mdnsName"));
            if (request->hasArg("wifiPassword") && request->arg("wifiPassword") != "---unchanged---")
                settings->setWifiPassword(request->arg("wifiPassword"));
            if (request->hasArg("apPassword") && request->arg("apPassword").length() >= WIFI_AP_PASSWORD_MIN_LENGTH)
                settings->setWifiApPassword(request->arg("apPassword"));
            // On/off settings: the Settings page sends each one as "1" or "0", and one
            // missing from a save stays as it is. Missing used to mean off, so a
            // partial save (pump flow calibration, an older settings file) turned
            // every switch off.
            if (request->hasArg("homekit"))
                settings->setHomekit(request->arg("homekit") != "0");
            if (request->hasArg("boilerFillActive"))
                settings->setBoilerFillActive(request->arg("boilerFillActive") != "0");
            if (hasNumber("startupFillTime"))
                settings->setStartupFillTime(request->arg("startupFillTime").toInt() * 1000);
            if (hasNumber("steamFillTime"))
                settings->setSteamFillTime(request->arg("steamFillTime").toInt() * 1000);
            if (request->hasArg("smartGrindActive"))
                settings->setSmartGrindActive(request->arg("smartGrindActive") != "0");
            if (request->hasArg("smartGrindIp"))
                settings->setSmartGrindIp(request->arg("smartGrindIp"));
            if (hasNumber("smartGrindMode"))
                settings->setSmartGrindMode(request->arg("smartGrindMode").toInt());
            if (request->hasArg("homeAssistant"))
                settings->setHomeAssistant(request->arg("homeAssistant") != "0");
            if (request->hasArg("haUser"))
                settings->setHomeAssistantUser(request->arg("haUser"));
            if (request->hasArg("haPassword"))
                settings->setHomeAssistantPassword(request->arg("haPassword"));
            if (request->hasArg("haIP"))
                settings->setHomeAssistantIP(request->arg("haIP"));
            if (hasNumber("haPort"))
                settings->setHomeAssistantPort(request->arg("haPort").toInt());
            if (request->hasArg("haTopic"))
                settings->setHomeAssistantTopic(request->arg("haTopic"));
            if (request->hasArg("momentaryButtons"))
                settings->setMomentaryButtons(request->arg("momentaryButtons") != "0");
            if (request->hasArg("delayAdjust"))
                settings->setDelayAdjust(request->arg("delayAdjust") != "0");
            if (hasNumber("brewDelay"))
                settings->setBrewDelay(request->arg("brewDelay").toDouble());
            if (hasNumber("grindDelay"))
                settings->setGrindDelay(request->arg("grindDelay").toDouble());
            if (request->hasArg("timezone"))
                settings->setTimezone(request->arg("timezone"));
            if (request->hasArg("clock24hFormat"))
                settings->setClockFormat(request->arg("clock24hFormat") != "0");
            if (hasNumber("standbyTimeout"))
                settings->setStandbyTimeout(request->arg("standbyTimeout").toInt() * 1000);
            if (hasNumber("mainBrightness"))
                settings->setMainBrightness(request->arg("mainBrightness").toInt());
            if (hasNumber("standbyBrightness"))
                settings->setStandbyBrightness(request->arg("standbyBrightness").toInt());
            if (hasNumber("standbyBrightnessTimeout"))
                settings->setStandbyBrightnessTimeout(request->arg("standbyBrightnessTimeout").toInt() * 1000);
            if (hasNumber("steamPumpPercentage"))
                settings->setSteamPumpPercentage(request->arg("steamPumpPercentage").toFloat());
            if (hasNumber("steamPumpCutoff"))
                settings->setSteamPumpCutoff(request->arg("steamPumpCutoff").toFloat());
            if (hasNumber("themeMode"))
                settings->setThemeMode(request->arg("themeMode").toInt());
            if (request->hasArg("sunriseIdle"))
                settings->setSunriseIdle(request->arg("sunriseIdle"));
            if (request->hasArg("sunriseActive"))
                settings->setSunriseActive(request->arg("sunriseActive"));
            if (request->hasArg("sunriseFinished"))
                settings->setSunriseFinished(request->arg("sunriseFinished"));
            if (request->hasArg("sunriseError"))
                settings->setSunriseError(request->arg("sunriseError"));
            if (hasNumber("sunriseExtBrightness"))
                settings->setSunriseExtBrightness(request->arg("sunriseExtBrightness").toInt());
            if (hasNumber("emptyTankDistance"))
                settings->setEmptyTankDistance(request->arg("emptyTankDistance").toInt());
            if (hasNumber("fullTankDistance"))
                settings->setFullTankDistance(request->arg("fullTankDistance").toInt());
            if (hasNumber("altRelayFunction"))
                settings->setAltRelayFunction(request->arg("altRelayFunction").toInt());
            if (request->hasArg("buttonBehavior"))
                settings->setButtonBehaviorList(explode(request->arg("buttonBehavior"), ','));
            if (hasNumber("commutationGain"))
                settings->setCommutationGain(request->arg("commutationGain").toFloat());
            if (hasNumber("convergenceGain"))
                settings->setConvergenceGain(request->arg("convergenceGain").toFloat());
            if (hasNumber("integralGain"))
                settings->setIntegralGain(request->arg("integralGain").toFloat());
            if (hasNumber("maxPumpPower"))
                settings->setMaxPumpPower(request->arg("maxPumpPower").toFloat());
            if (request->hasArg("savedScale"))
                settings->setSavedScale(request->arg("savedScale"));
            if (request->hasArg("autowakeupEnabled"))
                settings->setAutoWakeupEnabled(request->arg("autowakeupEnabled") != "0");
            if (request->hasArg("autowakeupSchedules")) {
                // Handle schedule format with days
                String schedulesStr = request->arg("autowakeupSchedules");
                std::vector<AutoWakeupSchedule> schedules;

                if (schedulesStr.length() > 0) {
                    // Split semicolon-separated schedules
                    int start = 0;
                    int end = schedulesStr.indexOf(';');

                    while (end != -1 || start < schedulesStr.length()) {
                        String scheduleStr = (end != -1) ? schedulesStr.substring(start, end) : schedulesStr.substring(start);

                        int pipePos = scheduleStr.indexOf('|');
                        if (pipePos != -1) {
                            String timeStr = scheduleStr.substring(0, pipePos);
                            String daysStr = scheduleStr.substring(pipePos + 1);

                            AutoWakeupSchedule schedule;
                            schedule.time = timeStr;

                            if (daysStr.length() == 7) {
                                for (int i = 0; i < 7; i++) {
                                    schedule.days[i] = (daysStr.charAt(i) == '1');
                                }
                            }

                            schedules.push_back(schedule);
                        }

                        if (end == -1)
                            break;
                        start = end + 1;
                        end = schedulesStr.indexOf(';', start);
                    }
                }

                if (schedules.empty()) {
                    schedules.push_back(AutoWakeupSchedule("07:00")); // Default fallback
                }
                settings->setAutoWakeupSchedules(schedules);
            }
            settings->save(true);
        });
        // New Wi-Fi details saved while on the hotspot (a new board, the fallback
        // hotspot or the Setup Portal): restart into that network right away
        // instead of waiting for Save & Restart (user 2026-09-25). The hotspot's Wi-Fi page
        // sends wifiRetry: Save there always restarts and tries the router, even unchanged
        // (user 2026-10-14).
        if (apMode && !current.getWifiSsid().isEmpty() &&
            (request->hasArg("wifiRetry") || current.getWifiSsid() != oldSsid ||
             current.getWifiPassword() != oldPass)) {
            if (current.getBootIntoAp()) {
                current.setBootIntoAp(false);
                current.save(true);
            }
            restarting = true;
            wifiRestart = true;
        }
        pluginManager->trigger("settings:changed");
        // A theme pick or the "Auto themes" switch alone (the picker's fallback sends only that
        // field): the pages get the value in the message and read nothing back (2026-10-16).
        const bool themeOnly =
            request->args() == 1 && (request->hasArg("holidayMode") || request->hasArg("keepTheme"));
        markChanged(themeOnly ? CHANGED_THEME_PICK : CHANGED_SETTINGS);
        controller->setTargetTemp(controller->getTargetTemp());
        controller->setPumpModelCoeffs();
    }

    AsyncResponseStream *response = request->beginResponseStream("application/json");
    response->addHeader("Cache-Control", "no-store"); // phones kept an old copy
    JsonDocument doc(&psramAllocator);
    Settings const &settings = controller->getSettings();
    const int startupMode = settings.getStartupMode();
    doc["startupMode"] = startupMode == MODE_BREW ? "brew" : startupMode == MODE_MANUAL ? "manual" : "standby";
    doc["startupProfile"] = settings.getStartupProfile();
    doc["brewNumColor"] = settings.getBrewNumColor();
    doc["themeBg"] = settings.getThemeBg();
    doc["themeAccent"] = settings.getThemeAccent();
    doc["themeText"] = settings.getThemeText();
    doc["webTheme"] = settings.getWebTheme();
    doc["holidayMode"] = settings.getHolidayMode();
    doc["brewVideo"] = settings.getBrewVideo();
    doc["brewVideoMode"] = settings.getBrewVideoMode();
    doc["keepTheme"] = settings.isKeepTheme();
    // a built-in touchscreen (the original GaggiMate); without one, Settings hides Display Settings
#ifdef GAGGIMATE_HEADLESS
    doc["hasDisplay"] = false;
#else
    doc["hasDisplay"] = true;
#endif
    doc["brewNumOpacity"] = settings.getBrewNumOpacity();
    doc["brewNumSize"] = settings.getBrewNumSize();
    doc["chartTimer"] = settings.getChartTimer();
    doc["chartTimerOpacity"] = settings.getChartTimerOpacity();
    doc["chartTimerSize"] = settings.getChartTimerSize();
    doc["shotHistoryLimit"] = settings.getShotHistoryLimit();
    doc["saveManualShots"] = settings.isSaveManualShots();
    doc["heatUpCheck"] = settings.isHeatUpCheck();
    doc["btStandby"] = settings.isBtStandby();
#ifdef GAGGIMATE_MERGED
    {
        // The last heat-up check trip since the restart (Settings > Machine shows it red).
        extern bool gmGetHeatUpTrip(float &from, float &to, float &target, uint32_t &agoSec);
        float from, to, target;
        uint32_t ago;
        if (gmGetHeatUpTrip(from, to, target, ago)) {
            JsonObject trip = doc["heatUpTrip"].to<JsonObject>();
            trip["from"] = from;
            trip["to"] = to;
            trip["target"] = target;
            trip["ago"] = ago;
        }
    }
#endif
    doc["lastGrinder"] = settings.getLastGrinder();
    doc["lastBasket"] = settings.getLastBasket();
    doc["targetSteamTemp"] = settings.getTargetSteamTemp();
    doc["targetWaterTemp"] = settings.getTargetWaterTemp();
    doc["homekit"] = settings.isHomekit();
    doc["homeAssistant"] = settings.isHomeAssistant();
    doc["haUser"] = settings.getHomeAssistantUser();
    doc["haPassword"] = settings.getHomeAssistantPassword();
    doc["haIP"] = settings.getHomeAssistantIP();
    doc["haPort"] = settings.getHomeAssistantPort();
    doc["haTopic"] = settings.getHomeAssistantTopic();
    doc["pid"] = settings.getPid();
    doc["pumpModelCoeffs"] = settings.getPumpModelCoeffs();
    doc["pumpSlipCoeffs"] = settings.getPumpSlipCoeffs();
    doc["wifiSsid"] = settings.getWifiSsid();
    doc["wifiPassword"] = apMode ? "---unchanged---" : settings.getWifiPassword();
    doc["apPassword"] = settings.getWifiApPassword();
    doc["mdnsName"] = settings.getMdnsName();
    // Where to find the machine (Wi-Fi tab): its router address now, and the last one known.
    doc["ip"] = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : String("");
    doc["lastIp"] = settings.getLastIp();
    doc["temperatureOffset"] = String(settings.getTemperatureOffset());
    doc["pressureScaling"] = String(settings.getPressureScaling());
    doc["boilerFillActive"] = settings.isBoilerFillActive();
    doc["startupFillTime"] = settings.getStartupFillTime() / 1000;
    doc["steamFillTime"] = settings.getSteamFillTime() / 1000;
    doc["smartGrindActive"] = settings.isSmartGrindActive();
    doc["smartGrindIp"] = settings.getSmartGrindIp();
    doc["smartGrindMode"] = settings.getSmartGrindMode();
    doc["momentaryButtons"] = settings.isMomentaryButtons();
    doc["brewDelay"] = settings.getBrewDelay();
    doc["grindDelay"] = settings.getGrindDelay();
    doc["delayAdjust"] = settings.isDelayAdjust();
    doc["timezone"] = settings.getTimezone();
    doc["clock24hFormat"] = settings.isClock24hFormat();
    doc["standbyTimeout"] = settings.getStandbyTimeout() / 1000;
    doc["mainBrightness"] = settings.getMainBrightness();
    doc["standbyBrightness"] = settings.getStandbyBrightness();
    doc["standbyBrightnessTimeout"] = settings.getStandbyBrightnessTimeout() / 1000;
    doc["steamPumpPercentage"] = settings.getSteamPumpPercentage();
    doc["steamPumpCutoff"] = settings.getSteamPumpCutoff();
    doc["themeMode"] = settings.getThemeMode();
    doc["sunriseIdle"] = settings.getSunriseIdle();
    doc["sunriseActive"] = settings.getSunriseActive();
    doc["sunriseFinished"] = settings.getSunriseFinished();
    doc["sunriseError"] = settings.getSunriseError();
    doc["sunriseExtBrightness"] = settings.getSunriseExtBrightness();
    doc["emptyTankDistance"] = settings.getEmptyTankDistance();
    doc["fullTankDistance"] = settings.getFullTankDistance();
    doc["altRelayFunction"] = settings.getAltRelayFunction();
    // Add auto-wakeup settings to response
    doc["autowakeupEnabled"] = settings.isAutoWakeupEnabled();
    doc["buttonBehavior"] = implode(settings.getButtonBehaviorList(), ",");
    doc["commutationGain"] = settings.getCommutationGain();
    doc["convergenceGain"] = settings.getConvergenceGain();
    doc["integralGain"] = settings.getIntegralGain();
    doc["maxPumpPower"] = settings.getMaxPumpPower();
    doc["savedScale"] = settings.getSavedScale();

    // Add schedule format with days
    std::vector<AutoWakeupSchedule> autowakeupSchedules = settings.getAutoWakeupSchedules();
    String schedulesStr = "";
    for (size_t i = 0; i < autowakeupSchedules.size(); i++) {
        if (i > 0)
            schedulesStr += ";";
        schedulesStr += autowakeupSchedules[i].time + "|";

        // Convert days array to 7-bit string
        for (int j = 0; j < 7; j++) {
            schedulesStr += autowakeupSchedules[i].days[j] ? "1" : "0";
        }
    }
    doc["autowakeupSchedules"] = schedulesStr;
    if (restarting)
        doc["restarting"] = true; // the page shows "restarting" instead of "Saved"
    serializeJson(doc, *response);
    request->send(response);

    // After the answer: restarting right away cut it off, and the page took a
    // finished save for a failed one.
    if (restarting)
        restartSoon(wifiRestart ? 5000 : 1000);
}

void WebUIPlugin::handleBLEScaleList(AsyncWebServerRequest *request) {
    JsonDocument doc(&psramAllocator);
    JsonArray scalesArray = doc.to<JsonArray>();
    std::vector<DiscoveredDevice> devices = BLEScales.getDiscoveredScales();
    for (const DiscoveredDevice &device : BLEScales.getDiscoveredScales()) {
        JsonDocument scale(&psramAllocator);
        scale["uuid"] = device.getAddress().toString();
        scale["name"] = device.getName();
        scale["rssi"] = device.getRSSI();
        scalesArray.add(scale);
    }
    AsyncResponseStream *response = request->beginResponseStream("application/json");
    serializeJson(doc, *response);
    request->send(response);
}

void WebUIPlugin::handleBLEScaleScan(AsyncWebServerRequest *request) {
    if (request->method() != HTTP_POST) {
        request->send(404);
        return;
    }
    BLEScales.scan();
    JsonDocument doc(&psramAllocator);
    doc["success"] = true;
    AsyncResponseStream *response = request->beginResponseStream("application/json");
    serializeJson(doc, *response);
    request->send(response);
}

void WebUIPlugin::handleBLEScaleConnect(AsyncWebServerRequest *request) {
    if (request->method() != HTTP_POST) {
        request->send(404);
        return;
    }
    BLEScales.connect(request->arg("uuid").c_str());
    JsonDocument doc(&psramAllocator);
    doc["success"] = true;
    AsyncResponseStream *response = request->beginResponseStream("application/json");
    serializeJson(doc, *response);
    request->send(response);
}

void WebUIPlugin::handleBLEScaleInfo(AsyncWebServerRequest *request) {
    JsonDocument doc(&psramAllocator);
    doc["connected"] = BLEScales.isConnected();
    doc["name"] = BLEScales.getName();
    doc["uuid"] = BLEScales.getUUID();
    doc["rssi"] = BLEScales.getRSSI();
    doc["hasBattery"] = BLEScales.hasBatteryLevel();
    // Only surface the numeric when the scale reports one — a 255 sentinel
    // (REMOTE_SCALES_BATTERY_UNKNOWN) would otherwise render as a fake "255%".
    if (BLEScales.hasBatteryLevel()) {
        const uint8_t pct = BLEScales.getBatteryLevel();
        if (pct != REMOTE_SCALES_BATTERY_UNKNOWN) {
            doc["battery"] = pct;
        }
    }
    AsyncResponseStream *response = request->beginResponseStream("application/json");
    serializeJson(doc, *response);
    request->send(response);
}

void WebUIPlugin::updateOTAStatus(const String &version) {
    if (ws.getClients().empty()) {
        return;
    }
    Settings const &settings = controller->getSettings();
    JsonDocument doc(&psramAllocator);
    doc["latestVersion"] = ota->getCurrentVersion();
    doc["tp"] = "res:ota-settings";
    doc["displayUpdateAvailable"] = ota->isUpdateAvailable(false);
    doc["controllerUpdateAvailable"] = ota->isUpdateAvailable(true);
    doc["displayVersion"] = BUILD_GIT_VERSION;
    doc["controllerVersion"] = controller->getSystemInfo().version;
    doc["hardware"] = controller->getSystemInfo().hardware;
    doc["latestVersion"] = ota->getCurrentVersion();
    doc["channel"] = settings.getOTAChannel();
    doc["updating"] = updating;
    // LittleFS usage metrics
    {
        size_t total = storageTotalBytes();
        size_t used = total - storageFreeBytes(); // kept a while: counting walks the whole storage
        size_t freeBytes = total > used ? (total - used) : 0;
        doc["spiffsTotal"] = static_cast<uint32_t>(total);
        doc["spiffsUsed"] = static_cast<uint32_t>(used);
        doc["spiffsFree"] = static_cast<uint32_t>(freeBytes);
        if (total > 0) {
            doc["spiffsUsedPct"] = static_cast<uint8_t>((used * 100) / total);
        }
    }
    // Memory usage metrics
    {
        size_t free = heap_caps_get_free_size(MALLOC_CAP_DEFAULT | MALLOC_CAP_INTERNAL);
        size_t largest = heap_caps_get_largest_free_block(MALLOC_CAP_DEFAULT | MALLOC_CAP_INTERNAL);
        size_t total = heap_caps_get_total_size(MALLOC_CAP_DEFAULT | MALLOC_CAP_INTERNAL);
        doc["heapFree"] = static_cast<uint32_t>(free);
        doc["heapLargest"] = static_cast<uint32_t>(largest);
        doc["heapTotal"] = static_cast<uint32_t>(total);
    }
    doc["controllerTaskHealth"] = controller->isTaskHealthy();
#ifndef GAGGIMATE_HEADLESS
    doc["uiTaskHealth"] = controller->getUI()->isTaskHealthy();
#endif
    if (controller->isSDCard()) {
        const uint64_t total = SD_MMC.cardSize();
        const uint64_t used = SD_MMC.usedBytes();
        const uint64_t freeBytes = total > used ? (total - used) : 0;
        doc["sdTotal"] = total;
        doc["sdUsed"] = used;
        doc["sdFree"] = freeBytes;
        if (total > 0) {
            // Provide integer percentage to avoid float JSON
            doc["sdUsedPct"] = static_cast<uint8_t>((used * 100) / total);
        }
    }
    broadcastJson(doc);
}

void WebUIPlugin::updateOTAProgress(uint8_t phase, int progress) {
    if (ws.getClients().empty()) {
        return;
    }
    JsonDocument doc(&psramAllocator);
    doc["tp"] = "evt:ota-progress";
    doc["phase"] = phase;
    doc["progress"] = progress;
    broadcastJson(doc);
}

void WebUIPlugin::broadcastJson(JsonDocument &doc) {
    if (ws.getClients().empty()) {
        return;
    }
    ws.textAll(toWsBuffer(doc));
}

// The status is a snapshot, so one still waiting in a client's queue is
// already stale. On the lossy Wi-Fi the queue used to back up during a shot
// (timer delivered ~10 s late, then jumping); skip that client this tick so
// it only ever gets the newest. Same client walk as textAll().
// The link's TCP state for a "WS drop" line (2026-10-21, build 958), to show why its status
// messages stayed unconfirmed: q status messages queued, rx resends of the oldest data out, rto
// resend timer (ms), wnd the device's free receive space, cw the machine's send window, zw>0 the
// device's space was full, out bytes sent and not yet confirmed, wait bytes queued, not yet sent.
static void wsTcpState(AsyncClient *c, size_t queued, char *out, size_t cap) {
    tcp_pcb *pcb = c ? c->pcb() : nullptr;
    if (!pcb) {
        snprintf(out, cap, " q=%u nopcb", (unsigned)queued);
        return;
    }
    snprintf(out, cap, " q=%u rx=%u rto=%u wnd=%u cw=%u zw=%u out=%u wait=%u", (unsigned)queued, (unsigned)pcb->nrtx,
             (unsigned)pcb->rto * 500, (unsigned)pcb->snd_wnd, (unsigned)pcb->cwnd, (unsigned)pcb->persist_backoff,
             (unsigned)(pcb->snd_nxt - pcb->lastack), (unsigned)(pcb->snd_lbb - pcb->snd_nxt));
}

void WebUIPlugin::broadcastStatus(JsonDocument &doc) {
    if (ws.getClients().empty()) {
        return;
    }
    AsyncWebSocketSharedBuffer buffer = toWsBuffer(doc);
    // Hold the list lock while walking it (audit S5-H3): a tab closing on another task
    // used to remove its entry under this loop.
    const unsigned long now = millis();
    if (statusLastAt != 0 && now - statusLastAt > statusGapNow)
        statusGapNow = now - statusLastAt;
    statusLastAt = now;
    if (now - statusMinuteStart >= 60000) {
        statusGapPrev = statusGapNow;
        statusGapNow = 0;
        statusMinuteStart = now;
    }
    std::lock_guard<std::recursive_mutex> clientsGuard(ws.clientsLock());
    std::lock_guard<std::mutex> statsGuard(wsStatsMutex);
    for (auto &client : ws.getClients()) {
        // closing (2026-10-20): its connection is closed by async_tcp within ~0.5 s; no new drop line
        if (client.status() != WS_CONNECTED || client.closeRequested()) {
            continue;
        }
        WsClientStat &stat = wsStats[client.id()];
        // 2026-10-10: a peer that stopped ACKing pins the Wi-Fi driver's TX buffer pool, so
        // every send on the machine fails (errno 12) until the watchdog's full reconnect. Close
        // that one peer here (proven-safe loop) to free the pool before the 15 s freeze.
        if (client.client() != nullptr && client.client()->space() == 0) {
            if (stat.zeroWindowSince == 0)
                stat.zeroWindowSince = now;
        } else {
            stat.zeroWindowSince = 0;
        }
        const unsigned long zeroFor = stat.zeroWindowSince ? now - stat.zeroWindowSince : 0;
        if (stat.connectedAt && zeroFor > 2500 && client.client() != nullptr) {
            ESP_LOGW("WebUIPlugin", "Dropping %s: peer send window pinned %lu ms (not ACKing)",
                     stat.ip.c_str(), zeroFor);
            char tcp[96];
            wsTcpState(client.client(), client.queueLen(), tcp, sizeof(tcp));
            dlzlog("WS drop %s: send window pinned %lums%s", stat.ip.c_str(), zeroFor, tcp);
            stat.droppedByMachine = true;
            client.requestClose(); // closed by async_tcp, never under a running request (review 1.1)
            continue;
        }
        const size_t queued = client.queueLen();
        if (queued == 0) {
            client.text(buffer);
            stat.sent++;
            stat.lastStatusAt = now;
        } else {
            stat.skipped++;
            // Skipped while its queue is busy; a queue that never drains (a dead or stalled
            // link) left the page frozen for minutes, never full enough to be closed (user
            // 2026-10-09). After 5 s without an update, drop the link: the memory comes back
            // and the page reconnects. Safe inside this loop: a disconnect no longer erases.
            const unsigned long since = now - (stat.lastStatusAt ? stat.lastStatusAt : stat.connectedAt);
            if (stat.connectedAt && since > 5000 && client.client() != nullptr) {
                ESP_LOGW("WebUIPlugin", "Dropping %s: no update for %lu ms", stat.ip.c_str(), since);
                char tcp[96];
                wsTcpState(client.client(), queued, tcp, sizeof(tcp));
                dlzlog("WS drop %s: no update %lums%s", stat.ip.c_str(), since, tcp);
                stat.droppedByMachine = true;
                client.requestClose(); // closed by async_tcp, never under a running request (review 1.1)
            }
        }
        stat.lastQueue = queued;
    }
}

void WebUIPlugin::sendAutotuneResult() {
    JsonDocument doc(&psramAllocator);
    doc["tp"] = "evt:autotune-result";
    doc["pid"] = controller->getSettings().getPid();
    broadcastJson(doc);
}

void WebUIPlugin::sendAutotuneFailed() {
    // Distinct WS event — Autotune page renders "timed out" error card
    // instead of stuck spinner. Fires on ERROR_CODE_AUTOTUNE_TIMEOUT.
    JsonDocument doc(&psramAllocator);
    doc["tp"] = "evt:autotune-failed";
    broadcastJson(doc);
}

void WebUIPlugin::handleFlushStart(uint32_t clientId, JsonDocument &request) {
    controller->onFlush();

    JsonDocument response(&psramAllocator);
    response["tp"] = "res:flush:start";
    response["rid"] = request["rid"];
    response["success"] = true;
    ws.text(clientId, toWsBuffer(response));
}

void WebUIPlugin::handleCoreDumpDownload(AsyncWebServerRequest *request) {
    // Check if core dump is available
    size_t coreAddr, coreSize;
    if (esp_core_dump_image_get(&coreAddr, &coreSize) != ESP_OK || coreSize == 0) {
        request->send(404, "text/plain", "No core dump available");
        return;
    }

    // Find the coredump partition
    const esp_partition_t *coredump_partition =
        esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_COREDUMP, NULL);
    if (coredump_partition == NULL) {
        request->send(500, "text/plain", "Core dump partition not found");
        return;
    }

    ESP_LOGI("WebUIPlugin", "Streaming core dump: %d bytes from 0x%x", coreSize, coreAddr);

    // Create a streaming response
    AsyncWebServerResponse *response =
        request->beginResponse("application/octet-stream", coreSize,
                               [coredump_partition, coreSize](uint8_t *buffer, size_t maxLen, size_t index) -> size_t {
                                   // Calculate how much to read
                                   size_t remaining = coreSize - index;
                                   size_t toRead = (remaining < maxLen) ? remaining : maxLen;

                                   if (toRead == 0)
                                       return 0;

                                   // Read from partition
                                   esp_err_t err = esp_partition_read(coredump_partition, index, buffer, toRead);
                                   if (err != ESP_OK) {
                                       ESP_LOGE("WebUIPlugin", "Failed to read core dump: %s", esp_err_to_name(err));
                                       return 0;
                                   }

                                   return toRead;
                               });

    // Set appropriate headers
    response->addHeader("Content-Disposition", "attachment; filename=\"coredump.bin\"");
    response->addHeader("Cache-Control", "no-cache");

    request->send(response);
}

#ifdef GAGGIMATE_MERGED
// ============================================================================
// Merged single-board diagnostics support. This block sits AFTER every other
// include on purpose: ble_ota_dfu.hpp (pulled in transitively by the
// GaggiMateController headers) defines SERVICE_OTA_BLE_UUID etc. at global
// scope and collides with lib/OTA/src/ControllerOTA.h already included above.
// To avoid touching third-party headers, the bridge uses a layout-compatible
// plain struct + extern "C"-style accessor implemented in main.cpp, so no
// GaggiMateController header is needed here at all.
// ============================================================================
// Field-for-field mirror of GaggiMateController::Diagnostics (see
// lib/GaggiMateController/src/GaggiMateController.h). Keep in sync; static-
// asserted in main.cpp.
struct GmDiagnosticsMirror {
    bool maxPresent;
    float temperature;
    uint16_t maxRtd;
    uint8_t maxFault;
    int maxErrorCount;
    bool adsConnected;
    int adsRaw;
    float adsVolts;
    float pressureBar;
    float heaterDuty;
    float pumpPower;
    long pumpZeroCross;
    unsigned int pumpCps;
    uint32_t errorCode;
};
extern bool getGmDiagnosticsMirror(GmDiagnosticsMirror &out);

void fillMergedDiagnostics(JsonDocument &doc) {
    GmDiagnosticsMirror d;
    if (!getGmDiagnosticsMirror(d)) {
        return;
    }
    doc["merged"] = true;
    JsonDocument max;
    max["present"] = d.maxPresent;
    max["temperature"] = d.temperature;
    max["rtd"] = d.maxRtd;
    max["fault"] = d.maxFault;
    max["errorCount"] = d.maxErrorCount;
    doc["max31865"] = max;
    JsonDocument ads;
    ads["connected"] = d.adsConnected;
    ads["raw"] = d.adsRaw;
    ads["volts"] = d.adsVolts;
    ads["pressureBar"] = d.pressureBar;
    doc["ads1115"] = ads;
    JsonDocument act;
    act["heaterDuty"] = d.heaterDuty;
    act["pumpPower"] = d.pumpPower;
    act["pumpZeroCross"] = d.pumpZeroCross;
    act["pumpCps"] = d.pumpCps;
    act["errorCode"] = d.errorCode;
    doc["actuators"] = act;
}
#endif

