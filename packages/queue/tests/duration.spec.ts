import { describe, expect, it } from "vitest";
import { InvalidDurationError, toMilliseconds } from "../src";

describe("toMilliseconds", () => {
  it("passes milliseconds through and parses unit strings", () => {
    expect(toMilliseconds(250)).toBe(250);
    expect(toMilliseconds("500ms")).toBe(500);
    expect(toMilliseconds("30s")).toBe(30_000);
    expect(toMilliseconds("10m")).toBe(600_000);
    expect(toMilliseconds("2h")).toBe(7_200_000);
    expect(toMilliseconds("1d")).toBe(86_400_000);
    expect(toMilliseconds("1.5s")).toBe(1_500);
  });

  it("rejects malformed and negative values", () => {
    expect(() => toMilliseconds("10 minutes")).toThrow(InvalidDurationError);
    expect(() => toMilliseconds(-1)).toThrow(InvalidDurationError);
    expect(() => toMilliseconds(Number.NaN)).toThrow(InvalidDurationError);
  });
});
