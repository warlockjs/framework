import { describe, expect, it } from "vitest";
import { parseSize } from "../../../src/http/middleware/utils/parse-size";

/**
 * Pure size-string parser used by the body-limit middleware. Numeric input is
 * returned untouched; string input is unit-scaled (b/kb/mb/gb, case-insensitive).
 * Source: core/src/http/middleware/utils/parse-size.ts.
 */
describe("parseSize — numeric passthrough", () => {
  it("returns a number argument as-is (already bytes)", () => {
    expect(parseSize(4096)).toBe(4096);
    expect(parseSize(0)).toBe(0);
  });
});

describe("parseSize — unit scaling", () => {
  it("scales kb / mb / gb to bytes", () => {
    expect(parseSize("500kb")).toBe(512_000);
    expect(parseSize("2mb")).toBe(2_097_152);
    expect(parseSize("1gb")).toBe(1_073_741_824);
  });

  it("treats a bare number string as bytes", () => {
    expect(parseSize("1024")).toBe(1024);
  });

  it("treats an explicit b suffix as bytes", () => {
    expect(parseSize("1024b")).toBe(1024);
  });

  it("is case-insensitive on the unit", () => {
    expect(parseSize("2MB")).toBe(2_097_152);
    expect(parseSize("1Gb")).toBe(1_073_741_824);
  });

  it("tolerates whitespace between the amount and the unit", () => {
    expect(parseSize("2 mb")).toBe(2_097_152);
  });

  it("floors a fractional result", () => {
    // 1.5kb = 1536 bytes (whole); 0.0009765625mb = 1024 bytes
    expect(parseSize("1.5kb")).toBe(1536);
    // A value that does not divide evenly is floored.
    expect(parseSize("1.5b")).toBe(1);
  });
});

describe("parseSize — invalid input", () => {
  it("throws on an unparseable string", () => {
    expect(() => parseSize("abc")).toThrow(/Invalid size value/);
    expect(() => parseSize("")).toThrow(/Invalid size value/);
  });

  it("throws on a recognised number with an unsupported unit", () => {
    expect(() => parseSize("5tb")).toThrow(/Invalid size value/);
  });
});
