import { describe, expect, it } from "vitest";
import { allowedFeatures, featuresMap } from "../../../src/generations/add-command.action";

/**
 * Unit coverage for the `warlock add` feature registry — a pure data map, so
 * these assertions stay fs-free. They guard the AI scaffolding wiring: the `ai`
 * feature ejects config/ai.ts, the provider keys carry the `ai-` prefix (the
 * un-prefixed aliases are gone), and the three satellites exist and require the
 * core `ai` feature. create-warlock can reuse `allowedFeatures` as a CI guard.
 */
describe("add command feature registry", () => {
  it("ejects config/ai.ts for the ai feature", () => {
    expect(featuresMap.ai.ejectConfig?.name).toBe("ai");
    expect(featuresMap.ai.ejectConfig?.content).toContain("@warlock.js/ai");
  });

  it("namespaces the provider features under the ai- prefix", () => {
    const providers = ["ai-openai", "ai-google", "ai-anthropic", "ai-bedrock", "ai-ollama"];

    for (const provider of providers) {
      expect(allowedFeatures).toContain(provider);
      expect(featuresMap[provider].requires).toEqual(["ai"]);
    }
  });

  it("drops the un-prefixed provider keys", () => {
    const legacy = ["openai", "google", "anthropic", "bedrock", "ollama"];

    for (const key of legacy) {
      expect(allowedFeatures).not.toContain(key);
    }
  });

  it("registers the satellite features requiring the core ai feature", () => {
    const satellites = ["ai-tools", "ai-panoptic", "ai-workspace"];

    for (const satellite of satellites) {
      expect(allowedFeatures).toContain(satellite);
      expect(featuresMap[satellite].requires).toEqual(["ai"]);
    }
  });
});
