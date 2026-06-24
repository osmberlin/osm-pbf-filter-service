// Aggregate results/*.jsonl into a standalone, browser-readable report.html
// (host-side; run with `bun report.ts`). Structure: research question -> data
// table -> interpretation. Numbers come from results; prose lives here.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const HERE = import.meta.dir;
const RESULTS = path.join(HERE, "results");
const OUT = path.join(HERE, "report.html");

type Row = { scenario: string; step: string; status: string; wall_s: number; max_rss_kb: number; out_bytes: number };

// --- load --------------------------------------------------------------------
const byKey = new Map<string, Row>();
for (const f of readdirSync(RESULTS).filter((f) => f.endsWith(".jsonl")).sort()) {
  for (const line of readFileSync(path.join(RESULTS, f), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r: Row = JSON.parse(line);
    byKey.set(`${r.scenario}|${r.step}`, r);
  }
}
const get = (scenario: string, step: string) => byKey.get(`${scenario}|${step}`);
const env = existsSync(path.join(RESULTS, "_env.txt"))
  ? readFileSync(path.join(RESULTS, "_env.txt"), "utf8").trim()
  : "(unknown)";

// --- formatting --------------------------------------------------------------
const wall = (s?: number) => (s == null ? "—" : `${s.toFixed(1)} s`);
const rss = (kb?: number) =>
  kb == null ? "—" : kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} GB` : `${Math.round(kb / 1024)} MB`;
const size = (b?: number) =>
  b == null ? "—" : b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 / 1024)} MB`;

// bar cell: value + a proportional bar (max across the column for the section)
function num(value: string, frac: number, accent = false) {
  const pct = Math.max(0, Math.min(100, frac * 100));
  return `<td class="num${accent ? " accent" : ""}"><span class="bar" style="--w:${pct}%"></span><span class="v">${value}</span></td>`;
}

type Cell = { label: string; r?: Row; tag?: string };
function table(headLabel: string, cells: Cell[]) {
  const maxWall = Math.max(...cells.map((c) => c.r?.wall_s ?? 0), 0.0001);
  const maxRss = Math.max(...cells.map((c) => c.r?.max_rss_kb ?? 0), 1);
  const maxOut = Math.max(...cells.map((c) => c.r?.out_bytes ?? 0), 1);
  let h = `<table><thead><tr><th>${headLabel}</th><th>Wall time</th><th>Peak RAM</th><th>Output</th></tr></thead><tbody>`;
  for (const c of cells) {
    const r = c.r;
    const tag = c.tag ? ` <span class="pill">${c.tag}</span>` : "";
    h += `<tr><th scope="row">${c.label}${tag}</th>`;
    h += num(wall(r?.wall_s), (r?.wall_s ?? 0) / maxWall);
    h += num(rss(r?.max_rss_kb), (r?.max_rss_kb ?? 0) / maxRss);
    h += num(size(r?.out_bytes), (r?.out_bytes ?? 0) / maxOut);
    h += `</tr>`;
  }
  return h + `</tbody></table>`;
}

// --- sections (research questions) -------------------------------------------
const Q_RAM = `
<section class="card">
  <span class="qno">Q1</span>
  <h2>Does the RAM fit the shared server?</h2>
  <p class="ctx">Concern from PLAN §B8: the planet is 87&nbsp;GB — will osmium need huge RAM,
  and will it crowd out uMap?</p>
  ${table("osmium operation", [
    { label: "extract", tag: "simple", r: get("01-strategy-simple", "extract_simple") },
    { label: "extract", tag: "complete_ways", r: get("02-strategy-complete_ways", "extract_complete_ways") },
    { label: "extract", tag: "smart", r: get("03-strategy-smart", "extract_smart") },
    { label: "tags-filter", tag: "include refs", r: get("04-tagfilter-include-ref", "tagfilter_include") },
    { label: "tags-filter", tag: "-R omit refs", r: get("05-tagfilter-omit-ref", "tagfilter_omit") },
  ])}
  <div class="interp">
    <p class="verdict">Verdict: bounded at ~4&nbsp;GB — not proportional to the 87&nbsp;GB file. Budget ≥ 8&nbsp;GB headroom and re-measure on the planet.</p>
    <ul>
      <li>Peak RAM tracks the <strong>global node-ID index</strong>, not the output size — a 16&nbsp;MB result still cost GBs.</li>
      <li><code>extract</code> peaked ~4&nbsp;GB; <code>tags-filter</code> with referenced objects ~2.2&nbsp;GB; with <code>-R</code> only ~0.25&nbsp;GB.</li>
      <li>osmium streams the file, so RAM won't explode on the planet — but expect <em>somewhat</em> more than on a country (more ways/relations to track).</li>
    </ul>
  </div>
</section>`;

