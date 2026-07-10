// Orchestrator entry point (PLAN.md §B4). Loads configs, builds the plan, writes
// plan.json for traceability, then runs osmium top-down and writes status files.
//
// Run `bun run build` on the server runner, or `bun run build --dry-run` to emit
// plan.json without invoking osmium.
//
// PRE-ALPHA: the osmium execution path has not been run end-to-end yet. The
// planning logic (plan.ts / tags.ts / geojson.ts) is covered by tests.
import {
  mkdirSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  statSync,
  renameSync,
  linkSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { loadRegions, loadProjects } from "./config";
import { buildPlan, type Paths, type Plan, type PlanNode, type PlanStep } from "./plan";
import type { Project } from "./types";
import { ghError, ghWarning, errorCount, summaryLine } from "./github";

// One root knob (matches the scripts' OSM_ROOT and the ansible osm_root var);
// the individual paths can still be overridden separately.
const ROOT = process.env.OSM_ROOT ?? "/srv/osm";
const paths: Paths = {
  planet: process.env.OSM_PLANET ?? path.join(ROOT, "planet/planet.osm.pbf"),
  work: process.env.OSM_WORK ?? path.join(ROOT, "work"),
  extracts: process.env.OSM_EXTRACTS ?? path.join(ROOT, "extracts"),
};
const PUBLIC_BASE = process.env.OSM_PUBLIC_BASE ?? "https://osm.example.org/extracts";

// status.json is written next to each extract (served by nginx) AND copied into
// the repo-relative status/ dir so commit-results.sh can commit the audit log
// (PLAN.md §B6). The dir is created even with zero projects so the commit step
// always has a path to stage.
const REPO_STATUS_DIR = process.env.OSM_STATUS_DIR ?? "status";

/** Env flag: set and not "0"/"false"/"no". `OSM_DRY_RUN=false` must NOT dry-run. */
const envFlag = (v: string | undefined) => !!v && !["0", "false", "no"].includes(v.toLowerCase());

function osmiumExtractConfig(step: Extract<PlanStep, { kind: "extract-multi" }>) {
  return {
    directory: path.dirname(step.extracts[0]?.output ?? paths.work),
    extracts: step.extracts.map((e) => ({
      output: path.basename(e.output),
      polygon: { file_name: path.resolve(e.polygon), file_type: "geojson" },
    })),
  };
}

function osmium(args: string[]): void {
  console.log(`+ osmium ${args.join(" ")}`);
  execFileSync("osmium", args, { stdio: "inherit" });
}

/**
 * Build into `target`.tmp, then atomically promote (same filesystem → rename is
 * atomic). nginx serves extracts/ directly, so served files must never be
 * written in place: a client downloading during the run would get a truncated
 * pbf. On failure the .tmp is removed so nothing stray lingers in the served dir.
 */
function buildToTmp(target: string, build: (tmp: string) => void): void {
  const tmp = `${target}.tmp`;
  rmSync(tmp, { force: true });
  try {
    build(tmp);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  renameSync(tmp, target);
}

// Steps run strictly serially BY DESIGN: the server is shared with uMap, and one
// osmium process at a time caps our peak RAM and disk-I/O pressure (PLAN §A8/B8).
function runStep(step: PlanStep): number {
  const t0 = Date.now();
  if (step.kind === "extract-multi") {
    mkdirSync(path.dirname(step.configFile), { recursive: true });
    writeFileSync(step.configFile, JSON.stringify(osmiumExtractConfig(step), null, 2));
    osmium(["extract", "--overwrite", "--strategy", step.strategy, "-c", step.configFile, step.input]);
  } else if (step.kind === "tags-filter") {
    mkdirSync(path.dirname(step.output), { recursive: true });
    buildToTmp(step.output, (tmp) => {
      const args = ["tags-filter", "--overwrite"];
      // osmium INCLUDES referenced objects by default (complete geometry). -R is
      // --omit-referenced, so only pass it when we explicitly do NOT want them.
      if (!step.addReferenced) args.push("-R");
      args.push("-o", tmp, step.input, ...step.filters);
      osmium(args);
    });
  } else if (step.kind === "copy") {
    mkdirSync(path.dirname(step.to), { recursive: true });
    buildToTmp(step.to, (tmp) => {
      try {
        linkSync(step.from, tmp); // same volume: O(1), no doubled disk I/O
      } catch {
        copyFileSync(step.from, tmp);
      }
    });
  }
  return (Date.now() - t0) / 1000;
}

/** Streaming sha256 — extracts can be multiple GB; never buffer them in RAM. */
async function sha256(file: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(file).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

function fileinfo(file: string, key: string): string | null {
  try {
    return execFileSync("osmium", ["fileinfo", "-e", "-g", key, file]).toString().trim();
  } catch {
    return null;
  }
}

function readUpdateState(): any {
  const statePath = path.join(path.dirname(paths.planet), "update-state.json");
  if (!existsSync(statePath)) return {};
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch (e) {
    // A corrupt state file must not kill the run after hours of osmium work.
    ghWarning(statePath, `unreadable update-state.json (${(e as Error).message}); continuing without it`);
    return {};
  }
}

async function writeStatus(plan: Plan, projects: Project[], durations: Record<string, number>): Promise<void> {
  const state = readUpdateState();
  const now = new Date().toISOString();
  const index: any[] = [];

  const nodeByProject = new Map<string, PlanNode>();
  for (const n of plan.nodes) for (const pid of n.projects) nodeByProject.set(pid, n);

  mkdirSync(REPO_STATUS_DIR, { recursive: true });

  for (const p of projects) {
    const out = path.join(paths.extracts, p.id, "latest.osm.pbf");
    if (!existsSync(out)) continue; // skip in dry-run / when a step was skipped
    const node = nodeByProject.get(p.id);
    const status = {
      project: p.id,
      description: p.description,
      repository: p.repository,
      homepage: p.homepage,
      contact: p.contact,
      file: "latest.osm.pbf",
      size_bytes: statSync(out).size,
      sha256: await sha256(out),
      area: p.area,
      filters: p.filters,
      pipeline: node ? buildPipeline(plan, node.id) : [],
      // The planet's own timestamp (from update-planet.sh) is authoritative for
      // every extract of this run; per-file `osmium fileinfo -e` is only a
      // fallback — it decodes the whole pbf, which we avoid doing N times.
      data_timestamp: state.data_timestamp ?? fileinfo(out, "data.timestamp.last") ?? null,
      planet_sequence_number: state.planet_sequence_number ?? null,
      update_run_at: state.update_run_at ?? null,
      extract_run_at: now,
      extract_duration_seconds: durations[p.id] ?? null,
      download_url: `${PUBLIC_BASE}/${p.id}/latest.osm.pbf`,
    };
    const json = JSON.stringify(status, null, 2) + "\n";
    writeFileSync(path.join(paths.extracts, p.id, "status.json"), json); // served by nginx
    mkdirSync(path.join(REPO_STATUS_DIR, p.id), { recursive: true });
    writeFileSync(path.join(REPO_STATUS_DIR, p.id, "status.json"), json); // committed for the audit log
    index.push({ project: p.id, download_url: status.download_url, data_timestamp: status.data_timestamp, extract_run_at: now });
  }

  const indexJson = JSON.stringify({ generated_at: now, projects: index }, null, 2) + "\n";
  writeFileSync(path.join(paths.extracts, "index.json"), indexJson);
  writeFileSync(path.join(REPO_STATUS_DIR, "index.json"), indexJson);
}

function buildPipeline(plan: Plan, leafId: string): string[] {
  const nodeById = new Map(plan.nodes.map((n) => [n.id, n]));
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = leafId;
  while (cur) {
    if (seen.has(cur)) throw new Error(`node cycle at '${cur}' while building pipeline`);
    seen.add(cur);
    chain.push(cur);
    cur = nodeById.get(cur)?.parent ?? null;
  }
  return chain.reverse();
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run") || envFlag(process.env.OSM_DRY_RUN);

  const regions = loadRegions();
  const projects = loadProjects(regions);
  const plan = buildPlan(regions, projects, paths);

  writeFileSync("plan.json", JSON.stringify(plan, null, 2) + "\n");

  summaryLine("## OSM extract build");
  summaryLine(`- active regions: **${plan.nodes.filter((n) => n.id !== "world").length}**`);
  summaryLine(`- projects: **${projects.length}**`);
  summaryLine(`- osmium steps: **${plan.steps.length}**`);
  if (errorCount() > 0) summaryLine(`- ⚠️ **${errorCount()} invalid input(s) skipped** — see annotations`);

  // A run with zero valid projects must FAIL, not vacuously succeed: writing an
  // empty index.json would clobber the served + committed index while every
  // status.json silently goes stale (nobody would be alerted by a green run).
  if (projects.length === 0) {
    ghError("projects", "no valid projects after validation — refusing to publish an empty index");
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    console.log("dry-run: wrote plan.json; not invoking osmium.");
    return;
  }

  const durations: Record<string, number> = {};
  for (const step of plan.steps) {
    const secs = runStep(step);
    const pid = step.kind === "tags-filter" || step.kind === "copy" ? step.project : undefined;
    if (pid) durations[pid] = secs; // leaf-step (final extract) duration, per project
  }
  await writeStatus(plan, projects, durations);
  console.log(`Done: ${projects.length} projects, ${plan.steps.length} steps.`);
}

await main();
