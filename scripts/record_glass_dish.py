#!/usr/bin/env python3
"""Record the glass-dish look-dev demo clips frame-exact, without the HUD.

Serves the repo on 127.0.0.1 (loopback only), opens design/prototypes/glass-dish/ with ?capture&nohud plus each
clip's params, steps window.__tick(1) once per frame, grabs the canvas and pipes the frames to ffmpeg
(H.264, yuv420p, 30 fps). Math.random is seeded so re-renders match each other.

Framing: the prototype's canvas has no CSS size, so at device scale d it is d times the viewport and a page
only shows its top-left 1/d. The original clips were screenshots of a 1280x720 page at d = 1.5, i.e. the
top-left 2/3 of the render, upscaled. Here the page is 1920x1080 at d = 1.5 (a 2880x1620 render) and the
top-left 1920x1080 canvas pixels are kept: the same framing at native resolution.

  python3 scripts/record_glass_dish.py --out demo-clips/clean                 # all clips
  python3 scripts/record_glass_dish.py --out /tmp/x --only 12_final_look      # one clip
  python3 scripts/record_glass_dish.py --out /tmp/x --only 01 --probe 0,150   # PNG stills, no video

Needs Playwright (Chrome), ffmpeg, and network for three.js from unpkg.
"""
import argparse, base64, contextlib, socket, subprocess, sys, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PAGE = 'design/prototypes/glass-dish/index.html'
PHOTO = ROOT / 'design/prototypes/glass-dish/sample/test_skin_wound_synthetic.jpg'

# palettes: intact, edge, new tissue, dividing, wound (+ scene background)
TEAL = 'pal=1F4F5C,EE7F2D,F9D6FB,FFFFFF,0B1116&bg=050607'
TEAL_HOT = 'pal=0E7383,FF5A1F,FFC6F0,FFFFFF,03181C&bg=010C0E'
DERMIS = 'pal=8C1C3A,FF5B3A,FFC4D0,FFFFFF,14050A&bg=0A0205'
BERRY = 'pal=883955,FF3E41,FF7099,FFFFFF,2A1D29&bg=120B11'
BERRY_PALE = 'pal=883955,FF3E41,FFC2D1,FFFFFF,1E141D&bg=0E090E'
SUNSET = 'pal=D6336C,FFC21A,FFF1E0,FFFFFF,1A060C&bg=0D0306&light=warm'
SKIN = 'pal=C68B6E,B3122E,FFD2C6,FFFFFF,24120F&bg=120A09'
OLD = 'age=off&hshift=0'     # the prototype now defaults to the final look; switch age colouring and hue shift off
ITER = 'speed=1.4&orbit=0.5'  # iteration clips: 7 min of sim per second, slow orbit

# events: frame -> action, run just before that frame's tick. view: camera preset flown to before frame 0.
CLIPS = {
    '01_original_teal_matte': dict(q=f'{TEAL}&mat=matte&{OLD}&{ITER}'),
    '02_saturated_teal_gel': dict(q=f'{TEAL_HOT}&mat=gel&{OLD}&{ITER}'),
    '03_dermis_wet': dict(q=f'{DERMIS}&mat=wet&{OLD}&{ITER}'),
    '04_berry_height_ramp_bloom': dict(q=f'{BERRY}&mat=glow&ramp&fx=bloom&{OLD}&{ITER}'),
    '05_berry_xray': dict(q=f'{BERRY}&mat=xray&fx=bloom&{OLD}&{ITER}'),
    '06_berry_toon': dict(q=f'{BERRY_PALE}&mat=toon&{OLD}&{ITER}'),
    '07_berry_toon_age_colour': dict(q=f'{BERRY_PALE}&mat=toon&age=skin&ageramp=pale&hshift=0&{ITER}'),
    '08_age_heatmap_toggle': dict(q=f'{BERRY_PALE}&mat=toon&age=skin&ageramp=pale&hshift=0&{ITER}', frames=330, events={165: 'heat'}),
    '09_age_ramp_saturation': dict(q=f'{BERRY_PALE}&mat=toon&age=skin&ageramp=sat&hshift=0&{ITER}'),
    '10_warm_sunset': dict(q=f'{SUNSET}&mat=toon&age=skin&ageramp=pale&hshift=0&{ITER}'),
    '11a_skin_hue_shift_off': dict(q=f'{SKIN}&mat=toon&age=skin&hshift=0&{ITER}'),
    '11b_skin_hue_shift_8': dict(q=f'{SKIN}&mat=toon&age=skin&hshift=8&{ITER}'),
    '12_final_look': dict(q=f'{SKIN}&mat=toon&age=skin&hshift=8&speed=1&orbit=0.5', frames=480, events={150: 'cells', 330: 'close'}),
    # Draw from photo: paused overview, photo opened at frame 20 (its dialog is HUD, so hidden), run at frame 95
    '13_draw_from_photo': dict(q=f'{SKIN}&mat=toon&age=skin&hshift=8&speed=1', frames=455, view=None, paused=True,
                               events={20: 'photo', 95: 'run'}),
}

