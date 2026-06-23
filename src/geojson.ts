// Pure GeoJSON helpers: polygon-type validation + bounding boxes.
// No IO and no Bun imports, so this is unit-testable under vitest.

export type Check = { ok: boolean; detail: string };
export type BBox = [west: number, south: number, east: number, north: number];

/**
 * Accept only a GeoJSON Polygon/MultiPolygon, unwrapping Feature /
 * FeatureCollection. Anything else (point, line, empty, malformed) is rejected.
 */
export function polygonGeometryType(gj: unknown): Check {
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

/** Bounding box of any GeoJSON object, or null if it has no coordinates. */
export function bboxOf(gj: unknown): BBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = false;

  const visit = (c: any): void => {
    if (Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") {
      const [x, y] = c;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      found = true;
    } else if (Array.isArray(c)) {
      for (const e of c) visit(e);
    }
  };

  const geom = (g: any): void => { if (g?.coordinates) visit(g.coordinates); };

  const o = gj as any;
  if (o?.type === "FeatureCollection") for (const f of o.features ?? []) geom(f?.geometry);
  else if (o?.type === "Feature") geom(o.geometry);
  else geom(o);

  return found ? [minX, minY, maxX, maxY] : null;
}

/** True if two bounding boxes overlap (touching edges count as overlap). */
export function bboxOverlap(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}
