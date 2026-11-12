import config from "@mongez/config";
import { afterEach, describe, expect, it } from "vitest";
import { resolveClientIp } from "./trusted-proxy";

describe("resolveClientIp", () => {
  afterEach(() => {
    config.set("http", undefined);
  });

  it("returns the address Fastify resolved", () => {
    expect(resolveClientIp({ ip: "203.0.113.1", headers: {} })).toBe("203.0.113.1");
  });

  it("falls back to the socket address once request.ip is gone", () => {
    expect(
      resolveClientIp({
        ip: undefined,
        headers: {},
        socket: { remoteAddress: "198.51.100.2" },
      }),
    ).toBe("198.51.100.2");
  });

  it("returns an empty string, never undefined, when no address is known", () => {
    expect(resolveClientIp({ ip: undefined, headers: {}, socket: {} })).toBe("");
    expect(resolveClientIp({ headers: {} })).toBe("");
  });

  it("still prefers a trusted real-IP header", () => {
    config.set("http", { trustProxy: true, realIpHeader: "cf-connecting-ip" });

    expect(
      resolveClientIp({
        ip: undefined,
        headers: { "cf-connecting-ip": "203.0.113.9" },
        socket: { remoteAddress: "10.0.0.1" },
      }),
    ).toBe("203.0.113.9");
  });
});
