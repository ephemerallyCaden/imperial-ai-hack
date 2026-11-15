// Routing check for Assay's one "Upload images…" button (web/upload/route.js) on the repo's sample images:
// photo.js photoKind + routeUpload, then the step each route leads to (microscopy: the browser QC + forecast in
// forecast.js; photo: segmentBox -> photoCheck -> fitToLattice), so the refusal rules and the photo path still hold.
//   PY=path/to/python node web/upload/route_check.mjs     (default PY=python3; needs Pillow, as in requirements.txt)
// Node has no JPEG decoder, so Pillow decodes each sample to RGBA (stored values, no colour management, like the
// browser's rgbaFromFile). The classifier, router, QC and photo code are the browser's own modules. Exit 1 on a failure.
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { routeUpload, NOT_EITHER } from "./route.js";
import { greyFromRGBA } from "./segment.js";
import { runUpload } from "./forecast.js";
import { photoKind, photoCheck, segmentBox, fitToLattice, COLOUR_MIN, SKIN_MIN } from "../assay/photo.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url)), PY = process.env.PY || "python3";
const SAMPLES = join(ROOT, "web/data/samples"), GLASS = join(ROOT, "design/prototypes/glass-dish/sample");
const calib = JSON.parse(readFileSync(join(ROOT, "web/upload/browser_calib.json")));
const DECODE = "import struct, sys\nfrom PIL import Image\nim = Image.open(sys.argv[1]).convert('RGBA')\n"
  + "sys.stdout.buffer.write(struct.pack('>II', *im.size) + im.tobytes())";
const cache = {};
function load(path) {   // -> { data: RGBA bytes, width, height } as ImageData has them
  if (cache[path]) return cache[path];
  const b = execFileSync(PY, ["-I", "-c", DECODE, path], { maxBuffer: 1 << 28 }), width = b.readUInt32BE(0), height = b.readUInt32BE(4);
  return (cache[path] = { data: new Uint8ClampedArray(b.buffer, b.byteOffset + 8, width * height * 4), width, height });
}
const grey = im => ({ grey: greyFromRGBA(im.data, im.width, im.height), h: im.height, w: im.width });   // = greyFromFile

let ok = true;
const check = (pass, msg) => { ok &&= !!pass; console.log(`${pass ? "ok  " : "FAIL"} ${msg}`); };
const stats = k => `${k.kind}; colour ${k.colour.toFixed(3)} (photo >= ${COLOUR_MIN}), skin ${k.skin.toFixed(3)} (photo >= ${SKIN_MIN})`;
const kindOf = p => photoKind(load(p)).kind;

// 1. single images -> route
const micro = [...readdirSync(SAMPLES).filter(f => f.endsWith(".png")).sort().map(f => join(SAMPLES, f)), join(GLASS, "test_microscopy_synthetic.png")];
for (const p of micro) {
  const k = photoKind(load(p)), r = routeUpload([k.kind]);
  check(r.route === "microscopy", `${basename(p)} -> ${r.route} (${stats(k)})`);
}
const SKIN = join(GLASS, "test_skin_wound_synthetic.jpg"), OTHER = join(GLASS, "test_other_synthetic.jpg");
{ const k = photoKind(load(SKIN)), r = routeUpload([k.kind]); check(r.route === "photo", `${basename(SKIN)} -> ${r.route} (${stats(k)})`); }
{ const k = photoKind(load(OTHER)), r = routeUpload([k.kind]);
  check(r.route === "refused" && r.reason === NOT_EITHER, `${basename(OTHER)} -> ${r.route}: ${r.reason} (${stats(k)})`); }
// skin-toned but greyscale (r, g, b) = (v + 12, v, v - 8): the colour and skin tests disagree -> one inline choice
const W = 200, H = 150, tint = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) { const v = 90 + ((i * 7919) % 61); tint.set([v + 12, v, v - 8, 255], 4 * i); }
const amb = photoKind({ data: tint, width: W, height: H });
check(amb.kind === "ambiguous" && routeUpload([amb.kind]).route === "ask", `tinted grey (synthetic) -> ${routeUpload([amb.kind]).route} (${stats(amb)})`);

// 2. selections of several images
const F = [1, 2, 3].map(i => join(SAMPLES, `sample_frame${i}.png`));
const sel = [
  ["3 sample frames", F.map(kindOf), "microscopy"],
  ["2 frames + tinted grey", [...F.slice(0, 2).map(kindOf), amb.kind], "microscopy"],
  ["frame + skin photo", [kindOf(F[0]), kindOf(SKIN)], "refused", /^Mixed selection: 1 microscopy frame and 1 wound photo/],
  ["skin photo + tinted grey", [kindOf(SKIN), amb.kind], "refused", /^Mixed selection/],
  ["2 skin photos", [kindOf(SKIN), kindOf(SKIN)], "refused", /^2 wound photos/],
  ["frame + other photo", [kindOf(F[0]), kindOf(OTHER)], "refused", /^1 of 2 images is neither/],
];
for (const [what, kinds, want, why] of sel) {
  const r = routeUpload(kinds);
  check(r.route === want && (!why || why.test(r.reason)), `${what} [${kinds.join(", ")}] -> ${r.route}${r.reason ? `: ${r.reason}` : ""}`);
}

// 3. microscopy route -> the browser QC + forecast: sample frames forecast with a band, bad frames still refused
for (const n of [1, 3]) {
  const d = runUpload(F.slice(0, n).map(p => grey(load(p))), 1, 0.908, calib).doc, f = d.forecasts?.[0];
  check(!d.refused && f?.area_q05?.length && f.area_q95?.length, `${n} sample frame(s): forecast ${d.model}, band of ${f?.area_q05?.length} points`);
}
for (const [bad, want] of [["bad_blank", /^frame 1: blank frame$/], ["bad_blurred", /^frame 1: out of focus/]]) {
  const p = join(SAMPLES, bad + ".png"), d = runUpload([grey(load(p))], 1, 0.908, calib).doc;
  check(routeUpload([kindOf(p)]).route === "microscopy" && d.refused && want.test(d.reasons[0]), `${bad}: microscopy route, refused: ${JSON.stringify(d.reasons)}`);
}

// 4. photo route -> box around the wound, photoCheck passes, the outline fits the WHAD field; the "other" photo keeps its text
{
  const im = load(SKIN), seg = segmentBox(im, 60, 100, 600, 420), why = photoCheck(im, seg, "skin"), mask = fitToLattice(seg);
  const cells = mask.reduce((s, v) => s + v, 0);
  check(why === null && photoCheck(im, seg) === null && cells > 0, `skin photo traced: photoCheck ${why}, outline ${cells} of ${mask.length} field sites`);
  const o = load(OTHER), msg = photoCheck(o, segmentBox(o, 60, 100, 600, 420));
  check(msg === "This does not look like a skin photo.", `other photo, photoCheck: ${msg}`);
}
console.log(ok ? "route check OK" : "route check FAILED"); process.exit(ok ? 0 : 1);
