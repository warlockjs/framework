import { describe, expect, it } from "vitest";
import { inferVisionCapability } from "./known-vision-models";

describe("inferVisionCapability", () => {
  it("returns true for multimodal Gemini families", () => {
    expect(inferVisionCapability("gemini-2.5-flash")).toBe(true);
    expect(inferVisionCapability("gemini-2.5-pro")).toBe(true);
    expect(inferVisionCapability("gemini-2.0-flash")).toBe(true);
    expect(inferVisionCapability("gemini-1.5-pro-002")).toBe(true);
    expect(inferVisionCapability("gemini-pro-vision")).toBe(true);
  });

  it("is case-insensitive and tolerates preview suffixes", () => {
    expect(inferVisionCapability("GEMINI-2.5-FLASH-PREVIEW-05-20")).toBe(true);
  });

  it("matches the gemini-exp and gemini-flash family substrings", () => {
    expect(inferVisionCapability("gemini-exp-1206")).toBe(true);
    expect(inferVisionCapability("gemini-flash-latest")).toBe(true);
  });

  it("matches when a known substring appears with a vendor prefix", () => {
    expect(inferVisionCapability("models/gemini-1.5-flash-001")).toBe(true);
  });

  it("does not treat the bare 'gemini-pro' / 'gemini-1.0-pro' as vision-capable", () => {
    expect(inferVisionCapability("gemini-pro")).toBe(false);
    expect(inferVisionCapability("gemini-1.0-pro")).toBe(false);
  });

  it("returns false for text-only and unknown ids", () => {
    expect(inferVisionCapability("gemini-1.0-pro")).toBe(false);
    expect(inferVisionCapability("text-embedding-004")).toBe(false);
    expect(inferVisionCapability("gemini-embedding-001")).toBe(false);
    expect(inferVisionCapability("")).toBe(false);
  });
});
