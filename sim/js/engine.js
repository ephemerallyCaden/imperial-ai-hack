// Draw-tool engine: Migliaccio-2023 lattice agent rules (design.md 5.1b), pure JS, no DOM.
// One site = one cell. 3x3 Moore neighbourhood. Grid cell values: 1 = cell, 0 = empty.
// Agent area = cells * siteArea; wound = connected empty region drawn by the user.
// Presets are PLACEHOLDERS until #23 (fit Tm/bias per wound) lands: replace via setPreset / presets.json.

export const PRESETS = {
  CC: { Tm: 1, Td: 40, bias: 7 / 9, divide: true },
  C61: { Tm: 2, Td: 40, bias: 7 / 9, divide: true },
};

// xorshift32, seedable so runs are reproducible
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];

export class Engine {
  // wound: Uint8Array(w*h), 1 where the user drew the wound (starts empty); rest is confluent cells.
  constructor({ w, h, wound, preset = 'CC', params = null, seed = 1 }) {
    this.w = w; this.h = h;
    this.grid = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) this.grid[i] = wound[i] ? 0 : 1;
    this.dist = new Float32Array(w * h); // distance (sites) to nearest empty site
    this.rand = rng(seed);
    this.setPreset(preset, params);
    this.step_ = 0;
    this.cells = [];
    this._rebuild();
    this._updateDist();
  }

  setPreset(name, override) {
    const p = { ...(PRESETS[name] || PRESETS.CC), ...(override || {}) };
    // Pm = (1/Tm)/(1/Tm+1/Td), Pd = (1/Td)/(1/Tm+1/Td)
    const a = 1 / p.Tm, b = p.divide ? 1 / p.Td : 0;
    this.pMove = a / (a + b);
    this.pDiv = b / (a + b);
    this.bias = p.bias;
    this.params = p;
  }

  _rebuild() {
    const c = [];
    for (let i = 0; i < this.grid.length; i++) if (this.grid[i]) c.push(i);
    this.cells = c;
  }

  get count() { return this.cells.length; }

  // multi-source BFS (8-neighbour) from empty sites; closed boundary (edges are walls)
  _updateDist() {
    const { w, h, grid, dist } = this;
    const q = new Int32Array(w * h);
    let head = 0, tail = 0;
    for (let i = 0; i < w * h; i++) {
      if (!grid[i]) { dist[i] = 0; q[tail++] = i; } else dist[i] = 1e9;
    }
    while (head < tail) {
      const i = q[head++], x = i % w, y = (i / w) | 0, d = dist[i] + 1;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (dist[j] > d) { dist[j] = d; q[tail++] = j; }
      }
    }
  }

  // One Monte Carlo sweep: each cell (random order) acts once.
  step() {
    const { w, h, grid, dist, rand, cells } = this;
    // Fisher-Yates shuffle
    for (let i = cells.length - 1; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const t = cells[i]; cells[i] = cells[j]; cells[j] = t;
    }
    const n = cells.length; // newborns act next sweep
    const empt = new Int8Array(8);
    for (let ci = 0; ci < n; ci++) {
      const idx = cells[ci], x = idx % w, y = (idx / w) | 0;
      let ne = 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (!grid[ny * w + nx]) empt[ne++] = k;
      }
      if (ne === 0) continue; // quiescent (contact inhibition)
      const r = rand();
      if (r >= this.pMove + this.pDiv) continue;
      // choose target: with prob bias restrict to empties facing the wound (smaller dist), else any empty
      let pick = -1;
      if (rand() < this.bias) {
        let m = 0, best = 1e9;
        for (let e = 0; e < ne; e++) {
          const k = empt[e], d = dist[(y + DY[k]) * w + x + DX[k]];
          if (d < best) { best = d; m = 0; }
          if (d === best) empt[m++] = k; // compact ties to the front
        }
        pick = empt[(rand() * m) | 0];
      } else {
        pick = empt[(rand() * ne) | 0];
      }
      const tx = x + DX[pick], ty = y + DY[pick], t = ty * w + tx;
      if (r < this.pMove) {
        grid[idx] = 0; grid[t] = 1; cells[ci] = t;
      } else {
        grid[t] = 1; cells.push(t);
      }
    }
    this.step_++;
    if (this.step_ % 4 === 0) this._updateDist();
    return this.step_;
  }

  // wound area = empty sites in the largest empty component touching... kept simple: all empty sites
  woundSites() { return this.grid.length - this.cells.length; }
}
