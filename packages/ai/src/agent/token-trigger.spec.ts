import { describe, expect, it } from "vitest";
import { AgentExecutionError } from "../errors";
import {
  assertTokenTrigger,
  isTokenTriggerReached,
  isValidTokenTrigger,
  normalizeTokenTrigger,
  resolveTokenTrigger,
} from "./token-trigger";

describe("token trigger", () => {
  it("resolves min(floor(window * share), window - reserve, max), at least 1", () => {
    expect(resolveTokenTrigger({ share: 0.85 }, 200_000)).toBe(170_000);
    expect(resolveTokenTrigger({ share: 0.85 }, 1_000_000)).toBe(850_000);
    expect(resolveTokenTrigger({ share: 0.9, reserve: 16_000 }, 128_000)).toBe(112_000);
    expect(resolveTokenTrigger({ share: 0.8, max: 100_000 }, 1_000_000)).toBe(100_000);
    expect(resolveTokenTrigger({ share: 0.5, reserve: 500_000 }, 1_000)).toBe(1);
    expect(resolveTokenTrigger(5_000, undefined)).toBe(5_000);
  });

  it("does not resolve a window-relative trigger without a window", () => {
    expect(resolveTokenTrigger({ share: 0.5 }, undefined)).toBeUndefined();
    expect(resolveTokenTrigger({ share: 0.5 }, 0)).toBeUndefined();
    expect(isTokenTriggerReached({ share: 0.5 }, 10_000_000, undefined)).toBeUndefined();
  });

  it("fires when the reply would not fit in the window", () => {
    const trigger = { share: 0.95, reserve: 1_000 };

    expect(isTokenTriggerReached(trigger, 80_000, 100_000, 0)).toBe(false);
    expect(isTokenTriggerReached(trigger, 80_000, 100_000, 30_000)).toBe(true);
    expect(isTokenTriggerReached(trigger, 98_999, 100_000)).toBe(true);
    expect(isTokenTriggerReached(1_000, 999, 100_000, 99_999)).toBe(false);
    expect(isTokenTriggerReached(1_000, 1_000, undefined)).toBe(true);
  });

  it("validates shapes", () => {
    for (const bad of [
      0,
      -1,
      1.5,
      { share: 0 },
      { share: 1.1 },
      { share: 0.5, reserve: -1 },
      { share: 0.5, max: 0 },
      {},
      null,
      "5",
    ]) {
      expect(isValidTokenTrigger(bad)).toBe(false);
      expect(() => assertTokenTrigger(bad, "x")).toThrow(AgentExecutionError);
    }
    expect(isValidTokenTrigger({ share: 1, reserve: 0, max: 10 })).toBe(true);
  });

  it("normalizes key order", () => {
    expect(JSON.stringify(normalizeTokenTrigger({ max: 5, share: 0.5 }))).toBe(
      JSON.stringify({ share: 0.5, max: 5 }),
    );
  });
});
