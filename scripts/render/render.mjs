// node scripts/render/render.mjs sheet out.png
// node scripts/render/render.mjs compare out.png dirF=file:///tmp/p2-render/follow/ [ncaF=whad_partII_C61_P2_nca_v2.json]
// node scripts/render/render.mjs frame out.png layer=smooth|agents|nca|nca_smooth file=whad_partII_C61_P2.json t=6 scale=20
// Headless Chrome screenshot of render.html over file:// (no server). Width/height are passed for the sheet.
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [mode, out, ...kv] = process.argv.slice(2);
const params = new URLSearchParams({ mode, ...Object.fromEntries(kv.map((s) => s.split('='))) });
const url = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'render.html')) + '?' + params;
const size = mode === 'compare' ? '1874,2010' : mode === 'sheet' ? '1874,1400'  // = render.html sheet canvas: 250 + 7 x 232, 64 + 5 x 190 + 386
  : (params.get('layer') === 'panel' ? '1280,720' : `${44 * (+params.get('scale') || 20)},${32 * (+params.get('scale') || 20)}`);
execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--allow-file-access-from-files',
  `--user-data-dir=/tmp/p2-render-chrome`, '--default-background-color=000000ff', '--virtual-time-budget=20000',
  `--window-size=${size}`, `--screenshot=${resolve(out)}`, url], { stdio: ['ignore', 'ignore', 'pipe'] });
console.log('wrote', resolve(out));
