// Assay mode: pick a recorded agent run or a sample, replay it on a timeline, see the decision card, the forecast,
// the images and the agent's reasons, over a 3D field of SIMULATED cells (never tracked cells).
// Data: agent/runs (ctx.data.runIndex), web/data/samples, web/public/sim (P2 playback). Nothing is invented here.
// tissue.js needs three.js (import map -> unpkg); it is loaded dynamically in mount() so Assay still works offline
import { parseRun, mergeBranch, docAsChecks, isCalibrated, HORIZON_H } from "./runlog.js";
import { areaAt, curveX } from "./curve.js";
import { decisionCard, refusedPanel, tabs, forecastTab, imagesTab, whyTab, esc } from "./panel.js";
import { createTimeline } from "./timeline.js";
import { greyFromFile } from "../upload/segment.js";
import { runUpload, BROWSER_LABEL } from "../upload/forecast.js";

const PLAYBACK = "web/public/sim/whad_partII_C61_P2_follow.json";   // P2 cell-agent playback (follow rule), docs/p2-handoff.md
const PLAYBACK_WOUND = "exp1_partII_C61_P2";
const SAMPLES = [
  { id: "sample_3frame", label: "Sample · 3 frames (upload)", n: 3 },
  { id: "sample_2frame", label: "Sample · 2 frames (upload)", n: 2 },
  { id: "sample_1frame", label: "Sample · 1 frame (upload)", n: 1 },
  { id: "bad_blank", label: "Sample · blank frame (refused)", frames: ["bad_blank.png"], masks: [null] },
  { id: "bad_blurred", label: "Sample · blurred frame (refused)", frames: ["bad_blurred.png"], masks: ["bad_blurred_frame1_mask.png"] },
];
const SAMPLE_DIR = "web/data/samples/";
const CALIB = "web/upload/browser_calib.json";   // WHAD calibration pool for the in-browser upload (web/upload/export_calib.py)

