import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
import { isIP, isIPv4, isIPv6 } from "../../../src/rules/string/ip";

const validIPv4 = [
  "192.168.1.1",
  "255.255.255.255",
  "0.0.0.0",
  "127.0.0.1",
  "10.0.0.1",
];

const invalidIPv4 = [
  "1.2.3.4.5", // 5 octets
  "1.2.3.256", // octet > 255
  "01.2.3.4", // leading zero
  "1.02.3.4", // leading zero in middle octet
  "1.2.3", // too few octets
  "1.2.3.a", // hex/non-digit
  "", // empty
  "1.2.3.4 ", // trailing whitespace
  " 1.2.3.4", // leading whitespace
];

const validIPv6 = [
  "::", // unspecified
  "::1", // loopback
  "2001:db8::1", // compressed
  "2001:0db8:0000:0000:0000:0000:0000:0001", // full form
  "1:2:3:4:5:6:7:8", // full form, no compression
  "::ffff:1.2.3.4", // v4-mapped
  "::ffff:192.168.1.1", // v4-mapped
  "fe80::1%eth0", // zone id (net.isIP accepts this)
  "0:0:0:0:0:0:0:0",
];

const invalidIPv6 = [
  "1:2:3:4:5:6:7:8:9", // too many groups
  "1::2::3", // double ::
  "12345::", // group too long
  "::g", // invalid hex char
  "2001:db8::1:2:3:4:5:6", // too many groups with ::
  "1:2:3:4:5:6:7:1.2.3.4", // v4 tail with full 8 groups already
  "1.2.3.4:5:6:7:8:9:10", // malformed mix
  ":", // bare colon
  "fe80::1%", // empty zone id
];

describe("ip helpers (pure, no Node net)", () => {
  it("isIPv4 accepts valid IPv4 addresses", () => {
    for (const value of validIPv4) {
      expect(isIPv4(value), value).toBe(true);
    }
  });

  it("isIPv4 rejects invalid IPv4 addresses", () => {
    for (const value of invalidIPv4) {
      expect(isIPv4(value), value).toBe(false);
    }
  });

  it("isIPv6 accepts valid IPv6 addresses", () => {
    for (const value of validIPv6) {
      expect(isIPv6(value), value).toBe(true);
    }
  });

  it("isIPv6 rejects invalid IPv6 addresses", () => {
    for (const value of invalidIPv6) {
      expect(isIPv6(value), value).toBe(false);
    }
  });

  it("isIP returns 4, 6, or 0 mirroring Node's net.isIP signature", () => {
    for (const value of validIPv4) expect(isIP(value), value).toBe(4);
    for (const value of validIPv6) expect(isIP(value), value).toBe(6);
    for (const value of [...invalidIPv4, ...invalidIPv6]) {
      expect(isIP(value), value).toBe(0);
    }
  });
});

describe("IP Rules", () => {
  it("ip rule accepts v4 and v6, rejects invalid", async () => {
    const validator = v.string().ip();
    for (const value of [...validIPv4, ...validIPv6]) {
      expect((await validate(validator, value)).isValid, value).toBe(true);
    }
    for (const value of [...invalidIPv4, ...invalidIPv6]) {
      expect((await validate(validator, value)).isValid, value).toBe(false);
    }
  });

  it("ip4 rule accepts only v4", async () => {
    const validator = v.string().ip4();
    for (const value of validIPv4) {
      expect((await validate(validator, value)).isValid, value).toBe(true);
    }
    for (const value of validIPv6) {
      expect((await validate(validator, value)).isValid, value).toBe(false);
    }
  });

  it("ip6 rule accepts only v6", async () => {
    const validator = v.string().ip6();
    for (const value of validIPv6) {
      expect((await validate(validator, value)).isValid, value).toBe(true);
    }
    for (const value of validIPv4) {
      expect((await validate(validator, value)).isValid, value).toBe(false);
    }
  });
});
