/**
 * DRAFT skeleton of the extract orchestrator (PLAN.md Part B4).
 *
 * What's implemented here: loading configs + region tree, and **fail-soft input
 * validation** — every referenced polygon must be a GeoJSON Polygon/MultiPolygon;
 * invalid inputs are SKIPPED and reported as GitHub Actions error annotations.
 *
 * What's still TODO: build the active DAG, compute per-node tag unions, generate
 * the osmium multi-extract configs, run osmium top-down, and write status.json /
 * index.json / plan.json.
 *
 * Note: the polygon files under regions/polygons/ are not committed yet, so until
 * they are added this will (correctly) report regions as invalid.
 */
import { readdirSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";
import { YAML } from "bun"; // native YAML parser — https://bun.com/docs/runtime/yaml

const PROJECTS_DIR = "projects";
const REGIONS_FILE = "regions/regions.yaml";

// --- GitHub Actions reporting -------------------------------------------------

function ghError(file: string, msg: string): void {
  // ::error file=...:: highlights the offending file in the Actions run.
  console.log(`::error file=${file}::${msg}`);
}

function ghWarning(file: string, msg: string): void {
  console.log(`::warning file=${file}::${msg}`);
}

function summaryLine(md: string): void {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) appendFileSync(f, md + "\n");
  else console.log(md);
}

// --- GeoJSON polygon validation ----------------------------------------------

type Check = { ok: boolean; detail: string };

/** True only for GeoJSON Polygon/MultiPolygon (unwrapping Feature/FeatureCollection). */
function polygonGeometryType(gj: unknown): Check {
  if (gj == null || typeof gj !== "object") return { ok: false, detail: "not a JSON object" };
  const t = (gj as any).type;

  if (t === "Polygon" || t === "MultiPolygon") return { ok: true, detail: t };

  if (t === "Feature") {
    const g = (gj as any).geometry?.type;
    return g === "Polygon" || g === "MultiPolygon"
      ? { ok: true, detail: `Feature/${g}` }
      : { ok: false, detail: `Feature geometry is ${g ?? "missing"} (need Polygon/MultiPolygon)` };
  }

  if (t === "FeatureCollection") {
    const feats = Array.isArray((gj as any).features) ? (gj as any).features : [];
    if (feats.length === 0) return { ok: false, detail: "empty FeatureCollection" };
    const types = feats.map((f: any) => f?.geometry?.type);
    const allPoly = types.every((x: string) => x === "Polygon" || x === "MultiPolygon");
    return allPoly
      ? { ok: true, detail: `FeatureCollection(${types.join(",")})` }
      : { ok: false, detail: `non-polygonal geometry in collection: ${types.join(",")}` };
  }

  return { ok: false, detail: `type is ${t ?? "missing"} (need Polygon/MultiPolygon)` };
}

function validatePolygonFile(file: string): Check {
  if (!existsSync(file)) return { ok: false, detail: "file not found" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return { ok: false, detail: `invalid JSON: ${(e as Error).message}` };
  }
  return polygonGeometryType(parsed);
}

// --- Loading (fail-soft) ------------------------------------------------------

type Region = { id: string; name?: string; parent: string; polygon?: string };

function loadRegions(): Map<string, Region> {
  const out = new Map<string, Region>();
  if (!existsSync(REGIONS_FILE)) {
    ghError(REGIONS_FILE, "regions file not found");
    return out;
  }
  const raw = YAML.parse(readFileSync(REGIONS_FILE, "utf8")) as { regions?: Region[] };
  for (const r of raw?.regions ?? []) {
    if (!r?.id || !r?.parent) {
      ghError(REGIONS_FILE, `region missing id/parent: ${JSON.stringify(r)}`);
      continue;
    }
    if (r.polygon) {
      const p = path.join("regions", r.polygon);
      const v = validatePolygonFile(p);
      if (!v.ok) {
        ghError(p, `region '${r.id}' polygon invalid: ${v.detail}`);
        continue;
      }
    }
    out.set(r.id, r);
  }
  return out;
}

type Project = { id: string; cfg: any };

function loadProjects(regions: Map<string, Region>): Project[] {
  const out: Project[] = [];
  for (const entry of readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const cfgPath = path.join(PROJECTS_DIR, id, "config.yaml");
    if (!existsSync(cfgPath)) continue;

    let cfg: any;
    try {
      cfg = YAML.parse(readFileSync(cfgPath, "utf8"));
    } catch (e) {
      ghError(cfgPath, `invalid YAML: ${(e as Error).message}`);
      continue;
    }

    // The id is the folder name; a stray `name:` can drift out of sync.
    if (cfg && "name" in cfg) {
      ghWarning(cfgPath, `'name' is ignored — the project id is the folder ('${id}'). Remove the 'name' field.`);
    }

    const area = cfg?.area ?? {};
    if (!area.region && !area.polygon) {
      ghError(cfgPath, "area must set exactly one of 'region' or 'polygon'");
      continue;
    }
    if (area.region && area.polygon) {
      ghError(cfgPath, "area sets both 'region' and 'polygon'; pick one");
      continue;
    }
    if (area.region && !regions.has(area.region)) {
      ghError(cfgPath, `unknown region '${area.region}' (not a valid id in regions.yaml)`);
      continue;
    }
    if (area.polygon) {
      const p = path.join(PROJECTS_DIR, id, area.polygon);
      const v = validatePolygonFile(p);
      if (!v.ok) {
        ghError(p, `project '${id}' polygon invalid: ${v.detail}`);
        continue;
      }
    }

    out.push({ id, cfg });
  }
  return out;
}

// --- Main ---------------------------------------------------------------------

function main(): void {
  const regions = loadRegions();
  const projects = loadProjects(regions);

  summaryLine("## OSM extract build");
  summaryLine(`- regions loaded: **${regions.size}**`);
  summaryLine(`- valid projects: **${projects.length}**`);

  console.log(`Loaded ${regions.size} regions and ${projects.length} valid projects.`);

  // TODO (PLAN.md §B4):
  //   1. Resolve each project to its world→…→project chain (region links or
  //      bbox-overlap for custom polygons).
  //   2. Build the active DAG; drop unused continents/countries.
  //   3. Compute the per-node tag union (broadest-key-wins; broaden object types).
  //   4. Generate osmium multi-extract --config JSON per parent.
  //   5. Run osmium top-down (extract + tags-filter --add-referenced).
  //   6. Write per-project status.json, extracts/index.json, and plan.json.
  console.log("TODO: DAG + tag-union + osmium execution not implemented yet (DRAFT).");
}

main();