const Q_STRATEGY = `
<section class="card">
  <span class="qno">Q2</span>
  <h2>Which extract strategy: simple / complete_ways / smart?</h2>
  <p class="ctx">These cut the region geometry. Trade-off: completeness of ways &amp; relations vs cost.</p>
  ${table("strategy", [
    { label: "simple", tag: "1 pass", r: get("01-strategy-simple", "extract_simple") },
    { label: "complete_ways", tag: "2 passes · osmium default", r: get("02-strategy-complete_ways", "extract_complete_ways") },
    { label: "smart", tag: "3 passes", r: get("03-strategy-smart", "extract_smart") },
  ])}
  <div class="interp">
    <p class="verdict">Verdict: use <strong>smart</strong> for boundary projects; <strong>complete_ways</strong> where relations aren't needed.</p>
    <ul>
      <li><code>smart</code> costs only ~12&nbsp;s and ~0.2&nbsp;GB more than <code>complete_ways</code>, for the same output size — but it completes multipolygon <strong>relations</strong> (admin boundaries).</li>
      <li><code>simple</code> is ~2× faster and ~1.5&nbsp;GB leaner, but geometrically incomplete — only for throwaway cuts.</li>
      <li>The per-project <code>extract_strategy</code> knob selects this; the pipeline uses the strongest strategy any project under a region needs.</li>
    </ul>
  </div>
</section>`;

const Q_REF = `
<section class="card">
  <span class="qno">Q3</span>
  <h2>Cost of keeping referenced objects (default) vs <code>-R</code> (omit)?</h2>
  <p class="ctx"><code>osmium tags-filter</code> includes referenced nodes/members by default (complete geometry).
  <code>-R/--omit-referenced</code> drops them.</p>
  ${table("tags-filter mode", [
    { label: "include referenced", tag: "default · usable geometry", r: get("04-tagfilter-include-ref", "tagfilter_include") },
    { label: "-R omit referenced", tag: "cheap · broken geometry", r: get("05-tagfilter-omit-ref", "tagfilter_omit") },
  ])}
  <div class="interp">
    <p class="verdict">Verdict: keep the <strong>default (include)</strong> — the cheap mode produces unusable extracts.</p>
    <ul>
      <li><code>-R</code> is ~3× faster and ~9× less RAM — but the smaller output (16 vs 53&nbsp;MB) is smaller <em>because</em> ways/relations lost their nodes/members.</li>
      <li>This is why the orchestrator was fixed to include-by-default and only add <code>-R</code> when a project opts out.</li>
    </ul>
  </div>
</section>`;

