import { describe, expect, it } from "vitest";
import { inferContextWindow } from "./known-context-windows";

describe("known chat models (xai)", () => {
  it.each([
    "grok-4",
    "grok-4.3",
    "grok-4.7",
    "grok-build-0.1",
    "grok-4-fast-reasoning",
    "grok-4-1-fast",
    "grok-code-fast-1",
    "grok-3",
    "grok-3-mini",
    "grok-2",
    "grok-2-vision",
  ])("reports a positive window for %s", (name) => {
    expect(inferContextWindow(name)).toBeGreaterThan(0);
  });

  it("leaves unknown ids unset", () => {
    expect(inferContextWindow("some-unlisted-model")).toBeUndefined();
  });

  it("picks the longest prefix", () => {
    expect(inferContextWindow("grok-4-fast")).toBe(2_000_000);
    expect(inferContextWindow("grok-2-vision-latest")).toBe(32_768);
  });
});
