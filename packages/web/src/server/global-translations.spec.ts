import type { Keywords } from "@mongez/localization";
import { beforeEach, describe, expect, it } from "vitest";
import { usageOf } from "@warlock.js/core";
import { contentHash } from "../translations/delivery";
import {
  createGlobalTranslationDelivery,
  globalTranslationDelivery,
  installGlobalTranslationDelivery,
  productionGlobalTranslationDelivery,
} from "./global-translations";
import {
  parseTranslationTableFile,
  RECENT_TRANSLATION_TABLES,
  resetTranslationTablesForTests,
  translationTableFor,
} from "./translation-tables";

type Registry = Record<string, Keywords>;

/** A registry the test mutates between payloads, the way `register()` hooks do. */
function registry(initial: Registry) {
  const state = { lists: initial as Registry };

  return {
    state,
    keywordsOf: (locale: string): Keywords | null => state.lists[locale] ?? null,
  };
}

const keywords: Registry = {
  en: {
    app: { title: "Orders app" },
    common: { save: "Save" },
    orders: { title: "Orders", statuses: { paid: "Paid", open: "Open" } },
    members: { title: "Members" },
  },
};

beforeEach(() => {
  resetTranslationTablesForTests();
  installGlobalTranslationDelivery(undefined);
});

describe("createGlobalTranslationDelivery", () => {
  it("delivers the page's non-shared keys and a reference to the shared table", () => {
    const source = registry(keywords);
    const delivery = createGlobalTranslationDelivery({
      sharedGroups: ["app", "common"],
      prune: true,
      development: false,
      usageFor: (route) => (route === "orders" ? usageOf({ keys: ["orders.title"] }) : undefined),
      keywordsOf: source.keywordsOf,
    });

    const delivered = delivery.deliver("orders", "en");

    expect(delivered.keywords).toEqual({ orders: { title: "Orders" } });
    expect(delivered.assets?.groups).toEqual(["app", "common"]);
    expect(delivered.assets?.development).toBeUndefined();
    expect(delivered.assets?.url).toBe(`/__warlock/translations/en.${delivered.assets?.hash}.json`);
  });

  it("publishes exactly the shared groups under the hash it names", () => {
    const source = registry(keywords);
    const delivery = createGlobalTranslationDelivery({
      sharedGroups: ["app", "common"],
      prune: true,
      development: false,
      usageFor: () => undefined,
      keywordsOf: source.keywordsOf,
    });

    const { assets } = delivery.deliver("orders", "en");
    const stored = translationTableFor("en", assets?.hash ?? "");

    expect(stored?.development).toBe(false);
    expect(JSON.parse(stored?.body ?? "{}")).toEqual({
      app: { title: "Orders app" },
      common: { save: "Save" },
    });
    expect(contentHash(stored?.body ?? "")).toBe(assets?.hash);
  });

  it("ships everything but the shared groups for a route with no recorded usage (the full fallback)", () => {
    const source = registry(keywords);
    const delivery = createGlobalTranslationDelivery({
      sharedGroups: ["app", "common"],
      prune: true,
      development: false,
      usageFor: () => undefined,
      keywordsOf: source.keywordsOf,
    });

    expect(delivery.deliver("unknown", "en").keywords).toEqual({
      orders: { title: "Orders", statuses: { paid: "Paid", open: "Open" } },
      members: { title: "Members" },
    });
  });

  it("opts out of pruning with prune: false while keeping the shared table", () => {
    const source = registry(keywords);
    const delivery = createGlobalTranslationDelivery({
      sharedGroups: ["app", "common"],
      prune: false,
      development: false,
      usageFor: () => usageOf({ keys: ["orders.title"] }),
      keywordsOf: source.keywordsOf,
    });

    const delivered = delivery.deliver("orders", "en");

    expect(Object.keys(delivered.keywords)).toEqual(["orders", "members"]);
    expect(delivered.assets?.groups).toEqual(["app", "common"]);
  });

  it("changes the hash when a registration changes a shared group, and keeps the old table servable", () => {
    const source = registry(keywords);
    const delivery = createGlobalTranslationDelivery({
      sharedGroups: ["app", "common"],
      prune: true,
      development: false,
      usageFor: () => undefined,
      keywordsOf: source.keywordsOf,
    });
    const before = delivery.deliver("orders", "en").assets?.hash ?? "";

    source.state.lists.en = { ...keywords.en, app: { title: "Orders app", extra: "New" } };
    const after = delivery.deliver("orders", "en").assets?.hash ?? "";

    expect(after).not.toBe(before);
    expect(translationTableFor("en", before)).toBeDefined();
    expect(translationTableFor("en", after)).toBeDefined();
  });

  it("keeps the same hash while nothing in the shared groups changes", () => {
    const source = registry(keywords);
    const delivery = createGlobalTranslationDelivery({
      sharedGroups: ["app", "common"],
      prune: true,
      development: false,
      usageFor: () => undefined,
      keywordsOf: source.keywordsOf,
    });

    source.state.lists.en = { ...keywords.en, members: { title: "Members (renamed)" } };

    expect(delivery.deliver("orders", "en").assets?.hash).toBe(
      delivery.deliver("members", "en").assets?.hash,
    );
  });

  it("ages out the oldest tables beyond the recent window, so a stale hash answers nothing", () => {
    const source = registry(keywords);
    const delivery = createGlobalTranslationDelivery({
      sharedGroups: ["app"],
      prune: true,
      development: false,
      usageFor: () => undefined,
      keywordsOf: source.keywordsOf,
    });
    const first = delivery.deliver("orders", "en").assets?.hash ?? "";

    for (let version = 0; version < RECENT_TRANSLATION_TABLES; version += 1) {
      source.state.lists.en = { ...keywords.en, app: { title: `v${version}` } };
      delivery.deliver("orders", "en");
    }

    expect(translationTableFor("en", first)).toBeUndefined();
  });

  it("carries every group, marked development, in development so the detector can read it", () => {
    const source = registry(keywords);
    const delivery = createGlobalTranslationDelivery({
      sharedGroups: ["app"],
      prune: true,
      development: true,
      usageFor: () => usageOf({ keys: ["orders.title"] }),
      keywordsOf: source.keywordsOf,
    });

    const delivered = delivery.deliver("orders", "en");
    const stored = translationTableFor("en", delivered.assets?.hash ?? "");

    expect(delivered.assets?.development).toBe(true);
    expect(stored?.development).toBe(true);
    expect(JSON.parse(stored?.body ?? "{}")).toMatchObject({
      orders: { title: "Orders" },
      members: { title: "Members" },
    });
  });

  it("uses an empty table for a locale the registry does not hold", () => {
    const delivery = createGlobalTranslationDelivery({
      sharedGroups: ["app"],
      prune: true,
      development: false,
      usageFor: () => undefined,
      keywordsOf: () => null,
    });

    expect(delivery.deliver("orders", "fr").keywords).toEqual({});
    expect(
      JSON.parse(
        translationTableFor("fr", delivery.deliver("orders", "fr").assets?.hash ?? "")?.body ?? "x",
      ),
    ).toEqual({});
  });
});

