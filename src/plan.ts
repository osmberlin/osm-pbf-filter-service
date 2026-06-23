// Pure planning: resolve each project to a region chain, decide which regions are
// active, compute the per-node tag union, and emit the ordered osmium steps
// (PLAN.md §B3/§B4). No IO / no Bun imports — unit-testable.
import path from "node:path";
import type { Region, Project } from "./types";
import { mergeFilters } from "./tags";

export type PlanNode = {
  id: string; // region id, or "world" (the planet)
  parent: string | null; // parent region id; null for world
  depth: number; // world = 0, continents = 1, ...
  polygon?: string; // repo-relative GeoJSON path (undefined for world)
  keepAll: boolean; // a descendant wants everything -> no tag-filter on this branch
  tagUnion: string[]; // merged filters for this intermediate node
  projects: string[]; // project ids whose leaf attaches at this region
};

export type ExtractMultiStep = {
  kind: "extract-multi";
  input: string;
  strategy: string;
  configFile: string; // generated osmium extract --config json
  extracts: { region: string; polygon: string; output: string }[];
};
export type TagsFilterStep = {
  kind: "tags-filter";
  node?: string;
  project?: string;
  input: string;
  output: string;
  filters: string[];
  addReferenced: boolean;
};
export type CopyStep = { kind: "copy"; from: string; to: string };
export type PlanStep = ExtractMultiStep | TagsFilterStep | CopyStep;

export type Paths = { planet: string; work: string; extracts: string };
export type Plan = { nodes: PlanNode[]; steps: PlanStep[] };

/** Region chain from the planet down to `regionId`, e.g. ["world","europe","germany"]. */
export function resolveChain(regions: Map<string, Region>, regionId: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = regionId;
  while (cur && cur !== "world") {
    if (seen.has(cur)) throw new Error(`region cycle detected at '${cur}'`);
    seen.add(cur);
    const r = regions.get(cur);
    if (!r) throw new Error(`unknown region '${cur}'`);
    chain.push(cur);
    cur = r.parent;
  }
  chain.push("world");
  return chain.reverse();
}

function depthOf(regions: Map<string, Region>, id: string): number {
  return id === "world" ? 0 : resolveChain(regions, id).length - 1;
}

/** Active region nodes (world + every region on a project chain) with tag unions. */
export function buildNodes(regions: Map<string, Region>, projects: Project[]): PlanNode[] {
  type Agg = { filters: string[]; keepAll: boolean; projects: string[] };
  const acc = new Map<string, Agg>();
  const ensure = (id: string): Agg => {
    let a = acc.get(id);
    if (!a) { a = { filters: [], keepAll: false, projects: [] }; acc.set(id, a); }
    return a;
  };

  for (const p of projects) {
    const regionId = p.area.region;
    if (!regionId) continue; // custom-polygon scheduling: not wired yet (pre-alpha)
    const chain = resolveChain(regions, regionId);
    const keepAll = (p.filters ?? []).length === 0;
    for (const rid of chain) {
      const a = ensure(rid);
      if (rid === "world") continue; // the planet is never tag-filtered as a whole
      if (keepAll) a.keepAll = true;
      else a.filters.push(...p.filters);
    }
    ensure(regionId).projects.push(p.id);
  }

  const nodes: PlanNode[] = [];
  for (const [id, a] of acc) {
    const region = id === "world" ? undefined : regions.get(id);
    nodes.push({
      id,
      parent: id === "world" ? null : region!.parent,
      depth: depthOf(regions, id),
      polygon: region?.polygon,
      keepAll: a.keepAll,
      tagUnion: a.keepAll ? [] : mergeFilters(a.filters),
      projects: [...a.projects].sort(),
    });
  }
  nodes.sort((x, y) => x.depth - y.depth || x.id.localeCompare(y.id));
  return nodes;
}

const geoFile = (p: Paths, id: string) => path.join(p.work, `${id}.geo.osm.pbf`);
const filteredFile = (p: Paths, n: PlanNode) =>
  n.keepAll ? geoFile(p, n.id) : path.join(p.work, `${n.id}.filtered.osm.pbf`);
const projectOut = (p: Paths, pid: string) => path.join(p.extracts, pid, "latest.osm.pbf");

/** Ordered osmium steps for a set of nodes (single-pass multi-extract per parent). */
export function planSteps(
  nodes: PlanNode[],
  projects: Project[],
  paths: Paths,
): PlanStep[] {
  const childrenOf = new Map<string, PlanNode[]>();
  for (const n of nodes) {
    if (n.parent == null) continue;
    const siblings = childrenOf.get(n.parent) ?? [];
    siblings.push(n);
    childrenOf.set(n.parent, siblings);
  }

  const steps: PlanStep[] = [];

  // Parents first (nodes are already depth-sorted): one read of each parent file
  // produces all its children's geometry, then each child is tag-filtered.
  for (const parent of nodes) {
    const kids = (childrenOf.get(parent.id) ?? []).filter((k) => k.polygon);
    if (kids.length === 0) continue;
    const input = parent.id === "world" ? paths.planet : filteredFile(paths, parent);
    steps.push({
      kind: "extract-multi",
      input,
      strategy: "smart",
      configFile: path.join(paths.work, `${parent.id}.extracts.json`),
      extracts: kids.map((k) => ({ region: k.id, polygon: k.polygon!, output: geoFile(paths, k.id) })),
    });
    for (const k of kids) {
      if (k.keepAll) continue; // filtered == geo
      steps.push({
        kind: "tags-filter",
        node: k.id,
        input: geoFile(paths, k.id),
        output: filteredFile(paths, k),
        filters: k.tagUnion,
        addReferenced: true,
      });
    }
  }

  // Project leaves: cut the project's exact tags out of its region's filtered file.
  const projById = new Map(projects.map((p) => [p.id, p]));
  for (const n of nodes) {
    for (const pid of n.projects) {
      const p = projById.get(pid)!;
      const input = filteredFile(paths, n);
      const out = projectOut(paths, pid);
      if ((p.filters ?? []).length === 0) {
        steps.push({ kind: "copy", from: input, to: out });
      } else {
        steps.push({
          kind: "tags-filter",
          project: pid,
          input,
          output: out,
          filters: p.filters,
          addReferenced: p.osmium.add_referenced,
        });
      }
    }
  }

  return steps;
}

export function buildPlan(regions: Map<string, Region>, projects: Project[], paths: Paths): Plan {
  const nodes = buildNodes(regions, projects);
  return { nodes, steps: planSteps(nodes, projects, paths) };
}
