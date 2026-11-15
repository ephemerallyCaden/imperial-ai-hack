// Bottom timeline: transport (step back, play/pause, step forward), speed 0.5x–4x, "t = x h of 19 h",
// a ribbon with observed history solid, the t0 marker, the forecast hatched, check ticks and a draggable playhead.
import { HORIZON_H } from "./runlog.js";
import { ICON } from "./panel.js";

const SPEEDS = [0.5, 1, 2, 4];
const I = {
  back: `<svg viewBox="0 0 24 24"><path d="M6 5v14M18 6l-9 6 9 6z"/></svg>`,
  fwd: `<svg viewBox="0 0 24 24"><path d="M18 5v14M6 6l9 6-9 6z"/></svg>`,
  play: `<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>`,
};

export function createTimeline(el, { onPlay, onStep, onSpeed, onSeek }) {
  el.innerHTML = `
    <div class="tl-row">
      <div class="st-seg">
        <button class="st-btn st-btn--icon" data-tl="back" aria-label="Step back (←)" title="Step back · ←">${I.back}</button>
        <button class="st-btn st-btn--icon st-btn--primary" data-tl="play" aria-label="Play (Space)" title="Play · Space">${I.play}</button>
        <button class="st-btn st-btn--icon" data-tl="fwd" aria-label="Step forward (→)" title="Step forward · →">${I.fwd}</button>
      </div>
      <div class="st-seg tl-speed">${SPEEDS.map(s => `<button class="st-btn" data-speed="${s}">${s}×</button>`).join("")}</div>
      <span class="tl-t num"></span>
      <span class="st-chip st-chip--honesty tl-sped" hidden>Sped up</span>
    </div>
    <div class="tl-ribbon" role="slider" tabindex="0" aria-label="Time" aria-valuemin="0" aria-valuemax="${HORIZON_H}">
      <div class="tl-obs"></div><div class="tl-fc"></div><div class="tl-t0"></div><div class="tl-ticks"></div><div class="tl-head"></div>
    </div>
`;
  const $ = s => el.querySelector(s), rib = $(".tl-ribbon");
  el.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.tl === "play") onPlay(); else if (b.dataset.tl === "back") onStep(-1); else if (b.dataset.tl === "fwd") onStep(1);
    else if (b.dataset.speed) onSpeed(+b.dataset.speed);
  });
  const seekFrom = e => { const r = rib.getBoundingClientRect(); onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * HORIZON_H); };
  let drag = false;
  rib.addEventListener("pointerdown", e => { drag = true; rib.setPointerCapture(e.pointerId); seekFrom(e); });
  rib.addEventListener("pointermove", e => drag && seekFrom(e));
  rib.addEventListener("pointerup", () => { drag = false; });
  rib.addEventListener("keydown", e => { if (e.key === "Home") onSeek(0); if (e.key === "End") onSeek(HORIZON_H); });

  return {
    update({ t, playing, speed, t0, checks = [], msg = "" }) {
      const p = h => `${(h / HORIZON_H) * 100}%`;
      $(".tl-t").innerHTML = `${t.toFixed(1)} h <span>/ ${HORIZON_H} h</span>`;
      const pb = $('[data-tl="play"]'); pb.innerHTML = playing ? I.pause : I.play;
      pb.setAttribute("aria-label", playing ? "Pause (Space)" : "Play (Space)"); pb.title = playing ? "Pause · Space" : "Play · Space";
      el.querySelectorAll("[data-speed]").forEach(b => b.setAttribute("aria-pressed", +b.dataset.speed === speed));
      $(".tl-sped").hidden = !(speed > 1);
      const o = t0 ?? 0;
      $(".tl-obs").style.width = p(o); $(".tl-fc").style.left = p(o); $(".tl-t0").style.left = p(o);
      $(".tl-t0").hidden = t0 == null;
      $(".tl-head").style.left = p(t);
      rib.setAttribute("aria-valuenow", t.toFixed(1));
      const ticks = checks.map(c => `<i class="tl-tick tl-tick--${c.kind || "go"} ${c.pending ? "is-pending" : ""}" style="left:${p(c.h)}" title="${c.h} h">${ICON[c.kind] || ""}</i>`).join("");
      if ($(".tl-ticks").innerHTML !== ticks) $(".tl-ticks").innerHTML = ticks;
    },
  };
}
