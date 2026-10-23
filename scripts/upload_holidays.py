#!/usr/bin/env python3
"""Send the holiday packs (web/holidays/<id>/) to the machine's storage over Wi-Fi.

Each pack goes as ONE file: its theme.css with every picture it uses written
inside it (data: URLs), gzipped. The machine serves it at
/holidays/<id>/theme.css, so a page load asks it for one file instead of a
dozen pictures at once (more than it can serve side by side). The packs are
not part of the firmware: run this after flashing a board whose storage was
erased, and after changing a pack. Profiles and shot history in the same
storage are not touched.

usage: scripts/upload_holidays.py <machine address> [pack id ...]
"""
import base64
import gzip
import mimetypes
import re
import sys
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'web' / 'holidays'
TYPES = {'.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ttf': 'font/ttf', '.woff2': 'font/woff2'}
URL_RE = re.compile(r"url\(\s*(['\"]?)([^'\")]+)\1\s*\)")
FILE_RE = re.compile(r'^(\./)?[A-Za-z0-9_\-./]+\.(webp|svg|png|jpe?g|ttf|woff2)$', re.I)


def bundle(pack: Path) -> bytes:
    css = (pack / 'theme.css').read_text()

    def inline(m):
        ref = m.group(2).strip()
        if not FILE_RE.match(ref):          # data: URLs, #ids inside inline SVGs, anything not a pack file
            return m.group(0)
        pic = (pack / ref).resolve()
        mime = TYPES.get(pic.suffix.lower()) or mimetypes.guess_type(pic.name)[0] or 'application/octet-stream'
        return 'url("data:%s;base64,%s")' % (mime, base64.b64encode(pic.read_bytes()).decode())

    return gzip.compress(URL_RE.sub(inline, css).encode(), 9)


def post(url: str, data: bytes = None, filename: str = None) -> None:
    headers = {}
    if filename is not None:
        boundary = 'gm' + uuid.uuid4().hex
        data = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                f'Content-Type: application/octet-stream\r\n\r\n').encode() + data + f'\r\n--{boundary}--\r\n'.encode()
        headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary
    req = urllib.request.Request(url, data=data or b'', headers=headers, method='POST')
    with urllib.request.urlopen(req, timeout=120) as r:
        if r.status != 200:
            raise RuntimeError(f'{url}: HTTP {r.status}')


def main(argv):
    if not argv:
        sys.exit(__doc__.strip().splitlines()[-1])
    host, ids = argv[0], argv[1:] or sorted(p.name for p in ROOT.iterdir() if (p / 'theme.css').exists())
    for pid in ids:
        pack = ROOT / pid
        if not (pack / 'theme.css').exists():
            sys.exit(f'{pid}: no such pack in {ROOT}')
        body = bundle(pack)
        post(f'http://{host}/api/holiday-clear?id={pid}')
        post(f'http://{host}/api/holiday-file?path={pid}/theme.css.gz', body, 'theme.css.gz')
        # the theme picker's small picture (long-press the logo), when the pack has one
        thumb = pack / 'thumb.webp'
        if thumb.exists():
            post(f'http://{host}/api/holiday-file?path={pid}/thumb.webp', thumb.read_bytes(), 'thumb.webp')
        print(f'{pid}: sent ({len(body) // 1024} KB)')


if __name__ == '__main__':
    main(sys.argv[1:])
