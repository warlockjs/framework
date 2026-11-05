import { describe, expect, it } from "vitest";
import { inferContextWindow } from "./known-context-windows";

describe("inferContextWindow (openai)", () => {
  it("picks the longest matching prefix", () => {
    expect(inferContextWindow("gpt-4.1-mini")).toBe(1_047_576);
    expect(inferContextWindow("gpt-5-mini")).toBe(400_000);
    expect(inferContextWindow("gpt-5-chat-latest")).toBe(128_000);
    expect(inferContextWindow("gpt-4o-mini")).toBe(128_000);
  });

  it("leaves unknown ids unset", () => {
    expect(inferContextWindow("llama-3")).toBeUndefined();
  });
});