// order question: two multi-step approaches with totals
function orderRows(scenario: string, steps: { label: string; step: string }[]) {
  const rs = steps.map((s) => get(scenario, s.step));
  const totalWall = rs.reduce((a, r) => a + (r?.wall_s ?? 0), 0);
  const final = rs[rs.length - 1];
  let body = "";
  const maxWall = 75, maxRss = 4000000, maxOut = 60 * 1024 * 1024; // shared scale across both approaches
  steps.forEach((s, i) => {
    const r = rs[i];
    body += `<tr><th scope="row">${s.label}</th>`;
    body += num(wall(r?.wall_s), (r?.wall_s ?? 0) / maxWall);
    body += num(rss(r?.max_rss_kb), (r?.max_rss_kb ?? 0) / maxRss);
    body += num(size(r?.out_bytes), (r?.out_bytes ?? 0) / maxOut);
    body += `</tr>`;
  });
  body += `<tr class="total"><th scope="row">total</th>${num(wall(totalWall), totalWall / maxWall, true)}<td class="num">—</td>${num(size(final?.out_bytes), (final?.out_bytes ?? 0) / maxOut)}</tr>`;
  return body;
}
const Q_ORDER = `
<section class="card">
  <span class="qno">Q4</span>
  <h2>Region-first or tag-first (for our sparse tags)?</h2>
  <p class="ctx">Same end result, two orders. Sparse tags = boundaries + a few POIs.</p>
  <div class="two">
    <div>
      <h3>A · region → tag</h3>
      <table><thead><tr><th>step</th><th>Wall</th><th>Peak RAM</th><th>Output</th></tr></thead>
      <tbody>${orderRows("06-region-then-tag", [
        { label: "extract region (smart)", step: "region_extract" },
        { label: "tag-filter region", step: "region_tagfilter" },
      ])}</tbody></table>
    </div>
    <div>
      <h3>B · tag → region</h3>
      <table><thead><tr><th>step</th><th>Wall</th><th>Peak RAM</th><th>Output</th></tr></thead>
      <tbody>${orderRows("07-tag-then-region", [
        { label: "tag-filter country", step: "global_tagfilter" },
        { label: "extract region (smart)", step: "region_extract" },
      ])}</tbody></table>
    </div>
  </div>
  <div class="interp">
    <p class="verdict">Verdict: tag-first is marginally faster here — but both are dominated by one unavoidable full pass. Re-test on the planet before changing the pipeline.</p>
    <ul>
      <li>Tag-filtering the country first shrinks it (→ ~53&nbsp;MB), making the region cut almost free (3&nbsp;s vs 10&nbsp;s).</li>
      <li>The saving is small because tag-filter-with-referenced is itself a multi-pass op; on 87&nbsp;GB the win isn't guaranteed.</li>
      <li>The pipeline currently does region-first (osmium's own recommendation for splitting big files).</li>
    </ul>
  </div>
</section>`;

// appendix: everything
const allScenarios = [...new Set([...byKey.values()].map((r) => r.scenario))].sort();
let appendix = `<table><thead><tr><th>Scenario</th><th>Step</th><th>Wall</th><th>Peak RAM</th><th>Output</th><th>OK</th></tr></thead><tbody>`;
for (const s of allScenarios) {
  for (const r of [...byKey.values()].filter((r) => r.scenario === s)) {
    appendix += `<tr><td>${s}</td><td>${r.step}</td><td class="r">${r.step === "_container_peak" ? "—" : wall(r.wall_s)}</td><td class="r">${rss(r.max_rss_kb)}</td><td class="r">${r.out_bytes ? size(r.out_bytes) : "—"}</td><td class="c">${r.status === "ok" ? "✅" : "❌"}</td></tr>`;
  }
}
appendix += `</tbody></table>`;

