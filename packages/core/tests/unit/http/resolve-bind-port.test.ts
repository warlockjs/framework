import { describe, expect, it } from "vitest";
import { defaultHttpConfigurations } from "../../../src/http/config";
import { isCanonicalPortValue, resolveBindPort } from "../../../src/http/resolve-bind-port";

describe("resolveBindPort", () => {
  describe("innocent case", () => {
    it("returns a plain number unchanged", () => {
      expect(resolveBindPort(3000)).toBe(3000);
      expect(isCanonicalPortValue(3000, 3000)).toBe(true);
    });

    it("returns the canonical stringified number unchanged", () => {
      expect(resolveBindPort("3000")).toBe(3000);
      expect(isCanonicalPortValue("3000", 3000)).toBe(true);
    });

    it("falls back to the framework default for undefined — does not throw", () => {
      expect(resolveBindPort(undefined)).toBe(defaultHttpConfigurations.port ?? 3000);
      expect(isCanonicalPortValue(undefined, defaultHttpConfigurations.port ?? 3000)).toBe(true);
    });

    it("never flags a plain number as needing a notice", () => {
      // The whole point of `isCanonicalPortValue`: a caller uses it to decide
      // whether to print ONE notice line. It must stay silent for the
      // ordinary, already-correct case.
      expect(isCanonicalPortValue(3000, resolveBindPort(3000))).toBe(true);
      expect(isCanonicalPortValue(undefined, resolveBindPort(undefined))).toBe(true);
    });
  });

  describe("values env() leaves as strings — the defect this resolver exists to close", () => {
    it("normalises a zero-padded string port", () => {
      const resolved = resolveBindPort("03999");

      expect(resolved).toBe(3999);
      expect(isCanonicalPortValue("03999", resolved)).toBe(false);
    });

    it("normalises a leading/trailing-whitespace string port", () => {
      const resolvedLeading = resolveBindPort(" 3999");
      const resolvedTrailing = resolveBindPort("3999 ");

      expect(resolvedLeading).toBe(3999);
      expect(resolvedTrailing).toBe(3999);
      expect(isCanonicalPortValue(" 3999", resolvedLeading)).toBe(false);
      expect(isCanonicalPortValue("3999 ", resolvedTrailing)).toBe(false);
    });

    it("normalises a plus-prefixed string port", () => {
      const resolved = resolveBindPort("+3999");

      expect(resolved).toBe(3999);
      expect(isCanonicalPortValue("+3999", resolved)).toBe(false);
    });

    it("resolves exponential notation to the port it would actually bind — the silent-wrong-port defect", () => {
      // This is the case that used to bind port 1000 with NO diagnostic
      // anywhere: `env()` leaves "1e3" as a string (it does not round-trip
      // through `String(Number(v)) === v`), and `net.Server.listen({ port })`
      // happily binds `Number("1e3")` = 1000 without complaint.
      const resolved = resolveBindPort("1e3");

      expect(resolved).toBe(1000);
      expect(isCanonicalPortValue("1e3", resolved)).toBe(false);
    });
  });

  describe("unusable ports", () => {
    it.each(["abc", "99999", "-1", "3.5"])("throws for %s, naming the raw value", (rawPort) => {
      expect(() => resolveBindPort(rawPort)).toThrow(JSON.stringify(rawPort));
    });
  });
});
