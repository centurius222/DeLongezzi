#!/usr/bin/env bash
set -euo pipefail
# Build the full release file from this repo alone: the program plus the storage in one 16 MB file,
# written at 0x0 (like delongezzi-vX.Y.Z.bin on the Releases page). NVS is left blank, so the file
# carries no Wi-Fi details or passwords. Writing it to a board replaces everything on it.
#
# The storage is storage/ (the 32 themes in ct/, the 18 brew-button videos in vid/, the fonts' tag
# file in hol/fonts/) plus the starter profiles from data/p and the 10 fonts from web/fonts.
# Needs PlatformIO (pio); on Windows use WSL. Details: docs/HANDOVER.md section 6.
#
# Usage (plain terminal):
#   bash scripts/build_release.sh    # -> delongezzi-<version>.bin in the repo folder
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV=delongezzi-single
BUILD=".pio/build/$ENV"
CORE="${PLATFORMIO_CORE_DIR:-$HOME/.platformio}"
MKLITTLEFS="$CORE/packages/tool-mklittlefs/mklittlefs"
ESPTOOL="$CORE/packages/tool-esptoolpy/esptool.py"
BOOT_APP0="$CORE/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin"
PY="$CORE/penv/bin/python"
[ -x "$PY" ] || PY=python3

# At a vX.Y.Z tag this is the release's own name; other builds get git's longer name (and no
# version inside the firmware, see scripts/auto_firmware_version.py).
VERSION="$(git describe --tags --dirty --exclude nightly --exclude db 2>/dev/null || echo dev)"
OUT="delongezzi-$VERSION.bin"

# Reproducible: the same commit gives the same program, on any day. The program's build times
# (scripts/auto_firmware_version.py) and the storage files' times take the commit's time; the
# storage image still differs in a few bytes, as mklittlefs stores each folder's change time.
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct 2>/dev/null || date +%s)}"

echo ">> Building the program..."
# From clean: parts compiled earlier would keep their old build times.
pio run -e "$ENV" -t clean > /dev/null
pio run -e "$ENV"

# PlatformIO installs its mklittlefs only for a filesystem build.
[ -x "$MKLITTLEFS" ] || pio run -e "$ENV" -t buildfs

echo ">> Making the storage..."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/data"
cp -R storage/. "$TMP/data/"
cp -R data/p "$TMP/data/p"
cp web/fonts/*.ttf web/fonts/*.otf "$TMP/data/hol/fonts/"
# mklittlefs stores each file's time: the commit's, not the checkout's.
"$PY" -c 'import os, sys
t = int(sys.argv[1])
for d, ds, fs in os.walk(sys.argv[2]):
    for n in ds + fs:
        os.utime(os.path.join(d, n), (t, t))
os.utime(sys.argv[2], (t, t))' "$SOURCE_DATE_EPOCH" "$TMP/data"
"$MKLITTLEFS" -c "$TMP/data" -b 4096 -p 256 -s 0xBE0000 "$TMP/storage.bin" > /dev/null

echo ">> Merging the release file..."
"$PY" "$ESPTOOL" --chip esp32s3 merge_bin -o "$OUT" --flash_mode dio --flash_freq 80m --flash_size 16MB \
  0x0 "$BUILD/bootloader.bin" 0x8000 "$BUILD/partitions.bin" 0xe000 "$BOOT_APP0" \
  0x10000 "$BUILD/firmware.bin" 0x410000 "$TMP/storage.bin"

echo ">> Done: $OUT ($(wc -c < "$OUT") bytes)"
sha256sum "$OUT" 2>/dev/null || shasum -a 256 "$OUT"
