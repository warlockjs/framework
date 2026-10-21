import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HydrationDocumentPayloadSource } from "../hydration-payload";
import {
  loadTranslationAssets,
  mergePayloadTranslations,
  resetTranslationStoreForTests,
  translationDictionaryFor,
  translationsForKeyword,
} from "./translation-store";
import { onClientError, resetClientErrorReporterForTests } from "./report-client-error";

const LOCALE = "store-test";

function payload(
  translations: Record<string, unknown>,
  assets?: HydrationDocumentPayloadSource["translationAssets"],
  name = "orders.index",
): HydrationDocumentPayloadSource {
  return {
    appData: {},
    layoutData: {},
    pageData: {},
    shared: {},
    name,
    locale: LOCALE,
    translations: translations as HydrationDocumentPayloadSource["translations"],
    translationMode: "scoped",
    ...(assets === undefined ? {} : { translationAssets: assets }),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetTranslationStoreForTests();
  resetClientErrorReporterForTests();
  vi.stubGlobal("window", globalThis);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadTranslationAssets", () => {
  it("fetches the shared table once for a hashed URL and merges the page's keys with it", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ app: { title: "Orders" } }));
    vi.stubGlobal("fetch", fetchMock);
    const source = payload(
      { orders: { title: "All orders" } },
      { url: "/assets/translations/store-test.abc.json", hash: "abc", groups: ["app"] },
    );

    await loadTranslationAssets(source);
    await loadTranslationAssets(payload({}, source.translationAssets));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(translationDictionaryFor(LOCALE)).toEqual({
      app: { title: "Orders" },
      orders: { title: "All orders" },
    });
  });

  it("retries a failed table load once, and only once", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({ app: { title: "Recovered" } }));
    vi.stubGlobal("fetch", fetchMock);

    await loadTranslationAssets(
      payload(
        {},
        { url: "/assets/translations/store-test.retry.json", hash: "retry", groups: ["app"] },
      ),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(translationDictionaryFor(LOCALE)).toEqual({ app: { title: "Recovered" } });
  });

  it("renders without the shared table and reports the failure once when both attempts fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, 503)),
    );
    const reports: unknown[] = [];
    onClientError((event) => {
      reports.push(event);
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await loadTranslationAssets(
      payload(
        { orders: { title: "Kept" } },
        { url: "/assets/translations/store-test.down.json", hash: "down", groups: ["app"] },
      ),
    );

    expect(translationDictionaryFor(LOCALE)).toEqual({ orders: { title: "Kept" } });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ kind: "translations" });
  });
});

describe("navigation merging", () => {
  it("merges each page's pruned dictionary into the locale, later values winning", () => {
    mergePayloadTranslations(payload({ orders: { title: "Orders" } }, undefined, "orders.index"));
    mergePayloadTranslations(
      payload(
        { orders: { status: { paid: "Paid" } }, members: { title: "Members" } },
        undefined,
        "members.index",
      ),
    );

    expect(translationDictionaryFor(LOCALE)).toEqual({
      orders: { title: "Orders", status: { paid: "Paid" } },
      members: { title: "Members" },
    });
  });

  it("keeps the dictionary's identity until a merge changes it", () => {
    mergePayloadTranslations(payload({ orders: { title: "Orders" } }));
    const first = translationDictionaryFor(LOCALE);

    expect(translationDictionaryFor(LOCALE)).toBe(first);
    mergePayloadTranslations(payload({ members: { title: "Members" } }));
    expect(translationDictionaryFor(LOCALE)).not.toBe(first);
  });

  it("does not let a page's keys write into the shared table", async () => {
    const shared = { app: { title: "Shared" } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(shared)),
    );
    await loadTranslationAssets(
      payload(
        { app: { title: "Overridden" } },
        { url: "/assets/translations/store-test.iso.json", hash: "iso", groups: ["app"] },
      ),
    );

    expect(translationDictionaryFor(LOCALE)).toEqual({ app: { title: "Overridden" } });
    expect(shared).toEqual({ app: { title: "Shared" } });
  });
});

describe("pruning misses", () => {
  it("resolves a pruned key from the full table in development, with a warning that names the declaration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ app: { title: "Brand" }, members: { title: "Members" } })),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await loadTranslationAssets(
      payload(
        { orders: { title: "Orders" } },
        {
          url: "/__warlock/translations/store-test?v=dev",
          hash: "dev",
          groups: ["app"],
          development: true,
        },
        "orders.index",
      ),
    );

    const dictionary = translationDictionaryFor(LOCALE);
    const resolved = translationsForKeyword(LOCALE, dictionary, "members.title");

    expect(resolved).toEqual({ app: { title: "Brand" }, members: { title: "Members" } });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('config = { translations: ["members.title"] }'),
    );
    expect(warn.mock.calls[0]?.[0]).toContain('page "orders.index"');
  });

  it("warns once per key and page, not on every lookup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ members: { title: "Members" } })),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await loadTranslationAssets(
      payload(
        {},
        {
          url: "/__warlock/translations/store-test?v=once",
          hash: "once",
          groups: [],
          development: true,
        },
      ),
    );
    const dictionary = translationDictionaryFor(LOCALE);

    translationsForKeyword(LOCALE, dictionary, "members.title");
    translationsForKeyword(LOCALE, dictionary, "members.title");

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("reports a missing key once in production and leaves it to render", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ app: {} })),
    );
    const reports: unknown[] = [];
    onClientError((event) => {
      reports.push(event);
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await loadTranslationAssets(
      payload(
        { orders: {} },
        { url: "/assets/translations/store-test.prod.json", hash: "prod", groups: ["app"] },
        "orders.index",
      ),
    );
    const dictionary = translationDictionaryFor(LOCALE);

    expect(translationsForKeyword(LOCALE, dictionary, "members.title")).toBe(dictionary);
    translationsForKeyword(LOCALE, dictionary, "members.title");

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ kind: "translations", routeName: "orders.index" });
  });

  it("returns inline translation objects and present keys untouched", () => {
    const dictionary = translationDictionaryFor(LOCALE);
    const inline = { en: "Save", ar: "حفظ" };

    expect(translationsForKeyword(LOCALE, dictionary, inline)).toBe(dictionary);
  });
});
