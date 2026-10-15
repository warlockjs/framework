import { describe, expect, it } from "vitest";
import { isPrivateOrReservedIp } from "./classify-ip-address";

const hex = (a: number, b: number, c: number, d: number) =>
  `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;

const forms = (v4: string): string[] => {
  const [a, b, c, d] = v4.split(".").map(Number) as [number, number, number, number];
  const h = hex(a, b, c, d);
  const [h1, h2] = h.split(":") as [string, string];

  return [
    v4,
    `::ffff:${v4}`,
    `::ffff:${h}`,
    `::${v4}`,
    `::${h}`,
    `64:ff9b::${v4}`,
    `64:ff9b::${h}`,
    `2002:${h1}:${h2}::`,
    `2002:${h1}:${h2}:1::1`,
  ];
};

describe("isPrivateOrReservedIp", () => {
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1"])(
    "classifies every form of %s as private",
    (v4) => {
      for (const form of forms(v4)) {
        expect(isPrivateOrReservedIp(form), form).toBe(true);
      }
    },
  );

  it("classifies every form of 8.8.8.8 as public", () => {
    for (const form of forms("8.8.8.8")) {
      expect(isPrivateOrReservedIp(form), form).toBe(false);
    }
  });

  it("blocks the WHATWG-serialized loopback bypass from the finding", () => {
    const host = new URL("http://[::ffff:127.0.0.1]/").hostname.slice(1, -1);
    expect(host).toBe("::ffff:7f00:1");
    expect(isPrivateOrReservedIp(host)).toBe(true);
    expect(isPrivateOrReservedIp("::ffff:a9fe:a9fe")).toBe(true);
  });

  it("keeps existing IPv6 behaviour", () => {
    expect(isPrivateOrReservedIp("::1")).toBe(true);
    expect(isPrivateOrReservedIp("::")).toBe(true);
    expect(isPrivateOrReservedIp("fd00::1")).toBe(true);
    expect(isPrivateOrReservedIp("fe80::1%eth0")).toBe(true);
    expect(isPrivateOrReservedIp("2606:4700::1111")).toBe(false);
  });
});
