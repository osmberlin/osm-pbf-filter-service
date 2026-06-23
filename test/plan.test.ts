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
