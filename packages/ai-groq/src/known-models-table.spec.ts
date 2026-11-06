import { describe, expect, it } from "vitest";
import { inferContextWindow } from "./known-context-windows";
import {
  GROQ_MODEL_LIFECYCLE,
  GROQ_MODEL_LIFECYCLE_AS_OF,
  groqLifecycleFor,
} from "./known-lifecycle";
import { GROQ_KNOWN_MODELS } from "./known-models";
import { GROQ_DEFAULT_PRICING, GROQ_DEFAULT_PRICING_AS_OF } from "./sdk";

describe("Groq model tables", () => {
  it("dates the pricing table", () => {
    expect(GROQ_DEFAULT_PRICING_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(GROQ_MODEL_LIFECYCLE_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it.each([...GROQ_KNOWN_MODELS, ...Object.keys(GROQ_DEFAULT_PRICING)])(
    "gives listed model %s a current status",
    (id) => {
      expect(groqLifecycleFor(id)?.status).toBe("current");
    },
  );

  it("lists qwen/qwen3.8-27b and none of the shut-down ids", () => {
    expect(GROQ_KNOWN_MODELS).toContain("qwen/qwen3.8-27b");

    for (const id of GROQ_KNOWN_MODELS) {
      expect(groqLifecycleFor(id)?.status).not.toBe("retired");
    }
  });

  it("records the shut-down ids as retired with their dates", () => {
    expect(groqLifecycleFor("llama-3.3-70b-versatile")).toEqual({
      status: "retired",
      retiresOn: "2026-08-16",
      replacement: "openai/gpt-oss-120b",
    });
    expect(groqLifecycleFor("llama-3.1-8b-instant")?.retiresOn).toBe("2026-08-16");
    expect(groqLifecycleFor("deepseek-r1-distill-llama-70b")?.retiresOn).toBe("2025-10-02");
    expect(groqLifecycleFor("nope")).toBeUndefined();
  });

  it("keeps lifecycle dates consistent with their status", () => {
    for (const lifecycle of Object.values(GROQ_MODEL_LIFECYCLE)) {
      if (lifecycle.status === "retired") {
        expect(lifecycle.retiresOn! <= GROQ_MODEL_LIFECYCLE_AS_OF).toBe(true);
      }

      expect(lifecycle.status).not.toBe("retiring");
    }
  });

  it("reports 131,072 for qwen/qwen3.8-27b", () => {
    expect(inferContextWindow("qwen/qwen3.8-27b")).toBe(131_072);
  });
});
