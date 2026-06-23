import { describe, it, expect } from "vitest";
import type { Region, Project } from "../src/types";
import { resolveChain, buildNodes, buildPlan, type Paths } from "../src/plan";

const regions = new Map<string, Region>([
  ["europe", { id: "europe", parent: "world", polygon: "regions/polygons/europe.geojson" }],
  ["africa", { id: "africa", parent: "world", polygon: "regions/polygons/africa.geojson" }],
  ["germany", { id: "germany", parent: "europe", polygon: "regions/polygons/germany.geojson" }],
  ["france", { id: "france", parent: "europe", polygon: "regions/polygons/france.geojson" }],
  ["hessen", { id: "hessen", parent: "germany", polygon: "regions/polygons/hessen.geojson" }],
]);

function project(id: string, region: string, filters: string[]): Project {
  return {
    id,
    dir: `projects/${id}`,
    area: { region },
    filters,
    osmium: { extract_strategy: "smart", add_referenced: true },
  };
}

const projects = [
  project("osm-boundary-check", "germany", ["nwr/boundary=administrative", "nwr/admin_level"]),
  project("playgrounds-france", "france", ["nwr/amenity=playground"]),
  project("spieli", "hessen", ["n/leisure=playground", "w/leisure=playground", "n/amenity=cafe"]),
];

const paths: Paths = { planet: "/planet.osm.pbf", work: "/work", extracts: "/ex" };

describe("resolveChain", () => {
  it("walks from the planet down to the region", () => {
    expect(resolveChain(regions, "hessen")).toEqual(["world", "europe", "germany", "hessen"]);
    expect(resolveChain(regions, "france")).toEqual(["world", "europe", "france"]);
  });

  it("throws on an unknown region", () => {
    expect(() => resolveChain(regions, "atlantis")).toThrow(/unknown region/);
  });
});

describe("buildNodes (activation + tag union)", () => {
  const nodes = buildNodes(regions, projects);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  it("activates only referenced regions (africa stays out)", () => {
    expect(nodes.map((n) => n.id).sort()).toEqual(["europe", "france", "germany", "hessen", "world"]);
  });

  it("unions every descendant's tags at europe", () => {
    expect(byId.europe.tagUnion).toEqual([
      "nw/leisure=playground",
      "nwr/admin_level",
      "nwr/amenity=cafe,playground",
      "nwr/boundary=administrative",
    ]);
  });

  it("scopes the union per branch", () => {
    expect(byId.germany.tagUnion).toEqual([
      "n/amenity=cafe",
      "nw/leisure=playground",
      "nwr/admin_level",
      "nwr/boundary=administrative",
    ]);
    expect(byId.france.tagUnion).toEqual(["nwr/amenity=playground"]);
    expect(byId.hessen.tagUnion).toEqual(["n/amenity=cafe", "nw/leisure=playground"]);
  });

  it("attaches each project leaf at its own region", () => {
    expect(byId.germany.projects).toEqual(["osm-boundary-check"]);
    expect(byId.france.projects).toEqual(["playgrounds-france"]);
    expect(byId.hessen.projects).toEqual(["spieli"]);
  });

  it("marks a no-filter project's branch keepAll", () => {
    const ns = buildNodes(regions, [project("everything", "germany", [])]);
    expect(ns.find((n) => n.id === "germany")!.keepAll).toBe(true);
    expect(ns.find((n) => n.id === "germany")!.tagUnion).toEqual([]);
  });
});

describe("buildPlan (osmium steps)", () => {
  const plan = buildPlan(regions, projects, paths);

  it("reads the planet exactly once", () => {
    const fromPlanet = plan.steps.filter((s) => s.kind === "extract-multi" && s.input === paths.planet);
    expect(fromPlanet).toHaveLength(1);
  });

  it("does a multi-extract per parent (world, europe, germany)", () => {
    const multis = plan.steps.filter((s) => s.kind === "extract-multi");
    expect(multis).toHaveLength(3);
  });

  it("emits a project tags-filter writing latest.osm.pbf with the exact filters", () => {
    const leaf = plan.steps.find((s) => s.kind === "tags-filter" && s.project === "playgrounds-france");
    expect(leaf).toBeDefined();
    expect(leaf).toMatchObject({
      output: "/ex/playgrounds-france/latest.osm.pbf",
      filters: ["nwr/amenity=playground"],
      addReferenced: true,
    });
  });
});

describe("extract strategy (honors per-project osmium.extract_strategy)", () => {
  const withStrategy = (id: string, region: string, strategy: string): Project => ({
    ...project(id, region, ["n/amenity=cafe"]),
    osmium: { extract_strategy: strategy, add_referenced: true },
  });

  it("propagates a project's strategy up its whole region chain", () => {
    const ns = buildNodes(regions, [withStrategy("p", "hessen", "complete_ways")]);
    const byId = Object.fromEntries(ns.map((n) => [n.id, n]));
    expect(byId.hessen.strategy).toBe("complete_ways");
    expect(byId.germany.strategy).toBe("complete_ways");
    expect(byId.europe.strategy).toBe("complete_ways");
  });

  it("cuts each region with the strongest strategy any project needs", () => {
    // hessen wants complete_ways; another germany project defaults to smart.
    const ns = buildNodes(regions, [
      withStrategy("weak", "hessen", "complete_ways"),
      project("strong", "germany", ["nwr/admin_level"]), // default strategy = smart
    ]);
    const byId = Object.fromEntries(ns.map((n) => [n.id, n]));
    expect(byId.hessen.strategy).toBe("complete_ways");
    expect(byId.germany.strategy).toBe("smart"); // smart ⊇ complete_ways
  });

  it("defaults the cut strategy to smart and uses it in the extract-multi step", () => {
    const plan = buildPlan(regions, [project("p", "france", ["nwr/amenity=playground"])], paths);
    const step = plan.steps.find(
      (s) => s.kind === "extract-multi" && (s as any).extracts.some((e: any) => e.region === "france"),
    ) as any;
    expect(step.strategy).toBe("smart");
  });
});
