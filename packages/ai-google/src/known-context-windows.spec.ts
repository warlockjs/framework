import { describe, expect, it } from "vitest";
import { inferContextWindow } from "./known-context-windows";

describe("inferContextWindow (google)", () => {
  it("knows the 1M Gemini families", () => {
    expect(inferContextWindow("gemini-2.5-flash")).toBe(1_048_576);
    expect(inferContextWindow("models/gemini-2.0-flash-001")).toBe(1_048_576);
  });

  it("leaves unknown ids unset", () => {
    expect(inferContextWindow("gemini-9-ultra")).toBeUndefined();
  });
});

describe("known chat models (google)", () => {
  it.each([
    "gemini-4-argon",
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3-pro",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
  ])("reports a positive window for %s", (name) => {
    expect(inferContextWindow(name)).toBeGreaterThan(0);
  });

  it("reports 2M for Gemini 1.5 Pro", () => {
    expect(inferContextWindow("gemini-1.5-pro-002")).toBe(2_097_152);
  });
});
