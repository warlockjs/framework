import { describe, expect, it } from "vitest";
import { requestContext } from "../../../src/http/context/request-context";
import { defineResource } from "../../../src/resource/define-resource";

/**
 * Covers the request-context locale branch of `Resource.transformOutput`: a
 * `localized` cast field is resolved against the active request's `locale`
 * (read via `useRequestStore()`). We drive the AsyncLocalStorage with
 * `requestContext.run(...)` so a fake request supplies the locale.
 * Source: core/src/resource/resource.ts:213.
 */
function withLocale<T>(locale: string | undefined, callback: () => T): Promise<T> {
  const request = { locale } as never;

  return requestContext.run({ request } as never, async () => callback());
}

const localizedName = [
  { localeCode: "en", value: "Phone" },
  { localeCode: "ar", value: "هاتف" },
];

describe("Resource — localized field resolves via the request-context locale", () => {
  const R = defineResource({
    schema: { id: "int", name: "localized" },
  });

  it("resolves the localized cast to the active request's locale", async () => {
    const arabic = await withLocale("ar", () => new R({ id: 1, name: localizedName }).toJSON());
    const english = await withLocale("en", () => new R({ id: 1, name: localizedName }).toJSON());

    expect(arabic).toEqual({ id: 1, name: "هاتف" });
    expect(english).toEqual({ id: 1, name: "Phone" });
  });

  it("defaults the localized value to the first entry when there is no request context", () => {
    // Outside any requestContext.run(...) the store is empty, so localeCode is
    // undefined and the localized cast returns the first entry's value.
    const json = new R({ id: 1, name: localizedName }).toJSON();

    expect(json).toEqual({ id: 1, name: "Phone" });
  });
});
