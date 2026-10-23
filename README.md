# DeLongezzi

Espresso-machine firmware for a single **ESP32-S3 N16R8** board, based on
[GaggiMate](https://github.com/jniebuhr/gaggimate) by Caffinnova S.r.l.
DeLongezzi is not made or endorsed by GaggiMate.

- One board runs everything: GaggiMate's display half and controller half are merged into one
  firmware and talk through an in-memory link instead of Bluetooth.
- No screen: the web page is the user interface (phone, tablet or PC on your home network).

## What is different from GaggiMate
- Single-board build `delongezzi-single`: 16 MB flash layout (one 4 MB program, about 11.9 MB of
  storage). No over-the-air updates: the board is flashed by USB.
- Custom themes with your own pictures, brew-button videos and theme fonts; holiday packs.
- Water-level touch sensor, a Diagnostics page and a permanent log (`/api/log`).
- Setup hotspot with a captive page, and Improv Wi-Fi over USB.

## Hardware
- ESP32-S3 **N16R8** (16 MB flash, 8 MB octal PSRAM). Other boards are not supported.
- Wired like GaggiMate's "Pro Lego Build" (`GM_PRO_LEGO` in `lib/GaggiMateController/src/ControllerConfig.h`):

| Function | GPIO |
|---|---|
| Heater (SSR) | 14 |
| Pump (dimmer) | 21, zero-cross sense 9 |
| Valve / second relay | 10 / 47 |
| Temperature (MAX31865, SPI) | SCK 6, CS 8, MISO 4, MOSI 5 |
| Pressure (ADS1115, I2C) | SDA 42, SCL 41 |
| Brew / steam button | 38 / 48 |
| Water-level touch | 12 |
| 4-pin port (LED / distance sensor, I2C) | SDA 43, SCL 44 |

- Bluetooth scales through `lib/esp-arduino-ble-scales`.

## Install
**Turn the machine's mains power off before flashing.** While the board is being flashed no
program runs, so nothing holds the heater and pump outputs off. Flash with the board on USB only.

Files on the Releases page:

| File | For | Write at |
|---|---|---|
| `delongezzi-v2.2.2-full-install.bin` | a new board, or starting over: everything, incl. 5 starter profiles. Erases all settings, shots and themes | `0x0`, after erasing the chip |
| `delongezzi-v2.2.2-update.bin` | a board that **already runs DeLongezzi**: keeps settings, shots, profiles and themes | `0x10000` |
| `SHA256SUMS.txt` | checksums of the two files | — |

With [esptool](https://github.com/espressif/esptool):

```sh
# full install
esptool.py --chip esp32s3 erase_flash
esptool.py --chip esp32s3 write_flash 0x0 delongezzi-v2.2.2-full-install.bin

# update (only on a board that already runs DeLongezzi)
esptool.py --chip esp32s3 write_flash 0x10000 delongezzi-v2.2.2-update.bin
```

## First start
1. The board opens a Wi-Fi hotspot **DeLongezzi**, password **espresso-setup**.
2. Join it, open http://4.4.4.1, enter your Wi-Fi under Settings › Wi-Fi and press Save. The board
   restarts into your Wi-Fi and is then at http://delongezzi.local.
3. Change the hotspot password (Settings › Wi-Fi › Access Point Password): the default is public,
   and the hotspot comes back whenever your router can't be reached at start-up.
4. The web page has **no login**: keep the machine on your home network and never forward a port to it.

## Themes
- `themes/delongezzi-themes-v2.2.2.json`: 32 custom themes. Load them under Settings › Custom themes › Restore themes.
- Theme fonts and the pizza/western packs are not inside the firmware. Upload them with
  `python3 scripts/upload_fonts.py <machine address>` and `python3 scripts/upload_holidays.py <machine address>`.

## Build
- [PlatformIO](https://platformio.org): `pio run` builds `delongezzi-single`; `pio run -t upload`
  flashes the program only (keeps the data).
- The web page is committed ready-built in `src/display/webassets/`. After changing `web/`, run
  `scripts/build_webui.sh` (Node 22 with npm), then delete `.pio/build/delongezzi-single/**/web_ui_blob*.o`
  (or do a clean build) so the new page is linked.
- Libraries are pinned to exact versions. NimBLE-Arduino 1.4.3 is kept in `lib/NimBLE-Arduino` with
  4 memory settings changed (listed at the top of its `nimconfig.h`).
- The firmware version comes from the git tag: a build at tag `vX.Y.Z` shows that version, any
  other build shows none.

## License
[CC BY-NC-SA 4.0](LICENSE), the same as GaggiMate: free for non-commercial use, with credit, and
changes shared under the same license. Third-party libraries in `lib/` keep their own licenses.

## Credits
- [GaggiMate](https://github.com/jniebuhr/gaggimate) by Caffinnova S.r.l., the original.
- Icons: Uicons by [Flaticon](https://www.flaticon.com/uicons) (see `icons/README.md`).
