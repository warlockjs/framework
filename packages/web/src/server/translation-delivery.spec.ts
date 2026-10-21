import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildRouteLocaleManifest } from "../build/build-route-locale-manifest";
import { sharedTranslationAssets, type TranslationSourceEntries } from "../translations/delivery";
import { CLIENT_ASSET_URL_PREFIX } from "./client-asset-url-prefix";
import { createRouteTranslationsResolver } from "./route-translations";
import {
  deliverTranslations,
  developmentTranslationDelivery,
  productionTranslationDelivery,
} from "./translation-delivery";
import { developmentTranslationPages } from "./translation-dev-pages";

const temporary: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-translation-delivery-"));
  temporary.push(root);
  return root;
}

afterEach(() => {
  while (temporary.length > 0) fs.rmSync(temporary.pop() ?? "", { recursive: true, force: true });
});

const sources: TranslationSourceEntries[] = [
  {
    entries: {
      "app.title": { en: "Orders app", ar: "تطبيق" },
      "orders.title": { en: "Orders", ar: "الطلبات" },
      "members.title": { en: "Members", ar: "الأعضاء" },
    },
  },
];

describe("production translation delivery", () => {
  it("names the shared table the build emitted, by its URL", () => {
    const delivery = productionTranslationDelivery({ sources, translations: undefined });
    const [english] = sharedTranslationAssets(sources, ["app", "common"]).filter(
      (asset) => asset.locale === "en",
    );

    expect(delivery.assetFor("en")).toEqual({
      url: `${CLIENT_ASSET_URL_PREFIX}/${english?.fileName}`,
      hash: english?.hash,
      groups: ["app", "common"],
    });
  });

  it("reaches every key for a page the build did not analyze", () => {
    const delivery = productionTranslationDelivery({ sources, translations: undefined });

    expect(delivery.usageFor("src/web/unknown.page.tsx").dynamic).toBe(true);
  });

  it("uses the usage the build recorded for a known page", () => {
    const delivery = productionTranslationDelivery({
      sources,
      translations: {
        sharedGroups: ["app"],
        prune: true,
        usage: {
          "src/web/orders.page.tsx": { keys: [], prefixes: ["orders."], dynamic: false },
        },
      },
    });

    expect(delivery.usageFor("src/web/orders.page.tsx")).toMatchObject({
      dynamic: false,
      prefixes: ["orders."],
    });
    expect(delivery.sharedGroups).toEqual(["app"]);
  });
});

describe("deliverTranslations", () => {
  it("carries the pruned keys without the shared groups, and the shared-table reference", () => {
    const delivery = productionTranslationDelivery({
      sources,
      translations: {
        sharedGroups: ["app"],
        prune: true,
        usage: {
          "src/web/orders.page.tsx": { keys: ["orders.title"], prefixes: [], dynamic: false },
        },
      },
    });

    const delivered = deliverTranslations(delivery, "src/web/orders.page.tsx", "en", {
      app: { title: "Orders app" },
      orders: { title: "Orders" },
      members: { title: "Members" },
    });

    expect(delivered.keywords).toEqual({ orders: { title: "Orders" } });
    expect(delivered.assets?.groups).toEqual(["app"]);
  });
});

describe("development translation delivery", () => {
  it("analyzes the page's client graph and picks up a new key on the next request", () => {
    const root = tempRoot();
    const page = path.join(root, "src/web/orders.page.tsx");
    fs.mkdirSync(path.dirname(page), { recursive: true });
    fs.writeFileSync(page, `export default () => trans("orders.title");`, "utf8");

    const delivery = developmentTranslationDelivery({
      sources,
      appSrcRoot: path.join(root, "src"),
      pages: [{ pageFile: page, entries: [page], setupFiles: [] }],
    });

    expect(delivery.usageFor(page).keys).toEqual(["orders.title"]);

    fs.writeFileSync(page, `export default () => trans("members.title");`, "utf8");
    fs.utimesSync(page, new Date(), new Date(Date.now() + 5_000));

    expect(delivery.usageFor(page).keys).toEqual(["members.title"]);
  });

  it("names the development full table by its content hash, under the table route", () => {
    const delivery = developmentTranslationDelivery({
      sources,
      appSrcRoot: tempRoot(),
      pages: [],
    });
    const asset = delivery.assetFor("en");

    expect(asset?.url).toMatch(/^\/__warlock\/translations\/en\.[0-9a-f]{16}\.json$/);
    expect(asset?.url.endsWith(`.${asset?.hash ?? ""}.json`)).toBe(true);
    expect(asset?.development).toBe(true);
  });

  it("reaches every key for a page it was not given", () => {
    const delivery = developmentTranslationDelivery({ sources, appSrcRoot: tempRoot(), pages: [] });

    expect(delivery.usageFor("src/web/other.page.tsx").dynamic).toBe(true);
  });
});

describe("development page entries", () => {
  it("starts a page's graph at the page, its layouts, the root and every error page", () => {
    const root = tempRoot();
    const webRoot = path.join(root, "src/web");
    const page = path.join(webRoot, "orders/index.page.tsx");
    const layout = path.join(webRoot, "layout.tsx");
    const errorPage = path.join(webRoot, "error.page.tsx");
    const app = path.join(webRoot, "root.tsx");

    for (const file of [page, layout, errorPage, app]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "export default () => null;", "utf8");
    }

    const [entry] = developmentTranslationPages({
      pages: [
        { pageFile: page, webRoot },
        { pageFile: errorPage, webRoot },
      ],
      appFile: app,
    });

    expect(entry?.entries).toEqual(expect.arrayContaining([page, layout, app, errorPage]));
  });
});

describe("createRouteTranslationsResolver with delivery", () => {
  it("attaches the delivered dictionary to a page's snapshot and keeps the full keywords for rendering", () => {
    const manifest = buildRouteLocaleManifest(
      {
        pages: [{ pageFile: "src/web/orders.page.tsx", webRoot: "src/web" }],
        localeFiles: [{ sourceFile: "src/web/locales.json", webRoot: "src/web" }],
      },
      {
        localeCodes: ["en", "ar"],
        localeCode: "en",
        readSource: () =>
          JSON.stringify({
            $group: "app",
            title: { en: "Orders app", ar: "تطبيق" },
            orders: { title: { en: "Orders", ar: "الطلبات" } },
          }),
      },
    );
    const resolver = createRouteTranslationsResolver(
      manifest,
      productionTranslationDelivery({
        sources: manifest?.sources ?? [],
        translations: {
          sharedGroups: ["app"],
          prune: true,
          usage: { "src/web/orders.page.tsx": { keys: [], prefixes: [], dynamic: false } },
        },
      }),
    );

    const snapshot = resolver?.("src/web/orders.page.tsx", "en");

    expect(snapshot?.keywords).toEqual({
      app: { title: "Orders app" },
      orders: { title: "Orders" },
    });
    expect(snapshot?.delivered?.keywords).toEqual({});
    expect(snapshot?.delivered?.assets?.groups).toEqual(["app"]);
  });
});
