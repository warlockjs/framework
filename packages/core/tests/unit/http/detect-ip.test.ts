import config from "@mongez/config";
import type { FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Request } from "../../../src/http/request";
import { startHttpServer } from "../../../src/http/server";

// The first Fastify boot in the process costs far more than the 10s default on
// a cold transform cache; the assertions themselves resolve instantly.
vi.setConfig({ testTimeout: 120_000 });

/**
 * Coverage for `Request.detectIp()` — the real-client-IP resolver used by
 * ip-filter / rate-limit / idempotency scoping.
 *
 * The security-critical property: `X-Real-IP` / `X-Forwarded-For` are
 * client-settable, so they are honoured ONLY as far as `http.trustProxy`
 * allows. Without the opt-in, a spoofed header must be ignored and the socket
 * peer address returned — otherwise any client could bypass ip-filter
 * allowlists, rate-limit buckets, and idempotency scoping by forging a header.
 *
 * `X-Forwarded-For` resolution is delegated to Fastify (`request.ip`), so the
 * chain tests below run against a live Fastify booted through the framework's
 * own `startHttpServer()` with a real socket peer address — asserting the
 * config value shapes end to end (`true`, hop count, CIDR list) rather than a
 * re-implementation of the chain walk. `X-Real-IP` is not part of Fastify's
 * resolution and is asserted against a seeded `baseRequest`.
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
 * Reset by removing the key outright: a stored `null` is not the same as an
 * absent key, and only an absent key makes a later `config.get(key, fallback)`
 * return the fallback. `unset()` exists for exactly this — reaching into
 * `list()` and deleting by hand relied on it returning the live object.
 */
function unsetTrustProxy() {
  config.unset("http.trustProxy");
}

/**
 * Boot the framework's Fastify with the given `http.trustProxy`, inject one
 * request from `remoteAddress`, and report what `detectIp()` resolved. This is
 * the production wiring: Fastify applies `trustProxy` to `request.ip`, and
 * `detectIp()` reads it back off the same request object.
 */
