#!/usr/bin/env python3
"""Sends the custom themes' fonts (web/fonts/) to the machine's storage, served as
/holidays/fonts/<file> and loaded by a page only when a theme picks that font
(web/src/customFonts.css, Settings > Custom Themes > Font).

usage: python3 scripts/upload_fonts.py <machine address>"""
import sys
from pathlib import Path

from upload_holidays import post

FONTS = Path(__file__).resolve().parent.parent / 'web' / 'fonts'

if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__.strip().splitlines()[-1])
    host = sys.argv[1]
    post(f'http://{host}/api/holiday-clear?id=fonts')
    for f in sorted(FONTS.iterdir()):
        if f.suffix in ('.ttf', '.otf'):
            post(f'http://{host}/api/holiday-file?path=fonts/{f.name}', f.read_bytes(), f.name)
            print(f'{f.name}: sent ({f.stat().st_size // 1024} KB)')
