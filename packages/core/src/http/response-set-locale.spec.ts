import config from "@mongez/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnknownLocaleError } from "../errors/unknown-locale-error";
import { Request } from "./request";
import { Response } from "./response";

/**
 * `response.setLocale(locale)` — the framework owns the cookie name
 * `request.locale` reads, so an app never hardcodes it.
 *
 * `createResponse` captures whatever `response.cookie()` actually hands
 * Fastify's `setCookie`, and `createRequest` feeds that BACK through
 * `Request`'s own reading path (`request.locale`, never a re-implemented
 * lookup). Neither helper hardcodes the cookie's name anywhere — the name
 * only ever comes from what `setLocale` itself wrote. That is what makes
 * "the drift test" below different from asserting the same literal twice:
 * if `Response.setLocale` and `Request.resolveLocale` ever stop agreeing on
 * `LOCALE_COOKIE_NAME` (one renamed, the other not), the cookie this test
 * captures from the writer lands under a key the reader no longer looks at,
 * `request.locale` falls back to the configured default instead of the
 * value that was set, and the assertion fails — without this spec ever
 * naming the cookie itself.
 */

function createResponse() {
  const setCookie = vi.fn();
  const clearCookie = vi.fn();
  const response = new Response();

  response.setResponse({ setCookie, clearCookie, raw: { once: vi.fn() } } as never);

  return { response, setCookie, clearCookie };
}

/** What `Request` expects `setRequest`'s argument to look like. */
function makeFastifyShaped(cookies: Record<string, string>) {
  return {
    body: {},
    query: {},
    params: {},
    headers: {},
    cookies,
  } as never;
}

describe("response.setLocale / request.locale — shared cookie name", () => {
  beforeEach(() => {
    config.set("app", { localeCode: "en", localeCodes: ["en", "ar"] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    config.set("http.cookies.options", {});
  });

  it("round-trips through the REAL writer and the REAL reader — the drift control", () => {
    const { response, setCookie } = createResponse();

    response.setLocale("ar");

    // Read back exactly what the writer emitted — name, value, and nothing
    // assumed about either.
    expect(setCookie).toHaveBeenCalledTimes(1);
    const [writtenName, writtenValue] = setCookie.mock.calls[0];
    expect(writtenValue).toBe("ar");

    // Feed it through the real reader as an incoming cookie, under whatever
    // name the writer actually used.
    const request = new Request().setRequest(makeFastifyShaped({ [writtenName]: writtenValue }));

    expect(request.locale).toBe("ar");
  });

  it("a cookie named anything OTHER than what the writer used is invisible to the reader (proves the round-trip above is not vacuous)", () => {
    const { response, setCookie } = createResponse();

    response.setLocale("ar");

    const [writtenName] = setCookie.mock.calls[0];

    // Deliberately wrong key — simulates the reader and writer disagreeing.
    const request = new Request().setRequest(
      makeFastifyShaped({ [`${writtenName}-drifted`]: "ar" }),
    );

    // No cookie under the name the reader actually looks up ⇒ falls back to
    // the configured default, not "ar". This is the failure a real drift
    // would produce.
    expect(request.locale).toBe("en");
  });

  it("writes the cookie raw (no JSON quoting), matching how the reader consumes it", () => {
    const { response, setCookie } = createResponse();

    response.setLocale("ar");

    expect(setCookie.mock.calls[0][1]).toBe("ar");
  });

  it("clears the host-only JS preference before writing the authoritative locale cookie", () => {
    const { response, clearCookie, setCookie } = createResponse();
    config.set("http.cookies.options", { domain: ".example.test" });

    response.setLocale("ar");

    expect(clearCookie).toHaveBeenCalledWith("warlock.locale-preference", {
      path: "/",
      sameSite: "lax",
      httpOnly: false,
      domain: undefined,
    });
    expect(clearCookie.mock.invocationCallOrder[0]).toBeLessThan(
      setCookie.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("resolves query, preference, legacy cookie, then header in that order", () => {
    const preferenceOnly = new Request().setRequest({
      ...makeFastifyShaped({ "warlock.locale-preference": "ar", locale: "en" }),
      headers: { locale: "en" },
    } as never);
    const queryWins = new Request().setRequest({
      ...makeFastifyShaped({ "warlock.locale-preference": "ar", locale: "en" }),
      query: { locale: "en" },
      headers: { locale: "ar" },
    } as never);

    expect(preferenceOnly.locale).toBe("ar");
    expect(queryWins.locale).toBe("en");
  });

  it("keeps preference values behind the configured locale allow-list", () => {
    const request = new Request().setRequest(
      makeFastifyShaped({ "warlock.locale-preference": "fr", locale: "ar" }),
    );

    expect(request.locale).toBe("en");
  });

  it("throws UnknownLocaleError, naming what was given and what is configured, for a locale outside app.localeCodes", () => {
    const { response, clearCookie } = createResponse();

    expect(() => response.setLocale("fr")).toThrowError(UnknownLocaleError);

    try {
      response.setLocale("fr");
      throw new Error("expected setLocale to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownLocaleError);
      expect((error as Error).message).toContain("fr");
      expect((error as Error).message).toContain("en");
      expect((error as Error).message).toContain("ar");
    }
    expect(clearCookie).not.toHaveBeenCalled();
  });

  it("passes any locale through when the app declares no app.localeCodes allow-list", () => {
    config.set("app", { localeCode: "en" });

    const { response, setCookie } = createResponse();

    expect(() => response.setLocale("fr")).not.toThrow();
    expect(setCookie.mock.calls[0][1]).toBe("fr");
  });
});
