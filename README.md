<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.png">
  <img src="docs/logo-light.png" alt="DeLongezzi" width="468">
</picture>

**Try it** [![LIVE](https://img.shields.io/badge/LIVE-ff2a1a?style=flat-square)](https://centurius222.github.io/)**, no machine needed:** https://centurius222.github.io/ (the real web page with a
simulated machine in your browser; nothing is saved).

## Why DeLongezzi
- **Machine always stays STOCK:** add one switch to flip between stock and DeLongezzi, handy while tinkering.
- **One board:** a single ESP32-S3 N16R8.
- **Headless:** no screen to wire; use an old phone, a tablet or a smart TV.
- **PT1000A (Class A high accuracy) probe** instead of a thermocouple: no more grounding issues
- **Manual brew page:** easy to read, simple start/stop, and a pressure slider you can move live during the shot.
- 🔥 **HOT** **Themes:** holiday themes, or make your own (colors and all).
- **Quick theme picker:** press and hold the top-left corner.
- **Brew button:** the default, or your own picture or MP4 video.
- **Splash screen and logo:** your own or the defaults; the splash can be turned off.
- **Shots to profiles:** turn manual shots from your history into profiles.
- **Original GaggiMate pages** (profiles, brewing and the rest) still work as before.
- **Scales** usually connect in about 8 s.
- **Water-level sensor:** just two copper strips on the side of the tank.
- **Diagnostics tab** for easy troubleshooting.
- **Easy install:** web flasher, or one .bin file.
- **Easy to extend:** an AI handover is included, so just ask Claude.

Based on [GaggiMate](https://github.com/jniebuhr/gaggimate) by Caffinnova S.r.l.
DeLongezzi is not made or endorsed by GaggiMate.

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

One file on the Releases page, `delongezzi-v2.2.2.bin`: the firmware, 32 custom themes, 18 brew-button
videos and pictures, and 5 starter profiles, with no Wi-Fi details or passwords in it. Writing it
replaces everything on the board (settings, shots, profiles, themes, videos). The SHA-256 is in the
release notes.

With [esptool](https://github.com/espressif/esptool):

```sh
esptool.py --chip esp32s3 erase_flash
esptool.py --chip esp32s3 write_flash 0x0 delongezzi-v2.2.2.bin
```

Or from the browser, nothing to install (Chrome or Edge on a computer, USB cable):
https://centurius222.github.io/DeLongezzi/flasher/

## First start
1. The board opens a Wi-Fi hotspot **DeLongezzi**, password **delongezzi**.
2. Join it, open http://4.4.4.1, enter your Wi-Fi under Settings › Wi-Fi and press Save. The board
   restarts into your Wi-Fi and is then at http://delongezzi.local.
3. Change the hotspot password (Settings › Wi-Fi › Access Point Password): the default is public,
   and the hotspot comes back whenever your router can't be reached at start-up.
4. The web page has **no login**: keep the machine on your home network and never forward a port to it.

## Themes
- The release file already has the 32 custom themes and 18 brew-button videos and pictures; delete any you
  don't want under Settings › Custom themes and Settings › Pictures.
- `themes/delongezzi-themes-v2.2.2.json`: the same 32 themes as a backup file, for Settings › Custom themes › Restore themes.
- Theme fonts and the pizza/western packs are not inside the firmware. Upload them with
  `python3 scripts/upload_fonts.py <machine address>` and `python3 scripts/upload_holidays.py <machine address>`.

## Build
- [PlatformIO](https://platformio.org): `pio run` builds `delongezzi-single`; `pio run -t upload`
  flashes the program only (keeps the data).
- The web page is committed ready-built in `src/display/webassets/`. After changing `web/`, run
  `scripts/build_webui.sh` (Node 22 with npm); the next `pio run` builds the new page in (the page's
  checksum is written into `web_ui_blob.S`).
- Libraries are pinned to exact versions. NimBLE-Arduino 1.4.3 is kept in `lib/NimBLE-Arduino` with
  4 memory settings changed (listed at the top of its `nimconfig.h`), and Improv WiFi Library 0.0.4 in
  `lib/ImprovWiFi` with a fix (it dropped the command that came right after a successful one).
- The firmware version comes from the git tag: a build at tag `vX.Y.Z` shows that version, any
  other build shows none.

## License
[CC BY-NC-SA 4.0](LICENSE), the same as GaggiMate: free for non-commercial use, with credit, and
changes shared under the same license. Third-party libraries in `lib/` keep their own licenses.

## Credits
- [GaggiMate](https://github.com/jniebuhr/gaggimate) by Caffinnova S.r.l., the original.
- Icons: Uicons by [Flaticon](https://www.flaticon.com/uicons) (see `icons/README.md`).
