import config from "@mongez/config";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocaleRoutingConfigError,
  resolveClientLocaleRoutingFallback,
  resolveLocaleRouting,
} from "./resolve-locale-routing";

afterEach(() => {
  config.set("web", {});
  config.set("app", {});
});

describe("resolveLocaleRouting — defaults", () => {
  it("defaults the strategy to none with no app locale config", () => {
    expect(resolveLocaleRouting()).toEqual({ strategy: "none", codes: [], defaultLocale: "" });
  });

  it("reads codes from app.localeCodes and the default from app.localeCode under none", () => {
    config.set("app", { localeCodes: ["en", "ar"], localeCode: "en" });

    expect(resolveLocaleRouting()).toEqual({
      strategy: "none",
      codes: ["en", "ar"],
      defaultLocale: "en",
    });
  });

  it("resolves a valid non-none strategy against app.localeCodes / app.localeCode", () => {
    config.set("web", { localeRouting: { strategy: "prefix-except-default" } });
    config.set("app", { localeCodes: ["en", "ar"], localeCode: "en" });

    expect(resolveLocaleRouting()).toEqual({
      strategy: "prefix-except-default",
      codes: ["en", "ar"],
      defaultLocale: "en",
    });
  });
});

describe("resolveLocaleRouting — invalid strategy", () => {
  it("throws a clear config error for an unknown strategy value", () => {
    config.set("web", { localeRouting: { strategy: "bogus" } });

    expect(() => resolveLocaleRouting()).toThrow(LocaleRoutingConfigError);
    expect(() => resolveLocaleRouting()).toThrow(/localeRouting\.strategy/);
  });
});

describe("resolveLocaleRouting — default not in codes", () => {
  it("throws when a non-none strategy has fewer than one code", () => {
    config.set("web", { localeRouting: { strategy: "prefix" } });
    config.set("app", { localeCodes: [], localeCode: "en" });

    expect(() => resolveLocaleRouting()).toThrow(LocaleRoutingConfigError);
  });

  it("throws when app.localeCode is not one of app.localeCodes", () => {
    config.set("web", { localeRouting: { strategy: "prefix" } });
    config.set("app", { localeCodes: ["en", "ar"], localeCode: "fr" });

    expect(() => resolveLocaleRouting()).toThrow(LocaleRoutingConfigError);
  });
});

describe("resolveClientLocaleRoutingFallback — the build-time client registry", () => {
  it("falls back to none when the app config is not loaded (warlock build), even for a site strategy", () => {
    config.set("app", undefined);

    expect(resolveClientLocaleRoutingFallback({ strategy: "prefix-except-default" })).toEqual({
      strategy: "none",
      codes: [],
      defaultLocale: "",
    });
  });

  it("resolves and validates normally once app.localeCodes is loaded (dev)", () => {
    config.set("app", { localeCodes: ["en", "ar"], localeCode: "en" });

    expect(resolveClientLocaleRoutingFallback({ strategy: "prefix-except-default" })).toEqual({
      strategy: "prefix-except-default",
      codes: ["en", "ar"],
      defaultLocale: "en",
    });
    config.set("app", { localeCodes: [], localeCode: "en" });
    expect(() => resolveClientLocaleRoutingFallback({ strategy: "prefix" })).toThrow(
      LocaleRoutingConfigError,
    );
  });
});

describe("resolveLocaleRouting — a site's own locales", () => {
  const app = { localeCodes: ["en", "ar", "fr"], localeCode: "en" };

  it("narrows codes and keeps the app default when the site serves it", () => {
    config.set("app", app);

    expect(resolveLocaleRouting({ strategy: "prefix", locales: ["en", "ar"] }, "shop")).toEqual({
      strategy: "prefix",
      codes: ["en", "ar"],
      defaultLocale: "en",
    });
  });

  it("uses the site's defaultLocale, or its first locale when the app default is not served", () => {
    config.set("app", app);

    expect(
      resolveLocaleRouting({ strategy: "prefix", locales: ["ar", "fr"] }, "shop").defaultLocale,
    ).toBe("ar");
    expect(
      resolveLocaleRouting(
        { strategy: "prefix", locales: ["ar", "fr"], defaultLocale: "fr" },
        "shop",
      ).defaultLocale,
    ).toBe("fr");
  });

  it("names the site when a locale is not in app.localeCodes", () => {
    config.set("app", app);

    expect(() => resolveLocaleRouting({ locales: ["en", "de"] }, "shop")).toThrow(
      /web\.sites\.shop\.localeRouting\.locales lists "de"/,
    );
    expect(() => resolveLocaleRouting({ locales: ["en"], defaultLocale: "ar" }, "shop")).toThrow(
      /web\.sites\.shop\.localeRouting\.defaultLocale is "ar"/,
    );
  });

  it("leaves a site without the options exactly as before", () => {
    config.set("app", app);

    expect(resolveLocaleRouting({ strategy: "prefix" }, "shop")).toEqual({
      strategy: "prefix",
      codes: ["en", "ar", "fr"],
      defaultLocale: "en",
    });
  });
});
