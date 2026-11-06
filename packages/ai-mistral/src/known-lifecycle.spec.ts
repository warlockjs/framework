import { describe, expect, it } from "vitest";
import { inferContextWindow } from "./known-context-windows";
import {
  MISTRAL_MODEL_LIFECYCLE,
  MISTRAL_MODEL_LIFECYCLE_AS_OF,
  mistralLifecycleFor,
} from "./known-lifecycle";

describe("Mistral model lifecycle", () => {
  it("keeps dates consistent with the status", () => {
    for (const lifecycle of Object.values(MISTRAL_MODEL_LIFECYCLE)) {
      if (lifecycle.status === "current") {
        expect(lifecycle.retiresOn).toBeUndefined();
      } else {
        expect(lifecycle.retiresOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(lifecycle.status === "retired").toBe(
          lifecycle.retiresOn! <= MISTRAL_MODEL_LIFECYCLE_AS_OF,
        );
      }
    }
  });

  it("knows the Z.ai ids", () => {
    expect(mistralLifecycleFor("zai-glm-5-2")?.replacement).toBe("zai-glm-5-3");
    expect(mistralLifecycleFor("zai-glm-5-3")?.status).toBe("current");
    expect(mistralLifecycleFor("mistral-medium-3-5")?.status).toBe("retiring");
    expect(mistralLifecycleFor("nope")).toBeUndefined();
  });

  it("reports a 1M window for zai-glm-5-3", () => {
    expect(inferContextWindow("zai-glm-5-3")).toBe(1_000_000);
  });
});
