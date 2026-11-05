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
