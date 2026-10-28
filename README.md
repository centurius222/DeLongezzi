<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.png">
  <img src="docs/logo-light.png" alt="DeLongezzi" width="468">
</picture>

**Try it** [![LIVE](docs/live.svg)](https://centurius222.github.io/)**, no machine needed:** https://centurius222.github.io/ (the firmware's real interface with a simulated machine in your browser; nothing is saved).

## Why DeLongezzi <sub><sup><sub>YOUR MACHINE YOUR WAY</sub></sup></sub>
- **Stock functions stay STOCK:** brew and steam knobs work as always; one switch flips to DeLongezzi.
- **One board, no screen to wire:** a single ESP32-S3 N16R8; use an old phone, a tablet or a smart TV.
- **PT1000A (Class A high accuracy) probe** instead of a thermocouple: no more grounding issues.
- **Manual brew page:** easy to read, simple start/stop, pressure slider you can move mid-shot.
- 🔥 **HOT** **Themes:** holiday ones or your own, colors and all; hold the top-left corner to switch.
- **Your own look:** brew button picture or MP4 video, splash screen and logo (or the defaults).
- **Shots to profiles:** turn manual shots from your history into profiles.
- **Original GaggiMate pages** (profiles, brewing and the rest) still work as before.
- **Water-level sensor:** just two copper strips on the side of the tank.
- **Diagnostics tab** for easy troubleshooting.
- **Easy install:** web flasher, or one .bin file. **Easy to extend:** AI handover included, just ask Claude.

Based on [GaggiMate](https://github.com/jniebuhr/gaggimate) by Caffinnova S.r.l.
DeLongezzi is not made or endorsed by GaggiMate.

<p align="center">
  <img src="docs/gaggimate_1.jpg" alt="DeLongezzi on a DeLonghi" width="272">&nbsp; <img src="docs/gaggimate_2.jpg" alt="The theme picker" width="272">&nbsp; <img src="docs/gaggimate_3.jpg" alt="Tiki theme" width="272">
</p>

**Test drive, no machine needed:** [try it LIVE](https://centurius222.github.io/) in your browser, or [flash a bare N16R8 board](https://centurius222.github.io/DeLongezzi/flasher/) and explore it from your phone, tablet or PC.
[<img src="docs/no-sensors.svg" align="absbottom" alt="With no sensors attached a heater warning shows; everything else works.">](https://centurius222.github.io/DeLongezzi/flasher/)

<br>

## Requirements
- **Machine:** best with DeLonghi ECP, EC and Stilosa ([which model?](docs/machines.md)); adaptable to any simple machine.
- **Board:** ESP32-S3 N16R8 (16 MB flash, 8 MB PSRAM); for another board, ask Claude to adapt the build.
- **2.4 GHz Wi-Fi:** the N16R8 board works on 2.4 GHz only; it will NOT work on 5 GHz.
- **A screen:** tablet, phone, PC or smart TV.
- **Browser:** Chrome (using other browsers might not work).
- **To install:** a computer with Chrome, and a USB data cable (charge-only cables don't work).

## Bill of Materials
<a href="docs/BOM.md"><img src="docs/bom-banner.jpg" alt="De'Longezzi bill of materials: open the parts list"></a>

Everything this build uses, 28 parts with pictures and shop links: **[parts list](docs/BOM.md)**.




## Plumbing
<a href="https://raw.githubusercontent.com/centurius222/DeLongezzi/main/docs/plumbing.jpg"><img src="docs/plumbing.jpg" width="340" alt="Plumbing: pump and pressure sensor joined to the boiler with a PY4 Y connector; PT1000A probe in the boiler with one copper washer outside and the serrated flange nut inside"></a>&nbsp; <a href="https://raw.githubusercontent.com/centurius222/DeLongezzi/main/docs/plumbing-1.jpg"><img src="docs/plumbing-1.jpg" width="152" alt="Pressure sensor held by a 3D-printed clip"></a>&nbsp; <a href="https://raw.githubusercontent.com/centurius222/DeLongezzi/main/docs/plumbing-2.jpg"><img src="docs/plumbing-2.jpg" width="152" alt="PY4 Y connector and tubes next to the boiler"></a>&nbsp; <a href="https://raw.githubusercontent.com/centurius222/DeLongezzi/main/docs/plumbing-3.jpg"><img src="docs/plumbing-3.jpg" width="152" alt="PT1000A probe in the boiler top with its copper washer"></a>

1. Pressure sensor position, held by a 3D-printed clip
2. Position of the PY4 and tubes
3. Probe in the boiler top with its copper washer

**Step 1. Open the machine:** [DeLonghi teardown video](https://www.youtube.com/watch?v=paImrXJvxlg) (Tom's Coffee Corner).

**Step 2. Plumb it:** follow the diagram and the photos above.

**Need more help?** Ask in the [GaggiMate Discord](https://delta2.eu/discord).


## Wiring
<a href="https://raw.githubusercontent.com/centurius222/DeLongezzi/main/docs/wiring.jpg"><img src="docs/wiring.jpg" width="322" alt="De'Longezzi wiring, mains side"></a>&nbsp; <a href="https://raw.githubusercontent.com/centurius222/DeLongezzi/main/docs/wiring-low-voltage.png"><img src="docs/wiring-low-voltage.png" width="500" alt="De'Longezzi wiring, low-voltage side (coming soon)"></a>

<a href="https://raw.githubusercontent.com/centurius222/DeLongezzi/main/docs/wiring-1.jpg"><img src="docs/wiring-1.jpg" width="132" alt="The ON-OFF-ON switch, wired"></a>&nbsp; <a href="https://raw.githubusercontent.com/centurius222/DeLongezzi/main/docs/wiring-2.jpg"><img src="docs/wiring-2.jpg" width="132" alt="The switch position, inside"></a>&nbsp; <a href="https://raw.githubusercontent.com/centurius222/DeLongezzi/main/docs/wiring-3.jpg"><img src="docs/wiring-3.jpg" width="132" alt="The switch position, from the front"></a>&nbsp; <a href="https://raw.githubusercontent.com/centurius222/DeLongezzi/main/docs/wiring-4.jpg"><img src="docs/wiring-4.jpg" width="132" alt="The finished wiring inside, from above"></a>&nbsp; <a href="https://raw.githubusercontent.com/centurius222/DeLongezzi/main/docs/wiring-5.jpg"><img src="docs/wiring-5.jpg" width="132" alt="The water-level sensor plug (wires to the copper strips)"></a>&nbsp; <a href="https://raw.githubusercontent.com/centurius222/DeLongezzi/main/docs/wiring-6.jpg"><img src="docs/wiring-6.jpg" width="132" alt="Two copper strips on the outside of the tank"></a>

1. The ON-OFF-ON switch, wired
2. The switch position, inside
3. The switch position, from the front
4. The finished wiring inside, from above: nice and tight
5. The water-level sensor plug (wires to the copper strips)
6. Two copper strips on the outside of the tank

**Original wiring:** the stock ECP3630 wiring in all four modes, drawn by [u/Apprehensive_Sir_202](https://www.reddit.com/user/Apprehensive_Sir_202/) on Reddit.

Which GPIO each part connects to (GaggiMate's "Pro Lego Build" pins):

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

**Temperature probe:** prepare the MAX31865 and connect the PT1000A with the [MAX31865 guide](docs/max31865.md).

**Need more help?** Ask in the [GaggiMate Discord](https://delta2.eu/discord).



## Install
**Turn the machine's mains power off before flashing.** While the board is being flashed no
program runs, so nothing holds the heater and pump outputs off. Flash with the board on USB only.

**Easiest:** the [web flasher](https://centurius222.github.io/DeLongezzi/flasher/), nothing to install
(Chrome on a computer, USB cable).

**Or by hand:** download `delongezzi-v2.2.2.bin` from [Releases](https://github.com/centurius222/DeLongezzi/releases/latest)
and write it with [esptool](https://github.com/espressif/esptool):

```sh
esptool.py --chip esp32s3 erase_flash
esptool.py --chip esp32s3 write_flash 0x0 delongezzi-v2.2.2.bin
```

The file holds the firmware, 32 custom themes, 18 brew-button videos and pictures, and 5 starter
profiles, with no Wi-Fi details or passwords in it. Writing it replaces everything on the board
(settings, shots, profiles, themes, videos). The SHA-256 is in the release notes.

## First start
1. If the web flasher asked for your Wi-Fi, skip to step 3. Otherwise the board opens a Wi-Fi hotspot
   **DeLongezzi**, password **delongezzi**.
2. Join it, open http://4.4.4.1, enter your Wi-Fi under Settings › Wi-Fi and press Save.
3. The board restarts into your Wi-Fi and is at http://delongezzi.local. If that doesn't open, find its
   address in your router's device list.
4. Change the hotspot password (Settings › Wi-Fi › Access Point Password): the default is public,
   and the hotspot comes back whenever your router can't be reached at start-up.
5. The web page has **no login**: keep the machine on your home network and never forward a port to it.

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
