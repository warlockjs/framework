import config from "@mongez/config";
import type { FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { Request } from "../../../src/http/request";

/**
 * Unit coverage for `Request.detectIp()` — the real-client-IP resolver used by
 * ip-filter / rate-limit / idempotency scoping.
 *
 * The security-critical property: `X-Real-IP` / `X-Forwarded-For` are
 * client-settable, so they are honoured ONLY when `http.trustProxy` is set.
 * Without the opt-in, a spoofed header must be ignored and the socket peer
 * address returned — otherwise any client could bypass ip-filter allowlists,
 * rate-limit buckets, and idempotency scoping by forging a header.
 *
 * With trustProxy on, the interesting case is a multi-hop `X-Forwarded-For`
 * ("client, proxy1, proxy2"): only the leftmost entry (the original client)
 * should be returned, comma-split and trimmed.
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

/**
 * `config.set(key, undefined)` stores `null` rather than unsetting, and a
 * later `config.get(key, fallback)` returns that `null` instead of the
 * fallback — so reset by deleting the key.
 */
function unsetTrustProxy() {
  delete config.list()?.http?.trustProxy;
}

describe("Request.detectIp", () => {
  afterEach(() => {
    unsetTrustProxy();
  });

  describe("without http.trustProxy (default)", () => {
    it("ignores a spoofed x-real-ip and returns the peer ip", () => {
      const request = makeRequest({
        headers: { "x-real-ip": "198.51.100.5" },
        ip: "10.0.0.1",
      });

      expect(request.detectIp()).toBe("10.0.0.1");
    });

    it("ignores a spoofed x-forwarded-for and returns the peer ip", () => {
      const request = makeRequest({
        headers: { "x-forwarded-for": "203.0.113.9, 70.41.3.18" },
        ip: "10.0.0.1",
      });

      expect(request.detectIp()).toBe("10.0.0.1");
    });

    it("returns the peer ip when no forwarding headers exist", () => {
      const request = makeRequest({ ip: "172.16.0.4" });

      expect(request.detectIp()).toBe("172.16.0.4");
    });
  });

  describe("with http.trustProxy enabled", () => {
    it("returns x-real-ip when present (highest priority)", () => {
      config.set("http.trustProxy", true);

      const request = makeRequest({
        headers: { "x-real-ip": "198.51.100.5", "x-forwarded-for": "203.0.113.9" },
        ip: "10.0.0.1",
      });

      expect(request.detectIp()).toBe("198.51.100.5");
    });

    it("returns a single-hop x-forwarded-for verbatim", () => {
      config.set("http.trustProxy", true);

      const request = makeRequest({
        headers: { "x-forwarded-for": "198.51.100.7" },
        ip: "10.0.0.1",
      });

      expect(request.detectIp()).toBe("198.51.100.7");
    });

    it("takes only the FIRST entry of a multi-hop x-forwarded-for", () => {
      config.set("http.trustProxy", true);

      const request = makeRequest({
        headers: { "x-forwarded-for": "203.0.113.9, 70.41.3.18, 150.172.238.178" },
        ip: "10.0.0.1",
      });

      expect(request.detectIp()).toBe("203.0.113.9");
    });

    it("trims whitespace around the first hop", () => {
      config.set("http.trustProxy", true);

      const request = makeRequest({
        headers: { "x-forwarded-for": "  203.0.113.9 , 70.41.3.18" },
        ip: "10.0.0.1",
      });

      expect(request.detectIp()).toBe("203.0.113.9");
    });

    it("falls back to the peer ip when no forwarding headers exist", () => {
      config.set("http.trustProxy", true);

      const request = makeRequest({ ip: "172.16.0.4" });

      expect(request.detectIp()).toBe("172.16.0.4");
    });

    it("falls back to the peer ip when x-forwarded-for is blank/comma-only", () => {
      config.set("http.trustProxy", true);

      const request = makeRequest({
        headers: { "x-forwarded-for": " , " },
        ip: "172.16.0.4",
      });

      expect(request.detectIp()).toBe("172.16.0.4");
    });
  });
});
