import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { Request } from "../../../src/http/request";

/**
 * Unit coverage for `Request.detectIp()` — the real-client-IP resolver used by
 * ip-filter / rate-limit / idempotency scoping. The interesting case is a
 * multi-hop `X-Forwarded-For` ("client, proxy1, proxy2"): only the leftmost
 * entry (the original client) should be returned, comma-split and trimmed.
 * We seed `baseRequest` directly so no Fastify server is needed.
 */
function makeRequest(seed: {
  headers?: Record<string, string>;
  ip?: string;
}): Request {
  const request = new Request();

  request.setRequest({
    headers: seed.headers ?? {},
    ip: seed.ip ?? "127.0.0.1",
  } as unknown as FastifyRequest);

  return request;
}

describe("Request.detectIp", () => {
  it("returns x-real-ip when present (highest priority)", () => {
    const request = makeRequest({
      headers: { "x-real-ip": "198.51.100.5", "x-forwarded-for": "203.0.113.9" },
      ip: "10.0.0.1",
    });

    expect(request.detectIp()).toBe("198.51.100.5");
  });

  it("returns a single-hop x-forwarded-for verbatim", () => {
    const request = makeRequest({
      headers: { "x-forwarded-for": "198.51.100.7" },
      ip: "10.0.0.1",
    });

    expect(request.detectIp()).toBe("198.51.100.7");
  });

  it("takes only the FIRST entry of a multi-hop x-forwarded-for", () => {
    const request = makeRequest({
      headers: { "x-forwarded-for": "203.0.113.9, 70.41.3.18, 150.172.238.178" },
      ip: "10.0.0.1",
    });

    expect(request.detectIp()).toBe("203.0.113.9");
  });

  it("trims whitespace around the first hop", () => {
    const request = makeRequest({
      headers: { "x-forwarded-for": "  203.0.113.9 , 70.41.3.18" },
      ip: "10.0.0.1",
    });

    expect(request.detectIp()).toBe("203.0.113.9");
  });

  it("falls back to the peer ip when no forwarding headers exist", () => {
    const request = makeRequest({ ip: "172.16.0.4" });

    expect(request.detectIp()).toBe("172.16.0.4");
  });

  it("falls back to the peer ip when x-forwarded-for is blank/comma-only", () => {
    const request = makeRequest({
      headers: { "x-forwarded-for": " , " },
      ip: "172.16.0.4",
    });

    expect(request.detectIp()).toBe("172.16.0.4");
  });
});
