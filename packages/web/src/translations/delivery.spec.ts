import { describe, expect, it } from "vitest";
import { usageOf, translationDeclarationUsage, scanTranslationSource } from "@warlock.js/core";
import {
  canonicalJson,
  contentHash,
  EVERYTHING_USAGE,
  groupOf,
  localeCodesOf,
  pruneKeywords,
  pruneKeywordsAgainst,
  serializeUsage,
  sharedAssetFileName,
  sharedTableFor,
  sharedTranslationAssets,
  usageFromRecord,
  type TranslationSourceEntries,
} from "./delivery";
import { DEFAULT_SHARED_TRANSLATION_GROUPS } from "./types";

const sources: TranslationSourceEntries[] = [
  {
    entries: {
      "app.title": { en: "Orders app", ar: "تطبيق الطلبات" },
      "common.save": { en: "Save", ar: "حفظ" },
    },
  },
  {
    entries: {
      "orders.title": { en: "Orders", ar: "الطلبات" },
      "orders.statuses.paid": { en: "Paid", ar: "مدفوع" },
      "orders.statuses.open": { en: "Open", ar: "مفتوح" },
      "members.title": { en: "Members", ar: "الأعضاء" },
    },
  },
];

describe("shared groups", () => {
  it("defaults to the app-level and common groups", () => {
    expect(DEFAULT_SHARED_TRANSLATION_GROUPS).toEqual(["app", "common"]);
  });

  it("takes the group of a key from its first segment", () => {
    expect(groupOf("app.title")).toBe("app");
    expect(groupOf("standalone")).toBe("standalone");
  });

  it("collects every key of a shared group across every source, per locale", () => {
    expect(sharedTableFor(sources, "en", ["app", "common"])).toEqual({
      app: { title: "Orders app" },
      common: { save: "Save" },
    });
  });

  it("lists every locale the sources carry, once", () => {
    expect(localeCodesOf(sources)).toEqual(["en", "ar"]);
  });
});

describe("hashed shared assets", () => {
  it("serializes with sorted keys, so equal tables produce equal bytes", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("names each locale's file by its content hash, and changes the name when the content changes", () => {
    const [english] = sharedTranslationAssets(sources, ["app", "common"]);
    const changed = sharedTranslationAssets(
      [{ entries: { "app.title": { en: "Renamed", ar: "" } } }],
      ["app"],
    )[0];

    expect(english?.locale).toBe("en");
    expect(english?.fileName).toBe(sharedAssetFileName("en", contentHash(english?.body ?? "")));
    expect(english?.fileName).toMatch(/^translations\/en\.[0-9a-f]{16}\.json$/);
    expect(changed?.fileName).not.toBe(english?.fileName);
  });

  it("is deterministic across runs for the same sources", () => {
    expect(sharedTranslationAssets(sources, ["app"])).toEqual(
      sharedTranslationAssets(sources, ["app"]),
    );
  });
});

describe("pruneKeywords", () => {
  const keywords = {
    app: { title: "Orders app" },
    orders: {
      title: "Orders",
      statuses: { paid: "Paid", open: "Open" },
    },
    members: { title: "Members" },
  };

  it("drops shared groups, which the shared table provides", () => {
    const pruned = pruneKeywords(keywords, EVERYTHING_USAGE, ["app"]);

    expect(pruned).not.toHaveProperty("app");
    expect(pruned).toHaveProperty("orders");
  });

  it("keeps only the keys a literal key reaches, with its subtree", () => {
    const usage = usageOf({ keys: ["orders.title"] });

    expect(pruneKeywords(keywords, usage, ["app"])).toEqual({ orders: { title: "Orders" } });
  });

  it("keeps every key under a static prefix", () => {
    const usage = translationDeclarationUsage("orders.statuses.*", "orders.setup.ts");

    expect(pruneKeywords(keywords, usage, ["app"])).toEqual({
      orders: { statuses: { paid: "Paid", open: "Open" } },
    });
  });

  it("keeps a declared group whole", () => {
    const usage = translationDeclarationUsage("members", "members.setup.ts");

    expect(pruneKeywords(keywords, usage, ["app"])).toEqual({ members: { title: "Members" } });
  });

  it("keeps everything but shared groups for a dynamic usage (the full fallback)", () => {
    const usage = usageOf({ dynamic: true });

    expect(pruneKeywords(keywords, usage, ["app"])).toEqual({
      orders: { title: "Orders", statuses: { paid: "Paid", open: "Open" } },
      members: { title: "Members" },
    });
  });

  it("returns an empty object when the usage reaches nothing", () => {
    expect(pruneKeywords(keywords, usageOf({}), ["app"])).toEqual({});
  });
});

describe("count variants", () => {
  const keywords = {
    cart: {
      items_one: "1 item",
      items_other: ":count items",
      itemsTotal: "Total",
      title: "Cart",
    },
    app: { title: "Shop" },
  };

  /** A key that is only passed on to a helper and then used with a count. */
  const { usage } = scanTranslationSource(
    "src/web/cart.tsx",
    `const LABELS = { items: "cart.items" };
     export const Items = ({ count }) => render(LABELS.items, { count });`,
  );

  it("delivers every count variant of a base key a page names", () => {
    expect(pruneKeywords(keywords, usage, ["app"])).toEqual({
      cart: { items_one: "1 item", items_other: ":count items" },
    });
  });

  it("delivers them in the global-registry mode too, leaving unrelated keys out", () => {
    expect(pruneKeywordsAgainst(keywords, usage, { app: { title: "Shop" } })).toEqual({
      cart: { items_one: "1 item", items_other: ":count items" },
    });
  });
});

describe("usage records", () => {
  it("round-trips through the serialized manifest form", () => {
    const usage = usageOf({ keys: ["members"], prefixes: ["statuses."] });

    expect(usageFromRecord(serializeUsage(usage))).toMatchObject({
      keys: ["members"],
      prefixes: ["statuses."],
      dynamic: false,
    });
  });

  it("keeps the key literals and template heads found in the page's modules", () => {
    const usage = usageOf({ literals: ["cart.items"], literalPrefixes: ["status."] });

    expect(usageFromRecord(serializeUsage(usage))).toMatchObject({
      literals: ["cart.items"],
      literalPrefixes: ["status."],
    });
  });

  it("reads a record from a manifest built before literals were recorded", () => {
    expect(usageFromRecord({ keys: ["members"], prefixes: [], dynamic: false })).toMatchObject({
      literals: [],
      literalPrefixes: [],
    });
  });
});