async function detectIpThroughServer(seed: {
  trustProxy?: unknown;
  headers?: Record<string, string>;
  remoteAddress?: string;
}): Promise<string> {
  if (seed.trustProxy !== undefined) {
    config.set("http.trustProxy", seed.trustProxy);
  }

  const server = startHttpServer();

  let detected = "";

  server.get("/whoami", async (baseRequest: FastifyRequest) => {
    detected = new Request().setRequest(baseRequest).detectIp();

    return { ok: true };
  });

  try {
    await server.inject({
      method: "GET",
      url: "/whoami",
      headers: seed.headers ?? {},
      remoteAddress: seed.remoteAddress ?? "127.0.0.1",
    });
  } finally {
    await server.close();
  }

  return detected;
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

    it("ignores a spoofed x-forwarded-for and returns the peer ip", async () => {
      expect(
        await detectIpThroughServer({
          headers: { "x-forwarded-for": "203.0.113.9, 70.41.3.18" },
          remoteAddress: "10.0.0.1",
        }),
      ).toBe("10.0.0.1");
    });

    it("returns the peer ip when no forwarding headers exist", () => {
      const request = makeRequest({ ip: "172.16.0.4" });

      expect(request.detectIp()).toBe("172.16.0.4");
    });
  });

  describe("with http.trustProxy: true (whole chain trusted)", () => {
    it("returns x-real-ip when present (highest priority)", () => {
      config.set("http.trustProxy", true);

      const request = makeRequest({
        headers: { "x-real-ip": "198.51.100.5", "x-forwarded-for": "203.0.113.9" },
        ip: "10.0.0.1",
      });

      expect(request.detectIp()).toBe("198.51.100.5");
    });

    it("returns a single-hop x-forwarded-for verbatim", async () => {
      expect(
        await detectIpThroughServer({
          trustProxy: true,
          headers: { "x-forwarded-for": "198.51.100.7" },
          remoteAddress: "10.0.0.1",
        }),
      ).toBe("198.51.100.7");
    });

    it("takes the leftmost entry of a multi-hop x-forwarded-for", async () => {
      expect(
        await detectIpThroughServer({
          trustProxy: true,
          headers: { "x-forwarded-for": "203.0.113.9, 70.41.3.18, 150.172.238.178" },
          remoteAddress: "10.0.0.1",
        }),
      ).toBe("203.0.113.9");
    });

    it("trims whitespace around the resolved hop", async () => {
      expect(
        await detectIpThroughServer({
          trustProxy: true,
          headers: { "x-forwarded-for": "  203.0.113.9 , 70.41.3.18" },
          remoteAddress: "10.0.0.1",
        }),
      ).toBe("203.0.113.9");
    });

    it("falls back to the peer ip when no forwarding headers exist", async () => {
      expect(
        await detectIpThroughServer({
          trustProxy: true,
          remoteAddress: "172.16.0.4",
        }),
      ).toBe("172.16.0.4");
    });

    it("falls back to the peer ip when x-forwarded-for is blank/comma-only", async () => {
      expect(
        await detectIpThroughServer({
          trustProxy: true,
          headers: { "x-forwarded-for": " , " },
          remoteAddress: "172.16.0.4",
        }),
      ).toBe("172.16.0.4");
    });
  });

  describe("with a numeric http.trustProxy (grants NO trust)", () => {
    /**
     * These three cases previously asserted hop-count semantics — that
     * `trustProxy: 1` lands on the entry the edge appended, `2` walks one
     * further left, and so on. **Fastify does not do that, deliberately.**
     *
     * `fastify/lib/request.js`, `getTrustProxyFn`:
     *
     *     if (typeof tp === 'number') {
     *       // Hop-count-only trust cannot validate the immediate peer. Fail
     *       // closed so direct clients cannot spoof X-Forwarded-* values by
     *       // supplying enough hops.
     *       return function () { return false }
     *     }
     *
     * So a number grants no trust and `request.ip` stays the socket peer.
     * Verified against bare Fastify 5.12.1 — both through `inject` and against
     * a real listening socket — with no Warlock code in the path.
     *
     * That is a SECURITY property and it was previously untested: the tests
     * that stood here asserted its opposite, and would have gone green only if
     * Warlock started honouring a hop count Fastify refuses. They now pin the
     * real behaviour so a future change cannot loosen it unnoticed.
     *
     * The silent part is the defect, and it is a documentation one: a number
     * looks like bounded trust and delivers none. See `http/types.ts`.
     */
    it("grants no trust for one hop — the socket peer wins over the whole chain", async () => {
      expect(
        await detectIpThroughServer({
          trustProxy: 1,
          headers: { "x-forwarded-for": "203.0.113.9, 198.51.100.7" },
          remoteAddress: "10.0.0.1",
        }),
      ).toBe("10.0.0.1");
    });

    it("grants no trust for two hops either — a larger number is not more trust", async () => {
      expect(
        await detectIpThroughServer({
          trustProxy: 2,
          headers: { "x-forwarded-for": "203.0.113.9, 198.51.100.7" },
          remoteAddress: "10.0.0.1",
        }),
      ).toBe("10.0.0.1");
    });

    it("cannot be widened by inflating the hop count past the chain length", async () => {
      expect(
        await detectIpThroughServer({
          trustProxy: 5,
          headers: { "x-forwarded-for": "203.0.113.9" },
          remoteAddress: "10.0.0.1",
        }),
      ).toBe("10.0.0.1");
    });

    it("ignores x-real-ip under a bounded hop count", async () => {
      expect(
        await detectIpThroughServer({
          trustProxy: 1,
          headers: { "x-real-ip": "203.0.113.9" },
          remoteAddress: "10.0.0.1",
        }),
      ).toBe("10.0.0.1");
    });

    it("trusts nothing when the hop count is 0", async () => {
      expect(
        await detectIpThroughServer({
          trustProxy: 0,
          headers: { "x-forwarded-for": "203.0.113.9" },
          remoteAddress: "10.0.0.1",
        }),
      ).toBe("10.0.0.1");
    });
  });

  describe("with a CIDR / IP list http.trustProxy", () => {
    it("walks the chain past hops inside the trusted CIDR", async () => {
      expect(
        await detectIpThroughServer({
          trustProxy: "10.0.0.0/8",
          headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.2" },
          remoteAddress: "10.0.0.1",
        }),
      ).toBe("203.0.113.9");
    });

    it("stops at the first hop outside the trusted CIDR", async () => {
      expect(
        await detectIpThroughServer({
          trustProxy: "10.0.0.0/8",
          headers: { "x-forwarded-for": "203.0.113.9, 198.51.100.7" },
          remoteAddress: "10.0.0.1",
        }),
      ).toBe("198.51.100.7");
    });

    it("ignores a forged chain when the peer itself is not a trusted proxy", async () => {
      expect(
        await detectIpThroughServer({
          trustProxy: "10.0.0.0/8",
          headers: { "x-forwarded-for": "203.0.113.9" },
          remoteAddress: "198.51.100.1",
        }),
      ).toBe("198.51.100.1");
    });

    it("accepts an array of CIDR blocks", async () => {
      expect(
        await detectIpThroughServer({
          trustProxy: ["10.0.0.0/8", "192.168.0.0/16"],
          headers: { "x-forwarded-for": "203.0.113.9, 192.168.1.7" },
          remoteAddress: "10.0.0.1",
        }),
      ).toBe("203.0.113.9");
    });

    it("accepts a comma-separated list in a single string", async () => {
      expect(
        await detectIpThroughServer({
          trustProxy: "10.0.0.0/8, 192.168.0.0/16",
          headers: { "x-forwarded-for": "203.0.113.9, 192.168.1.7" },
          remoteAddress: "10.0.0.1",
        }),
      ).toBe("203.0.113.9");
    });

    it("accepts an exact proxy address", async () => {
      expect(
        await detectIpThroughServer({
          trustProxy: "10.0.0.1",
          headers: { "x-forwarded-for": "203.0.113.9" },
          remoteAddress: "10.0.0.1",
        }),
      ).toBe("203.0.113.9");
    });

    it("ignores x-real-ip under a CIDR list", async () => {
      expect(
        await detectIpThroughServer({
          trustProxy: "10.0.0.0/8",
          headers: { "x-real-ip": "203.0.113.9" },
          remoteAddress: "10.0.0.1",
        }),
      ).toBe("10.0.0.1");
    });
  });
});
