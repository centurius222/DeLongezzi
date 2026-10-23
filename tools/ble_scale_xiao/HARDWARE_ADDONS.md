XIAO ESP32-S3 BLE SCALE — HARDWARE ADD-ON PLAN
=============================================
Last updated: 2026-09-10

Goal: add a local readout display (NV3007 TFT) + a clean load-cell ADC
(NAU7802) to the XIAO scale, alongside the existing BLE weight streaming.

Sub-goal this ADC is chosen for: beat the "annoying noise" in brew-by-weight
readings. NAU7802 chosen over HX711 for its ~50nV input noise, true 24-bit
resolution, and internal autocalibration. HX711 is cheaper/more-proven but
noisier at low grams (what matters for brew-by-weight).


BOARD PIN FACTS
---------------
XIAO ESP32-S3:
  I2C         : SDA = D4 (GPIO5), SCL = D5 (GPIO6)   <- NOT machine's SDA42/SCL41
  SPI         : SCK = D8 (GPIO7), MOSI = D10 (GPIO9), MISO = D9 (GPIO8, unused)
  Touch       : works on D0..D10 (GPIO1-9), incl D2=GPIO3
  Avoid       : D2 (GPIO3) = strapping (JTAG select) — used here anyway as touch
                (high-impedance capacitive read does not force boot state)
  Note        : D7 (GPIO44) = UART RX — used as buzzer, so no wired serial input


FINAL PIN MAP  (screen prioritized; BL hard-wired to 3V3 = always-on backlight)
-----------------------------------------------------------------------------
NAU7802 (I2C)      : SDA -> D4 (GPIO5), SCL -> D5 (GPIO6)
                     AVDD+DVDD -> 3V3, GND -> GND
                     0.1uF across AVDD/AVSS at the module
                     Load cell -> A+/A- differential inputs
SPI TFT (NV3007)   : SCK -> D8 (GPIO7), MOSI/SDA -> D10 (GPIO9)
                     DC -> D1 (GPIO2), RES -> D0 (GPIO1), CS -> D6 (GPIO43)
                     BL -> tied to 3V3 (always on). NO GPIO for BL.
                     VCC -> 3V3 (or 5V if module expects), GND -> GND
Touch x2           : D3 (GPIO4) = pour (existing), D2 (GPIO3) = ...touch button
Buzzer             : D7 (GPIO44)

Pin accounting: 10 of 11 GPIOs used (D0,D1,D2,D3,D4,D5,D6,D7,D8,D10). Spare = D9.
SPI and I2C do not overlap; both coexist cleanly.


PINOUT NOTE FOR WHEN THE PANEL ARRIVES
--------------------------------------
8-pin order varies by module P/N. Some are VCC/GND/SCK/SDA/RST/DC/CS/BL,
some omit backlight. Confirm the actual pad labels / pin table before
soldering; do not trust the above order blindly.


TOUCH NOTE (D2 = GPIO3)
-----------------------
D2 is a boot-strapping pin (JTAG source select). Using it as a capacitive touch
button is acceptable because the read is high-impedance and does not drive the
pin hard, so it will not force the boot state. Internal pullup boots to the
default USB-JTAG path. It is the one-pin exception chosen because no other
spare touch-capable pin exists without breaking SPI/I2C.


CONTROLLER NOTE (NV3007)
------------------------
NV3007 is a niche SPI TFT driver. Bring-up may need a manually-sourced init
sequence if the selected library lacks it. For a static readout (large weight
number + status) this is low-risk; for animated/high-fps content SPI + a new
driver is the wrong tool — keep the display to readout/slow data.