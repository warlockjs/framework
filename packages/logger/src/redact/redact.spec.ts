import { describe, expect, it } from "vitest";
import type { LoggingData, RedactConfig } from "../types";
import { DEFAULT_REDACT_KEY_SET, DEFAULT_REDACT_KEYS, normalizeRedactKey } from "./default-keys";
import { applyRedact, mergeRedact, resolveRedactKeys } from "./redact";

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
    it("returns the input by reference when nothing matches", () => {
      const data = entry({ context: { role: "admin" } });
      const result = applyRedact(data, undefined);
      expect(result).toBe(data);
    });

    it("returns the input by reference when paths is empty and no key matches", () => {
      const data = entry({ context: { role: "admin" } });
      const result = applyRedact(data, { paths: [] });
      expect(result).toBe(data);
    });

    it("returns the input by reference when defaults are opted out", () => {
      const data = entry({ context: { password: "secret" } });
      const result = applyRedact(data, { paths: [], defaultKeys: false });
      expect(result).toBe(data);
      expect((result.context as any).password).toBe("secret");
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
      // Deliberately non-secret key names — this asserts *path* semantics, so
      // the default key denylist is kept out of the picture.
      const data = entry({
        context: { user: { profile: { handle: "alice" } } },
      });

      const result = applyRedact(data, {
        paths: ["context.user.profile.handle"],
      });

      expect(result.context).toEqual({
        user: { profile: { handle: "[REDACTED]" } },
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
        context: { wrap: { nested: { handle: "a" } } },
      });

      const result = applyRedact(data, { paths: ["context.*.handle"] });

      // `context.*.handle` requires the leaf to be exactly one level under
      // context — it sits two levels under here, so untouched.
      expect((result.context as any).wrap.nested.handle).toBe("a");
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
          users: [{ profile: { handle: "a" } }, { profile: { handle: "b" } }],
        },
      });

      const result = applyRedact(data, { paths: ["**.handle"] });

      expect((result.context as any).users[0].profile.handle).toBe("[REDACTED]");
      expect((result.context as any).users[1].profile.handle).toBe("[REDACTED]");
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

