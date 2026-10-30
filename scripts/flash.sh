#!/usr/bin/env bash
set -euo pipefail
# Build the web page, then upload the De'longezzi program only (pio run -t upload). Settings, Wi-Fi,
# shots, profiles, themes, videos and fonts stay. For a full install use the release file or the
# Web Flasher. (Until 2026-10-30 this erased the whole chip first, which left an empty board.)
#
# Usage (plain terminal):
#   bash scripts/flash.sh                          # PlatformIO picks the port
#   bash scripts/flash.sh /dev/serial/by-id/...    # with more than one ESP32 on USB
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Rebuild + re-embed the web page from source. web_ui_blob.S carries the page's checksum, so the
# next build always links the new page.
bash scripts/build_webui.sh

echo ">> Uploading the program (keeps the data)..."
if [ $# -ge 1 ]; then
  pio run -e delongezzi-single -t upload --upload-port "$1"
else
  pio run -e delongezzi-single -t upload
fi

echo ">> Done. Hard-refresh the browser (Ctrl+Shift+R) to drop the cached page."
