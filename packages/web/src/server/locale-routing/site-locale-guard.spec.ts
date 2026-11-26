import { describe, expect, it, vi } from "vitest";
import type { HttpContext } from "@warlock.js/core";
import {
  notFoundLocaleCodes,
  restrictToSiteLocales,
  siteDeclaresLocales,
} from "./site-locale-guard";

const routing = {
  strategy: "prefix-except-default",
  codes: ["en", "ar"],
  defaultLocale: "en",
} as const;

describe("notFoundLocaleCodes", () => {
  it("is undefined under none and the routing's codes otherwise", () => {
    expect(notFoundLocaleCodes({ ...routing, strategy: "none" })).toBeUndefined();
    expect(notFoundLocaleCodes(routing)).toEqual(["en", "ar"]);
  });
});

describe("restrictToSiteLocales", () => {
  it("returns the handler itself for a site without its own locales", () => {
    const handler = vi.fn();

    expect(restrictToSiteLocales(handler, routing, undefined)).toBe(handler);
    expect(restrictToSiteLocales(handler, routing, { strategy: "prefix" } as never)).toBe(handler);
    expect(siteDeclaresLocales({})).toBe(false);
  });

  it("falls back to the site default for a locale outside the site's set", async () => {
    const handler = vi.fn(async () => undefined);
    const wrapped = restrictToSiteLocales(handler, routing, { locales: ["en", "ar"] });
    const outside = { locale: "fr" };
    const inside = { locale: "ar" };

    await wrapped({ request: outside } as unknown as HttpContext);
    await wrapped({ request: inside } as unknown as HttpContext);

    expect(outside.locale).toBe("en");
    expect(inside.locale).toBe("ar");
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
