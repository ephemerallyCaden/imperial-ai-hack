// Data access for the web app. Served from the repo root (python -m http.server 8000 --directory .),
// so paths outside web/ resolve with ROOT. Only real files are read; nothing is invented here.
export const ROOT = new URL("../../", import.meta.url).href;   // web/lib/ -> repo root

export async function json(path) {
  const r = await fetch(ROOT + path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}
export async function text(path) {
  const r = await fetch(ROOT + path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.text();
}
export async function jsonl(path) {
  return (await text(path)).split("\n").filter(Boolean).map(l => JSON.parse(l));
}
export function csv(src) {
  const [head, ...rows] = src.trim().split(/\r?\n/);
  const keys = head.split(",");
  return rows.map(r => Object.fromEntries(r.split(",").map((v, i) => [keys[i], v])));
}
// Recorded agent runs: agent/runs/index.json (final), else agent/runs/practice/index.json (local practice runs).
export async function runIndex() {
  for (const p of ["agent/runs/index.json", "agent/runs/practice/index.json"]) {
    try { const d = await json(p); return { ...d, base: p.replace(/index\.json$/, "") }; } catch { /* try next */ }
  }
  return { runs: [], base: "agent/runs/" };
}
