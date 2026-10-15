import config from "@mongez/config";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyCspHeader,
  buildCspHeaderValue,
  InvalidCspDirectiveError,
  mergeCspDirectives,
  validateCspConfigAtBoot,
  validateCspDirectives,
} from "./csp";
import { Request } from "./request";
import { Response } from "./response";

/** A `Response` whose `header()` calls are observable without a real Fastify reply. */
function createResponse() {
  const headers: Record<string, string> = {};
  const response = new Response();

  response.setResponse({
    header: (name: string, value: string) => {
      headers[name] = value;
    },
    getHeader: (name: string) => headers[name],
    raw: { once: () => {} },
  } as never);

  return { response, headers };
}

describe("csp — merging and serialization", () => {
  it("builds the documented default policy plus the request's nonce on script-src", () => {
    const value = buildCspHeaderValue({ enabled: true }, "abc123");

    expect(value).toBe(
      "default-src 'self'; script-src 'self' 'nonce-abc123'; style-src 'self'; " +
        "img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
    );
  });

  it("replaces (not merges) a directive the app names, keeping every other default", () => {
    const merged = mergeCspDirectives({ "img-src": ["'self'", "https://cdn.example.com"] }, "n1");

    expect(merged["img-src"]).toEqual(["'self'", "https://cdn.example.com"]);
    expect(merged["default-src"]).toEqual(["'self'"]);
  });

  it("always appends the nonce to script-src, even when the app supplies its own script-src", () => {
    const merged = mergeCspDirectives({ "script-src": ["'self'", "https://js.example.com"] }, "n2");

    expect(merged["script-src"]).toEqual(["'self'", "https://js.example.com", "'nonce-n2'"]);
  });

  it("carries an app directive that has no framework default through untouched", () => {
    const merged = mergeCspDirectives(
      { "connect-src": ["'self'", "https://api.example.com"] },
      "n3",
    );

    expect(merged["connect-src"]).toEqual(["'self'", "https://api.example.com"]);
  });
});

describe("csp — validation", () => {
  it("accepts well-formed directives", () => {
    expect(() =>
      validateCspDirectives({ "img-src": ["'self'", "data:", "https://cdn.example.com"] }),
    ).not.toThrow();
  });

  it("rejects a value containing ';'", () => {
    expect(() => validateCspDirectives({ "script-src": ["'self'; evil-directive"] })).toThrowError(
      InvalidCspDirectiveError,
    );
  });

  it("rejects a value with an unbalanced quote", () => {
    expect(() => validateCspDirectives({ "script-src": ["'self"] })).toThrowError(
      InvalidCspDirectiveError,
    );
  });

  it("names the offending directive and value on the thrown error", () => {
    try {
      validateCspDirectives({ "style-src": ["'self"] });
      throw new Error("expected validateCspDirectives to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidCspDirectiveError);
      expect((error as InvalidCspDirectiveError).directive).toBe("style-src");
      expect((error as InvalidCspDirectiveError).value).toBe("'self");
    }
  });
});

describe("csp — applyCspHeader (the response-path integration)", () => {
  afterEach(() => {
    config.set("http", {});
  });

  it("sets no header at all when http.csp is unset", () => {
    config.set("http", {});

    const { response, headers } = createResponse();
    applyCspHeader(new Request(), response);

    expect(headers["Content-Security-Policy"]).toBeUndefined();
    expect(headers["Content-Security-Policy-Report-Only"]).toBeUndefined();
  });

  it("sets no header when http.csp.enabled is false", () => {
    config.set("http", { csp: { enabled: false } });

    const { response, headers } = createResponse();
    applyCspHeader(new Request(), response);

    expect(headers["Content-Security-Policy"]).toBeUndefined();
  });

  it("sets Content-Security-Policy with a script-src nonce when enabled", () => {
    config.set("http", { csp: { enabled: true } });

    const { response, headers } = createResponse();
    const request = new Request();
    applyCspHeader(request, response);

    expect(headers["Content-Security-Policy"]).toContain(`'nonce-${request.nonce}'`);
  });

  it("gives two different requests two different nonces in their headers", () => {
    config.set("http", { csp: { enabled: true } });

    const first = createResponse();
    const firstRequest = new Request();
    applyCspHeader(firstRequest, first.response);

    const second = createResponse();
    const secondRequest = new Request();
    applyCspHeader(secondRequest, second.response);

    expect(first.headers["Content-Security-Policy"]).not.toBe(
      second.headers["Content-Security-Policy"],
    );
  });

  it("emits Content-Security-Policy-Report-Only instead, when reportOnly is set", () => {
    config.set("http", { csp: { enabled: true, reportOnly: true } });

    const { response, headers } = createResponse();
    applyCspHeader(new Request(), response);

    expect(headers["Content-Security-Policy"]).toBeUndefined();
    expect(headers["Content-Security-Policy-Report-Only"]).toBeDefined();
  });
});

describe("csp — validateCspConfigAtBoot", () => {
  afterEach(() => {
    config.set("http", {});
  });

  it("throws InvalidCspDirectiveError at boot for a malformed directive, without needing a request", () => {
    config.set("http", { csp: { enabled: true, directives: { "script-src": ["'self"] } } });

    expect(() => validateCspConfigAtBoot()).toThrowError(InvalidCspDirectiveError);
  });

  it("does not validate (and does not throw) when csp is disabled, even with a malformed directive", () => {
    config.set("http", { csp: { enabled: false, directives: { "script-src": ["'self"] } } });

    expect(() => validateCspConfigAtBoot()).not.toThrow();
  });
});
