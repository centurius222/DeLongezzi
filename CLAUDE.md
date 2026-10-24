# DeLongezzi: quick start for Claude

Espresso-machine firmware (a GaggiMate fork) for one ESP32-S3 N16R8 board: both GaggiMate halves
in one program, no screen, the web page served from flash.

- Build: `bash scripts/build_webui.sh` after any change in `web/`, then `pio run`.
- Update a board and keep its data: `pio run -t upload --upload-port /dev/serial/by-id/<board>`.
  Not `scripts/flash.sh`: it erases the whole chip.
- Before changing anything, read "Traps and what they cost" in the handover below: each line
  there cost hours or data.

The full handover (HANDOVER.md, the one copy to keep up to date):

@HANDOVER.md
