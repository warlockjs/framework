/**
 * Cookie jar availability (`CookieJarUnavailableError`).
 *
 * `baseRequest.cookies` is `undefined` when `@fastify/cookie` was never
 * registered on the Fastify instance, and `{}` (or populated) once it is.
 * `get cookies()` stays lenient either way so the framework's own
 * opportunistic reads (e.g. `resolveLocale()`) never throw, but a deliberate
 * by-name read via `cookie()` / `hasCookie()` must fail loudly when the jar
 * itself is unavailable — that is a configuration fault, not an absent
 * cookie.
 */
import { describe, expect, it } from "vitest";
import { CookieJarUnavailableError } from "./errors";
import { Request } from "./request";

function createRequestWithCookies(cookies: Record<string, string> | undefined) {
  const request = new Request();

  request.setRequest({
    method: "GET",
    url: "/things/42",
    headers: {},
    body: undefined,
    query: {},
    params: {},
    cookies,
  } as never);

  return request;
}

describe("cookie jar missing (@fastify/cookie not registered)", () => {
  it("cookie() throws CookieJarUnavailableError naming the cookie, not the default", () => {
    const request = createRequestWithCookies(undefined);

    expect(() => request.cookie("token", "fallback")).toThrow(CookieJarUnavailableError);
    expect(() => request.cookie("token", "fallback")).toThrow(/token/);
    expect(() => request.cookie("token", "fallback")).toThrow(/@fastify\/cookie/);
  });

  it("hasCookie() throws CookieJarUnavailableError", () => {
    const request = createRequestWithCookies(undefined);

    expect(() => request.hasCookie("token")).toThrow(CookieJarUnavailableError);
    expect(() => request.hasCookie("token")).toThrow(/token/);
  });
});

describe("cookie jar present", () => {
  it("cookie() returns the default when the named cookie is absent", () => {
    const request = createRequestWithCookies({});

    expect(request.cookie("token", "fallback")).toBe("fallback");
  });

  it("hasCookie() returns false when the named cookie is absent", () => {
    const request = createRequestWithCookies({});

    expect(request.hasCookie("token")).toBe(false);
  });

  it("cookie() returns the value when the named cookie is present", () => {
    const request = createRequestWithCookies({ token: "abc123" });

    expect(request.cookie("token")).toBe("abc123");
  });

  it("hasCookie() returns true when the named cookie is present", () => {
    const request = createRequestWithCookies({ token: "abc123" });

    expect(request.hasCookie("token")).toBe(true);
  });
});

describe("resolveLocale() regression guard — no jar must not throw", () => {
  it("locale resolves from query/header without throwing when the cookie jar is unavailable", () => {
    const request = createRequestWithCookies(undefined);

    expect(() => request.locale).not.toThrow();
    expect(typeof request.locale).toBe("string");
  });
});
