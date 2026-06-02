import { describe, expect, it } from "vitest";
import type { LoggingData, RedactConfig } from "../types";
import { applyRedact, mergeRedact } from "./redact";

function entry(overrides: Partial<LoggingData> = {}): LoggingData {
  return {
    type: "info",
    module: "auth",
    action: "login",
    message: "ok",
    ...overrides,
  };
}

describe("applyRedact", () => {
  describe("no-op cases", () => {
    it("returns the input unchanged when config is undefined", () => {
      const data = entry({ context: { password: "secret" } });
      const result = applyRedact(data, undefined);
      expect(result).toBe(data);
    });

    it("returns the input unchanged when paths is empty", () => {
      const data = entry({ context: { password: "secret" } });
      const result = applyRedact(data, { paths: [] });
      expect(result).toBe(data);
    });
  });

  describe("literal paths", () => {
    it("redacts a top-level context key", () => {
      const data = entry({ context: { password: "secret", role: "admin" } });
      const result = applyRedact(data, { paths: ["context.password"] });

      expect(result.context).toEqual({
        password: "[REDACTED]",
        role: "admin",
      });
    });

    it("redacts a deeply nested context key", () => {
      const data = entry({
        context: { user: { credentials: { token: "abc" } } },
      });

      const result = applyRedact(data, {
        paths: ["context.user.credentials.token"],
      });

      expect(result.context).toEqual({
        user: { credentials: { token: "[REDACTED]" } },
      });
    });

    it("ignores paths that don't exist", () => {
      const data = entry({ context: { username: "alice" } });
      const result = applyRedact(data, { paths: ["context.missing.path"] });
      expect(result.context).toEqual({ username: "alice" });
    });

    it("redacts inside the message field when message is an object", () => {
      const data = entry({ message: { apiKey: "abc", op: "send" } });
      const result = applyRedact(data, { paths: ["message.apiKey"] });

      expect(result.message).toEqual({ apiKey: "[REDACTED]", op: "send" });
    });
  });

  describe("single-segment wildcard *", () => {
    it("matches every immediate child", () => {
      const data = entry({
        context: { primary: { token: "a" }, secondary: { token: "b" } },
      });

      const result = applyRedact(data, { paths: ["context.*.token"] });

      expect(result.context).toEqual({
        primary: { token: "[REDACTED]" },
        secondary: { token: "[REDACTED]" },
      });
    });

    it("does not match deeper than one segment", () => {
      const data = entry({
        context: { wrap: { nested: { token: "a" } } },
      });

      const result = applyRedact(data, { paths: ["context.*.token"] });

      // `context.*.token` requires the token to be exactly one level under
      // context — it sits two levels under here, so untouched.
      expect((result.context as any).wrap.nested.token).toBe("a");
    });

    it("matches array elements with *", () => {
      const data = entry({
        context: { users: [{ token: "a" }, { token: "b" }] },
      });

      const result = applyRedact(data, { paths: ["context.users.*.token"] });

      expect((result.context as any).users).toEqual([
        { token: "[REDACTED]" },
        { token: "[REDACTED]" },
      ]);
    });
  });

  describe("multi-segment wildcard **", () => {
    it("matches a leaf at any depth", () => {
      const data = entry({
        context: {
          a: { password: "1" },
          b: { c: { password: "2" } },
          d: { e: { f: { password: "3" } } },
        },
      });

      const result = applyRedact(data, { paths: ["**.password"] });

      expect((result.context as any).a.password).toBe("[REDACTED]");
      expect((result.context as any).b.c.password).toBe("[REDACTED]");
      expect((result.context as any).d.e.f.password).toBe("[REDACTED]");
    });

    it("does not censor non-matching keys at the same depth", () => {
      const data = entry({
        context: { a: { password: "x", username: "y" } },
      });

      const result = applyRedact(data, { paths: ["**.password"] });

      expect((result.context as any).a.username).toBe("y");
    });

    it("recurses through arrays to reach a leaf at any depth", () => {
      const data = entry({
        context: {
          users: [
            { credentials: { token: "a" } },
            { credentials: { token: "b" } },
          ],
        },
      });

      const result = applyRedact(data, { paths: ["**.token"] });

      expect((result.context as any).users[0].credentials.token).toBe("[REDACTED]");
      expect((result.context as any).users[1].credentials.token).toBe("[REDACTED]");
    });
  });

  describe("literal numeric segments (array indexing)", () => {
    it("redacts a specific array index by literal position", () => {
      const data = entry({
        context: { tokens: [{ value: "a" }, { value: "b" }, { value: "c" }] },
      });

      const result = applyRedact(data, { paths: ["context.tokens.1.value"] });

      expect((result.context as any).tokens[0].value).toBe("a");
      expect((result.context as any).tokens[1].value).toBe("[REDACTED]");
      expect((result.context as any).tokens[2].value).toBe("c");
    });

    it("ignores a literal index that is out of bounds", () => {
      const data = entry({ context: { tokens: [{ value: "a" }] } });

      const result = applyRedact(data, { paths: ["context.tokens.5.value"] });

      expect((result.context as any).tokens[0].value).toBe("a");
    });
  });

  describe("censor variants", () => {
    it("uses the literal string censor when supplied", () => {
      const data = entry({ context: { password: "secret" } });
      const result = applyRedact(data, {
        paths: ["context.password"],
        censor: "***",
      });

      expect((result.context as any).password).toBe("***");
    });

    it("calls function censor with original value and dotted path", () => {
      const data = entry({ context: { password: "supersecret" } });
      const seen: { value: any; path: string }[] = [];

      const result = applyRedact(data, {
        paths: ["context.password"],
        censor: (value, path) => {
          seen.push({ value, path });
          return `${String(value).slice(0, 2)}***`;
        },
      });

      expect(seen).toEqual([{ value: "supersecret", path: "context.password" }]);
      expect((result.context as any).password).toBe("su***");
    });
  });

  describe("immutability", () => {
    it("never mutates the input data or its nested objects", () => {
      const original = entry({
        context: { user: { password: "secret", role: "admin" } },
      });
      const userRef = original.context!.user;

      const result = applyRedact(original, { paths: ["context.user.password"] });

      expect(original.context!.user).toBe(userRef);
      expect((original.context as any).user.password).toBe("secret");
      expect(result).not.toBe(original);
      expect((result.context as any).user.password).toBe("[REDACTED]");
    });

    it("preserves Error instances (constructor + message + stack)", () => {
      const err = new Error("kaboom");
      const data = entry({ message: err, context: { token: "x" } });

      const result = applyRedact(data, { paths: ["context.token"] });

      expect(result.message).toBeInstanceOf(Error);
      expect((result.message as Error).message).toBe("kaboom");
      expect((result.message as Error).stack).toBe(err.stack);
    });

    it("preserves Date instances", () => {
      const at = new Date("2024-01-01T00:00:00Z");
      const data = entry({ context: { token: "x", at } });

      const result = applyRedact(data, { paths: ["context.token"] });

      expect((result.context as any).at).toBeInstanceOf(Date);
      expect((result.context as any).at.getTime()).toBe(at.getTime());
      expect((result.context as any).at).not.toBe(at);
    });

    it("survives circular references in context", () => {
      const ctx: any = { name: "alice", token: "x" };
      ctx.self = ctx;
      const data = entry({ context: ctx });

      const result = applyRedact(data, { paths: ["context.token"] });

      expect((result.context as any).token).toBe("[REDACTED]");
      expect((result.context as any).self).toBeDefined();
    });
  });
});

describe("mergeRedact", () => {
  it("returns undefined when both sides are undefined", () => {
    expect(mergeRedact(undefined, undefined)).toBeUndefined();
  });

  it("returns extra when base is undefined", () => {
    const extra: RedactConfig = { paths: ["a"], censor: "X" };
    expect(mergeRedact(undefined, extra)).toBe(extra);
  });

  it("returns base when extra is undefined", () => {
    const base: RedactConfig = { paths: ["a"] };
    expect(mergeRedact(base, undefined)).toBe(base);
  });

  it("concatenates paths from both sides", () => {
    const merged = mergeRedact(
      { paths: ["context.password"] },
      { paths: ["context.email"] },
    );
    expect(merged?.paths).toEqual(["context.password", "context.email"]);
  });

  it("prefers the channel's censor over the base", () => {
    const merged = mergeRedact(
      { paths: ["a"], censor: "BASE" },
      { paths: ["b"], censor: "CHAN" },
    );
    expect(merged?.censor).toBe("CHAN");
  });

  it("falls back to base censor when channel omits one", () => {
    const merged = mergeRedact(
      { paths: ["a"], censor: "BASE" },
      { paths: ["b"] },
    );
    expect(merged?.censor).toBe("BASE");
  });
});
