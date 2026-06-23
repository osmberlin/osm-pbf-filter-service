// Shared data types. Kept dependency-free so the pure logic modules (and their
// vitest tests) never need to import Bun-specific or IO modules.

export type Region = {
  id: string;
  name?: string;
  parent: string; // parent region id, or "world" for a top-level (continent)
  polygon?: string; // repo-relative path to a GeoJSON Polygon/MultiPolygon
};

export type Project = {
  id: string; // = folder name
  dir: string; // projects/<id>
  description?: string;
  repository?: string;
  homepage?: string;
  contact?: string;
  area: { region?: string; polygon?: string };
  filters: string[]; // osmium tags-filter expressions; [] = keep everything
  osmium: { extract_strategy: string; add_referenced: boolean };
};
