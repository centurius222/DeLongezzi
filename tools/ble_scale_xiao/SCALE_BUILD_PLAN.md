# Best Home Espresso Scale — Build Plan (XIAO + NAU7802 + NV3007)

Source: distilled from 4 comparison docs (WeighMyBru², coffee-scale-app,
AcaiaArduinoBLE, OpenScale, EspressiScale deep dive). Licenses ignored — home
use only. Hardware already decided; this is the plan to make it the best it can
be, in the ordered phases that proved successful.

========================================================
THE ONE RULE (every doc agrees, do not break it)
========================================================
Three layers, never mixed:
   Machine (GaggiMate/Decent)  <- BLE protocol
   Scale protocol              <- packets/commands/timestamp
   Measurement engine          <- load cell, ADC, cal, filter, flow
Everything flows as one struct and nothing below knows about anything above:

   LoadCell -> MeasurementEngine -> ScaleState -> { TFT | BLE | Buzzer }

Consumers (TFT, BLE, UI) NEVER touch the ADC. The measurement engine never
knows a protocol exists.

========================================================
HARDWARE (decided, confirmed)
========================================================
XIAO ESP32-S3. Final pin map (10 of 11 GPIO, spare D9):

   NAU7802 I2C   : SDA->D4 (GPIO5), SCL->D5 (GPIO6)
                   AVDD+DVDD->3V3, GND->GND, 0.1uF across AVDD/AVSS at module
   Load cell     : -> NAU7802 A+/A- differential
   NV3007 TFT    : SCK->D8, MOSI->D10, DC->D1, RES->D0, CS->D6  (SPI)
                   BL -> tied to 3V3 (always on, no BL pin)
   Touch x2      : D3 (GPIO4)=POUR, D2 (GPIO3)=TARE   [D2 is strapping-pin
                   exception: high-Z capacitive read is safe]
   Buzzer        : D7 (GPIO44)   [gives up wired serial input]
Confirm the TFT 8-pin order when it arrives (P/N varies).

