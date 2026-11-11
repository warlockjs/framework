import config from "@mongez/config";
import type { FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { Request } from "../../../src/http/request";
import {
  buildIdempotencyCacheKey,
  hashBody,
  isValidIdempotencyKey,
} from "../../../src/http/middleware/utils/idempotency-key";

/**
 * Pure helpers behind the idempotency middleware. Source:
 * core/src/http/middleware/utils/idempotency-key.ts. `buildIdempotencyCacheKey`
 * reads `request.decodedAccessToken` / `request.locals.user` (written by
 * `@warlock.js/auth`'s middleware) / `request.detectIp()`, all of which we
 * seed directly so no Fastify server is needed.
 */
describe("isValidIdempotencyKey", () => {
  it("accepts a printable ASCII string within length bounds", () => {
    expect(isValidIdempotencyKey("01J9XZQ-ABC")).toBe(true);
    expect(isValidIdempotencyKey("a")).toBe(true);
    expect(isValidIdempotencyKey("x".repeat(255))).toBe(true);
  });

  it("rejects a non-string", () => {
    expect(isValidIdempotencyKey(123)).toBe(false);
    expect(isValidIdempotencyKey(null)).toBe(false);
    expect(isValidIdempotencyKey(undefined)).toBe(false);
    expect(isValidIdempotencyKey({})).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidIdempotencyKey("")).toBe(false);
  });

  it("rejects a string longer than 255 chars", () => {
    expect(isValidIdempotencyKey("x".repeat(256))).toBe(false);
  });

  it("rejects control characters and whitespace (log-injection guard)", () => {
    expect(isValidIdempotencyKey("has space")).toBe(false);
    expect(isValidIdempotencyKey("has\nnewline")).toBe(false);
    expect(isValidIdempotencyKey("has\ttab")).toBe(false);
  });
});

describe("hashBody", () => {
  it("returns a stable sha-256 hex digest for the same object", () => {
    const a = hashBody({ amount: 100, currency: "USD" });
    const b = hashBody({ amount: 100, currency: "USD" });

    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it("produces a different digest for a different body", () => {
    expect(hashBody({ amount: 100 })).not.toBe(hashBody({ amount: 200 }));
  });

  it("hashes a raw string body directly", () => {
    expect(hashBody("raw")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("treats null / undefined as an empty object", () => {
    const empty = hashBody({});

    expect(hashBody(null)).toBe(empty);
    expect(hashBody(undefined)).toBe(empty);
  });
});

describe("buildIdempotencyCacheKey", () => {
  function makeRequest(seed: {
    headers?: Record<string, string>;
    ip?: string;
    user?: { id: unknown };
    decodedAccessToken?: { userType?: string };
  }): Request {
    const request = new Request();

    request.setRequest({
      headers: seed.headers ?? {},
      ip: seed.ip ?? "127.0.0.1",
    } as unknown as FastifyRequest);

    if (seed.user !== undefined) {
      // Core does not declare a `user` key on `RequestLocals` — that
      // augmentation belongs to `@warlock.js/auth` — so this test seeds it
      // through an untyped bag, exactly as `buildIdempotencyCacheKey` itself
      // reads it back.
      (request.locals as Record<string, unknown>).user = seed.user;
    }

    if (seed.decodedAccessToken !== undefined) {
      request.decodedAccessToken = seed.decodedAccessToken;
    }

    return request;
  }

  it("scopes the key to userType:userId when authenticated", () => {
    const request = makeRequest({
      user: { id: 123 },
      decodedAccessToken: { userType: "client" },
    });

    expect(buildIdempotencyCacheKey(request, "01J9XZQ-ABC")).toBe("idem:client:123:::01J9XZQ-ABC");
  });

  it("falls back to anonymous + client IP when unauthenticated", () => {
    const request = makeRequest({ ip: "203.0.113.9" });

    expect(buildIdempotencyCacheKey(request, "KEY")).toBe("idem:anonymous:203.0.113.9:::KEY");
  });

  it("ignores X-Forwarded-For for the anonymous scope unless http.trustProxy is set", () => {
    const request = makeRequest({
      headers: { "x-forwarded-for": "198.51.100.7" },
      ip: "10.0.0.1",
    });

    expect(buildIdempotencyCacheKey(request, "KEY")).toBe("idem:anonymous:10.0.0.1:::KEY");
  });

  describe("with http.trustProxy enabled", () => {
    afterEach(() => {
      // A stored `null` is not the same as an absent key, so remove it
      // outright rather than setting it to `undefined`.
      config.unset("http.trustProxy");
      config.unset("http.realIpHeader");
    });

    /**
     * `X-Forwarded-For` resolution belongs to Fastify (`request.ip`) and is
     * covered end to end in `detect-ip.test.ts` against a live server, since a
     * seeded `baseRequest` cannot reproduce the chain walk. The header named by
     * `http.realIpHeader` is the one `detectIp()` reads itself, so it is what
     * this seeded request can assert the scoping against.
     */
    it("prefers the http.realIpHeader value over the peer IP for the anonymous scope", () => {
      config.set("http.trustProxy", true);
      config.set("http.realIpHeader", "x-real-ip");

      const request = makeRequest({
        headers: { "x-real-ip": "198.51.100.7" },
        ip: "10.0.0.1",
      });

      expect(buildIdempotencyCacheKey(request, "KEY")).toBe("idem:anonymous:198.51.100.7:::KEY");
    });
  });
});

describe("buildIdempotencyCacheKey — request target", () => {
  function requestFor(params: Record<string, string>, query: Record<string, string> = {}) {
    const request = new Request();

    request.setRequest({
      headers: {},
      ip: "203.0.113.9",
      params,
      query,
    } as unknown as FastifyRequest);

    return request;
  }

  it("gives two resources behind one route pattern their own records", () => {
    const first = buildIdempotencyCacheKey(requestFor({ id: "1" }), "KEY");
    const second = buildIdempotencyCacheKey(requestFor({ id: "2" }), "KEY");

    expect(first).not.toBe(second);
  });

  it("keeps the same record for a retry of the same target", () => {
    const first = buildIdempotencyCacheKey(requestFor({ id: "1" }, { a: "x", b: "y" }), "KEY");
    const retry = buildIdempotencyCacheKey(requestFor({ id: "1" }, { b: "y", a: "x" }), "KEY");

    expect(first).toBe(retry);
  });

  it("separates the same route by query", () => {
    expect(buildIdempotencyCacheKey(requestFor({}, { account: "1" }), "KEY")).not.toBe(
      buildIdempotencyCacheKey(requestFor({}, { account: "2" }), "KEY"),
    );
  });
});
