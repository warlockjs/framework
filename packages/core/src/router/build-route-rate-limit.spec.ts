import { describe, expect, it } from "vitest";
import { buildRouteRateLimit } from "./build-route-rate-limit";

describe("buildRouteRateLimit", () => {
  it("maps errorMessage to errorResponseBuilder", () => {
    const result = buildRouteRateLimit({ max: 1, timeWindow: 1000, errorMessage: "Slow down" }) as any;

    expect(result.errorMessage).toBeUndefined();
    expect(result.errorResponseBuilder().message).toBe("Slow down");
    expect(result.errorResponseBuilder().statusCode).toBe(429);
  });

  it("passes options through without errorMessage", () => {
    expect(buildRouteRateLimit({ max: 1, timeWindow: 1000 })).toEqual({ max: 1, timeWindow: 1000 });
  });
});
