/**
 * Request locale order: `?locale=`, the preference cookie (only when it is in
 * `app.localeCodes`), the `locale` header, the `locale` cookie, then the
 * default. Every adjacent pair is pinned so the docs cannot drift from it.
 */
import config from "@mongez/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request } from "./request";

function localeOf(sources: {
  query?: string;
  preference?: string;
  header?: string;
  cookie?: string;
}) {
  const cookies: Record<string, string> = {};

  if (sources.preference) cookies["warlock.locale-preference"] = sources.preference;
  if (sources.cookie) cookies.locale = sources.cookie;

  const request = new Request();

  request.setRequest({
    method: "GET",
    url: "/x",
    headers: sources.header ? { locale: sources.header } : {},
    body: undefined,
    query: sources.query ? { locale: sources.query } : {},
    params: {},
    cookies,
  } as never);

  return request.locale;
}

describe("request locale resolution order", () => {
  beforeEach(() => {
    config.set("app.localeCode", "en");
    config.set("app.localeCodes", ["en", "ar", "fr", "de"]);
  });

  afterEach(() => {
    config.set("app.localeCode", undefined);
    config.set("app.localeCodes", undefined);
  });

  it("query beats the preference cookie", () => {
    expect(localeOf({ query: "fr", preference: "ar" })).toBe("fr");
  });

  it("preference cookie beats the header", () => {
    expect(localeOf({ preference: "ar", header: "fr" })).toBe("ar");
  });

  it("header beats the locale cookie", () => {
    expect(localeOf({ header: "ar", cookie: "en" })).toBe("ar");
  });

  it("locale cookie beats the default", () => {
    expect(localeOf({ cookie: "fr" })).toBe("fr");
  });

  it("falls back to the default", () => {
    expect(localeOf({})).toBe("en");
  });

  it("skips a preference cookie outside app.localeCodes", () => {
    expect(localeOf({ preference: "zz", header: "de" })).toBe("de");
  });

  it("a value outside app.localeCodes falls back to the default", () => {
    expect(localeOf({ header: "zz" })).toBe("en");
  });
});
