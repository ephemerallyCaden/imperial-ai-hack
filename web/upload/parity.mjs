// Parity check for the browser upload (#39): web/upload/*.js vs data/upload.py --forecaster edge_speed on the samples.
//   PY=path/to/python node web/upload/parity.mjs        (default PY=python3; runs the Python reference into a temp dir)
// Reports mask IoU per frame and the max |difference| in area_q05/q50/q95, t50, t90, p_close_by_T; checks that
// bad_blank.png and bad_blurred.png are refused with the same reasons. Exit 1 if anything is off.
import { readFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { inflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runUpload } from "./forecast.js";

// schedule compared without its evidence text: the browser quotes edge-speed widths, upload.py quotes the NCA's
const sched = (x) => x && { ...x, evidence: undefined };
const ROOT = fileURLToPath(new URL("../../", import.meta.url)), SAMPLES = join(ROOT, "web/data/samples");
const calib = JSON.parse(readFileSync(join(ROOT, "web/upload/browser_calib.json")));

// minimal PNG decoder (8-bit grey / grey+alpha / RGB / RGBA, non-interlaced) -> grey as load_gray does
function png(path) {
  const b = readFileSync(path); let p = 8, w, h, ct, idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString("ascii", p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; if (d[8] !== 8 || d[12]) throw new Error("8-bit non-interlaced only"); }
    else if (type === "IDAT") idat.push(d);
    p += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct], raw = inflateSync(Buffer.concat(idat)), st = w * ch, px = new Uint8Array(h * st);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (st + 1)], src = raw.subarray(y * (st + 1) + 1, (y + 1) * (st + 1));
    for (let x = 0; x < st; x++) {
      const a = x >= ch ? px[y * st + x - ch] : 0, u = y ? px[(y - 1) * st + x] : 0, c = y && x >= ch ? px[(y - 1) * st + x - ch] : 0;
      const pa = Math.abs(u - c), pb = Math.abs(a - c), pc = Math.abs(a + u - 2 * c);
      const pr = [0, a, u, (a + u) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? u : c][f];
      px[y * st + x] = (src[x] + pr) & 255;
    }
  }
  const grey = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) grey[i] = ch < 3 ? px[i * ch] : Math.fround((px[i * ch] + px[i * ch + 1] + px[i * ch + 2]) / 3);
  return { grey, h, w };
}

const PY = process.env.PY || "python3", out = mkdtempSync(join(tmpdir(), "upload_parity_"));
const py = (frames, name) => {
  execFileSync(PY, ["-I", join(ROOT, "data/upload.py"), "--frames", ...frames, "--interval", "1", "--scale", "0.908",
    "--forecaster", "edge_speed", "--out", out, "--name", name], { stdio: "pipe" });
  return JSON.parse(readFileSync(join(out, name + ".json")));
};
let ok = true;
const maxDiff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const evDiff = (a, b) => ["median", "q05", "q95", "censored_prob"].map(k => (a[k] === null) !== (b[k] === null) ? Infinity : Math.abs((a[k] ?? 0) - (b[k] ?? 0)));
for (const n of [1, 2, 3]) {
  const files = Array.from({ length: n }, (_, i) => join(SAMPLES, `sample_frame${i + 1}.png`));
  const ref = py(files, `ref_${n}frame`), js = runUpload(files.map(png), 1, 0.908, calib);
  const ious = js.masks.map((m, k) => {
    const g = png(join(out, `ref_${n}frame_frame${k + 1}_mask.png`)); let i = 0, u = 0;
    for (let p = 0; p < m.mask.length; p++) { const a = m.mask[p], b = g.grey[p] > 127; i += a && b; u += a || b; }
    return i / u;
  });
  const F = js.doc.forecasts[0], R = ref.forecasts[0];
  const d = { area_q05: maxDiff(F.area_q05, R.area_q05), area_q50: maxDiff(F.area_q50, R.area_q50), area_q95: maxDiff(F.area_q95, R.area_q95),
    t50: Math.max(...evDiff(F.t50, R.t50)), t90: Math.max(...evDiff(F.t90, R.t90)), p_close_by_T: Math.abs(F.p_close_by_T - R.p_close_by_T),
    p_stall: Math.abs((F.p_stall ?? 0) - (R.p_stall ?? 0)), observed: maxDiff(F.observed.area, R.observed.area) };
  const same = js.doc.model === ref.model && js.doc.notes === ref.notes && JSON.stringify(sched(js.doc.schedule)) === JSON.stringify(sched(ref.schedule))
    && JSON.stringify(F.flags) === JSON.stringify(R.flags) && JSON.stringify(F.segmentation_quality) === JSON.stringify(R.segmentation_quality)
    && (!R.members || maxDiff(F.members.flat(), R.members.flat()) === 0);
  const pass = ious.every(x => x > 0.999) && Object.values(d).every(x => x < 1e-3) && same;
  ok &&= pass;
  console.log(`${n} frame(s) ${pass ? "OK  " : "DIFF"} model ${js.doc.model}; mask IoU ${ious.map(x => x.toFixed(5)).join(", ")}; max |diff| `
    + Object.entries(d).map(([k, v]) => `${k} ${v.toPrecision(2)}`).join(", ") + `; model/notes/schedule/flags/QC/members ${same ? "identical" : "DIFFER"}`);
  if (!same) console.log("   js :", js.doc.notes, JSON.stringify(js.doc.schedule), "\n   py :", ref.notes, JSON.stringify(ref.schedule));
}
for (const bad of ["bad_blank", "bad_blurred"]) {
  const f = join(SAMPLES, bad + ".png"), ref = py([f], bad), js = runUpload([png(f)], 1, 0.908, calib).doc;
  const pass = js.refused && ref.refused && JSON.stringify(js.reasons) === JSON.stringify(ref.reasons);
  ok &&= pass;
  console.log(`${bad}: ${pass ? "OK  " : "DIFF"} js ${JSON.stringify(js.reasons)} · py ${JSON.stringify(ref.reasons)}`);
}
console.log(ok ? "parity OK" : "parity FAILED"); process.exit(ok ? 0 : 1);
