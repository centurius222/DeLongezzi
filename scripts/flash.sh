#!/usr/bin/env bash
set -euo pipefail
# Build the web UI, then full-erase + upload the De'longezzi single-board firmware.
#
# WHY erase: the web UI is embedded at the END of the firmware blob. A partial
# `pio run -t upload` only rewrites the sectors it touches, so when the new
# image is a different size than the previous one, STALE BYTES can remain in the
# region where /index.html lives — the machine then serves old/garbage data and
# the dashboard is a blank screen. Full erase + upload always writes it
# contiguous, which is what guarantees the embedded bundle is intact.
#
# Usage (plain terminal):
#   bash scripts/flash.sh
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Rebuild + re-embed the web UI from source (regenerates web_ui.bin + the .S).
bash scripts/build_webui.sh

# Purge the compiled blob object. PlatformIO caches web_ui_blob.S.o and links it
# even after a web rebuild, so the embedded blob can be OLDER than the manifest
# it's paired with — the manifest offsets then point at stale bytes and the
# dashboard is a blank screen (served /index.html is garbage even after a full
# erase+upload). Always rebuild the object from the fresh web_ui.bin.
rm -f .pio/build/delongezzi-single/src/display/webassets/web_ui_blob.S.o

echo ">> Erasing flash (clears stale blob tail)..."
~/.local/bin/pio run -e delongezzi-single -t erase

echo ">> Uploading firmware..."
~/.local/bin/pio run -e delongezzi-single -t upload

echo ">> Done. Hard-refresh the browser (Ctrl+Shift+R) to drop the cached bundle."