// --- page --------------------------------------------------------------------
const now = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>osmium performance experiment</title>
<style>
  :root { --bg:#fafafa; --card:#fff; --ink:#1a1a1a; --muted:#666; --line:#e3e3e3; --accent:#2563eb; --bar:#dbe6ff; --good:#16a34a; }
  @media (prefers-color-scheme: dark){ :root{ --bg:#15171a; --card:#1e2126; --ink:#e8e8e8; --muted:#9aa0a6; --line:#33383f; --accent:#6ea8ff; --bar:#27324a; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:880px; margin:0 auto; padding:32px 20px 64px; }
  h1 { font-size:1.7rem; margin:0 0 4px; }
  .sub { color:var(--muted); margin:0 0 24px; }
  .keys { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; margin:0 0 28px; }
  .key { background:var(--card); border:1px solid var(--line); border-left:4px solid var(--accent); border-radius:8px; padding:10px 12px; font-size:.9rem; }
  .key b { display:block; font-size:.72rem; letter-spacing:.04em; text-transform:uppercase; color:var(--muted); margin-bottom:2px; }
  details { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:8px 14px; margin:0 0 28px; }
  summary { cursor:pointer; font-weight:600; }
  details ul { margin:8px 0; } details code { white-space:nowrap; }
  .card { position:relative; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:20px 22px 6px; margin:0 0 22px; }
  .qno { position:absolute; top:-12px; left:18px; background:var(--accent); color:#fff; font-size:.72rem; font-weight:700; letter-spacing:.05em; padding:3px 9px; border-radius:20px; }
  .card h2 { font-size:1.18rem; margin:6px 0 2px; }
  .card h3 { font-size:.95rem; margin:14px 0 6px; color:var(--muted); }
  .ctx { color:var(--muted); margin:0 0 14px; font-size:.92rem; }
  table { width:100%; border-collapse:collapse; margin:6px 0 4px; font-size:.92rem; }
  th, td { text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); }
  thead th { font-size:.72rem; letter-spacing:.04em; text-transform:uppercase; color:var(--muted); border-bottom:2px solid var(--line); }
  tbody th { font-weight:600; }
  td.num { position:relative; text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  td.num .bar { position:absolute; right:0; top:50%; transform:translateY(-50%); height:60%; width:var(--w); background:var(--bar); border-radius:3px; z-index:0; }
  td.num .v { position:relative; z-index:1; }
  td.num.accent .v { font-weight:700; color:var(--accent); }
  td.r { text-align:right; font-variant-numeric:tabular-nums; } td.c { text-align:center; }
  tr.total th, tr.total td { border-top:2px solid var(--line); border-bottom:none; font-weight:700; }
  .pill { display:inline-block; font-size:.68rem; color:var(--muted); border:1px solid var(--line); border-radius:20px; padding:1px 7px; vertical-align:middle; }
  .two { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
  @media (max-width:640px){ .two{ grid-template-columns:1fr; } }
  .interp { margin:14px 0 16px; }
  .verdict { background:color-mix(in srgb, var(--good) 12%, transparent); border-left:4px solid var(--good); border-radius:6px; padding:9px 12px; margin:0 0 10px; font-weight:600; }
  .interp ul { margin:0; padding-left:20px; } .interp li { margin:4px 0; }
  code { background:color-mix(in srgb, var(--ink) 8%, transparent); padding:1px 5px; border-radius:4px; font-size:.88em; }
  footer { color:var(--muted); font-size:.82rem; margin-top:30px; border-top:1px solid var(--line); padding-top:14px; }
</style></head>
<body><div class="wrap">
  <h1>osmium performance experiment</h1>
  <p class="sub">Filtering a country extract — answering the open questions in PLAN&nbsp;§B8. Generated ${now}.</p>

  <div class="keys">
    <div class="key"><b>Input</b>germany-latest.osm.pbf · 4.4 GB</div>
    <div class="key"><b>Sub-region</b>~Hessen bbox</div>
    <div class="key"><b>Tags</b>boundaries + playground POIs (sparse)</div>
    <div class="key"><b>Environment</b>Docker (Linux), GNU time</div>
  </div>

  <details><summary>Method — how RAM &amp; time were measured</summary>
    <ul>
      <li>Each osmium step wrapped with <code>/usr/bin/time -f '%e %M'</code> → wall seconds + peak resident set size (RAM).</li>
      <li>Per-scenario cgroup <code>memory.peak</code> recorded as a cross-check (agrees with per-step RAM).</li>
      <li>Bars in each table are relative to the largest value in that table — for quick visual comparison.</li>
      <li>Toolchain: <code>${env.replace(/\n/g, " · ")}</code></li>
      <li><strong>Caveat:</strong> Docker-on-macOS wall-times are indicative (VM I/O); peak RAM transfers well. The country file under-counts data volume vs the 87 GB planet but exercises realistic RAM (the node-ID space is global). Re-run on the planet/server before final sizing.</li>
    </ul>
  </details>

  ${Q_RAM}
  ${Q_STRATEGY}
  ${Q_REF}
  ${Q_ORDER}

  <details><summary>Appendix — all raw measurements</summary>
    ${appendix}
  </details>

  <footer>Regenerate with <code>bun report.ts</code> after <code>./run.sh</code>. Add a scenario in <code>scenarios/</code>, run just that one, regenerate — existing results are reused.</footer>
</div></body></html>`;

writeFileSync(OUT, html);
console.log(`Wrote ${OUT} (${allScenarios.length} scenarios).`);