describe("default key denylist", () => {
  describe("with no configuration at all", () => {
    it.each([
      "password",
      "passwd",
      "passphrase",
      "passwordHash",
      "secret",
      "clientSecret",
      "token",
      "accessToken",
      "refreshToken",
      "apiKey",
      "privateKey",
      "authorization",
      "cookie",
      "sessionId",
      "jwt",
      "creditCard",
      "cvv",
      "ssn",
    ])("censors context.%s", (key) => {
      const data = entry({ context: { [key]: "leak-me", role: "admin" } });
      const result = applyRedact(data, undefined);

      expect((result.context as any)[key]).toBe("[REDACTED]");
      // Non-secret siblings are untouched — redaction must not cost
      // debuggability.
      expect((result.context as any).role).toBe("admin");
    });

    it.each([
      ["api_key", "apiKey snake_case"],
      ["API-KEY", "apiKey screaming-kebab"],
      ["Api Key", "apiKey spaced"],
      ["x-api-key", "the x-api-key header"],
      ["Authorization", "capitalized header"],
      ["set-cookie", "the set-cookie header"],
      ["refresh_token", "snake_case token"],
    ])("matches %s (%s) case- and separator-insensitively", (key) => {
      const data = entry({ context: { [key]: "leak-me" } });
      const result = applyRedact(data, undefined);

      expect((result.context as any)[key]).toBe("[REDACTED]");
    });

    it("censors at any nesting depth", () => {
      const data = entry({
        context: { req: { headers: { authorization: "Bearer sk_live_x" } } },
      });

      const result = applyRedact(data, undefined);

      expect((result.context as any).req.headers.authorization).toBe(
        "[REDACTED]",
      );
    });

    it("censors through arrays", () => {
      const data = entry({
        context: { users: [{ password: "a" }, { password: "b" }] },
      });

      const result = applyRedact(data, undefined);

      expect((result.context as any).users[0].password).toBe("[REDACTED]");
      expect((result.context as any).users[1].password).toBe("[REDACTED]");
    });

    it("censors inside an object message, not just context", () => {
      const data = entry({ message: { op: "send", apiKey: "sk_live_x" } });
      const result = applyRedact(data, undefined);

      expect(result.message).toEqual({ op: "send", apiKey: "[REDACTED]" });
    });

    it("censors the whole value when a secret container key matches", () => {
      const data = entry({ context: { credentials: { user: "a", pass: "b" } } });
      const result = applyRedact(data, undefined);

      expect((result.context as any).credentials).toBe("[REDACTED]");
    });

    it("does not censor lookalike keys (exact match, not substring)", () => {
      const data = entry({
        context: {
          tokenCount: 12,
          passwordUpdatedAt: "2026-01-01",
          publicKey: "pk_live_x",
          secretsLoaded: true,
        },
      });

      const result = applyRedact(data, undefined);

      expect(result.context).toEqual({
        tokenCount: 12,
        passwordUpdatedAt: "2026-01-01",
        publicKey: "pk_live_x",
        secretsLoaded: true,
      });
    });

    it("never mutates the caller's object", () => {
      const context = { password: "secret" };
      const data = entry({ context });

      const result = applyRedact(data, undefined);

      expect(context.password).toBe("secret");
      expect((result.context as any).password).toBe("[REDACTED]");
    });

    it("survives circular references", () => {
      const context: any = { name: "alice", password: "secret" };
      context.self = context;

      const result = applyRedact(entry({ context }), undefined);

      expect((result.context as any).password).toBe("[REDACTED]");
      // The cycle is rebuilt against the *redacted* copy, not the original —
      // otherwise the secret would still be reachable via `.self.password`.
      expect((result.context as any).self).toBe(result.context);
      expect((result.context as any).self.password).toBe("[REDACTED]");
    });
  });

  describe("Error payloads", () => {
    it("censors a secret carried on an Error's own enumerable props", () => {
      // The axios/got shape from the audit: the failed request's outgoing
      // Authorization header rides along on the thrown Error.
      const error = new Error("Request failed with status code 401");
      (error as any).config = {
        url: "https://api.stripe.com/v1/charges",
        headers: { Authorization: "Bearer sk_live_leak" },
      };
      (error as any).code = "ERR_BAD_REQUEST";

      const result = applyRedact(entry({ message: error }), undefined);
      const censored = result.message as any;

      expect(censored).toBeInstanceOf(Error);
      expect(censored.config.headers.Authorization).toBe("[REDACTED]");
      // Non-secret error metadata survives — this is redaction, not deletion.
      expect(censored.code).toBe("ERR_BAD_REQUEST");
      expect(censored.config.url).toBe("https://api.stripe.com/v1/charges");
      expect(censored.message).toBe("Request failed with status code 401");
      expect(censored.stack).toBe(error.stack);
    });

    it("leaves the original Error untouched", () => {
      const error = new Error("boom");
      (error as any).apiKey = "sk_live_leak";

      applyRedact(entry({ message: error }), undefined);

      expect((error as any).apiKey).toBe("sk_live_leak");
    });

    it("returns the Error by reference when it carries no secret", () => {
      const error = new Error("boom");
      const data = entry({ message: error });

      expect(applyRedact(data, undefined).message).toBe(error);
    });

    it("falls back to a plain Error when a subclass constructor rejects the shape", () => {
      class PickyError extends Error {
        public constructor(payload: { detail: string }) {
          super(payload.detail);
        }
      }

      const error = new PickyError({ detail: "nope" });
      (error as any).token = "leak";

      const result = applyRedact(entry({ message: error }), undefined);

      expect(result.message).toBeInstanceOf(Error);
      expect((result.message as any).token).toBe("[REDACTED]");
      expect((result.message as Error).message).toBe("nope");
    });
  });

  describe("opting out", () => {
    it("defaultKeys: false disables the built-in set", () => {
      const data = entry({ context: { password: "secret", token: "t" } });
      const result = applyRedact(data, { defaultKeys: false });

      expect((result.context as any).password).toBe("secret");
      expect((result.context as any).token).toBe("t");
    });

    it("defaultKeys: false still honours explicit paths", () => {
      const data = entry({ context: { password: "secret", token: "t" } });
      const result = applyRedact(data, {
        defaultKeys: false,
        paths: ["context.token"],
      });

      expect((result.context as any).password).toBe("secret");
      expect((result.context as any).token).toBe("[REDACTED]");
    });

    it("defaultKeys: false still honours explicit keys", () => {
      const data = entry({ context: { password: "secret", internalRef: "r" } });
      const result = applyRedact(data, {
        defaultKeys: false,
        keys: ["internalRef"],
      });

      expect((result.context as any).password).toBe("secret");
      expect((result.context as any).internalRef).toBe("[REDACTED]");
    });
  });

  describe("extending", () => {
    it("keys extend the default set rather than replacing it", () => {
      const data = entry({
        context: { password: "secret", internalRef: "r", role: "admin" },
      });

      const result = applyRedact(data, { keys: ["internalRef"] });

      expect((result.context as any).password).toBe("[REDACTED]");
      expect((result.context as any).internalRef).toBe("[REDACTED]");
      expect((result.context as any).role).toBe("admin");
    });

    it("added keys are matched with the same normalization", () => {
      const data = entry({ context: { internal_ref: "r", "INTERNAL-REF": "r" } });
      const result = applyRedact(data, { keys: ["internalRef"] });

      expect((result.context as any).internal_ref).toBe("[REDACTED]");
      expect((result.context as any)["INTERNAL-REF"]).toBe("[REDACTED]");
    });

    it("coexists with paths — both matchers apply", () => {
      const data = entry({ context: { password: "p", email: "x@y.com" } });
      const result = applyRedact(data, { paths: ["context.email"] });

      expect((result.context as any).password).toBe("[REDACTED]");
      expect((result.context as any).email).toBe("[REDACTED]");
    });
  });

  describe("censor interaction", () => {
    it("uses a custom string censor for default-key matches", () => {
      const data = entry({ context: { password: "secret" } });
      const result = applyRedact(data, { censor: "***" });

      expect((result.context as any).password).toBe("***");
    });

    it("passes the original value and dotted path to a function censor", () => {
      const seen: { value: any; path: string }[] = [];
      const data = entry({ context: { user: { apiKey: "sk_live_1234" } } });

      applyRedact(data, {
        censor: (value, path) => {
          seen.push({ value, path });
          return "x";
        },
      });

      expect(seen).toEqual([
        { value: "sk_live_1234", path: "context.user.apiKey" },
      ]);
    });

    it("does not double-apply a function censor already applied by a path", () => {
      // Paths run first so the censor sees the raw value; the key pass must
      // then leave that leaf alone rather than censoring the mask.
      let calls = 0;
      const data = entry({ context: { password: "supersecret" } });

      const result = applyRedact(data, {
        paths: ["context.password"],
        censor: (value) => {
          calls++;
          return `${String(value).slice(0, 2)}***`;
        },
      });

      expect(calls).toBe(1);
      expect((result.context as any).password).toBe("su***");
    });
  });

  describe("opaque values", () => {
    it("passes buffers through by reference instead of expanding them", () => {
      const payload = Buffer.from("binary");
      const data = entry({ context: { payload, password: "secret" } });

      const result = applyRedact(data, undefined);

      expect((result.context as any).payload).toBe(payload);
      expect((result.context as any).password).toBe("[REDACTED]");
    });

    it("passes Maps through by reference (their contents are not reachable)", () => {
      // Documented residual gap: a secret inside a Map is not redacted.
      const map = new Map([["password", "secret"]]);
      const data = entry({ context: { map } });

      const result = applyRedact(data, undefined);

      expect((result.context as any).map).toBe(map);
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

  it("concatenates keys from both sides", () => {
    const merged = mergeRedact({ keys: ["baseKey"] }, { keys: ["chanKey"] });
    expect(merged?.keys).toEqual(["baseKey", "chanKey"]);
  });

  describe("defaultKeys is additive-only", () => {
    it("a channel cannot disable a logger-wide default", () => {
      const merged = mergeRedact({ paths: [] }, { defaultKeys: false });
      expect(resolveRedactKeys(merged)).toBe(DEFAULT_REDACT_KEY_SET);
    });

    it("a channel cannot disable the default when there is no logger config", () => {
      // The absent-base shortcut must not hand back the channel's opt-out
      // verbatim — no config means the denylist is on.
      const merged = mergeRedact(undefined, { defaultKeys: false });
      expect(merged?.defaultKeys).toBe(true);
      expect(resolveRedactKeys(merged)).toBe(DEFAULT_REDACT_KEY_SET);
    });

    it("a channel can re-enable defaults the logger opted out of", () => {
      const merged = mergeRedact({ defaultKeys: false }, { defaultKeys: true });
      expect(merged?.defaultKeys).toBe(true);
    });

    it("a silent channel inherits the logger's opt-out", () => {
      const merged = mergeRedact({ defaultKeys: false }, { paths: ["a"] });
      expect(merged?.defaultKeys).toBe(false);
      expect(resolveRedactKeys(merged)).toBeUndefined();
    });
  });
});

describe("resolveRedactKeys", () => {
  it("returns the built-in set for an absent config", () => {
    expect(resolveRedactKeys(undefined)).toBe(DEFAULT_REDACT_KEY_SET);
  });

  it("returns undefined when defaults are off and nothing was added", () => {
    expect(resolveRedactKeys({ defaultKeys: false })).toBeUndefined();
  });

  it("unions defaults with the config's own keys", () => {
    const resolved = resolveRedactKeys({ keys: ["internalRef"] })!;

    expect(resolved.has("password")).toBe(true);
    expect(resolved.has("internalref")).toBe(true);
  });

  it("caches the resolved set per config object", () => {
    const config = { keys: ["internalRef"] };
    expect(resolveRedactKeys(config)).toBe(resolveRedactKeys(config));
  });
});

describe("normalizeRedactKey", () => {
  it.each([
    ["apiKey", "apikey"],
    ["api_key", "apikey"],
    ["API-KEY", "apikey"],
    ["x-api-key", "xapikey"],
    ["Set-Cookie", "setcookie"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeRedactKey(input)).toBe(expected);
  });
});

describe("DEFAULT_REDACT_KEYS", () => {
  it("covers the credential families the audit called out", () => {
    const normalized = new Set(DEFAULT_REDACT_KEYS.map(normalizeRedactKey));

    for (const key of [
      "password",
      "secret",
      "token",
      "apikey",
      "authorization",
      "cookie",
      "accesstoken",
      "refreshtoken",
      "clientsecret",
      "privatekey",
      "sessionid",
      "creditcard",
      "ssn",
    ]) {
      expect(normalized.has(key)).toBe(true);
    }
  });

  it("excludes keys too generic to redact safely", () => {
    const normalized = new Set(DEFAULT_REDACT_KEYS.map(normalizeRedactKey));

    for (const key of ["key", "auth", "id", "hash", "signature", "name"]) {
      expect(normalized.has(key)).toBe(false);
    }
  });
});
