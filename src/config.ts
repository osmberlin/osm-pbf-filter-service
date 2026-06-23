// Load + validate region and project configs (PLAN.md §B2/§B4). Fail-soft:
// invalid inputs are skipped and reported as GitHub Actions annotations.
//
// This module does IO and uses Bun's native YAML, so it is NOT imported by the
// vitest tests (those exercise the pure modules: geojson, tags, plan).
import { YAML } from "bun"; // native YAML — https://bun.com/docs/runtime/yaml
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { polygonGeometryType } from "./geojson";
import { ghError, ghWarning } from "./github";
import type { Region, Project } from "./types";

const REGIONS_DIR = "regions";
const REGIONS_FILE = path.join(REGIONS_DIR, "regions.yaml");
const PROJECTS_DIR = "projects";

function validatePolygonFile(file: string): { ok: boolean; detail: string } {
  if (!existsSync(file)) return { ok: false, detail: "file not found" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return { ok: false, detail: `invalid JSON: ${(e as Error).message}` };
  }
  return polygonGeometryType(parsed);
}

export function loadRegions(): Map<string, Region> {
  const out = new Map<string, Region>();
  if (!existsSync(REGIONS_FILE)) {
    ghError(REGIONS_FILE, "regions file not found");
    return out;
  }

  const raw = YAML.parse(readFileSync(REGIONS_FILE, "utf8")) as { regions?: any[] };
  for (const r of raw?.regions ?? []) {
    if (!r?.id || !r?.parent) {
      ghError(REGIONS_FILE, `region missing id/parent: ${JSON.stringify(r)}`);
      continue;
    }
    let polygon: string | undefined;
    if (r.polygon) {
      polygon = path.join(REGIONS_DIR, r.polygon); // repo-relative path
      const v = validatePolygonFile(polygon);
      if (!v.ok) {
        ghError(polygon, `region '${r.id}' polygon invalid: ${v.detail}`);
        continue;
      }
    }
    out.set(r.id, { id: r.id, name: r.name, parent: r.parent, polygon });
  }

  // Drop regions whose parent chain doesn't resolve to "world".
  for (const [id, region] of [...out]) {
    const seen = new Set<string>();
    let cur: string | undefined = id;
    while (cur && cur !== "world") {
      if (seen.has(cur)) { ghError(REGIONS_FILE, `region cycle at '${cur}'`); out.delete(id); break; }
      seen.add(cur);
      const r = out.get(cur);
      if (!r) { ghError(REGIONS_FILE, `region '${id}' has unknown ancestor '${cur}'`); out.delete(id); break; }
      cur = r.parent;
    }
  }

  return out;
}

export function loadProjects(regions: Map<string, Region>): Project[] {
  const out: Project[] = [];
  if (!existsSync(PROJECTS_DIR)) return out;

  for (const entry of readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const dir = path.join(PROJECTS_DIR, id);
    const cfgPath = path.join(dir, "config.yaml");
    if (!existsSync(cfgPath)) continue;

    let cfg: any;
    try {
      cfg = YAML.parse(readFileSync(cfgPath, "utf8"));
    } catch (e) {
      ghError(cfgPath, `invalid YAML: ${(e as Error).message}`);
      continue;
    }

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
      const v = validatePolygonFile(path.join(dir, area.polygon));
      if (!v.ok) {
        ghError(path.join(dir, area.polygon), `project '${id}' polygon invalid: ${v.detail}`);
        continue;
      }
      // Custom polygons are validated but not scheduled yet (PLAN.md §B3, pre-alpha).
      // Skip explicitly so the project isn't silently dropped downstream with no output.
      ghWarning(cfgPath, `project '${id}' uses 'area.polygon', which is not scheduled yet (pre-alpha); skipping`);
      continue;
    }

    const filters = Array.isArray(cfg?.filters) ? cfg.filters.map(String) : [];

    out.push({
      id,
      dir,
      description: cfg?.description,
      repository: cfg?.repository,
      homepage: cfg?.homepage,
      contact: cfg?.contact,
      area: { region: area.region, polygon: area.polygon },
      filters,
      osmium: {
        extract_strategy: cfg?.osmium?.extract_strategy ?? "smart",
        add_referenced: cfg?.osmium?.add_referenced ?? true,
      },
    });
  }

  return out;
}