export async function mount(el, ctx) {
  const ROOT = ctx.data.ROOT;
  let T = null;
  try { T = await import("./tissue.js"); } catch (e) { console.error("3D field unavailable:", e); }
  const STATE_LABEL = T?.STATE_LABEL || {};
  const css = Object.assign(document.createElement("link"), { rel: "stylesheet", href: new URL("./assay.css", import.meta.url).href });
  document.head.appendChild(css);
  el.innerHTML = `<div class="assay">
    <div class="as-top">
      <label class="st-kicker" for="as-wound">Wound</label>
      <select id="as-wound" class="as-select"></select>
      <button class="st-btn st-btn--primary" data-act="upload"><svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5M5 21h14"/></svg>Upload images…</button>
      <input type="file" accept="image/*" multiple hidden id="as-file">
      <span class="as-qc"></span>
      <span class="as-honesty"></span>
    </div>
    <div class="as-main">
      <div class="as-centre">
        <div class="as-stage">
          <div class="as-hud as-hud-tl"><div class="as-readout num"></div><div class="as-caption as-simnote"></div></div>
          <div class="as-hud as-hud-tr">
            <div class="st-seg as-views">${["field", "wound", "cells"].map(v => `<button class="st-btn" data-view="${v}">${v}</button>`).join("")}</div>
            <button class="st-btn" data-act="select" title="Select area · S"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" stroke-dasharray="3 3"/></svg>Select area</button>
            <button class="st-btn" data-act="clear" title="Clear selection · Esc" hidden>Clear</button>
          </div>
          <div class="as-hud as-hud-bl">
            <div class="as-scalebar"><i></i><span></span></div>
            <div class="as-legend3d">${Object.entries(STATE_LABEL).map(([k, v]) => `<span><i class="sw sw-${k}"></i>${v}</span>`).join("")}<span class="as-dim">dividing: off in this simulation</span><span class="as-dim">height = local density</span></div>
          </div>
          <div class="as-hud as-hud-br as-selstats st-panel" hidden></div>
          <div class="st-tip as-tip" hidden></div>
          <div class="as-cover" hidden></div>
          <div class="as-notice st-panel--solid" hidden></div>
        </div>
        <div class="as-scales">
          <div><div class="st-kicker">Scales</div><p class="as-caption">Same field, three zooms. Click to fly the camera.</p></div>
          ${[["field", "×1 whole field", "880 × 640 µm"], ["wound", "×10 wound", "~16 cells across"], ["cells", "×40 single cells", "~4 cells across"]].map(([v, a, b]) =>
            `<button class="as-thumb" data-view="${v}"><canvas width="150" height="90"></canvas><span>${a} · ${b}</span></button>`).join("")}
        </div>
      </div>
      <aside class="as-panel" aria-label="Decision and forecast"></aside>
    </div>
    <div class="as-timeline"></div>
  </div>`;
  const $ = s => el.querySelector(s), panel = $(".as-panel"), stage = $(".as-stage");

  // ---------- state ----------
  const S = { items: [], item: null, main: null, branch: null, merged: null, active: "main", t: 0, playing: false, speed: 1,
    approvals: {}, tab: "forecast", rejectNote: "", panelKey: "", msg: "", sel: null, raw: {} };
  const run = () => S.active === "branch" ? S.merged : S.main;
  const checkAt = t => { const cs = run()?.checks || []; let c = null; for (const x of cs) if (x.cut_h <= t + 1e-9) c = x; return c; };
  const branchCut = () => S.branch?.start?.branch_cut_h;

  // ---------- sources ----------
  let index = { runs: [], base: "agent/runs/" };
  try { index = await ctx.data.runIndex(); } catch (e) { console.error(e); }
  const mains = index.runs.filter(r => !r.branch);
  S.items = [
    ...mains.map(r => ({ kind: "run", id: r.run_id, run: r, branch: index.runs.find(b => b.branch && b.run_id === r.run_id + ".reject") || null,
      label: `${r.kind === "frames" ? "Upload run" : "Held-out"} · ${r.wound_id}${r.stop_kind ? ` · stop (${r.stop_kind}) at ${r.stop_h} h` : ""}` })),
    ...SAMPLES.map(s => ({ kind: "sample", id: s.id, sample: s, label: s.label })),
  ];
  const sel = $("#as-wound");
  const grp = (name, list) => list.length ? `<optgroup label="${esc(name)}">${list.map(i => `<option value="${esc(i.id)}">${esc(i.label)}</option>`).join("")}</optgroup>` : "";
  const fillSelect = () => {
    sel.innerHTML = grp("Your uploads (run in this browser, nothing sent)", S.items.filter(i => i.kind === "upload"))
      + grp("Recorded runs (held-out WHAD replays)", S.items.filter(i => i.kind === "run" && i.run.kind !== "frames"))
      + grp("Recorded runs (upload)", S.items.filter(i => i.kind === "run" && i.run.kind === "frames"))
      + grp("Samples (offline, no agent run)", S.items.filter(i => i.kind === "sample"));
    if (!mains.length) sel.insertAdjacentHTML("beforeend", `<option disabled>No recorded runs found in agent/runs</option>`);
  };
  fillSelect();

  // ---------- tissue ----------
  let tissue = null;
  try {
    if (!T) throw new Error("three.js could not be loaded (offline?)");
    const pb = await ctx.data.json(PLAYBACK);
    tissue = T.createTissue(stage, pb, { onSelection: showSel, onHover: showTip });
  } catch (e) {
    console.error(e); stage.insertAdjacentHTML("afterbegin", `<div class="error">3D field of simulated cells not shown: ${esc(e.message)}. The curve, panel, samples and uploads still work.</div>`);
  }

  // ---------- timeline ----------
  const tl = createTimeline($(".as-timeline"), {
    onPlay: togglePlay, onStep: step, onSpeed: v => { S.speed = v; refresh(); }, onSeek: t => { S.playing = false; seek(t); },
  });

  async function select(id) {
    const it = S.items.find(i => i.id === id); if (!it) return;
    S.item = it; sel.value = id; S.approvals = {}; S.active = "main"; S.branch = S.merged = null; S.playing = false; S.msg = ""; S.rejectNote = ""; S.panelKey = ""; S.thumbF = -1;
    try {
      if (it.kind === "run") {
        const recs = await ctx.data.jsonl(index.base + it.run.file);
        S.raw = { main: recs }; S.main = parseRun(recs);
        if (it.branch) {
          const b = await ctx.data.jsonl(index.base + it.branch.file);
          S.raw.branch = b; S.branch = parseRun(b); S.merged = mergeBranch(S.main, S.branch);
        }
        S.t = S.main.checks[0]?.cut_h ?? 0;
      } else if (it.kind === "upload") {
        const doc = it.doc;
        S.raw = { doc }; S.main = docAsChecks(doc); S.main.refused = doc.refused ? doc : null;
        S.t = doc.cutoff_hours ?? 0;
      } else {
        const doc = await ctx.data.json(SAMPLE_DIR + it.id + ".json");
        S.raw = { doc }; S.main = docAsChecks(doc); S.main.refused = doc.refused ? doc : null;
        S.t = doc.cutoff_hours ?? 0;
      }
    } catch (e) {
      panel.innerHTML = `<div class="error">Could not load ${esc(it.label)}: ${esc(e.message)}</div>`; console.error(e); return;
    }
    tissue?.clearSelection();
    seek(S.t);
  }
  sel.addEventListener("change", () => select(sel.value));

  // ---------- playback ----------
  // the first approval at or after t0 that has no answer yet blocks time from passing it
  function blockAt(from, to) {
    for (const c of run()?.checks || []) {
      if (c.cut_h < from - 1e-9 || c.cut_h > to + 1e-9) continue;
      if (c.needsApproval && !S.approvals[c.cut_h]) return { t: c.cut_h, why: `Paused at ${c.cut_h} h: the proposal needs your approval.` };
      if (c.needsApproval && S.approvals[c.cut_h] === "rejected" && !(S.branch && branchCut() === c.cut_h))
        return { t: c.cut_h, why: "Rejected: no rejected branch was recorded for this run." };
    }
    return null;
  }
  function seek(t, from = 0) {
    t = Math.max(0, Math.min(HORIZON_H, t));
    const b = blockAt(from, t);
    if (b && b.t < t) { t = b.t; S.playing = false; S.msg = b.why; }
    else if (b && b.t === t) { S.msg = b.why; } else S.msg = "";
    S.t = t; refresh();
  }
  function togglePlay() {
    if (S.t >= HORIZON_H - 1e-6) S.t = 0;
    S.playing = !S.playing;
    if (S.playing) { const b = blockAt(S.t, S.t); if (b) { S.playing = false; S.msg = b.why; } }
    refresh();
  }
  function step(dir) {
    S.playing = false;
    const cs = (run()?.checks || []).map(c => c.cut_h), t = S.t;
    const cand = dir > 0 ? [Math.floor(t + 1e-6) + 1, ...cs.filter(c => c > t + 1e-6)] : [Math.ceil(t - 1e-6) - 1, ...cs.filter(c => c < t - 1e-6)];
    seek(dir > 0 ? Math.min(...cand) : Math.max(...cand), Math.min(t, t + dir));
  }
  let raf = 0, last = performance.now();
  const loop = now => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (S.playing) {
      const nt = Math.min(HORIZON_H, S.t + dt * S.speed);
      seek(nt, S.t + 1e-6);
      if (nt >= HORIZON_H) { S.playing = false; refresh(); }
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  // ---------- decisions ----------
  function act(a) {
    const c = checkAt(S.t);
    if (a === "approve" && c?.needsApproval) {
      S.approvals[c.cut_h] = "approved";
      if (S.active === "branch" && c.cut_h === branchCut()) S.active = "main";
      S.playing = true; S.msg = "";
    } else if (a === "reject" && c?.needsApproval) {
      S.approvals[c.cut_h] = "rejected";
      if (S.branch && branchCut() === c.cut_h) { S.active = "branch"; S.playing = true; S.msg = "Playing the recorded rejected branch."; }
      else { S.playing = false; S.msg = "Rejected: no rejected branch was recorded for this run."; }
    } else if (a === "undo" && c) {
      // undo the latest answer at or before t
      const cut = Math.max(...Object.keys(S.approvals).map(Number).filter(k => k <= S.t + 1e-9));
      if (isFinite(cut)) { delete S.approvals[cut]; if (cut === branchCut()) S.active = "main"; Object.keys(S.approvals).forEach(k => +k > cut && delete S.approvals[k]); seek(cut); return; }
    } else if (a === "why") { S.tab = "why"; }
    else if (a === "upload") return $("#as-file").click();
    else if (a === "sample") return select("sample_3frame");
    else if (a === "select") { tissue?.setSelecting(!tissue.isSelecting()); $('[data-act="select"]').setAttribute("aria-pressed", !!tissue?.isSelecting()); return; }
    else if (a === "clear") return tissue?.clearSelection();
    refresh();
  }
  el.addEventListener("click", e => {
    const b = e.target.closest("[data-act],[data-tab],[data-view]"); if (!b || !el.contains(b)) return;
    if (b.dataset.tab) { S.tab = b.dataset.tab; refresh(); }
    else if (b.dataset.view) { tissue?.goTo(b.dataset.view); markView(); }
    else act(b.dataset.act);
  });
  el.addEventListener("input", e => { if (e.target.id === "as-reason") S.rejectNote = e.target.value; });
  // ---------- in-browser upload (#39): same QC + segmentation + edge-speed forecast as data/upload.py, nothing sent ----------
  let nUploads = 0;
  $("#as-file").addEventListener("change", e => {
    const files = [...e.target.files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })); e.target.value = "";
    if (!files.length) return;
    const used = files.slice(0, 5);
    notice(`<div class="st-kicker">Upload · ${files.length} image${files.length === 1 ? "" : "s"} · runs in this browser, nothing is sent</div>
      <p>${esc(BROWSER_LABEL)}</p>
      <ol class="as-list">${used.map((f, i) => `<li>${esc(f.name)} <span class="as-dim">(t = ${i} × interval)</span></li>`).join("")}</ol>
      ${files.length > 5 ? `<p class="as-caption">Only the first 5 images (by file name) are used.</p>` : ""}
      <form class="as-upform">
        <label class="as-caption">Frame interval (hours between images)<input class="as-input" name="interval" type="number" step="any" min="0" required></label>
        <label class="as-caption">Pixel scale (µm per pixel; WHAD is 0.454, the samples are 0.908)<input class="as-input" name="scale" type="number" step="any" min="0" required></label>
        <p class="as-caption">Both are required, as in data/upload.py. Images are taken in file-name order.</p>
        <div class="as-btns"><button class="st-btn st-btn--primary" type="submit">Run QC and forecast</button><button class="st-btn" type="button" data-notice="close">Cancel</button></div>
      </form>`);
    const form = $(".as-notice .as-upform");
    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      const interval = +form.interval.value, scale = +form.scale.value;
      if (!(interval > 0) || !(scale > 0)) return;
      form.querySelector('[type="submit"]').disabled = true;
      form.insertAdjacentHTML("beforeend", `<p class="as-caption as-upbusy">Reading images and running QC…</p>`);
      try {
        const [calib, frames] = await Promise.all([ctx.data.json(CALIB), Promise.all(used.map(greyFromFile))]);
        const res = runUpload(frames, interval, scale, calib);
        if (res.doc.error) {
          return notice(`<div class="st-kicker">Upload · no forecast</div><p>${esc(res.doc.error)}</p><div class="as-btns"><button class="st-btn" data-notice="close">Close</button></div>`);
        }
        const id = `upload_${++nUploads}`, n = used.length;
        const item = { kind: "upload", id, doc: res.doc, label: `Upload ${nUploads} · ${n} frame${n === 1 ? "" : "s"}${res.doc.refused ? " (refused)" : ""} · browser estimate`,
          frames: used.map((f, i) => ({ src: URL.createObjectURL(f), mask: res.masks[i] ? maskURL(res.masks[i]) : null,
            t: res.doc.forecasts?.[0]?.observed?.t_hours[i], area: res.doc.forecasts?.[0]?.observed?.area[i] })) };
        S.items.unshift(item); fillSelect();
        $(".as-notice").hidden = true;
        await select(id);
      } catch (err) {
        console.error(err);
        notice(`<div class="st-kicker">Upload · could not read the images</div><p>${esc(err.message)}</p><p class="as-caption">PNG or JPEG phase-contrast frames work; TIFF does not decode in browsers.</p><div class="as-btns"><button class="st-btn" data-notice="close">Close</button></div>`);
      }
    });
  });
  // wound mask (1 = wound) -> PNG data URL, white = wound, like data/upload.py's NAME_frameK_mask.png
  function maskURL({ mask, mh, mw }) {
    const cv = Object.assign(document.createElement("canvas"), { width: mw, height: mh }), g = cv.getContext("2d"), im = g.createImageData(mw, mh);
    for (let i = 0; i < mask.length; i++) { const v = mask[i] ? 255 : 0; im.data.set([v, v, v, 255], i * 4); }
    g.putImageData(im, 0, 0);
    return cv.toDataURL("image/png");
  }
  function notice(html) {
    const n = $(".as-notice"); n.innerHTML = html; n.hidden = false;
    n.querySelector('[data-notice="close"]')?.addEventListener("click", () => { n.hidden = true; });
    n.querySelector('[data-act="sample"]')?.addEventListener("click", () => { n.hidden = true; });
  }

  // ---------- render ----------
  function images() {
    const it = S.item;
    if (!it) return null;
    if (it.kind === "upload") return { frames: it.frames, note: "Masks made in this browser by the classical segmenter (port of data/segment.py); no LLM looks at pixels and nothing was sent." };
    if (it.kind === "sample") {
      const s = it.sample, fc = S.main.checks[0]?.fc;
      const frames = s.frames ? s.frames.map((f, i) => ({ src: ROOT + SAMPLE_DIR + f, mask: s.masks[i] && ROOT + SAMPLE_DIR + s.masks[i] }))
        : Array.from({ length: s.n }, (_, i) => ({ src: ROOT + SAMPLE_DIR + `sample_frame${i + 1}.png`, mask: ROOT + SAMPLE_DIR + `${s.id}_frame${i + 1}_mask.png`,
          t: fc?.observed?.t_hours[i], area: fc?.observed?.area[i] }));
      return { frames };
    }
    if (it.run.kind === "frames") {
      const qc = S.main.checks[0]?.forecastCall, paths = qc?.input?.frames || [], fc = S.main.checks[0]?.fc;
      const asSample = paths.every((p, i) => p === `${SAMPLE_DIR}sample_frame${i + 1}.png`) && paths.length >= 1 && paths.length <= 3;
      return { frames: paths.map((p, i) => ({ src: ROOT + p, mask: asSample ? ROOT + SAMPLE_DIR + `sample_${paths.length}frame_frame${i + 1}_mask.png` : null,
          t: fc?.observed?.t_hours[i], area: fc?.observed?.area[i] })),
        note: asSample ? `Frames from the run log's qc_forecast input. This run's own masks went to a temp file; the masks shown are sample_${paths.length}frame's, made by the same segmenter from the same frames.` : "Frames from the run log's qc_forecast input; this run's masks were written to a temp file and are not in the repo." };
    }
    return null;
  }

  function refresh() {
    if (!S.item) return;
    const r = run(), cNow = checkAt(S.t), c = cNow || r.checks[0] || null;
    const refusedDoc = S.main.refused || (cNow?.doc?.refused ? cNow.doc : null);
    // ----- top bar chips -----
    const fc = c?.fc, sq = fc?.segmentation_quality;
    let qc = "";
    if (refusedDoc) qc = `<span class="st-chip st-chip--flag">Refused · ${esc((refusedDoc.reasons || [])[0] || "")}</span>`;
    else if (sq) {
      const obs = fc.observed.t_hours.filter(h => h <= c.doc.cutoff_hours + 1e-9), gap = obs.length > 1 ? obs[1] - obs[0] : null;
      const txt = sq.status === "manual_mask" ? "QC · manual mask (WHAD replay)" : sq.status === "flagged" ? "QC flagged" : `QC ${sq.status}`;
      qc = `<span class="st-chip ${sq.status === "flagged" ? "st-chip--flag" : ""}" title="${esc((sq.reasons || []).join("; "))}">${txt} · ${obs.length} image${obs.length === 1 ? "" : "s"}${gap ? ` · ${gap} h apart` : ""}${sq.reasons?.length ? ` · ${esc(sq.reasons[0])}` : ""}</span>`;
    }
    const uncFlag = !refusedDoc && (fc?.flags || []).find(f => f?.type === "uncalibrated_condition");
    if (uncFlag) qc += `<span class="st-chip st-chip--flag" title="${esc(uncFlag.reason)}">New condition · band widened, uncalibrated</span>`;
    $(".as-qc").innerHTML = qc;
    const cal = c && isCalibrated(c.doc, fc);
    $(".as-honesty").innerHTML = [S.item.kind === "run" ? "Recorded run" : S.item.kind === "upload" ? BROWSER_LABEL : "Sample data", refusedDoc ? null : "Simulated cells · not tracked cells",
      c && !refusedDoc && !cal ? "Uncalibrated" : null, S.active === "branch" ? "Rejected branch (recorded)" : null]
      .filter(Boolean).map(x => `<span class="st-chip st-chip--honesty">${x}</span>`).join("");

    // ----- stage -----
    const cover = $(".as-cover");
    cover.hidden = !refusedDoc;
    if (refusedDoc) cover.innerHTML = `<div class="st-kicker">Refused</div><p>No forecast, no band and no simulation are shown for refused data.</p>`;
    if (tissue && c && !refusedDoc) {
      const area = areaAt(fc, c.doc.cutoff_hours, S.t), fd = tissue.showArea(area), obsPhase = S.t <= c.doc.cutoff_hours + 1e-9 || !cNow;
      $(".as-readout").textContent = `t = ${S.t.toFixed(1)} h · wound area ${Math.round(area * 100)}% of start (${obsPhase ? "observed" : "forecast median"})`;
      const own = (S.item.run?.wound_id || "") === PLAYBACK_WOUND;
      $(".as-simnote").textContent = `Simulated cells, not tracked cells: P2 cell-agent playback (${PLAYBACK_WOUND}, follow rule), frame at sim ${fd.t} h chosen to match this area. `
        + (own ? "Same wound as the selected run." : `Field shape is ${PLAYBACK_WOUND}'s; only the area follows the selected wound.`);
      if (fd.f !== S.thumbF) { S.thumbF = fd.f; drawThumbs(); }
    } else { $(".as-readout").textContent = `t = ${S.t.toFixed(1)} h`; $(".as-simnote").textContent = ""; }

    // ----- timeline -----
    tl.update({ t: S.t, playing: S.playing, speed: S.speed, t0: refusedDoc ? null : c?.doc?.cutoff_hours ?? null, checks: (r.checks || []).map(x => x.cut_h), msg: S.msg });

    // ----- panel (re-render only when something it shows changed) -----
    const key = [S.item.id, S.active, cNow?.cut_h, JSON.stringify(S.approvals), S.tab, !!refusedDoc, S.msg].join("|");
    if (key !== S.panelKey) {
      S.panelKey = key;
      const ps = { check: cNow, run: r, approvals: S.approvals, sourceKind: S.item.kind, rejectNote: S.rejectNote,
        branchAvailable: !!(S.branch && cNow && branchCut() === cNow.cut_h) };
      if (refusedDoc) {
        const im = images();
        panel.innerHTML = refusedPanel(refusedDoc, cNow, S.item.kind === "upload" ? "the in-browser port of upload.py's rules" : undefined) + (im ? imagesTab(im, null, r) : "");
      } else {
        const body = S.tab === "forecast" ? forecastTab(c, S.t) : S.tab === "images" ? imagesTab(images(), c, r.start ? r : S.main) : whyTab(r, cNow, S.t, S.approvals);
        panel.innerHTML = decisionCard(ps) + tabs(S.tab) + `<div class="as-tabbody" role="tabpanel">${body}</div>`;
      }
      panel.querySelectorAll("canvas[data-mask]").forEach(drawMask);
    }
    const now = panel.querySelector(".c-now");
    if (now) { const x = curveX(S.t).toFixed(1); now.setAttribute("x1", x); now.setAttribute("x2", x); }
  }

  // amber outline (and faint fill) of a binary mask PNG, drawn on a canvas over its frame
  function drawMask(cv) {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight; cv.width = w; cv.height = h;
      const g = cv.getContext("2d"); g.drawImage(img, 0, 0);
      const src = g.getImageData(0, 0, w, h), out = g.createImageData(w, h), on = i => src.data[i * 4] > 127;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; if (!on(i)) continue;
        const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || !on(i - 1) || !on(i + 1) || !on(i - w) || !on(i + w);
        out.data.set(edge ? [224, 164, 88, 255] : [224, 164, 88, 40], i * 4);
      }
      g.putImageData(out, 0, 0);
    };
    img.onerror = () => { cv.remove(); };
    img.src = cv.dataset.mask;
  }

  // ---------- HUD bits ----------
  function showSel(st) {
    S.sel = st; const box = $(".as-selstats");
    $('[data-act="clear"]').hidden = !st; box.hidden = !st;
    if (!st) return;
    box.innerHTML = `<div class="st-kicker">Selection · simulated cells</div>
      <div class="st-row"><span>Size</span><span>${st.w_um} × ${st.d_um} µm</span></div>
      <div class="st-row"><span>Sites</span><span>${st.sites}</span></div>
      <div class="st-row"><span>Wound (open)</span><span>${Math.round(st.open * 100)}%</span></div>
      <div class="st-row"><span>Mean density</span><span>${st.density.toFixed(2)}</span></div>
      <div class="st-row"><span>Edge · new · intact</span><span>${st.counts.edge} · ${st.counts.fresh} · ${st.counts.intact}</span></div>`;
  }
  function showTip(h) {
    const tip = $(".as-tip");
    if (!h || tissue?.isSelecting()) { tip.hidden = true; return; }
    tip.hidden = false; tip.style.left = `${h.px + 14}px`; tip.style.top = `${h.py + 14}px`;
    tip.textContent = `site (${h.i},${h.j}) · x ${h.x_um} y ${h.y_um} µm · ${STATE_LABEL[h.state]} · density ${h.density.toFixed(2)} (simulated)`;
  }
  function markView() {
    const v = tissue?.view();
    el.querySelectorAll("[data-view]").forEach(b => b.setAttribute("aria-pressed", b.dataset.view === v));
  }
  const rootCss = getComputedStyle(document.documentElement), cv = (n, h) => rootCss.getPropertyValue(n).trim() || h;
  const COLORS = { wound: cv("--cell-wound", "#24120F"), intact: cv("--cell-intact", "#C68B6E"), edge: cv("--cell-edge", "#B3122E"), fresh: cv("--cell-new", "#FFD2C6") };
  function drawThumbs() {
    if (!tissue) return;
    const { NX, NY } = tissue.grid, st = Array.from({ length: NX * NY }, (_, k) => tissue.stateOf(k)), HY = Math.sqrt(3) / 2;
    let cx = 0, cy = 0, n = 0, ex = NX / 2, ey = NY / 2, bd = Infinity;
    for (let k = 0; k < st.length; k++) if (st[k] === "wound" || st[k] === "edge") { cx += k % NX; cy += (k / NX) | 0; n++; }
    if (n) { cx /= n; cy /= n; } else { cx = NX / 2; cy = NY / 2; }
    for (let k = 0; k < st.length; k++) if (st[k] === "edge") { const d = (k % NX - cx) ** 2 + (((k / NX) | 0) - cy - 3) ** 2; if (d < bd) { bd = d; ex = k % NX; ey = (k / NX) | 0; } }
    const regions = { field: [NX / 2, NY / 2, NX + 1], wound: [cx, cy, 16], cells: [ex, ey, 4] };
    el.querySelectorAll(".as-thumb").forEach(b => {
      const cv = b.querySelector("canvas"), g = cv.getContext("2d"), [mx, my, span] = regions[b.dataset.view];
      const sc = cv.width / span; g.fillStyle = "#050607"; g.fillRect(0, 0, cv.width, cv.height);
      const r = sc * 0.55;
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const x = (i + (j & 1) * 0.5 - mx) * sc + cv.width / 2, y = (j - my) * HY * sc + cv.height / 2;
        if (x < -r || y < -r || x > cv.width + r || y > cv.height + r) continue;
        g.fillStyle = COLORS[st[j * NX + i]]; g.beginPath();
        for (let a = 0; a < 6; a++) { const t = Math.PI / 3 * a + Math.PI / 6; g.lineTo(x + r * Math.cos(t), y + r * Math.sin(t)); }
        g.fill(); if (span <= 16) { g.strokeStyle = "rgba(232,236,239,.18)"; g.stroke(); }
      }
    });
  }
  tissue?.onFrame(() => {
    const px = tissue.pxPer100um(), [um, w] = px > 260 ? [20, px / 5] : px < 30 ? [500, px * 5] : [100, px];
    $(".as-scalebar i").style.width = `${Math.round(w)}px`; $(".as-scalebar span").textContent = `${um} µm (at the orbit target)`;
  });

  // ---------- exports ----------
  function download(name, text, type) {
    const a = Object.assign(document.createElement("a"), { href: typeof text === "string" && text.startsWith("data:") ? text : URL.createObjectURL(new Blob([text], { type })), download: name });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function exportForecast() {
    const c = checkAt(S.t) || run()?.checks[0];
    if (!c?.doc || c.doc.refused) return notice(`<p>No forecast to export for this item.</p><div class="as-btns"><button class="st-btn" data-notice="close">Close</button></div>`);
    const base = `stitch_${S.item.id}_t0_${c.doc.cutoff_hours}h`, fc = c.fc;
    download(`${base}.json`, JSON.stringify(c.doc, null, 1), "application/json");
    const rows = ["t_hours,kind,area,area_q05,area_q50,area_q95",
      ...fc.observed.t_hours.map((h, i) => `${h},observed,${fc.observed.area[i]},,,`),
      ...fc.t_hours.map((h, i) => `${h},forecast,,${fc.area_q05[i]},${fc.area_q50[i]},${fc.area_q95[i]}`)];
    download(`${base}.csv`, rows.join("\n") + "\n", "text/csv");
    if (tissue) download(`${base}_simulated_cells.png`, tissue.snapshot());
  }
  function exportRunlog() {
    if (S.item?.kind !== "run") return notice(`<p>Samples have no agent run log.</p><div class="as-btns"><button class="st-btn" data-notice="close">Close</button></div>`);
    const recs = S.active === "branch" ? S.raw.branch : S.raw.main;
    download(`${recs[0].run_id}.jsonl`, recs.map(r => JSON.stringify(r)).join("\n") + "\n", "application/x-ndjson");
  }

  // ---------- menu + keyboard ----------
  const onAction = e => {
    const a = e.detail?.action || "";
    if (a === "try-sample") select("sample_3frame");
    else if (a === "open-heldout") { const r = S.items.find(i => i.kind === "run" && i.run.kind !== "frames"); if (r && S.item?.kind !== "run") select(r.id); sel.focus(); }
    else if (a === "open-images") $("#as-file").click();
    else if (a === "select-area") act("select");
    else if (a === "clear-selection") tissue?.clearSelection();
    else if (a === "reset-camera") { tissue?.reset(); markView(); }
    else if (a.startsWith("camera:")) { tissue?.goTo(a.slice(7)); markView(); }
    else if (a === "export-forecast") exportForecast();
    else if (a === "export-runlog") exportRunlog();
  };
  const onKey = e => {
    const a = e.detail?.action;
    if (a === "play") togglePlay();
    else if (a === "step-back") step(-1);
    else if (a === "step-forward") step(1);
    else if (a === "zoom-in") tissue?.zoom(1);
    else if (a === "zoom-out") tissue?.zoom(-1);
    else if (a === "select-area") act("select");
    else if (a === "clear-selection") { if (tissue?.isSelecting()) tissue.setSelecting(false); tissue?.clearSelection(); }
    else if (a === "reset-camera") { tissue?.reset(); markView(); }
  };
  ctx.bus.addEventListener("action", onAction);
  ctx.bus.addEventListener("key", onKey);

  markView();
  const first = S.items.find(i => i.kind === "run" && i.run.wound_id === PLAYBACK_WOUND) || S.items[0];
  if (first) await select(first.id);

  return () => {
    cancelAnimationFrame(raf);
    ctx.bus.removeEventListener("action", onAction); ctx.bus.removeEventListener("key", onKey);
    tissue?.dispose(); css.remove(); el.replaceChildren();
  };
}
