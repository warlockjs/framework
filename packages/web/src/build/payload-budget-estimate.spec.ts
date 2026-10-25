import { describe, expect, it } from "vitest";
import { resolvePayloadBudget } from "../server/payload-budget";
import {
  estimatePagePayloads,
  formatPayloadBudgetOverages,
  payloadBudgetOverages,
} from "./payload-budget-estimate";

const sources = [
  {
    entries: {
      "app.title": { en: "Warlock", ar: "ساحر" },
      "products.title": { en: "Products", ar: "منتجات" },
      "products.intro": { en: "A very long introduction ".repeat(40), ar: "مقدمة" },
      "orders.title": { en: "Orders", ar: "طلبات" },
    },
  },
];

const apiRoutes = [
  { name: "orders.show", path: "/api/orders/:id", method: "GET" },
  { name: "internal.reindex", path: "/internal/reindex", method: "POST", clientVisible: false as const },
];

const usage = {
  "src/web/products/products.page.tsx": {
    keys: ["products.title", "products.intro"],
    prefixes: [],
    dynamic: false,
  },
  "src/web/orders/orders.page.tsx": { keys: ["orders.title"], prefixes: [], dynamic: false },
};

const translations = { sources, usage, sharedGroups: ["app"], prune: true };

const pages = [
  {
    route: "products",
    path: "/products",
    source: "src/web/products/products.page.tsx",
    apiRouteNames: ["orders.show", "internal.reindex", "missing.route"],
  },
  { route: "orders", path: "/orders", source: "src/web/orders/orders.page.tsx", apiRouteNames: [] },
];

describe("estimatePagePayloads", () => {
  it("measures a page's pruned translations without the shared groups", () => {
    const [products, orders] = estimatePagePayloads({ pages, translations, apiRoutes });

    expect(products?.sections.translations).toBeGreaterThan(1000);
    expect(orders?.sections.translations).toBeLessThan(200);
    expect(products?.locale).toBe("en");
  });

  it("measures the route table from the names the page reaches, never a hidden route", () => {
    const [products, orders] = estimatePagePayloads({ pages, translations, apiRoutes });

    expect(products?.sections.routes).toBeGreaterThan(0);
    expect(orders?.sections.routes).toBeLessThan(10);

    const withoutRoutes = estimatePagePayloads({ pages, translations, apiRoutes: [] });

    expect(withoutRoutes[0]?.sections.routes).toBeLessThan(10);
  });

  it("counts every key when pruning is off or the page has no recorded usage", () => {
    const pruned = estimatePagePayloads({ pages, translations, apiRoutes });
    const everything = estimatePagePayloads({
      pages,
      translations: { ...translations, prune: false },
      apiRoutes,
    });

    expect(everything[1]?.sections.translations).toBeGreaterThan(
      pruned[1]?.sections.translations ?? 0,
    );
  });

  it("sums the build-measured sections", () => {
    const [products] = estimatePagePayloads({ pages, translations, apiRoutes });

    expect(products?.total).toBe(
      (products?.sections.translations ?? 0) + (products?.sections.routes ?? 0),
    );
  });
});

describe("payloadBudgetOverages", () => {
  const estimates = estimatePagePayloads({ pages, translations, apiRoutes });

  it("lists only the pages over their own limit, largest first", () => {
    const overages = payloadBudgetOverages(
      estimates,
      resolvePayloadBudget({ page: "1kb", pages: { "/orders": "10kb" } }),
    );

    expect(overages.map((page) => page.path)).toEqual(["/products"]);
  });

  it("is empty when every page fits", () => {
    expect(payloadBudgetOverages(estimates, resolvePayloadBudget({ page: "64kb" }))).toEqual([]);
  });

  it("explains what was measured and what was not", () => {
    const overages = payloadBudgetOverages(estimates, resolvePayloadBudget({ page: "1kb" }));
    const message = formatPayloadBudgetOverages(overages);

    expect(message).toContain("/products");
    expect(message).toContain("translations");
    expect(message).toContain("routes");
    expect(message).toContain("loaded per request");
  });
});
