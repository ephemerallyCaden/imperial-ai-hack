# Glass dish look-dev

3D hex-column tissue prototype. Serve the repo root (`python3 -m http.server 8000 --bind 127.0.0.1`) and open
`/design/prototypes/glass-dish/index.html`. With no params it shows the final look
(`pal=C68B6E,B3122E,FFD2C6,FFFFFF,24120F&bg=120A09&mat=toon&age=skin&hshift=8`).

Recording params: `?speed=` playback multiplier, `?orbit=` slow auto-orbit, `?capture` frame-exact mode
(`window.__tick(n)` advances n frames of 1/30 s), `?nohud` hides the HUD and the axis text labels but keeps time and
camera running. `?bare` also hides the HUD but freezes time, so it is only for stills.

## Rendering the demo clips without the HUD

```
python3 scripts/record_glass_dish.py --out demo-clips/clean            # all 14 clips, 1920x1080 H.264, 30 fps
python3 scripts/record_glass_dish.py --out /tmp/x --only 12_final_look # one clip
python3 scripts/record_glass_dish.py --out /tmp/x --only 01 --probe 0,150  # PNG stills to check a look
```

Needs Playwright with Chrome, ffmpeg, and network access (three.js loads from unpkg). The script serves the repo on
127.0.0.1 only and stops the server when it is done. Each clip's params and timed button presses are in its `CLIPS` table.
