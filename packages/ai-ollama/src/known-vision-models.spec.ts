import { describe, expect, it } from "vitest";
import { inferVisionCapability } from "./known-vision-models";

describe("inferVisionCapability", () => {
  it("returns true for multimodal Ollama families", () => {
    expect(inferVisionCapability("llama3.2-vision:11b")).toBe(true);
    expect(inferVisionCapability("llava:13b")).toBe(true);
    expect(inferVisionCapability("llava-llama3")).toBe(true);
    expect(inferVisionCapability("moondream")).toBe(true);
    expect(inferVisionCapability("qwen2.5-vl:7b")).toBe(true);
    expect(inferVisionCapability("gemma3:12b")).toBe(true);
  });

  it("covers every known multimodal family substring", () => {
    expect(inferVisionCapability("bakllava:7b")).toBe(true);
    expect(inferVisionCapability("minicpm-v:8b")).toBe(true);
    expect(inferVisionCapability("qwen2-vl:2b")).toBe(true);
    expect(inferVisionCapability("llama4-scout")).toBe(true);
    expect(inferVisionCapability("llama3.2-vision")).toBe(true);
  });

  it("is case-insensitive and tolerates size/quant suffixes", () => {
    expect(inferVisionCapability("LLAVA:34B-V1.6-Q4_0")).toBe(true);
    expect(inferVisionCapability("Llama3.2-Vision:11B")).toBe(true);
    expect(inferVisionCapability("GEMMA3:12B")).toBe(true);
  });

  it("returns false for text-only and unknown tags", () => {
    expect(inferVisionCapability("llama3.1")).toBe(false);
    expect(inferVisionCapability("mistral:7b")).toBe(false);
    expect(inferVisionCapability("phi3")).toBe(false);
    expect(inferVisionCapability("nomic-embed-text")).toBe(false);
    expect(inferVisionCapability("")).toBe(false);
  });

  it("does not over-match adjacent non-vision families", () => {
    // gemma3 is multimodal but gemma2 is not; llama4 is, llama3.1 is not.
    expect(inferVisionCapability("gemma2:9b")).toBe(false);
    expect(inferVisionCapability("qwen2.5:14b")).toBe(false);
    expect(inferVisionCapability("llama3:8b")).toBe(false);
  });
});
