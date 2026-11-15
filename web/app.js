// Shell: menu bar, mode tabs (Assay / Ops; drawing lives in Assay's 3D view), a shared event bus. Each mode is a module exporting
// mount(el, ctx) -> optional unmount(). Menu items dispatch "action" events on ctx.bus.
import * as data from "./lib/data.js";

const bus = new EventTarget();
const ctx = { bus, data, emit: (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail })) };
const MODES = { assay: () => import("./assay/assay.js"), ops: () => import("./ops/ops.js") };
const root = document.getElementById("mode-root");
let unmount = null, current = null;

async function show(mode) {
  if (!MODES[mode]) mode = "assay";
  if (mode === current) return;
  if (unmount) { try { unmount(); } catch (e) { console.error(e); } }
  root.replaceChildren(); current = mode; unmount = null;
  document.querySelectorAll("[data-mode]").forEach(b => b.setAttribute("aria-selected", b.dataset.mode === mode));
  history.replaceState(null, "", `#${mode}`);
  try {
    const m = await MODES[mode]();
    unmount = (await m.mount(root, ctx)) || null;
  } catch (e) {
    root.innerHTML = `<div class="error">Could not load ${mode}: ${e.message}</div>`; console.error(e);
  }
}
document.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => show(b.dataset.mode)));

// menus: click to open, Esc / outside click to close; items emit "action"
const menus = document.querySelectorAll(".menu");
menus.forEach(m => m.querySelector("button").addEventListener("click", e => {
  e.stopPropagation(); const open = m.classList.contains("open");
  menus.forEach(x => x.classList.remove("open")); if (!open) m.classList.add("open");
}));
document.addEventListener("click", () => menus.forEach(x => x.classList.remove("open")));
document.querySelectorAll("[data-action]").forEach(el => el.addEventListener("click", e => {
  e.stopPropagation(); menus.forEach(x => x.classList.remove("open"));
  const a = el.dataset.action;
  if (a === "compare-baselines") return show("ops");
  if (["shortcuts", "how-it-works", "limitations", "about"].includes(a)) return help(a);
  ctx.emit("action", { action: a });
}));

const HELP = {
  shortcuts: "<h3>Keyboard shortcuts</h3><p>Space play/pause · ←/→ step · +/− zoom · S select area · B draw (brush on/off) · Esc clear selection · R reset camera · Ctrl N new analysis · Ctrl O open images</p>",
  "how-it-works": "<h3>How the forecast works</h3><p>Code runs the science at each check (QC, forecast, flags, schedule). An agent picks one of the decisions the policy code allows and explains it; every number it writes is checked against the tool outputs. Stops need your approval.</p>",
  limitations: "<h3>Limitations</h3><p>Cells shown are simulated, not tracked. Research use only, not for diagnosis or treatment. Bands from the simulator are uncalibrated; only the forecast band is a calibrated 90% band.</p>",
  about: "<h3>About</h3><p>Data: WHAD (Iheme et al., CC BY 4.0), WHiM-BC, Jin et al. 2016. See the README for citations.</p>",
};
function help(k) { const d = document.getElementById("dialog"); d.querySelector(".dialog-body").innerHTML = HELP[k]; d.showModal(); }

document.addEventListener("keydown", e => {
  if (e.target.closest("input,textarea")) return;
  if (e.key === "?") return help("shortcuts");
  const k = { " ": "play", ArrowLeft: "step-back", ArrowRight: "step-forward", "+": "zoom-in", "=": "zoom-in", "-": "zoom-out",
              s: "select-area", Escape: "clear-selection", r: "reset-camera", b: "brush" }[e.key];
  if (e.ctrlKey && e.key.toLowerCase() === "n") { e.preventDefault(); return ctx.emit("action", { action: "new-analysis" }); }
  if (e.ctrlKey && e.key.toLowerCase() === "o") { e.preventDefault(); return ctx.emit("action", { action: "open-images" }); }
  if (k) { if (k === "play") e.preventDefault(); ctx.emit("key", { action: k }); }
});

show(location.hash.slice(1) || "assay");