describe("productionGlobalTranslationDelivery", () => {
  it("prunes by the route usage the build recorded, and falls back to everything for a route it did not record", () => {
    installGlobalTranslationDelivery(
      productionGlobalTranslationDelivery({
        sharedGroups: ["app"],
        prune: true,
        usage: {},
        routes: { orders: { keys: ["orders.title"], prefixes: [], dynamic: false } },
      }),
    );

    const delivery = globalTranslationDelivery();
    const recorded = delivery?.deliver("orders", "en").keywords;
    const unrecorded = delivery?.deliver("not-recorded", "en").keywords;

    expect(recorded).toEqual({ orders: { title: "Orders" } });
    expect(unrecorded).toHaveProperty("members");
    expect(unrecorded).toHaveProperty("orders");
  });

  it("is absent until installed, so a payload built with no delivery carries the full registry", () => {
    expect(globalTranslationDelivery()).toBeUndefined();
  });
});

describe("parseTranslationTableFile", () => {
  it("reads a locale and hash from a table file name, and refuses anything else", () => {
    expect(parseTranslationTableFile("en-US.0123456789abcdef.json")).toEqual({
      locale: "en-US",
      hash: "0123456789abcdef",
    });
    expect(parseTranslationTableFile("en.json")).toBeUndefined();
    expect(parseTranslationTableFile("../en.0123456789abcdef.json")).toBeUndefined();
    expect(parseTranslationTableFile("en.XYZ.json")).toBeUndefined();
  });
});
