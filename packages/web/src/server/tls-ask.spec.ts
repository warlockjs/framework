import { describe, expect, it, vi } from "vitest";
import type { SitesConfig } from "../sites/site-config.types";
import { createTlsAskHandler } from "./tls-ask";

const request = new Request("https://localhost/.well-known/warlock/domain") as never;
const fixed: SitesConfig = {
  landing: { hosts: ["estates.app"] },
  tenant: { dynamic: true },
};

describe("createTlsAskHandler", () => {
  it("allows a listed host, including uppercase with a port", async () => {
    const ask = createTlsAskHandler({ sites: fixed });
    await expect(ask({ domain: "ESTATES.APP:443", request })).resolves.toEqual({ status: 200 });
  });

  it("allows a host claimed by the resolver", async () => {
    const resolveHost = vi.fn(() => ({ site: "tenant", key: "acme" }));
    const ask = createTlsAskHandler({ sites: fixed, resolveHost });
    await expect(ask({ domain: "acme.com", request })).resolves.toEqual({ status: 200 });
    expect(resolveHost).toHaveBeenCalledWith({ host: "acme.com", request });
  });

  it("denies an unclaimed host", async () => {
    const ask = createTlsAskHandler({ sites: fixed, resolveHost: () => null });
    await expect(ask({ domain: "missing.com", request })).resolves.toEqual({ status: 404 });
  });

  it("does not authorize an unknownHost fallback", async () => {
    const ask = createTlsAskHandler({ sites: fixed, resolveHost: () => null });
    await expect(ask({ domain: "missing.com", request })).resolves.toEqual({ status: 404 });
  });

  it.each([undefined, "", "https://acme.com", "acme.com/path", "acme .com"])(
    "rejects an absent or invalid domain %#",
    async (domain) => {
      const ask = createTlsAskHandler({ sites: fixed });
      await expect(ask({ domain, request })).resolves.toEqual({ status: 400 });
    },
  );

  it("rejects an IP literal", async () => {
    const ask = createTlsAskHandler({ sites: fixed });
    await expect(ask({ domain: "127.0.0.1", request })).resolves.toEqual({ status: 400 });
  });

  it("propagates resolver failures", async () => {
    const ask = createTlsAskHandler({
      sites: fixed,
      resolveHost: async () => {
        throw new Error("database unavailable");
      },
    });
    await expect(ask({ domain: "acme.com", request })).rejects.toThrow("database unavailable");
  });
});

describe("createTlsAskHandler caller allowlist", () => {
  const from = (remoteAddress: string) => ({ baseRequest: { socket: { remoteAddress } } }) as never;
  const resolveHost = () => ({ site: "tenant", key: "acme" });

  it("answers any caller by default", async () => {
    const ask = createTlsAskHandler({ sites: fixed, resolveHost });
    await expect(ask({ domain: "acme.com", request: from("203.0.113.7") })).resolves.toEqual({
      status: 200,
    });
  });

  it('refuses a non-loopback caller under "loopback"', async () => {
    const resolver = vi.fn(resolveHost);
    const ask = createTlsAskHandler({ sites: fixed, resolveHost: resolver, allow: "loopback" });

    await expect(ask({ domain: "acme.com", request: from("203.0.113.7") })).resolves.toEqual({
      status: 403,
    });
    expect(resolver).not.toHaveBeenCalled();
    await expect(ask({ domain: "acme.com", request: from("127.0.0.1") })).resolves.toEqual({
      status: 200,
    });
    await expect(ask({ domain: "acme.com", request: from("::ffff:127.0.0.1") })).resolves.toEqual({
      status: 200,
    });
  });

  it('accepts private-network callers under "private"', async () => {
    const ask = createTlsAskHandler({ sites: fixed, resolveHost, allow: "private" });

    await expect(ask({ domain: "acme.com", request: from("10.1.2.3") })).resolves.toEqual({
      status: 200,
    });
    await expect(ask({ domain: "acme.com", request: from("172.20.0.4") })).resolves.toEqual({
      status: 200,
    });
    await expect(ask({ domain: "acme.com", request: from("8.8.8.8") })).resolves.toEqual({
      status: 403,
    });
  });

  it("accepts only the listed addresses", async () => {
    const ask = createTlsAskHandler({ sites: fixed, resolveHost, allow: ["198.51.100.10"] });

    await expect(ask({ domain: "acme.com", request: from("198.51.100.10") })).resolves.toEqual({
      status: 200,
    });
    await expect(ask({ domain: "acme.com", request: from("198.51.100.11") })).resolves.toEqual({
      status: 403,
    });
  });

  it("refuses a domain longer than a DNS name before asking the resolver", async () => {
    const resolver = vi.fn(resolveHost);
    const ask = createTlsAskHandler({ sites: fixed, resolveHost: resolver });

    await expect(
      ask({ domain: `${"a".repeat(300)}.com`, request: from("127.0.0.1") }),
    ).resolves.toEqual({ status: 400 });
    expect(resolver).not.toHaveBeenCalled();
  });
});
