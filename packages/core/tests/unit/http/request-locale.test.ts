import config from "@mongez/config";
import { groupedTranslations } from "@mongez/localization";
import { beforeEach, describe, expect, it } from "vitest";
import { Request } from "../../../src/http/request";

/**
 * Locale handling — the two shipped-core defects surfaced by the C3 locale
 * ruling, as failing-first tests:
 *
 * 1. VALIDATION — a client-supplied locale (header or query) outside
 *    `app.localeCodes` must be treated as ABSENT, never used as-is. It steers
 *    every `request.trans()` string and every serialized Resource, so a
 *    forged value must fall through to the default. (Old behavior: the raw
 *    client value won.)
 *
 * 2. ORDERING — `setRequest` runs before routing, so the translator must
 *    resolve the locale at CALL time. A locale set after construction
 *    (path locale, `setLocaleCode`) must win in `request.t()` too. (Old
 *    behavior: `transFrom.bind(null, localeCode)` snapshotted the
 *    pre-routing locale for the request's whole lifetime.)
 *
 * The red-control for both runs in the batch verification pass: the same
 * tests against the pre-batch `request.ts` bytes must FAIL.
 */

groupedTranslations("localeProbe", {
  hello: {
    en: "Hello",
    ar: "Ahlan",
  },
});

function makeFastifyShaped(input?: {
  headers?: Record<string, string>;
  query?: Record<string, string>;
}) {
  return {
    body: {},
    query: input?.query ?? {},
    params: {},
    headers: input?.headers ?? {},
  } as never;
}

describe("request locale validation (app.localeCodes allow-list)", () => {
  beforeEach(() => {
    config.set("app", { localeCode: "en", localeCodes: ["en", "ar"] });
  });

  it("treats an unsupported query locale as absent — the default wins", () => {
    const request = new Request().setRequest(makeFastifyShaped({ query: { locale: "xx" } }));

    expect(request.getLocaleCode()).toBe("en");
  });

  it("treats an unsupported `locale` header as absent — the default wins", () => {
    const request = new Request().setRequest(makeFastifyShaped({ headers: { locale: "zz" } }));

    expect(request.getLocaleCode()).toBe("en");
  });

  it("treats an unsupported `translation-locale-code` header as absent", () => {
    const request = new Request().setRequest(
      makeFastifyShaped({ headers: { "translation-locale-code": "qq" } }),
    );

    expect(request.getLocaleCode()).toBe("en");
  });

  it("accepts a supported client locale", () => {
    const request = new Request().setRequest(makeFastifyShaped({ query: { locale: "ar" } }));

    expect(request.getLocaleCode()).toBe("ar");
  });

  it("passes client locales through unchanged when the app declares no allow-list", () => {
    config.set("app", { localeCode: "en" });

    const request = new Request().setRequest(makeFastifyShaped({ query: { locale: "fr" } }));

    expect(request.getLocaleCode()).toBe("fr");
  });

  it("never lets a forged locale steer translations", () => {
    const request = new Request().setRequest(makeFastifyShaped({ query: { locale: "xx" } }));

    expect(request.t("localeProbe.hello")).toBe("Hello");
  });
});

describe("request translator resolves the locale at call time", () => {
  beforeEach(() => {
    config.set("app", { localeCode: "en", localeCodes: ["en", "ar"] });
  });

  it("a locale set AFTER setRequest steers request.t()", () => {
    const request = new Request().setRequest(makeFastifyShaped());

    expect(request.t("localeProbe.hello")).toBe("Hello");

    request.setLocaleCode("ar");

    expect(request.t("localeProbe.hello")).toBe("Ahlan");
  });

  it("request.locale and request.t() agree after a late locale set", () => {
    const request = new Request().setRequest(makeFastifyShaped());

    request.setLocaleCode("ar");

    expect(request.locale).toBe("ar");
    expect(request.t("localeProbe.hello")).toBe("Ahlan");
  });
});
