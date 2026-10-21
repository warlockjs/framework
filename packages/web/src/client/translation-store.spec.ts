import { getKeywordsListOf, setTranslationsList } from "@mongez/localization";
import { usageOf } from "@warlock.js/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pruneKeywords, sharedTableFor } from "../translations/delivery";
import { installPayloadTranslations } from "./install-payload-translations";
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

  it("treats the base of delivered count variants as present, and reports a base nothing backs", async () => {
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
        { cart: { items_one: "1 item", items_other: ":count items" } },
        { url: "/assets/translations/store-test.plural.json", hash: "plural", groups: ["app"] },
        "cart.index",
      ),
    );
    const dictionary = translationDictionaryFor(LOCALE);

    expect(translationsForKeyword(LOCALE, dictionary, "cart.items")).toBe(dictionary);
    expect(reports).toHaveLength(0);

    translationsForKeyword(LOCALE, dictionary, "cart.total");
    translationsForKeyword(LOCALE, dictionary, "cart.item");
    expect(reports).toHaveLength(2);
  });

  it("returns inline translation objects and present keys untouched", () => {
    const dictionary = translationDictionaryFor(LOCALE);
    const inline = { en: "Save", ar: "حفظ" };

    expect(translationsForKeyword(LOCALE, dictionary, inline)).toBe(dictionary);
  });
});

describe("hydration parity", () => {
  it("renders the same text the server rendered for every key the page reads", async () => {
    const serverKeywords = {
      app: { title: "Orders app" },
      orders: { title: "Orders", statuses: { paid: "Paid", open: "Open" } },
      members: { title: "Members" },
    };
    const sources = [
      {
        entries: {
          "app.title": { [LOCALE]: "Orders app" },
          "orders.title": { [LOCALE]: "Orders" },
          "orders.statuses.paid": { [LOCALE]: "Paid" },
          "orders.statuses.open": { [LOCALE]: "Open" },
          "members.title": { [LOCALE]: "Members" },
        },
      },
    ];
    const usage = usageOf({ keys: ["orders.title"], prefixes: ["orders.statuses."] });
    const shared = sharedTableFor(sources, LOCALE, ["app"]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(shared)),
    );
    await loadTranslationAssets(
      payload(
        pruneKeywords(serverKeywords, usage, ["app"]),
        { url: "/assets/translations/store-test.parity.json", hash: "parity", groups: ["app"] },
        "orders.index",
      ),
    );

    const dictionary = translationDictionaryFor(LOCALE);

    for (const key of ["app.title", "orders.title", "orders.statuses.paid"]) {
      const segments = key.split(".");
      const serverValue = segments.reduce<unknown>(
        (value, segment) => (value as Record<string, unknown>)[segment],
        serverKeywords,
      );
      const clientValue = segments.reduce<unknown>(
        (value, segment) => (value as Record<string, unknown>)[segment],
        translationsForKeyword(LOCALE, dictionary, key),
      );

      expect(clientValue).toBe(serverValue);
    }
  });
});

/** A payload of the global-registry mode: the one that names no `translationMode`. */
function globalRegistryPayload(
  ...args: Parameters<typeof payload>
): HydrationDocumentPayloadSource {
  const source = payload(...args);
  delete (source as { translationMode?: string }).translationMode;

  return source;
}

describe("global-registry mode", () => {
  afterEach(() => setTranslationsList({}));

  it("completes the registry with the shared table and the page's pruned keys", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ app: { title: "Orders app" }, common: { save: "Save" } })),
    );
    const source = globalRegistryPayload(
      { orders: { title: "Orders" } },
      { url: "/__warlock/translations/store-test.g1.json", hash: "g1", groups: ["app", "common"] },
      "orders.index",
    );

    await loadTranslationAssets(source);
    installPayloadTranslations(source);

    expect(getKeywordsListOf(LOCALE)).toEqual({
      app: { title: "Orders app" },
      common: { save: "Save" },
      orders: { title: "Orders" },
    });
  });

  it("merges the next page's keys into the registry on navigation, keeping the earlier page's", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ app: { title: "Orders app" } })),
    );
    const first = globalRegistryPayload(
      { orders: { title: "Orders" } },
      { url: "/__warlock/translations/store-test.g2.json", hash: "g2", groups: ["app"] },
      "orders.index",
    );
    const second = globalRegistryPayload(
      { members: { title: "Members" } },
      { url: "/__warlock/translations/store-test.g2.json", hash: "g2", groups: ["app"] },
      "members.index",
    );

    await loadTranslationAssets(first);
    installPayloadTranslations(first);
    await loadTranslationAssets(second);
    installPayloadTranslations(second);

    expect(getKeywordsListOf(LOCALE)).toMatchObject({
      orders: { title: "Orders" },
      members: { title: "Members" },
    });
  });

  it("keeps the registry writable: a registration into a shared group does not throw on the frozen table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ app: { title: "Orders app" } })),
    );
    const source = globalRegistryPayload(
      {},
      { url: "/__warlock/translations/store-test.g3.json", hash: "g3", groups: ["app"] },
    );

    await loadTranslationAssets(source);
    installPayloadTranslations(source);

    expect(() => {
      const registryList = getKeywordsListOf(LOCALE);
      if (registryList === null) throw new Error("registry missing");
      (registryList.app as Record<string, unknown>).title = "Changed by a registration";
    }).not.toThrow();
  });

  it("keeps a legacy payload (no shared table) on the plain registry path, with no pruning reports", () => {
    const legacy = payload({ orders: { title: "Orders" } });
    delete (legacy as { translationMode?: string }).translationMode;

    installPayloadTranslations(legacy);

    expect(getKeywordsListOf(LOCALE)).toEqual({ orders: { title: "Orders" } });
  });
});

describe("table load order", () => {
  const latest = "/__warlock/translations/store-test.json";
  const hashed = "/__warlock/translations/store-test.order.json";

  it("answers from the unhashed latest table when the hashed one is missing (404)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({ app: { title: "Latest" } }));
    vi.stubGlobal("fetch", fetchMock);

    await loadTranslationAssets(
      payload({}, { url: hashed, hash: "order", groups: ["app"], latest }),
    );

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([hashed, latest]);
    expect(translationDictionaryFor(LOCALE)).toEqual({ app: { title: "Latest" } });
  });

  it("does not ask for the latest table when the hashed one fails for another reason", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({ app: { title: "Retried" } }));
    vi.stubGlobal("fetch", fetchMock);

    await loadTranslationAssets(
      payload({}, { url: hashed, hash: "order2", groups: ["app"], latest }),
    );

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([hashed, hashed]);
    expect(translationDictionaryFor(LOCALE)).toEqual({ app: { title: "Retried" } });
  });

  it("retries the hashed table once after the latest one also fails, then recovers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ app: { title: "Recovered" } }));
    vi.stubGlobal("fetch", fetchMock);

    await loadTranslationAssets(
      payload({}, { url: hashed, hash: "order3", groups: ["app"], latest }),
    );

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([hashed, latest, hashed]);
    expect(translationDictionaryFor(LOCALE)).toEqual({ app: { title: "Recovered" } });
  });

  it("renders its keys and reports once when the hashed and latest tables both stay missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, 404)),
    );
    const reports: unknown[] = [];
    onClientError((event) => {
      reports.push(event);
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await loadTranslationAssets(
      payload(
        { orders: { title: "Kept" } },
        { url: hashed, hash: "order4", groups: ["app"], latest },
      ),
    );

    expect(translationDictionaryFor(LOCALE)).toEqual({ orders: { title: "Kept" } });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ kind: "translations" });
  });
});
