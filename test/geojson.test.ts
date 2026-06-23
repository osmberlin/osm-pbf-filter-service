import { describe, it, expect } from "vitest";
import { polygonGeometryType, bboxOf, bboxOverlap } from "../src/geojson";

const poly = (coords: number[][][]) => ({ type: "Polygon", coordinates: coords });
const square = poly([[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]]);

describe("polygonGeometryType", () => {
  it("accepts Polygon and MultiPolygon", () => {
    expect(polygonGeometryType(square).ok).toBe(true);
    expect(polygonGeometryType({ type: "MultiPolygon", coordinates: [] }).ok).toBe(true);
  });

  it("unwraps Feature and FeatureCollection", () => {
    expect(polygonGeometryType({ type: "Feature", geometry: square }).ok).toBe(true);
    expect(
      polygonGeometryType({ type: "FeatureCollection", features: [{ type: "Feature", geometry: square }] }).ok,
    ).toBe(true);
  });

  it("rejects non-polygonal, empty, and malformed input", () => {
    expect(polygonGeometryType({ type: "Point", coordinates: [0, 0] }).ok).toBe(false);
    expect(polygonGeometryType({ type: "LineString", coordinates: [[0, 0], [1, 1]] }).ok).toBe(false);
    expect(polygonGeometryType({ type: "FeatureCollection", features: [] }).ok).toBe(false);
    expect(polygonGeometryType("not json").ok).toBe(false);
    expect(polygonGeometryType(null).ok).toBe(false);
    expect(
      polygonGeometryType({ type: "FeatureCollection", features: [{ geometry: { type: "Point" } }] }).ok,
    ).toBe(false);
  });
});

describe("bboxOf / bboxOverlap", () => {
  it("computes a bounding box for a polygon", () => {
    expect(bboxOf(square)).toEqual([0, 0, 2, 2]);
    expect(bboxOf({ type: "Feature", geometry: square })).toEqual([0, 0, 2, 2]);
  });

  it("returns null when there are no coordinates", () => {
    expect(bboxOf({ type: "FeatureCollection", features: [] })).toBeNull();
  });

  it("detects overlap, disjoint, and touching boxes", () => {
    expect(bboxOverlap([0, 0, 2, 2], [1, 1, 3, 3])).toBe(true); // overlap
    expect(bboxOverlap([0, 0, 1, 1], [2, 2, 3, 3])).toBe(false); // disjoint
    expect(bboxOverlap([0, 0, 1, 1], [1, 1, 2, 2])).toBe(true); // touching
  });
});
