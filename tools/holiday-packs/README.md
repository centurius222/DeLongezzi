# Holiday pack tools

Helper scripts for making a holiday pack; the steps are in `docs/HOLIDAY_PACKS.md`.

## Setup (once)

```bash
cd tools/holiday-packs
npm install                                        # Playwright
npx playwright install chromium firefox            # the test browsers
python3 -m pip install --user opencv-python-headless numpy fonttools
```

Keep a pack's work files (cut script, screenshots) outside `/tmp`: a PC restart wipes it.

## The scripts

| Script | What it does |
|---|---|
| `capture.js <replica dir> <id>` | Snapshot of the real page (local `web/dist` build, Manual mode faked, the machine's settings untouched) as the replica's `index.html` + `app.css`. Build the web UI first. |
| `shot.js <replica dir> out.png [w h]` | Screenshot a replica (Chromium). |
| `shotb.js <replica dir> out.png [chromium\|firefox] [w h]` | The same in either browser, at any window size. |
| `box.js <replica dir> "<selector>" ...` | Where elements are (CSS px). |
| `ink.js` + `check_gaps.py` | Each control's visible box, and a check that none touches a frame, a window's rim or another control (at least 1 px clear). Put your own card's edges in `check_gaps.py`. |
| `live.js <id> out.png` | The machine's real page with a holiday forced on; reports failed pack loads. |
| `grid.py` | A gridded close-up of the picture in 1517 x 712 CSS px, for measuring. |
| `cmp.py` | How far each live word in a replica screenshot is from the picture's. |
| `ringfit.py <picture>` | Fits a circle to a ring's inner edge (for the brew button's decoration). |
| `font.py` | Example: adds missing characters to a font in its own style (Time Circuits). |
| `make_bttf_example.py <picture> <art dir>` | A full Method A cutting script (Back to the Future): erasing, rebuilding steel, the ring, icons, pieces. Copy it as the start of a new pack's script. |

Mask images (`mask: url(...)`) don't show in a replica opened as a file: check it
through `python3 -m http.server` in the replica folder.
