import { describe, expect, it } from "vitest";
import { anyMatch, ipMatches } from "../../../src/http/middleware/utils/cidr-match";

/**
 * Pure IPv4 / CIDR matching used by the ipFilter middleware. No network — just
 * bit math. Source: core/src/http/middleware/utils/cidr-match.ts. IPv6 is
 * exact-string only by design (no IPv6 CIDR support).
 */
describe("ipMatches — exact matches", () => {
  it("matches an identical IPv4 string", () => {
    expect(ipMatches("10.0.0.5", "10.0.0.5")).toBe(true);
  });

  it("matches an identical IPv6 string exactly", () => {
    expect(ipMatches("::1", "::1")).toBe(true);
    expect(ipMatches("2001:db8::1", "2001:db8::1")).toBe(true);
  });

  it("does not match two different exact IPs", () => {
    expect(ipMatches("10.0.0.5", "10.0.0.6")).toBe(false);
  });
});

describe("ipMatches — CIDR blocks", () => {
  it("matches an IP inside a /8 block", () => {
    expect(ipMatches("10.255.255.255", "10.0.0.0/8")).toBe(true);
    expect(ipMatches("10.0.0.1", "10.0.0.0/8")).toBe(true);
  });

  it("rejects an IP outside a /8 block", () => {
    expect(ipMatches("11.0.0.1", "10.0.0.0/8")).toBe(false);
  });

  it("matches an IP inside a /24 block and rejects the neighbouring subnet", () => {
    expect(ipMatches("192.168.1.42", "192.168.1.0/24")).toBe(true);
    expect(ipMatches("192.168.2.42", "192.168.1.0/24")).toBe(false);
  });

  it("matches a /32 only for the exact host", () => {
    expect(ipMatches("203.0.113.7", "203.0.113.7/32")).toBe(true);
    expect(ipMatches("203.0.113.8", "203.0.113.7/32")).toBe(false);
  });

  it("matches everything for a /0 block", () => {
    expect(ipMatches("8.8.8.8", "0.0.0.0/0")).toBe(true);
    expect(ipMatches("255.255.255.255", "1.2.3.4/0")).toBe(true);
  });
});

describe("ipMatches — invalid inputs fail closed", () => {
  it("returns false for an empty ip or pattern", () => {
    expect(ipMatches("", "10.0.0.0/8")).toBe(false);
    expect(ipMatches("10.0.0.1", "")).toBe(false);
  });

  it("returns false when the IP has the wrong octet count", () => {
    expect(ipMatches("10.0.0", "10.0.0.0/8")).toBe(false);
    expect(ipMatches("10.0.0.0.1", "10.0.0.0/8")).toBe(false);
  });

  it("returns false for an out-of-range octet", () => {
    expect(ipMatches("10.0.0.256", "10.0.0.0/8")).toBe(false);
    expect(ipMatches("10.0.0.5", "10.0.0.256/8")).toBe(false);
  });

  it("returns false for a non-numeric octet", () => {
    expect(ipMatches("10.0.0.x", "10.0.0.0/8")).toBe(false);
  });

  it("returns false for an out-of-range prefix length", () => {
    expect(ipMatches("10.0.0.5", "10.0.0.0/33")).toBe(false);
    expect(ipMatches("10.0.0.5", "10.0.0.0/-1")).toBe(false);
  });

  it("returns false for a non-integer prefix length", () => {
    expect(ipMatches("10.0.0.5", "10.0.0.0/abc")).toBe(false);
  });

  it("returns false when an exact (non-CIDR) pattern does not match", () => {
    expect(ipMatches("not-an-ip", "10.0.0.0")).toBe(false);
  });
});

describe("anyMatch", () => {
  it("returns true when any pattern in the list matches", () => {
    expect(anyMatch("10.0.0.5", ["192.168.0.0/16", "10.0.0.0/8"])).toBe(true);
  });

  it("returns false when no pattern matches", () => {
    expect(anyMatch("172.16.0.1", ["192.168.0.0/16", "10.0.0.0/8"])).toBe(false);
  });

  it("returns false for an empty pattern list", () => {
    expect(anyMatch("10.0.0.5", [])).toBe(false);
  });
});
