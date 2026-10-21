import type { Keywords } from "@mongez/localization";
import { beforeEach, describe, expect, it } from "vitest";
import { usageOf } from "@warlock.js/core";
import { contentHash } from "../translations/delivery";
import {
  createLiveGlobalTranslationDelivery,
  createSnapshotGlobalTranslationDelivery,
  productionGlobalTranslationDeliveryInput,
  registerRouteSourceFile,
  resetRouteSourceFiles,
  type GlobalTranslationDeliveryInput,
} from "./global-translations";
import {
  RECENT_TRANSLATION_TABLES,
  resetTranslationTablesForTests,
  translationTableFor,
} from "./translation-tables";

type Registry = Record<string, Keywords>;

/** A registry the test mutates between payloads, the way `register()` hooks do. */
function registry(initial: Registry) {
  const state = { lists: initial };

  return {
    state,
    keywordsOf: (locale: string): Keywords | null => state.lists[locale] ?? null,
  };
}

const BOOT: Registry = {
  en: {
    app: { title: "Orders app" },
    common: { save: "Save" },
    orders: { title: "Orders", statuses: { paid: "Paid", open: "Open" } },
    members: { title: "Members" },
  },
};

const SHARED = ["app", "common"];

function input(
  source: ReturnType<typeof registry>,
  overrides: Partial<GlobalTranslationDeliveryInput> = {},
): GlobalTranslationDeliveryInput {
  return {
    sharedGroups: SHARED,
    prune: true,
    usageFor: () => undefined,
    keywordsOf: source.keywordsOf,
    ...overrides,
  };
}

beforeEach(() => {
  resetTranslationTablesForTests();
  resetRouteSourceFiles();
});

describe("snapshot delivery (production)", () => {
  it("keeps the same table and hash after later registrations, so the hash is fixed for the process", () => {
    const source = registry(BOOT);
    const delivery = createSnapshotGlobalTranslationDelivery(input(source), ["en"]);
    const bootHash = delivery.deliver("orders", "en").assets?.hash ?? "";

    source.state.lists.en = {
      ...BOOT.en,
      app: { title: "Orders app", extra: "Registered later" },
      common: { save: "Save", cancel: "Cancel" },
    };

    expect(delivery.deliver("orders", "en").assets?.hash).toBe(bootHash);
    expect(JSON.parse(translationTableFor("en", bootHash)?.body ?? "{}")).toEqual({
      app: { title: "Orders app" },
      common: { save: "Save" },
    });
  });

  it("produces the same hash in every process booted from the same registrations", () => {
    const first = createSnapshotGlobalTranslationDelivery(input(registry(BOOT)), ["en"]);
    const second = createSnapshotGlobalTranslationDelivery(input(registry(BOOT)), ["en"]);

    expect(first.deliver("orders", "en").assets?.hash).toBe(
      second.deliver("orders", "en").assets?.hash,
    );
  });

  it("names the pinned table by the hash of its exact bytes, with the latest fallback", () => {
    const delivery = createSnapshotGlobalTranslationDelivery(input(registry(BOOT)), ["en"]);
    const { assets } = delivery.deliver("orders", "en");
    const hash = assets?.hash ?? "";
    const stored = translationTableFor("en", hash);

    expect(contentHash(stored?.body ?? "")).toBe(hash);
    expect(assets?.url).toBe(`/__warlock/translations/en.${hash}.json`);
    expect(assets?.latest).toBe("/__warlock/translations/en.json");
    expect(assets?.development).toBeUndefined();
  });

  it("carries a shared key registered after boot inline, when the page uses it", () => {
    const source = registry(BOOT);
    const delivery = createSnapshotGlobalTranslationDelivery(
      input(source, { usageFor: () => usageOf({ keys: ["app.lateRegistration"] }) }),
      ["en"],
    );

    source.state.lists.en = {
      ...BOOT.en,
      app: { title: "Orders app", lateRegistration: "Registered by the first request" },
    };

    expect(delivery.deliver("orders", "en").keywords).toEqual({
      app: { lateRegistration: "Registered by the first request" },
    });
  });

  it("does not inline a later shared key that no page uses", () => {
    const source = registry(BOOT);
    const delivery = createSnapshotGlobalTranslationDelivery(
      input(source, { usageFor: () => usageOf({ keys: ["orders.title"] }) }),
      ["en"],
    );

    source.state.lists.en = { ...BOOT.en, app: { title: "Orders app", unused: "Never read" } };

    expect(delivery.deliver("orders", "en").keywords).toEqual({ orders: { title: "Orders" } });
  });

  it("never inlines a shared leaf the snapshot already holds, even when the page uses it", () => {
    const delivery = createSnapshotGlobalTranslationDelivery(
      input(registry(BOOT), { usageFor: () => usageOf({ keys: ["app.title"] }) }),
      ["en"],
    );

    expect(delivery.deliver("orders", "en").keywords).toEqual({});
  });

  it("inlines a snapshot key whose value a registration changed, since the table no longer matches", () => {
    const source = registry(BOOT);
    const delivery = createSnapshotGlobalTranslationDelivery(
      input(source, { usageFor: () => usageOf({ keys: ["app.title"] }) }),
      ["en"],
    );

    source.state.lists.en = { ...BOOT.en, app: { title: "Renamed by a registration" } };

    expect(delivery.deliver("orders", "en").keywords).toEqual({
      app: { title: "Renamed by a registration" },
    });
  });

  it("gives a locale absent at boot an empty fixed table, whatever it registers later", () => {
    const source = registry(BOOT);
    const delivery = createSnapshotGlobalTranslationDelivery(input(source), ["en"]);

    source.state.lists.ar = { app: { title: "تطبيق" } };
    const { assets, keywords } = delivery.deliver("orders", "ar");

    expect(JSON.parse(translationTableFor("ar", assets?.hash ?? "")?.body ?? "x")).toEqual({});
    expect(keywords).toEqual({ app: { title: "تطبيق" } });
  });

  it("ships the non-shared keys a route can reach, and nothing it cannot", () => {
    const delivery = createSnapshotGlobalTranslationDelivery(
      input(registry(BOOT), { usageFor: () => usageOf({ keys: ["orders.title"] }) }),
      ["en"],
    );

    expect(delivery.deliver("orders", "en").keywords).toEqual({ orders: { title: "Orders" } });
  });

  it("opts out of pruning with prune: false, still leaving the snapshot's shared keys to the table", () => {
    const delivery = createSnapshotGlobalTranslationDelivery(
      input(registry(BOOT), { prune: false, usageFor: () => usageOf({ keys: ["orders.title"] }) }),
      ["en"],
    );

    expect(delivery.deliver("orders", "en").keywords).toEqual({
      orders: { title: "Orders", statuses: { paid: "Paid", open: "Open" } },
      members: { title: "Members" },
    });
  });
});

