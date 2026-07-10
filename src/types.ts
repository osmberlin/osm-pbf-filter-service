// Shared data types + tiny pure validators. Kept dependency-free so the pure
// logic modules (and their tests) never need to import Bun-specific or IO modules.

export type Region = {
  id: string;
  name?: string;
  parent: string; // parent region id, or "world" for a top-level (continent)
  polygon?: string; // repo-relative path to a GeoJSON Polygon/MultiPolygon
};

export type Project = {
  id: string; // = folder name
  description?: string;
  repository?: string;
  homepage?: string;
  contact?: string;
  area: { region?: string; polygon?: string };
  filters: string[]; // osmium tags-filter expressions; [] = keep everything
  osmium: { extract_strategy: string; add_referenced: boolean };
};

// Region ids and project folder names become filesystem paths (work/<id>.pbf,
// extracts/<id>/) and public URLs. Restricting them up front is the systemic
// guard against path traversal ('../x'), nested paths ('a/b'), and broken URLs —
// important because third parties contribute configs via PRs on a public repo.
const ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

export const ID_RULE = "lowercase letters, digits, '-' or '_', starting with a letter or digit";
