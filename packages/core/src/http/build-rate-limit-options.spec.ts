import fastifyRateLimit from "@fastify/rate-limit";
import config from "@mongez/config";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildRateLimitOptions } from "./build-rate-limit-options";
import { CacheRateLimitStore } from "./rate-limit-cache-store";

describe("buildRateLimitOptions", () => {
  it("applies defaults", () => {
    expect(buildRateLimitOptions(undefined)).toEqual({
      max: 60,
      timeWindow: 60000,
      keyGenerator: expect.any(Function),
    });
    expect(buildRateLimitOptions({})).toEqual({
      max: 60,
      timeWindow: 60000,
      keyGenerator: expect.any(Function),
    });
  });

  it("aliases duration to timeWindow", () => {
    expect(buildRateLimitOptions({ max: 5, duration: 1000 })).toEqual({
      max: 5,
      timeWindow: 1000,
      keyGenerator: expect.any(Function),
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

  it("passes ipv6Subnet through to the plugin", () => {
    const options = buildRateLimitOptions({ ipv6Subnet: 56 } as any);

    expect(options?.ipv6Subnet).toBe(56);
  });

  it("returns null when disabled", () => {
    expect(buildRateLimitOptions({ enabled: false })).toBeNull();
  });

  it("does not pass unknown keys", () => {
    const options = buildRateLimitOptions({ max: 1, bogus: true, ban: 3 } as any);

    expect(options).toEqual({ max: 1, timeWindow: 60000, keyGenerator: expect.any(Function) });
  });

  it("fails open by default with the cache store, unless skipOnError is set", () => {
    expect(buildRateLimitOptions({ store: "cache" })?.skipOnError).toBe(true);
    expect(buildRateLimitOptions({ store: "cache", skipOnError: false })?.skipOnError).toBe(false);
    expect(buildRateLimitOptions({})?.skipOnError).toBeUndefined();
  });

  it('selects the cache-backed store for store: "cache"', () => {
    expect(buildRateLimitOptions({ store: "cache" })?.store).toBe(CacheRateLimitStore);
  });

  it('passes a custom store class through and adds none for "memory"', () => {
    class CustomStore {
      public incr() {}
      public child() {
        return this;
      }
    }

    expect(buildRateLimitOptions({ store: CustomStore as never })?.store).toBe(CustomStore);
    expect(buildRateLimitOptions({ store: "memory" })).toEqual({
      max: 60,
      timeWindow: 60000,
      keyGenerator: expect.any(Function),
    });
  });

  it("keeps the framework-only staticFiles switch out of the plugin options", () => {
    expect(buildRateLimitOptions({ staticFiles: true })).toEqual({
      max: 60,
      timeWindow: 60000,
      keyGenerator: expect.any(Function),
    });
  });
});

describe("global rate limiter client key", () => {
  afterEach(() => {
    config.set("http", undefined);
  });

  async function serve(trustProxy: boolean) {
    const server = Fastify({ trustProxy });

    await server.register(fastifyRateLimit, buildRateLimitOptions({ max: 2 })!);
    server.get("/", async () => "ok");
    await server.ready();

    return server;
  }

  it("counts one client behind a trusted proxy whatever X-Forwarded-For the client forges", async () => {
    config.set("http", { trustProxy: true, realIpHeader: "cf-connecting-ip" });
    const server = await serve(true);

    try {
      const statuses: number[] = [];

      for (const forged of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
        const response = await server.inject({
          url: "/",
          headers: { "x-forwarded-for": forged, "cf-connecting-ip": "203.0.113.7" },
        });

        statuses.push(response.statusCode);
      }

      const other = await server.inject({
        url: "/",
        headers: { "x-forwarded-for": "1.1.1.1", "cf-connecting-ip": "203.0.113.8" },
      });

      expect(statuses).toEqual([200, 200, 429]);
      expect(other.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("keys on the socket address without any proxy configuration", async () => {
    const server = await serve(false);

    try {
      const statuses: number[] = [];

      for (const forged of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
        const response = await server.inject({
          url: "/",
          remoteAddress: "198.51.100.4",
          headers: { "x-forwarded-for": forged, "cf-connecting-ip": forged },
        });

        statuses.push(response.statusCode);
      }

      const otherSocket = await server.inject({ url: "/", remoteAddress: "198.51.100.5" });

      expect(statuses).toEqual([200, 200, 429]);
      expect(otherSocket.statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("keeps an app's own keyGenerator", async () => {
    const keyGenerator = () => "everyone";

    expect(buildRateLimitOptions({ keyGenerator })?.keyGenerator).toBe(keyGenerator);
  });
});
