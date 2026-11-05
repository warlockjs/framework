import { describe, expect, it } from "vitest";
import { inferContextWindow } from "./known-context-windows";

describe("inferContextWindow (openai)", () => {
  it("picks the longest matching prefix", () => {
    expect(inferContextWindow("gpt-4.1-mini")).toBe(1_047_576);
    expect(inferContextWindow("gpt-5-mini")).toBe(400_000);
    expect(inferContextWindow("gpt-5-chat-latest")).toBe(128_000);
    expect(inferContextWindow("gpt-4o-mini")).toBe(128_000);
    expect(inferContextWindow("o1")).toBe(200_000);
    expect(inferContextWindow("o1-mini")).toBe(128_000);
    expect(inferContextWindow("o1-preview-2024-09-12")).toBe(128_000);
  });

  it("leaves unknown ids unset", () => {
    expect(inferContextWindow("llama-3")).toBeUndefined();
  });
});

describe("known chat models (openai)", () => {
  it.each([
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-5.1",
    "gpt-5.2",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.5",
    "gpt-5.6",
    "gpt-6",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-4",
    "gpt-3.5-turbo",
    "o1",
    "o3",
    "o3-mini",
    "o4-mini",
  ])("reports a positive window for %s", (name) => {
    expect(inferContextWindow(name)).toBeGreaterThan(0);
  });
});
