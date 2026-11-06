import { describe, expect, it } from "vitest";
import { inferContextWindow } from "./known-context-windows";

describe("known chat models (deepseek)", () => {
  it.each([
    "deepseek-chat",
    "deepseek-reasoner",
    "deepseek-flash",
    "deepseek-v4-flash",
    "deepseek-v4-pro",
  ])("reports a positive window for %s", (name) => {
    expect(inferContextWindow(name)).toBeGreaterThan(0);
  });

  it("reports 1M for deepseek-flash and the v4 ids", () => {
    expect(inferContextWindow("deepseek-flash")).toBe(1_000_000);
    expect(inferContextWindow("deepseek-v4-pro")).toBe(1_000_000);
    expect(inferContextWindow("deepseek-v4-flash")).toBe(1_000_000);
  });

  it("leaves unknown ids unset", () => {
    expect(inferContextWindow("some-unlisted-model")).toBeUndefined();
  });
});
