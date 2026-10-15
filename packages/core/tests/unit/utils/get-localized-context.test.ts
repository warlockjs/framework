import { describe, expect, it } from "vitest";
import { requestContext } from "../../../src/http/context/request-context";
import { getLocalized, type LocalizedObject } from "../../../src/utils/get-localized";

/**
 * Covers the request-context branch of getLocalized: when no explicit locale is
 * passed, it reads the active request's locale via `useRequestStore()`. We drive
 * the AsyncLocalStorage directly with `requestContext.run(...)` so a fake request
 * supplies the locale. Source: core/src/utils/get-localized.ts:16.
 */
const values: LocalizedObject[] = [
  { localeCode: "en", value: "Hello" },
  { localeCode: "ar", value: "مرحبا" },
];

function withLocale<T>(localeCode: string | undefined, callback: () => T): Promise<T> {
  const request = { getLocaleCode: () => localeCode } as never;

  return requestContext.run({ request } as never, async () => callback());
}

describe("getLocalized — request-context locale resolution", () => {
  it("uses the active request's locale when none is passed", async () => {
    const value = await withLocale("ar", () => getLocalized(values));

    expect(value).toBe("مرحبا");
  });

  it("falls back to the request locale only when the argument is omitted", async () => {
    // An explicit locale argument always wins over the context locale.
    const value = await withLocale("ar", () => getLocalized(values, "en"));

    expect(value).toBe("Hello");
  });

  it("returns undefined when the request locale matches no entry", async () => {
    const value = await withLocale("fr", () => getLocalized(values));

    expect(value).toBeUndefined();
  });
});
