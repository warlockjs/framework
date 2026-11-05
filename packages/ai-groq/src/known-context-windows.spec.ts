import { describe, expect, it } from "vitest";
import { inferContextWindow } from "./known-context-windows";

describe("known chat models (groq)", () => {
  it.each(["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b", "openai/gpt-oss-20b", "deepseek-r1-distill-llama-70b", "meta-llama/llama-4-scout-17b-16e-instruct", "qwen/qwen3-32b", "moonshotai/kimi-k2-instruct"])("reports a positive window for %s", (name) => {
    expect(inferContextWindow(name)).toBeGreaterThan(0);
  });

  it("leaves unknown ids unset", () => {
    expect(inferContextWindow("some-unlisted-model")).toBeUndefined();
  });
});
