// One "Upload images…" button for both kinds of image (Assay, web/assay/assay.js). Each selected file is typed by
// photoKind (web/assay/photo.js: photoCheck's colour and skin tests, same thresholds) and the selection is routed:
//   "microscopy"  greyscale (phase-contrast) frames -> QC + forecast (segment.js, forecast.js), unchanged
//   "photo"       one skin-wound photo -> live drawing: box the wound, its outline is carved into the live NCA; no forecast
//   "ask"         one image the two tests disagree on (skin-toned but almost no colour) -> one inline choice
//   "refused"     colour but not skin, photos mixed with frames, or more than one photo; `reason` says which
// In a selection of several images an "ambiguous" one counts as a frame: only frames come several at a time.
// Plain ES module: routeUpload is pure (node check: web/upload/route_check.mjs); kindOfFile needs a browser.
import { photoKind } from "../assay/photo.js";
import { rgbaFromFile } from "./segment.js";

export const KIND_LABEL = { microscopy: "microscopy frame", skin: "wound photo", other: "colour, not skin", ambiguous: "skin-toned, almost no colour" };
export const NOT_EITHER = "This does not look like a skin photo, and it has too much colour for greyscale phase-contrast microscopy.";

export async function kindOfFile(file) {
  return photoKind(await rgbaFromFile(file));
}

const count = (n, what) => `${n} ${what}${n === 1 ? "" : "s"}`;
export function routeUpload(kinds) {
  const n = kinds.length, photos = kinds.filter(k => k === "skin").length, other = kinds.filter(k => k === "other").length;
  const frames = n - photos - other;
  if (n === 1) return kinds[0] === "other" ? { route: "refused", reason: NOT_EITHER } : { route: { microscopy: "microscopy", skin: "photo", ambiguous: "ask" }[kinds[0]] };
  if (other) return { route: "refused", reason: `${other} of ${n} images ${other === 1 ? "is" : "are"} neither a skin photo nor greyscale phase-contrast microscopy.` };
  if (photos && frames) return { route: "refused", reason: `Mixed selection: ${count(frames, "microscopy frame")} and ${count(photos, "wound photo")}.` };
  if (photos) return { route: "refused", reason: `${photos} wound photos: the outline is traced from one photo at a time.` };
  return { route: "microscopy" };
}
