// Assay mode: pick a recorded agent run or a sample, replay it on a timeline, see the decision card, the forecast,
// the images and the agent's reasons, over a 3D density field from the v2 NCA emulator (never tracked cells).
// Data: agent/runs (ctx.data.runIndex), web/data/samples, web/public/sim (P2 NCA playbacks). Nothing is invented here.
// tissue.js needs three.js (import map -> unpkg); it is loaded dynamically in mount() so Assay still works offline
import { parseRun, mergeBranch, docAsChecks, isCalibrated, HORIZON_H } from "./runlog.js";
import { areaAt, curveX } from "./curve.js";
import { decisionCard, refusedPanel, charts, framesRow, decisionKind, esc, ICON } from "./panel.js";
import { createTimeline } from "./timeline.js";
import { greyFromFile, rgbaFromFile } from "../upload/segment.js";
import { runUpload, BROWSER_LABEL } from "../upload/forecast.js";
import { createLive, livePanel, liveReadouts, LIVE_LABEL } from "./live.js";
import { photoDialog, photoKind, COLOUR_MIN, SKIN_MIN } from "./photo.js";
import { routeUpload, KIND_LABEL } from "../upload/route.js";
import { mountHeldout } from "./heldout.js";

// 3D field = a v2 NCA density playback per WHAD run wound, started from that wound's own frame 0 with its follow-rule fit
// (sim/js/assay_nca_case.py + make_nca_playback.mjs, docs/p2-handoff.md). Items without their own file show
// FIELD_FALLBACK's field and say so: the samples and the pos2033 upload run are its frames t00-t02 (data/upload.py).
const NCA_FILE = w => `web/public/sim/nca_follow_${w}.json`;
const NCA_WOUNDS = ["exp1_partII_C61_P1", "exp1_partII_C61_P2", "exp1_partII_CC_P2", "exp1_partI_C61_P1", "exp1_partI_C61_P2"];
const FIELD_FALLBACK = "exp1_partII_CC_P2", DEFAULT_WOUND = "exp1_partII_C61_P2";
const AREA_TOL = 0.04;   // shown NCA frame vs target area (fraction of start): beyond this the mismatch is stated
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
      <button class="st-btn st-btn--primary" data-act="upload" title="1-5 phase-contrast frames (forecast) or one skin-wound photo (live NCA, no forecast)"><svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5M5 21h14"/></svg>Upload images…</button>
      <input type="file" accept="image/*" multiple hidden id="as-file">
      <span class="as-qc" hidden></span>
      <span class="as-honesty"></span>
    </div>
    <div class="as-main">
      <div class="as-centre">
        <div class="as-stage">
          <div class="as-hud as-hud-tl" hidden><div class="as-readout num"></div><div class="as-caption as-simnote"></div></div>
          <div class="as-hud as-hud-tr">
            <button class="as-ibtn" data-act="draw" aria-label="Draw (B)" title="Draw · B"><svg viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16z"/></svg></button>
            <button class="as-ibtn" data-act="heat" aria-pressed="false" aria-label="Age heatmap (A)" title="Age heatmap · A"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg></button>
            <button class="as-ibtn" data-act="outline" aria-pressed="false" aria-label="Simulated outline (O)" title="Simulated outline · O"><svg viewBox="0 0 24 24"><path d="M6 9c2-4 9-5 12-1s1 9-4 10-10-3-8-9z" stroke-dasharray="3 2.5"/></svg></button>
            <div class="as-zoom" role="group" aria-label="Zoom">
              <button class="as-ibtn" data-act="zoom-in" aria-label="Zoom in (+)" title="Zoom in · +">+</button>
              <input class="as-zoomr" type="range" min="0" max="1" step="0.01" value="0" aria-label="Zoom">
              <button class="as-ibtn" data-act="zoom-out" aria-label="Zoom out (−)" title="Zoom out · −">−</button>
            </div>
            <button class="as-ibtn" data-act="orbit" aria-pressed="true" aria-label="Idle orbit (I)" title="Idle orbit · I"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v4.5h-4.5"/><circle cx="12" cy="12" r="1.6"/></svg></button>
            <button data-act="select" hidden></button><button data-act="clear" hidden></button>
          </div>
          <div class="as-hud as-hud-bl">
            <div class="as-scalebar"><i></i><span></span></div>
            <div class="as-legend3d">${Object.entries(STATE_LABEL).map(([k, v]) => `<span class="as-st"><i class="sw sw-${k}"></i>${v}</span>`).join("")}<span class="as-divnote" hidden></span><span class="as-dim as-fieldnote" style="display:none"></span>
              <div class="as-ageleg" hidden><div class="st-kicker">Cell age</div><i class="as-agebar" style="background:${T?.HEAT_GRADIENT || "none"}"></i><div class="as-ageends"><span>new</span><span>old</span></div><span class="as-dim as-agenote">colour = simulated cell age, not a measurement</span></div></div>
          </div>
          <div class="as-hud as-hud-br as-selstats st-panel" hidden></div>
          <div class="st-tip as-tip" hidden></div>
          <div class="as-cover" hidden></div>
        </div>
      </div>
      <aside class="as-panel" aria-label="Decision and forecast"></aside>
    </div>
    <div class="as-heldout" hidden></div>
    <div class="as-timeline"></div>
    <div class="as-notice st-panel--solid" hidden></div>
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
      label: `${r.wound_id.replace(/^exp1_/, "").replace(/_/g, " ")}${r.stop_kind ? ` · stop ${r.stop_h} h` : ""}` })),
    ...SAMPLES.map(s => ({ kind: "sample", id: s.id, sample: s, label: s.label })),
    { kind: "draw", id: "draw_live", label: "Draw · live NCA" },
    { kind: "heldout", id: "heldout_sim_nca", label: "Sim vs NCA vs data · partII C61 P2" },
  ];
  const sel = $("#as-wound");
  const grp = (name, list) => list.length ? `<optgroup label="${esc(name)}">${list.map(i => `<option value="${esc(i.id)}">${esc(i.label)}</option>`).join("")}</optgroup>` : "";
  const fillSelect = () => {
    sel.innerHTML = grp("Uploads", S.items.filter(i => i.kind === "upload"))
      + grp("Held-out runs", S.items.filter(i => i.kind === "run" && i.run.kind !== "frames"))
      + grp("Upload runs", S.items.filter(i => i.kind === "run" && i.run.kind === "frames"))
      + grp("Samples", S.items.filter(i => i.kind === "sample"))
      + grp("Validation", S.items.filter(i => i.kind === "heldout"))
      + grp("Draw", S.items.filter(i => i.kind === "draw"));
    if (!mains.length) sel.insertAdjacentHTML("beforeend", `<option disabled>No runs</option>`);
  };
  fillSelect();

  // ---------- tissue ----------
  let tissue = null;
  const pbs = new Map();   // path -> Promise of the parsed playback
  const loadPb = path => { if (!pbs.has(path)) pbs.set(path, ctx.data.json(path)); return pbs.get(path); };
  try {
    if (!T) throw new Error("three.js could not be loaded (offline?)");
    tissue = T.createTissue(stage, await loadPb(NCA_FILE(DEFAULT_WOUND)), { onSelection: showSel, onHover: showTip });
  } catch (e) {
    console.error(e); stage.insertAdjacentHTML("afterbegin", `<div class="error">3D view offline</div>`);
  }
  // which NCA field an item shows: { path, own (started from this item's own data), note (what the field is) }
  function fieldFor(it) {
    const w = it.run?.wound_id;
    if (it.kind === "run" && it.run.kind !== "frames" && NCA_WOUNDS.includes(w)) return { path: NCA_FILE(w), own: true, note: `started from ${w}'s own frame 0` };
    const why = it.kind === "upload" ? "no NCA field is made for uploads"
      : (it.kind === "sample" || it.run?.kind === "frames") ? `these frames are ${FIELD_FALLBACK}'s t00-t02, but the field is not from this item's own masks`
      : "no NCA field was made for this wound";
    return { path: NCA_FILE(FIELD_FALLBACK), own: false, note: `field shape not from this item: ${FIELD_FALLBACK}'s NCA field (started from its frame 0; ${why}); only the area follows this item` };
  }
  async function useField(it) {
    if (!tissue) return;
    const f = fieldFor(it);
    try {
      const pb = await loadPb(f.path);
      if (S.item !== it) return;   // another item was picked while this one loaded
      tissue.setPlayback(pb); S.field = f;
    } catch (e) { console.error(e); S.field = { ...f, note: `${f.note}; this field failed to load (${e.message}), the previous field is shown` }; }
  }

  // ---------- timeline ----------
  const tl = createTimeline($(".as-timeline"), {
    onPlay: togglePlay, onStep: step, onSpeed: v => { S.speed = v; refresh(); }, onSeek: t => { S.playing = false; seek(t); },
  });

  // ---------- item kinds with their own view: { enter(item), leave(), key(action) -> handled } ----------
  // "draw": live drawing (live.js) on the same 3D view, fed by the live NCA instead of the playback.
  // "heldout": the held-out validation view (heldout.js, 2D, moved from the old Draw screen) in place of the stage.
  let live = null, special = null, heldout = null, thumbAt = 0;
  const leaveRun = it => {
    S.item = it; sel.value = it.id; S.main = S.branch = S.merged = null; S.playing = false; S.msg = ""; S.panelKey = ""; S.thumbF = -1;
    $(".as-timeline").hidden = true; $(".as-qc").innerHTML = ""; $(".as-cover").hidden = true; $(".as-fieldnote").style.display = "none";
  };
  const chips = list => list.map(x => `<span class="st-chip st-chip--honesty">${x}</span>`).join("");
  const VIEWS = {
    draw: {
      enter(it) {
        leaveRun(it); $(".as-honesty").innerHTML = chips(["Simulated cells · not tracked cells", "NCA emulator · preset parameters", "No forecast"]);
        if (!tissue) { panel.innerHTML = `<div class="error">Drawing needs the 3D field, which could not load (three.js offline?).</div>`; return; }
        tissue.clearSelection();
        live = live || createLive(tissue, { onState: liveState });
        live.start(); markDraw(); renderLivePanel();
        $(".as-simnote").textContent = `Simulated cells, not tracked cells: ${LIVE_LABEL}, live in this browser. Drag to cut the tissue.`;
      },
      leave() { live?.stop(); markDraw(); },
      key(a) {
        if (a === "play") { live?.toggle(); return true; }
        return a === "step-back" || a === "step-forward";
      },
    },
    heldout: {
      enter(it) {
        leaveRun(it); $(".as-honesty").innerHTML = chips(["Uncalibrated spread", "Simulated cells · not tracked cells", "Observed data end at 19 h"]);
        $(".as-main").hidden = true; const host = $(".as-heldout"); host.hidden = false; heldout = mountHeldout(host);
      },
      leave() { heldout?.dispose(); heldout = null; $(".as-heldout").hidden = true; $(".as-main").hidden = false; },
      key: a => a === "play" || a === "step-back" || a === "step-forward" || a === "brush" || a === "age-heatmap",   // the view handles its own keys (H = its edge speed)
    },
  };
  function renderLivePanel() { panel.innerHTML = livePanel(live.state); liveReadouts(panel, live.state); }
  function liveState(st) {
    if (special !== VIEWS.draw) return;
    if (pendingPhoto && st.ready) { live.carveMask(pendingPhoto); pendingPhoto = null; renderLivePanel(); }
    setText($(".as-readout"), `${st.fromPhoto ? "shape from photo" : `simulated t = ${st.t.toFixed(1)} h`} · live NCA · ${st.status === "running" ? "healing" : st.status}`);
    if (panel.querySelector(".as-live")) liveReadouts(panel, st); else renderLivePanel();
    const now = performance.now(); if (now - thumbAt > 1000) { thumbAt = now; drawThumbs(); }
  }
  function markDraw() {
    $('[data-act="draw"]').setAttribute("aria-pressed", !!(special === VIEWS.draw && live?.state.brushOn));
    $('[data-act="select"]').setAttribute("aria-pressed", !!tissue?.isSelecting());
    $('[data-act="outline"]').disabled = !!live?.state.active;   // a drawn wound has no outline
  }
  // one active tool on the 3D view: the brush (draw item only) or select-area
  function useTool(t) {
    if (!tissue) return;
    if (t === "brush") { if (special !== VIEWS.draw) return select("draw_live"); live.setBrushOn(!live.state.brushOn); renderLivePanel(); }
    else { if (live?.state.brushOn && special === VIEWS.draw) { live.setBrushOn(false); renderLivePanel(); } tissue.setSelecting(!tissue.isSelecting()); }
    markDraw();
  }
  panel.addEventListener("click", e => {
    const b = e.target.closest("[data-live]"); if (!b || !live) return;
    const [k, v] = b.dataset.live.split(":");
    if (k === "brush") return useTool("brush");
    if (k === "play") return live.toggle();
    ({ reset: () => live.reset(), preset: () => live.setPreset(v), size: () => live.setBrushSize(v), speed: () => live.setSpeed(+v) })[k]?.();
    renderLivePanel();
  });

  async function select(id) {
    const it = S.items.find(i => i.id === id); if (!it) return;
    const v = VIEWS[it.kind] || null;
    if (special && special !== v) { special.leave(); $(".as-timeline").hidden = false; }
    special = v;
    if (v) return v.enter(it);
    if (tissue) loadPb(fieldFor(it).path).catch(() => {});   // fetch the field alongside the run log (useField reports errors)
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
    if (!S.main.refused) await useField(it);
    if (S.item !== it) return;
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
    } else if (a === "zoom-in") return tissue?.zoom(1);
    else if (a === "zoom-out") return tissue?.zoom(-1);
    else if (a === "orbit") return setOrbit(!tissue?.isIdleOrbit());
    else if (a === "upload") return $("#as-file").click();
    else if (a === "sample") return select("sample_3frame");
    else if (a === "draw") return useTool("brush");
    else if (a === "select") return useTool("select");
    else if (a === "clear") return tissue?.clearSelection();
    else if (a === "heat") return setHeat(!tissue?.isHeat());
    else if (a === "outline") return setOutline(!tissue?.isOutline());
    refresh();
  }
  el.addEventListener("click", e => {
    const b = e.target.closest("[data-act],[data-view]"); if (!b || !el.contains(b)) return;
    if (false) {}
    else if (b.dataset.view) { tissue?.goTo(b.dataset.view); markView(); }
    else act(b.dataset.act);
  });
  el.addEventListener("input", e => { if (e.target.classList.contains("as-zoomr")) tissue?.setZoom(+e.target.value); });
  // ---------- in-browser upload (#39): same QC + segmentation + edge-speed forecast as data/upload.py, nothing sent ----------
  // One button for both kinds (web/upload/route.js): every file is typed by photo.js photoKind, then microscopy frames go
  // to uploadFrames, one skin-wound photo to uploadPhoto; an unsure single image gets one inline choice; the rest is refused.
  let nUploads = 0, pendingPhoto = null;
  const pct = x => `${Math.round(100 * x)}%`;
  $("#as-file").addEventListener("change", async e => {
    const files = [...e.target.files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })); e.target.value = "";
    if (!files.length) return;
    let kinds;
    try { kinds = await Promise.all(files.map(async f => photoKind(await rgbaFromFile(f)))); } catch (err) {
      console.error(err);
      return notice(`<div class="st-kicker">Could not read images · PNG / JPEG</div><p>${esc(err.message)}</p><div class="as-btns"><button class="st-btn" data-notice="close">Close</button></div>`);
    }
    const r = routeUpload(kinds.map(k => k.kind));
    if (r.route === "microscopy") return uploadFrames(files);
    if (r.route === "photo") return uploadPhoto(files[0]);
    // what each file was read as; hover: the two tests (a wound photo needs both colour and skin tone)
    const read = `<ol class="as-list">${files.slice(0, 6).map((f, i) => `<li title="colour ${pct(kinds[i].colour)} (photo ≥ ${pct(COLOUR_MIN)}) · skin tone ${pct(kinds[i].skin)} (photo ≥ ${pct(SKIN_MIN)})">${esc(f.name)} <span class="as-dim">· ${KIND_LABEL[kinds[i].kind]}</span></li>`).join("")}${files.length > 6 ? `<li class="as-dim">+ ${files.length - 6} more</li>` : ""}</ol>`;
    if (r.route === "ask") {
      notice(`<div class="st-kicker">Upload · 1 image · in browser</div><p>Microscopy frames or a wound photo?</p>${read}
        <div class="as-btns"><button class="st-btn" data-route="frames">Microscopy frames</button><button class="st-btn" data-route="photo">Wound photo</button><button class="st-btn" data-notice="close">Cancel</button></div>`);
      $('.as-notice [data-route="frames"]').addEventListener("click", () => uploadFrames(files));
      $('.as-notice [data-route="photo"]').addEventListener("click", () => uploadPhoto(files[0]));
      return;
    }
    notice(`<div class="st-kicker">Not used · 1-5 frames or one wound photo</div><p>${esc(r.reason)}</p>${read}<div class="as-btns"><button class="st-btn" data-notice="close">Close</button></div>`);
  });
  // wound photo: live drawing on the same 3D view, box the wound (photo.js), its outline is carved and the NCA heals it
  async function uploadPhoto(file) {
    if (special !== VIEWS.draw) await select("draw_live");
    if (!live) return;   // no 3D field: the draw view's panel says why
    photoDialog($(".as-notice"), file, mask => {
      if (!live.state.ready) { pendingPhoto = mask; return; }   // NCA still loading: liveState carves it on the first state
      live.carveMask(mask); renderLivePanel();
    });
  }
  function uploadFrames(files) {
    const used = files.slice(0, 5);
    notice(`<div class="st-kicker">Upload · ${used.length} image${used.length === 1 ? "" : "s"} · in browser</div>
      <ol class="as-list">${used.map(f => `<li>${esc(f.name)}</li>`).join("")}</ol>
      <form class="as-upform">
        <label class="as-caption">Interval (h)<input class="as-input" name="interval" type="number" step="any" min="0" placeholder="1" required></label>
        <label class="as-caption">Scale (µm/px)<input class="as-input" name="scale" type="number" step="any" min="0" placeholder="0.908" required></label>
        <div class="as-btns"><button class="st-btn st-btn--primary" type="submit">Forecast</button><button class="st-btn" type="button" data-notice="close">Cancel</button></div>
      </form>`);
    const form = $(".as-notice .as-upform");
    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      const interval = +form.interval.value, scale = +form.scale.value;
      if (!(interval > 0) || !(scale > 0)) return;
      form.querySelector('[type="submit"]').disabled = true;
      form.insertAdjacentHTML("beforeend", `<p class="as-caption as-upbusy">Running…</p>`);
      try {
        const [calib, frames] = await Promise.all([ctx.data.json(CALIB), Promise.all(used.map(greyFromFile))]);
        const res = runUpload(frames, interval, scale, calib);
        if (res.doc.error) {
          return notice(`<div class="st-kicker">No forecast</div><p>${esc(res.doc.error)}</p><div class="as-btns"><button class="st-btn" data-notice="close">Close</button></div>`);
        }
        const id = `upload_${++nUploads}`, n = used.length;
        const item = { kind: "upload", id, doc: res.doc, label: `Upload ${nUploads} · ${n} frame${n === 1 ? "" : "s"}${res.doc.refused ? " · refused" : ""}`,
          frames: used.map((f, i) => ({ src: URL.createObjectURL(f), mask: res.masks[i] ? maskURL(res.masks[i]) : null,
            t: res.doc.forecasts?.[0]?.observed?.t_hours[i], area: res.doc.forecasts?.[0]?.observed?.area[i] })) };
        S.items.unshift(item); fillSelect();
        $(".as-notice").hidden = true;
        await select(id);
      } catch (err) {
        console.error(err);
        notice(`<div class="st-kicker">Could not read images · PNG / JPEG</div><p>${esc(err.message)}</p><div class="as-btns"><button class="st-btn" data-notice="close">Close</button></div>`);
      }
    });
  }
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
    if (it.kind === "upload") return { frames: it.frames };
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
          t: fc?.observed?.t_hours[i], area: fc?.observed?.area[i] })) };
    }
    return null;
  }

  function refresh() {
    if (!S.item || special) return;
    const r = run(), cNow = checkAt(S.t), c = cNow || r.checks[0] || null;
    const refusedDoc = S.main.refused || (cNow?.doc?.refused ? cNow.doc : null);
    const fc = c?.fc;

    // ----- stage -----
    const cover = $(".as-cover");
    if (cover.hidden !== !refusedDoc) cover.hidden = !refusedDoc;
    if (refusedDoc && !cover.querySelector(".as-cover-icon")) cover.innerHTML = `<span class="as-cover-icon">${ICON.refused}</span><div class="st-kicker">Refused</div>`;
    let note = "";
    if (tissue && c && !refusedDoc) {
      const area = areaAt(fc, c.doc.cutoff_hours, S.t), fd = tissue.showArea(area);
      // visible only when needed: the field is another wound's, or the NCA cannot show this area (full note on hover)
      const miss = Math.abs(fd.area - area) > AREA_TOL;
      note = [S.field && !S.field.own ? `NCA field of ${FIELD_FALLBACK}, not this item's` : "",
        miss ? `NCA cannot show ${Math.round(area * 100)}% (closest frame ${Math.round(fd.area * 100)}%${area > fd.area ? ", the NCA wound only shrinks" : ""})` : ""].filter(Boolean).join(" · ");
    }
    const fn = $(".as-fieldnote"), fnTitle = note ? S.field?.note || "" : "", fnDisp = note ? "" : "none";
    setText(fn, note); if (fn.title !== fnTitle) fn.title = fnTitle; if (fn.style.display !== fnDisp) fn.style.display = fnDisp;

    // ----- timeline -----
    tl.update({ t: S.t, playing: S.playing, speed: S.speed, t0: refusedDoc ? null : c?.doc?.cutoff_hours ?? null,
      checks: (r.checks || []).map(x => ({ h: x.cut_h, kind: x.decision ? decisionKind(x.decision) : "go", pending: x.needsApproval && !S.approvals[x.cut_h] })) });

    // ----- panel (re-render only when something it shows changed) -----
    const key = [S.item.id, S.active, cNow?.cut_h, JSON.stringify(S.approvals), !!refusedDoc, S.msg].join("|");
    if (key !== S.panelKey) {
      S.panelKey = key;
      const ps = { check: cNow, run: r, approvals: S.approvals, sourceKind: S.item.kind };
      const im = images();
      panel.innerHTML = refusedDoc ? refusedPanel(refusedDoc) + framesRow(im) : decisionCard(ps) + charts(r, c, S.t) + framesRow(im);
      panel.querySelectorAll("canvas[data-mask]").forEach(drawMask);
      // honesty line (design.md 11): source, simulated cells, calibration; QC flag reasons on hover
      const sq = !refusedDoc && fc?.segmentation_quality;
      $(".as-honesty").innerHTML = chips([S.item.kind === "run" ? "Recorded run" : S.item.kind === "upload" ? "Browser estimate · edge speed" : "Sample data",
        refusedDoc ? null : "Simulated cells · not tracked cells", c && !refusedDoc && !isCalibrated(c.doc, fc) ? "Uncalibrated" : null,
        S.active === "branch" ? "Rejected branch (recorded)" : null].filter(Boolean))
        + (sq?.status === "flagged" ? `<span class="st-chip st-chip--flag" title="${esc((sq.reasons || []).join("; "))}">QC flagged</span>` : "");
    }
    const now = panel.querySelector(".c-now");
    if (now) { const x = curveX(S.t).toFixed(1); setAttr(now, "x1", x); setAttr(now, "x2", x); }
  }
  // DOM writes only on change: refresh() runs every frame while playing, and re-setting an unchanged text or attribute
  // still costs a style / layout / paint pass
  function setText(e, s) { if (e.textContent !== s) e.textContent = s; }
  function setAttr(e, k, v) { v = String(v); if (e.getAttribute(k) !== v) e.setAttribute(k, v); }

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
    box.innerHTML = `<div class="st-kicker">Selection · NCA field</div>
      <div class="st-row"><span>Size</span><span>${st.w_um} × ${st.d_um} µm</span></div>
      <div class="st-row"><span>Display hexes</span><span>${st.sites}</span></div>
      <div class="st-row"><span>Wound (open)</span><span>${Math.round(st.open * 100)}%</span></div>
      <div class="st-row"><span>Mean density</span><span>${st.density.toFixed(2)}</span></div>
      <div class="st-row"><span>Edge · new · intact</span><span>${st.counts.edge} · ${st.counts.fresh} · ${st.counts.intact}</span></div>`;
  }
  function showTip(h) {
    const tip = $(".as-tip");
    if (!h || tissue?.isSelecting()) { tip.hidden = true; return; }
    tip.hidden = false; tip.style.left = `${h.px + 14}px`; tip.style.top = `${h.py + 14}px`;
    tip.textContent = `${h.x_um}, ${h.y_um} µm · ${STATE_LABEL[h.state]} · ${h.density.toFixed(2)}`;
  }
  // age heatmap overlay (button, A or H, View menu, ?heat): recolours the 3D field only, so playback and the live run carry
  // on untouched; grows from / shrinks to the field centre (tissue.js). Legend as in the glass-dish mockup (title, gradient
  // of the stops, state entries dimmed), fading in and out with the front (assay.css)
  function setHeat(on) {
    if (!tissue) return;
    tissue.setHeat(on); $('[data-act="heat"]').setAttribute("aria-pressed", on);
    $(".as-legend3d").classList.toggle("is-heat", on); $(".as-ageleg").hidden = !on;
  }
  // simulated outline overlay (button, O, View menu): off by default, as the mockup has none; labelled "simulated outline"
  function setOutline(on) {
    const b = $('[data-act="outline"]'); if (!tissue || b.disabled) return;
    tissue.setOutline(on); b.setAttribute("aria-pressed", on);
  }
  function markView() {
    const v = tissue?.view();
    el.querySelectorAll("[data-view]").forEach(b => b.setAttribute("aria-pressed", b.dataset.view === v));
  }
  // idle orbit (button, I, View menu): tissue.js turns the camera slowly about its target after a few seconds without input on the
  // 3D view; on by default, the choice kept for the session; no button under prefers-reduced-motion (it never runs then)
  const ORBIT_KEY = "assay.idleOrbit";
  function setOrbit(on) {
    if (!tissue) return;
    tissue.setIdleOrbit(on); $('[data-act="orbit"]').setAttribute("aria-pressed", on);
    try { sessionStorage.setItem(ORBIT_KEY, on ? "1" : "0"); } catch { /* storage blocked: the default applies next time */ }
  }
  const rootCss = getComputedStyle(document.documentElement), cv = (n, h) => rootCss.getPropertyValue(n).trim() || h;
  const COLORS = { wound: cv("--cell-wound", "#24120F"), intact: cv("--cell-intact", "#C68B6E"), edge: cv("--cell-edge", "#B3122E"), fresh: cv("--cell-new", "#FFD2C6") };
  // minimaps of the same display hexes (positions in lattice sites from tissue.grid), field / wound / edge crops
  function drawThumbs() {
    if (!tissue) return;
    const { COUNT, u, v, spacing, W, H } = tissue.grid, st = Array.from({ length: COUNT }, (_, k) => tissue.stateOf(k));
    let cx = 0, cy = 0, n = 0, ex = W / 2, ey = H / 2, bd = Infinity;
    for (let k = 0; k < COUNT; k++) if (st[k] === "wound" || st[k] === "edge") { cx += u[k]; cy += v[k]; n++; }
    if (n) { cx /= n; cy /= n; } else { cx = W / 2; cy = H / 2; }
    for (let k = 0; k < COUNT; k++) if (st[k] === "edge") { const d = (u[k] - cx) ** 2 + (v[k] - cy - 3) ** 2; if (d < bd) { bd = d; ex = u[k]; ey = v[k]; } }
    const regions = { field: [W / 2, H / 2, W + 1], wound: [cx, cy, 16], cells: [ex, ey, 4] };   // centre and span in sites
    el.querySelectorAll(".as-thumb").forEach(b => {
      const cv = b.querySelector("canvas"), g = cv.getContext("2d"), [mx, my, span] = regions[b.dataset.view];
      const sc = cv.width / span; g.fillStyle = "#050607"; g.fillRect(0, 0, cv.width, cv.height);
      const r = sc * spacing * 0.55;
      for (let k = 0; k < COUNT; k++) {
        const x = (u[k] - mx) * sc + cv.width / 2, y = (v[k] - my) * sc + cv.height / 2;
        if (x < -r || y < -r || x > cv.width + r || y > cv.height + r) continue;
        g.fillStyle = COLORS[st[k]];
        if (r < 3) { g.fillRect(x - r, y - r, 2 * r, 2 * r); continue; }   // hexes under ~3 px: a square reads the same and is cheap
        g.beginPath(); for (let a = 0; a < 6; a++) { const t = Math.PI / 3 * a + Math.PI / 6; g.lineTo(x + r * Math.cos(t), y + r * Math.sin(t)); }
        g.fill(); if (span <= 16) { g.strokeStyle = "rgba(232,236,239,.18)"; g.stroke(); }
      }
    });
  }
  const zr = $(".as-zoomr");
  tissue?.onFrame(() => {   // every frame: write only what changed (no layout reads; tissue.js keeps the canvas width)
    const px = tissue.pxPer100um(), [um, w] = px > 260 ? [20, px / 5] : px < 30 ? [500, px * 5] : [100, px];
    const bar = $(".as-scalebar i"), bw = `${Math.round(w)}px`, zl = tissue.zoomLevel().toFixed(2);
    if (bar.style.width !== bw) bar.style.width = bw; setText($(".as-scalebar span"), `${um} µm`);
    if (document.activeElement !== zr && +zr.value !== +zl) zr.value = zl;
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
    else if (a === "age-heatmap") setHeat(!tissue?.isHeat());
    else if (a === "outline") act("outline");
    else if (a === "reset-camera") { tissue?.reset(); markView(); }
    else if (a.startsWith("camera:")) { tissue?.goTo(a.slice(7)); markView(); }
    else if (a === "idle-orbit") setOrbit(!tissue?.isIdleOrbit());
    else if (a === "export-forecast") exportForecast();
    else if (a === "export-runlog") exportRunlog();
  };
  const onKey = e => {
    const a = e.detail?.action;
    if (special?.key(a)) return;
    if (a === "brush") useTool("brush");
    else if (a === "play") togglePlay();
    else if (a === "step-back") step(-1);
    else if (a === "step-forward") step(1);
    else if (a === "zoom-in") tissue?.zoom(1);
    else if (a === "zoom-out") tissue?.zoom(-1);
    else if (a === "idle-orbit") setOrbit(!tissue?.isIdleOrbit());
    else if (a === "select-area") act("select");
    else if (a === "age-heatmap") setHeat(!tissue?.isHeat());
    else if (a === "outline") act("outline");
    else if (a === "clear-selection") { if (tissue?.isSelecting()) tissue.setSelecting(false); tissue?.clearSelection(); }
    else if (a === "escape") {   // Esc: deselect first; with nothing selected, zoom out as before
      if (tissue?.hasSelection() || tissue?.isSelecting()) { if (tissue.isSelecting()) tissue.setSelecting(false); tissue.clearSelection(); }
      else { tissue?.reset(); markView(); }
    }
    else if (a === "reset-camera") { if (tissue?.isSelecting()) tissue.setSelecting(false); tissue?.reset(); markView(); }
  };
  ctx.bus.addEventListener("action", onAction);
  ctx.bus.addEventListener("key", onKey);
  $('[data-act="orbit"]').style.display = tissue?.canIdleOrbit ? "" : "none";
  { let on = true; try { on = sessionStorage.getItem(ORBIT_KEY) !== "0"; } catch { /* storage blocked */ } setOrbit(on); }

  markView(); setHeat(new URLSearchParams(location.search).has("heat"));
  const first = S.items.find(i => i.id === ctx.openItem) || S.items.find(i => i.kind === "run" && i.run.wound_id === DEFAULT_WOUND) || S.items[0];
  delete ctx.openItem;
  if (first) await select(first.id);

  return () => {
    cancelAnimationFrame(raf);
    ctx.bus.removeEventListener("action", onAction); ctx.bus.removeEventListener("key", onKey);
    special?.leave(); live?.dispose(); tissue?.dispose(); css.remove(); el.replaceChildren();
  };
}
