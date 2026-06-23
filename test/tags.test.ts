import { describe, it, expect } from "vitest";
import { parseFilter, formatFilter, mergeFilters } from "../src/tags";

describe("parseFilter", () => {
  it("parses object types, key, and values", () => {
    expect(parseFilter("n/natural=tree")).toEqual({ types: "n", key: "natural", values: ["tree"] });
    expect(parseFilter("nwr/leisure=playground")).toEqual({ types: "nwr", key: "leisure", values: ["playground"] });
    expect(parseFilter("w/playground")).toEqual({ types: "w", key: "playground", values: null });
  });

  it("defaults to all object types when the prefix is omitted", () => {
    expect(parseFilter("amenity=cafe").types).toBe("nwr");
    expect(parseFilter("emergency")).toEqual({ types: "nwr", key: "emergency", values: null });
  });

  it("splits value lists", () => {
    expect(parseFilter("nw/amenity=cafe,bench").values).toEqual(["cafe", "bench"]);
  });

  it("canonicalises type order", () => {
    expect(parseFilter("rwn/amenity=cafe").types).toBe("nwr");
  });
});

describe("formatFilter", () => {
  it("sorts values and keeps key-only filters", () => {
    expect(formatFilter({ types: "nw", key: "amenity", values: ["cafe", "bench"] })).toBe("nw/amenity=bench,cafe");
    expect(formatFilter({ types: "nwr", key: "emergency", values: null })).toBe("nwr/emergency");
  });
});

describe("mergeFilters (union for intermediate nodes)", () => {
  it("unions object types per key", () => {
    expect(mergeFilters(["n/leisure=playground", "w/leisure=playground", "r/leisure=playground"])).toEqual([
      "nwr/leisure=playground",
    ]);
    expect(mergeFilters(["n/playground", "w/playground"])).toEqual(["nw/playground"]);
  });

  it("lets a key-only filter win over specific values (broadest wins)", () => {
    expect(mergeFilters(["n/emergency", "n/emergency=ambulance_station"])).toEqual(["n/emergency"]);
  });

  it("unions values for the same key", () => {
    expect(mergeFilters(["n/amenity=cafe", "w/amenity=bench"])).toEqual(["nw/amenity=bench,cafe"]);
  });

  it("handles the germany boundary scenario", () => {
    expect(
      mergeFilters(["nwr/boundary=administrative", "nwr/admin_level", "r/boundary=administrative"]),
    ).toEqual(["nwr/admin_level", "nwr/boundary=administrative"]);
  });
});