describe("live delivery (development)", () => {
  it("republishes the table when a registration changes the shared groups, under a development flag", () => {
    const source = registry(BOOT);
    const delivery = createLiveGlobalTranslationDelivery(input(source));
    const before = delivery.deliver("orders", "en").assets?.hash ?? "";

    source.state.lists.en = { ...BOOT.en, app: { title: "Changed" } };
    const after = delivery.deliver("orders", "en").assets;

    expect(after?.hash).not.toBe(before);
    expect(after?.development).toBe(true);
    expect(translationTableFor("en", before)).toBeDefined();
  });

  it("carries every group in its table, so the detector can read a pruned key", () => {
    const delivery = createLiveGlobalTranslationDelivery(
      input(registry(BOOT), { usageFor: () => usageOf({ keys: ["orders.title"] }) }),
    );
    const { assets } = delivery.deliver("orders", "en");
    const stored = translationTableFor("en", assets?.hash ?? "");

    expect(stored?.development).toBe(true);
    expect(JSON.parse(stored?.body ?? "{}")).toMatchObject({
      orders: { title: "Orders" },
      members: { title: "Members" },
    });
  });

  it("ages out old development tables beyond the recent window", () => {
    const source = registry(BOOT);
    const delivery = createLiveGlobalTranslationDelivery(input(source));
    const first = delivery.deliver("orders", "en").assets?.hash ?? "";

    for (let version = 0; version < RECENT_TRANSLATION_TABLES; version += 1) {
      source.state.lists.en = { ...BOOT.en, app: { title: `v${version}` } };
      delivery.deliver("orders", "en");
    }

    expect(translationTableFor("en", first)).toBeUndefined();
  });
});

describe("production usage lookup", () => {
  it("looks a route up by the name the installer recorded, and reads the usage of its source file", () => {
    registerRouteSourceFile("orders.list", "src/web/orders/index.page.tsx");
    const lookup = productionGlobalTranslationDeliveryInput({
      sharedGroups: SHARED,
      prune: true,
      usage: {
        "src/web/orders/index.page.tsx": { keys: ["orders.title"], prefixes: [], dynamic: false },
      },
    });

    expect(lookup.usageFor("orders.list")?.keys).toEqual(["orders.title"]);
    expect(lookup.usageFor("never-installed")).toBeUndefined();
  });

  it("answers undefined for a route whose source file has no recorded usage, which means everything", () => {
    registerRouteSourceFile("orders.list", "src/web/orders/index.page.tsx");
    const lookup = productionGlobalTranslationDeliveryInput({
      sharedGroups: SHARED,
      prune: true,
      usage: {},
    });

    expect(lookup.usageFor("orders.list")).toBeUndefined();
  });

  it("takes the shared groups and pruning switch from the build, with the defaults when absent", () => {
    const lookup = productionGlobalTranslationDeliveryInput(undefined);

    expect(lookup.sharedGroups).toEqual(["app", "common"]);
    expect(lookup.prune).toBe(true);
  });
});
