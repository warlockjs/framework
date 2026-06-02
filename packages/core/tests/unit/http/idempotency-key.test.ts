import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { Request } from "../../../src/http/request";
import {
  buildIdempotencyCacheKey,
  hashBody,
  isValidIdempotencyKey,
} from "../../../src/http/middleware/utils/idempotency-key";

/**
 * Pure helpers behind the idempotency middleware. Source:
 * core/src/http/middleware/utils/idempotency-key.ts. `buildIdempotencyCacheKey`
 * reads `request.decodedAccessToken` / `request.user` / `request.detectIp()`,
 * all of which we seed directly so no Fastify server is needed.
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
      request.user = seed.user as never;
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

    expect(buildIdempotencyCacheKey(request, "01J9XZQ-ABC")).toBe(
      "idem:client:123:01J9XZQ-ABC",
    );
  });

  it("falls back to anonymous + client IP when unauthenticated", () => {
    const request = makeRequest({ ip: "203.0.113.9" });

    expect(buildIdempotencyCacheKey(request, "KEY")).toBe("idem:anonymous:203.0.113.9:KEY");
  });

  it("prefers X-Forwarded-For over the peer IP for the anonymous scope", () => {
    const request = makeRequest({
      headers: { "x-forwarded-for": "198.51.100.7" },
      ip: "10.0.0.1",
    });

    expect(buildIdempotencyCacheKey(request, "KEY")).toBe("idem:anonymous:198.51.100.7:KEY");
  });
});
