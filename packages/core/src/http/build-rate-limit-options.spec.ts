import { describe, expect, it } from "vitest";
import { buildRateLimitOptions } from "./build-rate-limit-options";

describe("buildRateLimitOptions", () => {
  it("applies defaults", () => {
    expect(buildRateLimitOptions(undefined)).toEqual({ max: 60, timeWindow: 60000 });
    expect(buildRateLimitOptions({})).toEqual({ max: 60, timeWindow: 60000 });
  });

  it("aliases duration to timeWindow", () => {
    expect(buildRateLimitOptions({ max: 5, duration: 1000 })).toEqual({
      max: 5,
      timeWindow: 1000,
    });
  });

  it("prefers timeWindow when given directly", () => {
    expect(buildRateLimitOptions({ duration: 1000, timeWindow: "2 minutes" })).toMatchObject({
      timeWindow: "2 minutes",
    });
  });

  it("passes redis and other plugin options through", () => {
    const redis = { fake: true };
    const keyGenerator = () => "k";
    const options = buildRateLimitOptions({ redis, nameSpace: "rl:", keyGenerator, global: false });

    expect(options?.redis).toBe(redis);
    expect(options?.nameSpace).toBe("rl:");
    expect(options?.keyGenerator).toBe(keyGenerator);
    expect(options?.global).toBe(false);
  });

  it("returns null when disabled", () => {
    expect(buildRateLimitOptions({ enabled: false })).toBeNull();
  });

  it("does not pass unknown keys", () => {
    const options = buildRateLimitOptions({ max: 1, bogus: true, ban: 3 } as any);

    expect(options).toEqual({ max: 1, timeWindow: 60000 });
  });
});
