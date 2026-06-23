// Orchestrator entry point (PLAN.md §B4). Loads configs, builds the plan, writes
// plan.json for traceability, then runs osmium top-down and writes status files.
//
// Run `bun run build` on the server runner, or `bun run build --dry-run` to emit
// plan.json without invoking osmium.
//
// PRE-ALPHA: the osmium execution path has not been run end-to-end yet. The
// planning logic (plan.ts / tags.ts / geojson.ts) is covered by vitest.
import { mkdirSync, writeFileSync, copyFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadRegions, loadProjects } from "./config";
import { buildPlan, type Paths, type Plan, type PlanStep } from "./plan";
import { summaryLine } from "./github";

const paths: Paths = {
  planet: process.env.OSM_PLANET ?? "/srv/osm/planet/planet.osm.pbf",
  work: process.env.OSM_WORK ?? "/srv/osm/work",
  extracts: process.env.OSM_EXTRACTS ?? "/srv/osm/extracts",
};
const PUBLIC_BASE = process.env.OSM_PUBLIC_BASE ?? "https://osm.example.org/extracts";

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

function runStep(step: PlanStep): void {
  if (step.kind === "extract-multi") {
    mkdirSync(path.dirname(step.configFile), { recursive: true });
    writeFileSync(step.configFile, JSON.stringify(osmiumExtractConfig(step), null, 2));
    osmium(["extract", "--overwrite", "--strategy", step.strategy, "-c", step.configFile, step.input]);
  } else if (step.kind === "tags-filter") {
    mkdirSync(path.dirname(step.output), { recursive: true });
    const args = ["tags-filter", "--overwrite"];
    if (step.addReferenced) args.push("-R");
    args.push("-o", step.output, step.input, ...step.filters);
    osmium(args);
  } else if (step.kind === "copy") {
    mkdirSync(path.dirname(step.to), { recursive: true });
    copyFileSync(step.from, step.to);
  }
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function fileinfo(file: string, key: string): string | null {
  try {
    return execFileSync("osmium", ["fileinfo", "-e", "-g", key, file]).toString().trim();
  } catch {
    return null;
  }
}

function writeStatus(plan: Plan, projects: Awaited<ReturnType<typeof loadProjects>>): void {
  const statePath = path.join(path.dirname(paths.planet), "update-state.json");
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
  const now = new Date().toISOString();
  const index: any[] = [];

  for (const p of projects) {
    const out = path.join(paths.extracts, p.id, "latest.osm.pbf");
    if (!existsSync(out)) continue; // skip in dry-run / when a step was skipped
    const node = plan.nodes.find((n) => n.projects.includes(p.id));
    const status = {
      project: p.id,
      description: p.description,
      repository: p.repository,
      homepage: p.homepage,
      contact: p.contact,
      file: "latest.osm.pbf",
      size_bytes: statSync(out).size,
      sha256: sha256(out),
      area: p.area,
      filters: p.filters,
      pipeline: node ? buildPipeline(plan, node.id) : [],
      data_timestamp: fileinfo(out, "data.timestamp.last") ?? state.data_timestamp ?? null,
      planet_sequence_number: state.planet_sequence_number ?? null,
      update_run_at: state.update_run_at ?? null,
      extract_run_at: now,
      download_url: `${PUBLIC_BASE}/${p.id}/latest.osm.pbf`,
    };
    writeFileSync(path.join(paths.extracts, p.id, "status.json"), JSON.stringify(status, null, 2) + "\n");
    index.push({ project: p.id, download_url: status.download_url, data_timestamp: status.data_timestamp, extract_run_at: now });
  }

  writeFileSync(path.join(paths.extracts, "index.json"), JSON.stringify({ generated_at: now, projects: index }, null, 2) + "\n");
}

function buildPipeline(plan: Plan, leafId: string): string[] {
  const chain: string[] = [];
  let cur: string | null = leafId;
  while (cur) {
    chain.push(cur);
    cur = plan.nodes.find((n) => n.id === cur)?.parent ?? null;
  }
  return chain.reverse();
}

function main(): void {
  const dryRun = process.argv.includes("--dry-run") || !!process.env.OSM_DRY_RUN;

  const regions = loadRegions();
  const projects = loadProjects(regions);
  const plan = buildPlan(regions, projects, paths);

  writeFileSync("plan.json", JSON.stringify(plan, null, 2) + "\n");

  summaryLine("## OSM extract build");
  summaryLine(`- active regions: **${plan.nodes.filter((n) => n.id !== "world").length}**`);
  summaryLine(`- projects: **${projects.length}**`);
  summaryLine(`- osmium steps: **${plan.steps.length}**`);

  if (dryRun) {
    console.log("dry-run: wrote plan.json; not invoking osmium.");
    return;
  }

  for (const step of plan.steps) runStep(step);
  writeStatus(plan, projects);
  console.log(`Done: ${projects.length} projects, ${plan.steps.length} steps.`);
}

main();