SEED = """(() => { let a = 0x5eed1234; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();"""
CLICK = "id => document.getElementById(id).click()"


def free_port():
    with contextlib.closing(socket.socket()) as s:
        s.bind(('127.0.0.1', 0)); return s.getsockname()[1]


@contextlib.contextmanager
def serve():
    port = free_port()
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '--directory', str(ROOT)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            with contextlib.suppress(OSError):
                urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=1); break
            time.sleep(0.1)
        yield f'http://127.0.0.1:{port}'
    finally:
        srv.terminate(); srv.wait()


def act(pg, action):
    if action in ('close', 'cells', 'overview'): pg.evaluate(f"document.querySelector('[data-view=\"{action}\"]').click()")
    elif action == 'heat': pg.evaluate(CLICK, 'btn-heat')
    elif action == 'photo':
        pg.set_input_files('#photo-in', str(PHOTO))
        pg.wait_for_function("document.getElementById('photo').style.display === ''")
    elif action == 'run': pg.evaluate(CLICK, 'photo-run')
    else: raise ValueError(action)


GRAB = """(() => { const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
  c.getContext('2d').drawImage(document.getElementById('scene'), 0, 0); return c.toDataURL('image/png'); })()"""


def grab(pg):   # top-left 1920x1080 of the canvas (see Framing above)
    return base64.b64decode(pg.evaluate(GRAB).split(',', 1)[1])


def record(browser, base, name, clip, out, probe):
    pg = browser.new_page(viewport={'width': 1920, 'height': 1080}, device_scale_factor=1.5)
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.add_init_script(SEED)
    pg.goto(f"{base}/{PAGE}?capture&nohud&{clip['q']}")
    pg.wait_for_function('typeof window.__tick === "function"', timeout=60000)
    view = clip.get('view', 'close')
    pg.evaluate(CLICK, 'play')   # the page autoplays; pause at t = 0
    if view: act(pg, view)
    pg.evaluate('window.__tick(45)')   # warm-up with the sim held at t = 0: camera fly (1.4 s), columns settle
    if not clip.get('paused'): pg.evaluate(CLICK, 'play')
    n, events = clip.get('frames', 300), clip.get('events', {})
    ff = None if probe else subprocess.Popen(
        ['ffmpeg', '-v', 'error', '-y', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', '-',
         '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart',
         str(out / f'{name}.mp4')], stdin=subprocess.PIPE)
    t0 = time.time()
    for i in range(n):
        if i in events: act(pg, events[i])
        pg.evaluate('window.__tick(1)')
        if probe is None: ff.stdin.write(grab(pg))
        elif i in probe: (out / f'{name}_{i:04d}.png').write_bytes(grab(pg))
    if ff: ff.stdin.close(); ff.wait()
    pg.close()
    if errs: print(f'  page errors: {errs}', file=sys.stderr)
    print(f'{name}: {n} frames in {time.time() - t0:.0f} s', flush=True)
    if ff and ff.returncode: sys.exit(f'ffmpeg failed on {name}')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--only', nargs='*', help='clip names or prefixes (default: all)')
    ap.add_argument('--probe', help='comma-separated frame numbers: write PNG stills instead of a video')
    a = ap.parse_args()
    names = [k for k in CLIPS if not a.only or any(k.startswith(p) for p in a.only)]
    probe = {int(x) for x in a.probe.split(',')} if a.probe else None
    a.out.mkdir(parents=True, exist_ok=True)
    with serve() as base, sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=metal'])   # GPU; SwiftShader is too slow at this size
        for name in names: record(browser, base, name, CLIPS[name], a.out, probe)
        browser.close()


if __name__ == '__main__':
    main()