========================================================
ARCHITECTURE (from start3/deep-dive — build it clean, not one main.cpp)
========================================================
ADC abstraction (the deep-dive's best idea):
   LoadCellADC { begin(); available(); readRaw(); }   // class
   LoadCellADC -> NAU7802Driver                       // swap HW later, engine untouched
   Use the EXISTING SparkFun_Qwiic_Scale_NAU7802_Arduino_Library for the
   driver (verified: begin/LDO/PGA, tare, calibration, stable weight).
Display (NV3007): use an existing driver — LVGL's native NV3007, or the
   TFT_eSPI community config for this panel (verified). Pick a driver; don't
   reverse-engineer the controller.

Measurement engine (the "real scale" part — priority #1):
   raw counts -> outlier rejection -> tare offset -> grams-per-count
              -> filter -> grams -> flow -> ScaleState

Calibration model (start2, corrected; review refinement):
   grams = (raw - zeroOffset) * gramsPerCount
   TARE : 100-500 samples, reject outliers, median/average -> zeroOffset
   CAL  : tare, put known mass (100/200 g), capture raw -> gramsPerCount
   Persist in NVS with version + timestamp (so a stale/unvalidated cal can be
   detected), and consider double for gramsPerCount — large NAU7802 raw number
   times a small gain.

Filtering (deep-dive judgment — do NOT default to Kalman):
   Activity-switched, adapted from WeighMyBru²:
     IDLE    : smooth, stable, low jitter   (avg of 2)
     POURING : fast, low latency            (median of 3)
     big change > 5 g : bypass filter
   THEN test under pump vibration, cup placement, water hit, tare, shot
   start/end. Add Kalman (from coffee-scale-app) ONLY if it proves needed.

ScaleState (everything consumes this; review refinement adds timestamp/overloaded):
   struct ScaleState {
     float grams; float flow_g_s; float battery;
     bool stable; bool pouring; bool overloaded;
     uint32_t timestamp_ms;   // when this measurement was generated — flow uses
                              // this, never BLE packet arrival time
     uint32_t timer_ms;       // espresso shot timer
     uint32_t seq;
   };
   weight + flow + timestamp + sequence (seq lets the machine detect loss).

Firmware layout (from start3):
   src/
     main.cpp
     hardware/   NAU7802Driver, NV3007Display, Touch, Buzzer, Pins.h
     scale/      MeasurementEngine, Calibration, Filter, Stability
     coffee/     FlowRate, BrewTimer
     protocol/   DecentBLE, GaggiMateBLE, GenericBLE
     storage/    Settings (NVS)
     ui/         ScreenManager

========================================================
THE BLE PROTOCOL (Decent primary — because GaggiMate ships a Decent driver)
========================================================
Decent Scale protocol, from the deep-dive appendix (source-read numbers):
   Device: "Decent Scale"; Service FFF0; Write 36F5; Notify FFF4
   Weight: 10 Hz, frame 03 CE HH LL 00 00 XX  (signed int16 BE, tenths of g,
            ROUND not truncate, XOR checksum)
   Commands (byte1): 0x0F tare, 0x0B timer start/stop/zero,
                     0x1C buzzer (00 off, 01 on, 02 beep), 0x0A display/power
   Heartbeat flag: if set, disconnect after 5 s without heartbeat.

   Keep the existing WeighMyBru 20-byte path as V1 — it is the WORKING link to
   our GaggiMate today, so it stays first and gets the real measurements. Add
   Decent as V2 for future DE1 reach. None of the protocols owns the weight
   calculation — they all just consume ScaleState.

Bugs to NOT copy (deep-dive section 6):
   - no blocking ADC read inside a BLE write callback (WeighMyBru/Espressi)
   - no delay(1000) debounce that stalls the loop (Espressi)
   - round (not truncate) when encoding weight (Espressi)
   - enforce the checksum (Espressi logs it but doesn't check)
   - set a hotspot password + do not expose wifi creds in plaintext even at
     home (WeighMyBru)
   - actually notify the messages you build (WeighMyBru sets but never notifies)

========================================================
PHASED BUILD ORDER (deep-dive / start3 — hardware before BLE, always)
========================================================
Phase 0 - bare NAU7802 raw read loop to serial + MECHANICAL MOUNT:
   raw=12345678, raw=12345681, ... with the cell still. Confirm the ADC answers
   and the pin/driver work before anything else. THIS phase also includes the
   mechanical mounting work (rigid cell mount, damped feet, decoupled from the
   machine body) — the pump-vibration rejection has to be built in, not patched.
   FIRST, though, scaffold the code: split tools/ble_scale_xiao/main.cpp into
   the src/ layout the plan describes (hardware/, scale/, coffee/, protocol/,
   storage/, ui/) so Phase 0 lands in the target shape, not a ball-of-code to
   retrofit later.
Phase 1 - calibration: tare + 100/200/500g -> accurate 0.00/100.00/...g,
          persisted to NVS.
Phase 2 - filtering + stability + RAW-DATA LOGGING: before tuning any filter,
          add a debug mode that logs {timestamp, raw, filtered, grams, flow}.
          Then physically test the scale ON the machine: pump off/on, cup
          placed/removed, water pouring, tamping, machine vibration. Choose and
          tune the filter to THAT measured noise (not a menu pick). Verify
          response time stays fast under pour conditions.
Phase 3 - NV3007 TFT readout: big weight, g/s, timer (25.37 / 2.31 g/s /
          00:08.42) consuming ScaleState only.
Phase 4 - touch (D3 pour, D2 tare) + buzzer (D7) feedback.
Phase 5 - BLE: real grams -> Decent frame @ 10 Hz, then tare/timer/buzzer cmds.
Phase 6 - machine integration: scale -> BLE -> GaggiMate -> machine.
(NOT in V1: Kalman, WiFi, OTA, web UI, shot logging, multi-type decode.)

Why this order: a beautiful BLE stack is worthless if the scale has 0.5-1 g of
vibration noise. Prove the measurement + mechanics first — that is 80% of what
makes a good espresso scale.

========================================================
REUSE FROM OUR EXISTING FIRMWARE
========================================================
tools/ble_scale_xiao/main.cpp (current sim) already has, verified working:
   - WeighMyBru 20-byte BLE streaming + framework
   - touch pour/tare + debounce
   - web control surface
KEEP: BLE task structure, touch patterns, tare-command handling.
REPLACE: the fake pour model + simulated weight -> real NAU7802 reads. The
sim's updatePour()/weight integration goes away entirely.

The deep-dive's final note that matters most here: NAU7802 + the mechanical
load-cell mount are the true determiners of final quality. Get the mechanics
and ADC right first; the rest is proven patterns.

========================================================
SPECIAL SECTION — BEYOND THE FIVE PROJECTS (how a best-from-first-principles
scale would differ; NOT in V1, kept as the explicitly-better road)
========================================================
The plan above is the practical home build — compiled from five proven
projects, correct for THIS machine and budget. The three ideas below are what
a genuinely best scale would do that NONE of the five does. More work, and two
need machine cooperation we may not have. Recorded so nobody mistakes the
practical build for the theoretical ceiling.

(1) PUMP-GATED FILTERING (ask the machine, do not guess)
    Every project infers "we're brewing" from weight deltas, then switches the
    filter. But the weight wobble IS the noise — so the decision is made from
    the very signal that is broken. A better design gets a one-bit "pump on"
    signal from the machine when it commands the pump, and switches the filter
    deterministically (fast=pouring, smooth=idle) instead of threshold-searching
    a shaking number.
    Gate: only if our GaggiMate exposes brew/pump state to the scale — check
    before designing around it; if not, keep weight-inference as the fallback.

(2) MECHANICAL DAMPING AS A FIRST-CLASS REQUIREMENT
    The filters are all patching a physical problem: pump harmonics vibrating
    the load-cell mount. The best scale kills the noise at the source —
    rigid cell mount, damped feet, mechanically decoupled from the machine
    body. Treat this as equal in weight to the code; the best filter cannot
    out-resolve a mount that shakes.

(3) MEASURE THE NOISE, THEN CHOOSE THE FILTER
    The docs argue median vs Kalman vs exponential as if it were a contest.
    Wrong frame. Record the actual noise spectrum on THIS bench with the pump
    running, then design/tune the filter to that measurement — real data, not
    a menu pick. Do this once in Phase 2 and keep the spectrum for reference.

ORDER OF VALUE (honest): (2) mechanical mount is the highest-ROI "best" upgrade
and needs no machine cooperation — do it as part of V1 even though it is not a
code phase. (1) pump-gating is the biggest software win but is gated on what
the machine exposes. (3) is a deliberate practice, not a feature.

========================================================
HONEST GAPS — VERIFIED vs ASSUMED (read this before trusting any "feature")
========================================================
Everything above that depends on a specific part is tagged below. Anything
marked [assumed] was NOT checked against our actual hardware — treat it as a
hypothesis until the part is in hand.

1. NAU7802 ADC driver — [NOW VERIFIED: library EXISTS]. SparkFun Qwiic Scale
   NAU7802 Arduino Library (SparkFun_Qwiic_Scale_NAU7802_Arduino_Library)
   provides begin/LDO/PGA config, tare, calibration and stable-weight reading;
   forks add external-reference and ESP32+MQTT examples. We build ON this, not
   from scratch. (No NAU7802 *coffee-scale* project exists upstream, so the
   machine-side plumbing is still ours — but the ADC driver is a solved problem.)

1b. MACHINE-SIDE PICKUP — [VERIFIED LIVE 2026-09-11]. Real XIAO scale at
   one address + real machine at another on the home network: machine discovered WeighMyBru-
   Sim (its Bluetooth address, RSSI -46) via /api/scales/scan, connected, reported
   connected:true. The scale->BLE->GaggiMate link is proven on real hardware
   today. What remains unproven is only real-weight measurement (the fake-model
   "grams"), which Phases 0-1 build.

2. 0.1 g precision cap — [verified, and it limits us]. The Decent BLE frame
   sends weight as signed int16 in TENTHS of a gram. So regardless of the
   NAU7802's 24-bit resolution, the value is quantized to 0.1 g at the wire.
   The "beat the noise" goal is about the FILTERED number the scale SHOWS, not
   what the machine receives. Do not sell the NAU7802 as "more BLE precision" —
   its resolution buys a stable local display, not a finer BLE signal.

3. Load-cell range — [RESOLVED 2026-09-11]. 750 g (47x12x6 mm) cell. Fine for
   cup-on-scale weighing (~250 g max); would be tight for a full portafilter.
   Wires: input Red+/Black-, output Blue+/White- (-> NAU7802 A+/A-).
   EXCITATION DECISION: spec says 10 V recommended; user chose to try running
   at 3.7 V first and measure what signal/noise we actually get in Phase 0.
   If Phase 0 shows weak signal/noise, revisit: 10 V bridge rail, or a
   lower-excitation cell. Do NOT assume the 3.7 V path hits the noise goal —
   verify it before building the filter around it.

4. NV3007 controller — [NOW VERIFIED: drivers EXIST]. Three proven options:
   LVGL ships a native NV3007 driver (Arduino SPI example for 142x428, rotation
   + gap config); TFT_eSPI has a community config for this exact 2.79" panel
   ("test ok"); LovyanGFX has an open request. Bring-up = pick a driver, not
   reverse-engineer a controller. Remaining work is SPI wiring + which driver,
   not the blank-screen long pole originally feared.

5. Licenses — [verified, home-use-moot]. WeighMyBru² (CC BY-NC-SA 4.0) and
   EspressiScale (custom non-commercial) prohibit commercial use; our existing
   main.cpp is built on the WeighMyBru protocol. Fine for personal use, but if
   this ever became a product, that's a hard wall. NOTE: SparkFun NAU7802 lib
   is open-source, attribution + share-alike — fine for personal use.

6. Battery level — [NOT a feature; requires added hardware]. The XIAO has no
   onboard battery-monitor; measuring it needs a voltage-divider circuit + an
   ADC pin we have not allotted. Listed earlier by mistake — corrected.

========================================================
BACKEND / WEB (POST-V1 — optional; source-verified comparison)
========================================================
Only openscale has a real-time backend: ONE WebSocket endpoint ("/snapshot")
that PUSHES weight on a negotiated rate (2/5/10 Hz) driven by the same weight
tick that feeds BLE/USB — one measurement clock, all transports. WeighMyBru²
has NO WebSocket: its 45 REST routes are polled by the browser. EspressiScale
streams no weight over HTTP (BLE only). coffee-scale-app has no backend at all
(Web Bluetooth to a phone PWA).

If we ever add one: copy openscale's model — one WebSocket pushing ScaleState
at a settable rate, commands (tare/timer/rate) over the same socket. NOT the
WeighMyBru² polling style. Layered AFTER the scale measures correctly; not V1.

========================================================
KNOWN FUTURE WORK (explicitly out of V1 — acknowledged, not forgotten)
========================================================
- Power management: battery cell, charging, sleep modes (no battery in the
  current parts list; add the logic when hardware lands).
- Per-layer sample-rate tuning (80-100 Hz internal vs 10-20 Hz BLE).
- Higher calibration depth (temperature/zero-drift tracking, cal timestamp).
- WiFi / OTA / web-calibration UI, shot logging, multi-protocol decode.