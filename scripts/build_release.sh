#!/usr/bin/env bash
set -euo pipefail
# Build the full release file from this repo alone: the program plus the storage in one 16 MB file,
# written at 0x0 (like delongezzi-vX.Y.Z.bin on the Releases page). NVS is left blank, so the file
# carries no Wi-Fi details or passwords. Writing it to a board replaces everything on it.
#
# The storage is storage/ (the 32 themes in ct/, the 18 brew-button videos in vid/) plus the
# starter profiles from data/p and the 10 fonts from web/fonts; the cache tags are made here.
# Needs PlatformIO (pio); on Windows use WSL. Details: docs/HANDOVER.md section 6.
#
# Usage (plain terminal):
#   bash scripts/build_release.sh    # -> delongezzi-<version>.bin and the theme backup
#                                    #    delongezzi-themes-<version>.json in the repo folder
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV=delongezzi-single
BUILD=".pio/build/$ENV"
CORE="${PLATFORMIO_CORE_DIR:-$HOME/.platformio}"
PY="$CORE/penv/bin/python"
[ -x "$PY" ] || PY=python3

# Offsets and sizes come from the partition table, so a changed table can't give a wrong file.
part() { awk -F', *' -v n="$1" '$1 == n {print $4, $5}' partitions_16mb.csv; }
read -r APP_OFFSET _ <<< "$(part app0)"
read -r FS_OFFSET FS_SIZE <<< "$(part spiffs)"
if [ -z "${APP_OFFSET:-}" ] || [ -z "${FS_SIZE:-}" ]; then
  echo "partitions_16mb.csv has no app0 or spiffs line" >&2
  exit 1
fi

# PlatformIO's tools in the versions espressif32@6.12.0 uses (platformio.ini). Another ESP32
# platform may have put other versions in the plain folders, so every copy is looked at.
pkg() {
  local d
  for d in "$CORE/packages/$1" "$CORE/packages/$1"@*; do
    if grep -qs "\"version\": *\"$2" "$d/package.json"; then echo "$d"; return 0; fi
  done
  return 1
}
need() { pkg "$1" "$2" || { echo "PlatformIO's $1 ${2}x is missing in $CORE/packages" >&2; exit 1; }; }

# At a vX.Y.Z tag this is the release's own name; other builds get git's longer name (and no
# version inside the firmware, see scripts/auto_firmware_version.py).
VERSION="$(git describe --tags --dirty --exclude nightly --exclude db 2>/dev/null || echo dev)"
OUT="delongezzi-$VERSION.bin"

# Reproducible: the same commit gives the same program, on any day. The program's build times
# (scripts/auto_firmware_version.py) and the storage files' times take the commit's time; the
# storage image still differs in a few bytes, as mklittlefs stores each folder's change time.
# With uncommitted changes (or no git) it's the real time, as in a plain pio run.
if [ -z "${SOURCE_DATE_EPOCH:-}" ]; then
  if git diff --quiet HEAD 2>/dev/null; then
    SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)"
  else
    SOURCE_DATE_EPOCH="$(date +%s)"
  fi
fi
export SOURCE_DATE_EPOCH

echo ">> Building the program..."
# From clean: parts compiled earlier would keep their old build times.
pio run -e "$ENV" -t clean > /dev/null
pio run -e "$ENV"

ESPTOOL="$(need tool-esptoolpy 2.40900.)/esptool.py"
BOOT_APP0="$(need framework-arduinoespressif32 3.20017.)/tools/partitions/boot_app0.bin"
# PlatformIO installs its mklittlefs only for a filesystem build.
pkg tool-mklittlefs 1.203. > /dev/null || pio run -e "$ENV" -t buildfs > /dev/null
MKLITTLEFS="$(need tool-mklittlefs 1.203.)/mklittlefs"

echo ">> Making the storage..."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/data/hol/fonts"
cp -R storage/. "$TMP/data/"
cp -R data/p "$TMP/data/p"
cp web/fonts/*.ttf web/fonts/*.otf "$TMP/data/hol/fonts/"
# Cache tags: the board sends each theme, video and font folder's tag as the ETag, and a browser
# keeps its copy until the tag changes, so every tag is made here from the folder's files.
sha256() { if command -v sha256sum > /dev/null; then sha256sum; else shasum -a 256; fi; }
for d in "$TMP"/data/ct/*/ "$TMP"/data/vid/*/ "$TMP"/data/hol/fonts/; do
  hash="$(cd "$d" && LC_ALL=C ls -A | grep -vx tag | while read -r f; do echo "$f"; cat "$f"; done | sha256 | cut -c1-16)"
  printf '"h-%s"' "$hash" > "$d/tag"
done
# mklittlefs stores each file's time: the commit's, not the checkout's.
"$PY" -c 'import os, sys
t = int(sys.argv[1])
for d, ds, fs in os.walk(sys.argv[2]):
    for n in ds + fs:
        os.utime(os.path.join(d, n), (t, t))
os.utime(sys.argv[2], (t, t))' "$SOURCE_DATE_EPOCH" "$TMP/data"
"$MKLITTLEFS" -c "$TMP/data" -b 4096 -p 256 -s "$FS_SIZE" "$TMP/storage.bin" > /dev/null

echo ">> Merging the release file..."
# Flash mode, speed and size stay as PlatformIO wrote them into the bootloader.
"$PY" "$ESPTOOL" --chip esp32s3 merge_bin -o "$OUT" \
  0x0 "$BUILD/bootloader.bin" 0x8000 "$BUILD/partitions.bin" 0xe000 "$BOOT_APP0" \
  "$APP_OFFSET" "$BUILD/firmware.bin" "$FS_OFFSET" "$TMP/storage.bin"

echo ">> Making the theme backup..."
# For Settings > Custom Themes > Restore themes (the page's own backup format), made from
# storage/ct and attached to the release next to the .bin, instead of a second copy in git.
THEMES="delongezzi-themes-$VERSION.json"
b64() { base64 | tr -d '\n'; }
{
  printf '{"format":"delongezzi-custom-themes","version":2,"themes":['
  for d in storage/ct/*/; do
    printf '%s\t%s\n' "$(sed -n 's/^{"name":"\([^"]*\)".*/\1/p' "$d/meta.json")" "$(basename "$d")"
  done | LC_ALL=C sort | {
    sep=""
    while IFS="$(printf '\t')" read -r _name id; do
      printf '%s{"id":"%s","meta":%s,"picture":"%s"}' "$sep" "$id" "$(cat "storage/ct/$id/meta.json")" \
        "$(b64 < "storage/ct/$id/page.webp")"
      sep=","
    done
  }
  printf '],"videos":[]}'
} > "$THEMES"

echo ">> Done: $OUT ($(wc -c < "$OUT") bytes) and $THEMES"
sha256sum "$OUT" "$THEMES" 2>/dev/null || shasum -a 256 "$OUT" "$THEMES"
