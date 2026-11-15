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
  // RFC 4180-ish: quoted fields may contain commas, newlines and doubled quotes.
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"') { if (src[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  const [keys, ...body] = rows.filter(r => r.length > 1 || r[0] !== "");
  return body.map(r => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}
// Recorded agent runs: agent/runs/index.json (final), else agent/runs/practice/index.json (local practice runs).
export async function runIndex() {
  for (const p of ["agent/runs/index.json", "agent/runs/practice/index.json"]) {
    try { const d = await json(p); return { ...d, base: p.replace(/index\.json$/, "") }; } catch { /* try next */ }
  }
  return { runs: [], base: "agent/runs/" };
}
