import { describe, it, expect } from "bun:test";
import { isValidId } from "../src/types";

describe("isValidId (region ids + project folder names become paths and URLs)", () => {
  it("accepts plain kebab/snake ids", () => {
    expect(isValidId("germany")).toBe(true);
    expect(isValidId("osm-boundary-checker-germany")).toBe(true);
    expect(isValidId("region_2")).toBe(true);
    expect(isValidId("7zones")).toBe(true);
  });

  it("rejects path traversal and separators", () => {
    expect(isValidId("../planet")).toBe(false);
    expect(isValidId("a/b")).toBe(false);
    expect(isValidId("a\\b")).toBe(false);
    expect(isValidId(".")).toBe(false);
    expect(isValidId("..")).toBe(false);
  });

  it("rejects URL-hostile and shell-hostile characters", () => {
    expect(isValidId("my project (v2)")).toBe(false);
    expect(isValidId("UPPER")).toBe(false);
    expect(isValidId("umlaut-ä")).toBe(false);
    expect(isValidId("")).toBe(false);
    expect(isValidId("-leading-dash")).toBe(false);
  });
});
