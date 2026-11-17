import { describe, expect, it } from "vitest";
import { resolveClient } from "../../../src/production/http/client";
import {
  ipMatches,
  isValidNetworkEntry,
  normalizeIp,
  rateLimitClient,
} from "../../../src/production/http/ip";
import { createApp, HOST, PATH } from "./harness";

type Headers = Record<string, string | string[] | undefined>;

const request = (remoteAddress: string, headers: Headers = {}, encrypted = false) => ({
  socket: { remoteAddress, encrypted },
  headers: { host: "app.example.com:8443", ...headers },
});

describe("ipMatches", () => {
  it("matches an address, a CIDR, loopback and private", () => {
    expect(ipMatches("203.0.113.5", ["203.0.113.5"])).toBe(true);
    expect(ipMatches("203.0.113.6", ["203.0.113.5"])).toBe(false);
    expect(ipMatches("10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(ipMatches("11.1.2.3", ["10.0.0.0/8"])).toBe(false);
    expect(ipMatches("127.0.0.1", ["loopback"])).toBe(true);
    expect(ipMatches("127.8.8.8", ["loopback"])).toBe(true);
    expect(ipMatches("::1", ["loopback"])).toBe(true);
    expect(ipMatches("192.168.1.9", ["private"])).toBe(true);
    expect(ipMatches("172.16.0.1", ["private"])).toBe(true);
    expect(ipMatches("172.32.0.1", ["private"])).toBe(false);
    expect(ipMatches("fd12::1", ["private"])).toBe(true);
    expect(ipMatches("2001:db8::1", ["2001:db8::/32"])).toBe(true);
    expect(ipMatches("2001:db9::1", ["2001:db8::/32"])).toBe(false);
    expect(ipMatches("8.8.8.8", ["private", "loopback"])).toBe(false);
  });

  it("unwraps IPv4-mapped IPv6 addresses on both sides", () => {
    expect(ipMatches("::ffff:127.0.0.1", ["loopback"])).toBe(true);
    expect(ipMatches("::ffff:10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(ipMatches("10.1.2.3", ["::ffff:10.1.2.3"])).toBe(true);
    expect(normalizeIp("::FFFF:1.2.3.4")).toBe("1.2.3.4");
    expect(normalizeIp("FE80::1%eth0")).toBe("fe80::1");
  });

  it("matches nothing for an empty list or a value that is not an IP", () => {
    expect(ipMatches("127.0.0.1", [])).toBe(false);
    expect(ipMatches("", ["loopback"])).toBe(false);
    expect(ipMatches("not-an-ip", ["loopback"])).toBe(false);
  });

  it("validates the entry shapes", () => {
    for (const entry of ["1.2.3.4", "::1", "10.0.0.0/8", "fd00::/8", "loopback", "private"]) {
      expect(isValidNetworkEntry(entry), entry).toBe(true);
    }

    for (const entry of ["", "1.2.3", "1.2.3.4/33", "x/8", "10.0.0.0/", 5, null]) {
      expect(isValidNetworkEntry(entry), String(entry)).toBe(false);
    }
  });
});

describe("rateLimitClient", () => {
  it("is the IPv4 address, or the /64 of an IPv6 address in any spelling", () => {
    expect(rateLimitClient("198.51.100.4")).toBe("198.51.100.4");
    expect(rateLimitClient("::ffff:198.51.100.4")).toBe("198.51.100.4");
    expect(rateLimitClient("0:0:0:0:0:ffff:c633:6404")).toBe("198.51.100.4");
    expect(rateLimitClient("2001:DB8::1")).toBe("2001:db8:0:0::/64");
    expect(rateLimitClient("2001:db8:0:0:ffff:1:2:3")).toBe("2001:db8:0:0::/64");
    expect(rateLimitClient("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
    expect(rateLimitClient("64:ff9b::198.51.100.4")).toBe("64:ff9b:0:0::/64");
    expect(rateLimitClient("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(rateLimitClient("not an ip")).toBe("not an ip");
  });
});

describe("resolveClient", () => {
  it("uses the socket and ignores forwarding headers without a trusted proxy", () => {
    const client = resolveClient(
      request("203.0.113.9", {
        "x-forwarded-for": "198.51.100.1",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "evil.example.com",
      }),
      [],
    );

    expect(client).toEqual({
      ip: "203.0.113.9",
      proto: "http",
      hostname: "app.example.com",
      host: "app.example.com:8443",
    });
  });

  it("reads the protocol from the socket when it is encrypted", () => {
    expect(resolveClient(request("203.0.113.9", {}, true), []).proto).toBe("https");
  });

  it("believes forwarding headers from a trusted peer", () => {
    const client = resolveClient(
      request("10.0.0.2", {
        "x-forwarded-for": "198.51.100.1",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "Ops.Example.com:8443",
      }),
      ["10.0.0.0/8"],
    );

    expect(client).toEqual({
      ip: "198.51.100.1",
      proto: "https",
      hostname: "ops.example.com",
      host: "ops.example.com:8443",
    });
  });

  it("walks X-Forwarded-For from the right, skipping trusted hops", () => {
    const client = resolveClient(
      request("10.0.0.2", { "x-forwarded-for": "6.6.6.6, 198.51.100.1, 10.0.0.9" }),
      ["private"],
    );

    // 6.6.6.6 was written by the client; 198.51.100.1 is what the first proxy saw.
    expect(client.ip).toBe("198.51.100.1");
  });

  it("takes the leftmost address when every hop is trusted", () => {
    const client = resolveClient(request("10.0.0.2", { "x-forwarded-for": "10.0.0.7, 10.0.0.9" }), [
      "private",
    ]);

    expect(client.ip).toBe("10.0.0.7");
  });

  it("reads IPv6 and IPv4-mapped addresses in the chain", () => {
    expect(
      resolveClient(request("::1", { "x-forwarded-for": "2001:db8::5" }), ["loopback"]).ip,
    ).toBe("2001:db8::5");
    expect(
      resolveClient(request("::ffff:127.0.0.1", { "x-forwarded-for": "::ffff:198.51.100.4" }), [
        "loopback",
      ]).ip,
    ).toBe("198.51.100.4");
    expect(resolveClient(request("::ffff:203.0.113.9"), []).ip).toBe("203.0.113.9");
  });

  it("ignores junk in the chain and unknown protocols", () => {
    const client = resolveClient(
      request("10.0.0.2", {
        "x-forwarded-for": "garbage, 198.51.100.1",
        "x-forwarded-proto": "gopher",
      }),
      ["private"],
    );

    expect(client.ip).toBe("198.51.100.1");
    expect(client.proto).toBe("http");
  });

  it("keeps the peer when the trusted proxy sends no chain", () => {
    expect(resolveClient(request("10.0.0.2"), ["private"]).ip).toBe("10.0.0.2");
  });

  it("reads the first value of a repeated header", () => {
    const client = resolveClient(
      request("10.0.0.2", {
        "x-forwarded-proto": ["https", "http"],
        "x-forwarded-for": ["1.1.1.1"],
      }),
      ["private"],
    );

    expect(client.proto).toBe("https");
    expect(client.ip).toBe("1.1.1.1");
  });

  it("keeps the brackets of an IPv6 host literal", () => {
    expect(resolveClient(request("1.1.1.1", { host: "[::1]:8080" }), []).hostname).toBe("[::1]");
  });
});

describe("the gate and the client address", () => {
  it("ignores a spoofed X-Forwarded-For and X-Forwarded-Proto from an untrusted peer", async () => {
    const t = await createApp({ production: { trustedProxies: [] } });
    const response = await t.inject({
      method: "GET",
      url: `${PATH}/api/auth/session`,
      remoteAddress: "198.51.100.77",
      headers: { host: HOST, "x-forwarded-proto": "https", "x-forwarded-for": "127.0.0.1" },
    });

    // Plain HTTP on the socket: the dashboard answers as if it did not exist.
    expect(response.statusCode).toBe(404);
  });

  it("applies allowedIps to the resolved client address, not to a client-written header", async () => {
    const t = await createApp({ production: { allowedIps: ["203.0.113.5"] } });
    const allowed = await t.inject({ method: "GET", url: `${PATH}/api/auth/session` });
    const spoofed = await t.inject({
      method: "GET",
      url: `${PATH}/api/auth/session`,
      headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.5" },
    });

    expect(allowed.statusCode).toBe(200);
    // The proxy appended the peer it saw (203.0.113.5) last; the leftmost value was written by the client.
    expect(spoofed.statusCode).toBe(200);

    const denied = await t.inject({
      method: "GET",
      url: `${PATH}/api/auth/session`,
      headers: { "x-forwarded-for": "203.0.113.5, 198.51.100.1" },
    });

    expect(denied.statusCode).toBe(404);
  });

  it("derives the expected origin from the forwarded host when no origin is configured", async () => {
    const t = await createApp({ production: { origin: undefined as never } });
    const session = await t.signIn("viewer@example.com");
    const ok = await t.send("DELETE", "/api/account/sessions/none", {
      session,
      headers: { origin: `https://${HOST}` },
    });
    const foreign = await t.send("DELETE", "/api/account/sessions/none", {
      session,
      headers: { origin: "https://evil.example.com" },
    });

    expect(ok.statusCode).not.toBe(403);
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json()).toMatchObject({ code: "csrf.invalid" });
  });
});
