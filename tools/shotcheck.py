#!/usr/bin/env python3
# Before flashing (HANDOVER.md step 6): connect to the machine's WebSocket for 7 s and say
# whether a shot is running (evt:status process.a != 0). Needs the PlatformIO python (websockets).
import asyncio
import json
import time

import websockets


async def main():
    async with websockets.connect("ws://delongezzi.local/ws", open_timeout=10) as ws:
        t0 = time.time()
        seen = 0
        active = False
        while time.time() - t0 < 7:
            m = json.loads(await asyncio.wait_for(ws.recv(), 5))
            if m.get("tp") == "evt:status":
                seen += 1
                if (m.get("process") or {}).get("a", 0):
                    active = True
        print("status msgs", seen, "shot active" if active else "idle")


asyncio.run(main())
