/**
 * `scry()` and `formatScryResult()` over the shop fixture: one golden text
 * and JSON answer per query form, the GR9xxx errors, path forms, and the
 * stale-routes note. Regenerate the goldens with
 * `GRIMOIRE_UPDATE_GOLDEN=1 npx vitest run tests/scry.spec.ts`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GrimoireError } from "../src/codes";
import type { ScryQuery } from "../src/contracts/scry";
import type { GrimoireSnapshot } from "../src/contracts/snapshot";
import { formatScryResult, scry } from "../src/scry";
import { openGrimoire } from "../src/workspace";
import { createShopAdapter } from "./fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "./support/copy-fixture";

const goldenDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "golden", "scry");
const update = process.env.GRIMOIRE_UPDATE_GOLDEN === "1";

/** Compare with (or, when updating, write) a golden file. Absolute temp roots are replaced by `<root>`. */
function golden(name: string, content: string, root: string): void {
  const file = path.join(goldenDir, name);
  const stable = content.split(root).join("<root>");

  if (update || !existsSync(file)) {
    mkdirSync(goldenDir, { recursive: true });
    writeFileSync(file, stable);
  }

  expect(stable).toBe(readFileSync(file, "utf8"));
}

const QUERIES: Record<string, ScryQuery> = {
  file: { type: "file", file: "src/app/catalog/services/new-arrivals.service.ts" },
  impact: { type: "impact", file: "src/app/catalog/models/product.model.ts" },
  route: { type: "route", method: "POST", path: "/api/orders" },
  feature: { type: "feature", feature: "catalog" },
  flow: { type: "flow", feature: "catalog", flow: "new-arrivals" },
  search: { type: "search", text: "new arrivals" },
};

let copy: FixtureCopy;
let snapshot: GrimoireSnapshot;

beforeAll(async () => {
  copy = copyFixture();
  snapshot = await openGrimoire(copy.root, createShopAdapter(), { routes: "fresh" });
});

afterAll(() => copy.remove());

function codeOf(run: () => unknown): string | null {
  try {
    run();
  } catch (error) {
    return error instanceof GrimoireError ? `${error.code} ${error.message}` : String(error);
  }

  return null;
}

describe("scry over the shop fixture", () => {
  for (const [name, query] of Object.entries(QUERIES)) {
    it(`answers --${name} (text and JSON goldens)`, () => {
      const result = scry(snapshot, query);

      golden(`${name}.txt`, `${formatScryResult(result).join("\n")}\n`, copy.root);
      golden(`${name}.json`, `${JSON.stringify(result, null, 2)}\n`, copy.root);
    });
  }

  it("lists routes, pages, flows, the owner and borrowers in --impact", () => {
    const result = scry(snapshot, QUERIES.impact as ScryQuery);

    expect(result.type).toBe("impact");
    if (result.type !== "impact") return;
    expect(result.importers.direct).toEqual([
      "src/app/catalog/repositories/products.repository.ts",
    ]);
    expect(result.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      "GET /api/products",
      "GET /api/products/new-arrivals",
      "GET /api/products/:id",
      "POST /api/orders",
    ]);
    expect(result.pages.map((page) => `${page.app} ${page.route}`)).toEqual([
      "web-client /",
      "web-client /products/:id",
    ]);
    expect(result.flows).toContain("orders/place-order");
    expect(result.features).toEqual([
      { id: "catalog", via: "owner" },
      { id: "orders", via: "borrower" },
    ]);
  });

  it("gives per-criterion test status in --flow", () => {
    const result = scry(snapshot, QUERIES.flow as ScryQuery);

    expect(
      result.type === "flow" && result.bookmap.criteria.map((criterion) => criterion.status),
    ).toEqual(["not-run", "not-run", "no-test"]);
    expect(formatScryResult(result)[1]).toMatch(/home\.page\.tsx \(\+5 files\)$/);
  });

  it("takes either separator and absolute paths", () => {
    const relative = scry(snapshot, {
      type: "file",
      file: "src/app/catalog/services/new-arrivals.service.ts",
    });

    expect(
      scry(snapshot, {
        type: "file",
        file: "src\\app\\catalog\\services\\new-arrivals.service.ts",
      }),
    ).toEqual(relative);
    expect(
      scry(snapshot, {
        type: "file",
        file: path.join(copy.root, "src", "app", "catalog", "services", "new-arrivals.service.ts"),
      }),
    ).toEqual(relative);
  });

  it("throws GR9001-GR9004 with what failed and what to do", () => {
    expect(codeOf(() => scry(snapshot, { type: "file", file: "src/nope.ts" }))).toMatch(
      /^GR9001 src\/nope\.ts is not in the book/,
    );
    expect(codeOf(() => scry(snapshot, { type: "impact", file: "README.md" }))).toMatch(/^GR9001 /);
    expect(
      codeOf(() => scry(snapshot, { type: "route", method: "DELETE", path: "/api/orders" })),
    ).toMatch(
      /^GR9002 No route matches DELETE \/api\/orders\. Routes on that path: POST \/api\/orders\.$/,
    );
    expect(codeOf(() => scry(snapshot, { type: "feature", feature: "billing" }))).toMatch(
      /^GR9003 .*Features: auth, catalog, orders\.$/,
    );
    expect(
      codeOf(() => scry(snapshot, { type: "flow", feature: "catalog", flow: "returns" })),
    ).toMatch(
      /^GR9004 No flow catalog\/returns\. Flows of catalog: browse-products, new-arrivals, wishlist\.$/,
    );
  });

  it("matches route params written either way and ALL methods", () => {
    const result = scry(snapshot, { type: "route", method: "GET", path: "/api/products/[id]/" });

    expect(result.type === "route" && result.route.name).toBe("catalog.products.show");
  });

  it("ranks search hits: exact id, prefix, id words, detail words; respects the limit", () => {
    const result = scry(snapshot, { type: "search", text: "new arrivals", limit: 3 });

    expect(result.type === "search" && result.hits.map((hit) => `${hit.type} ${hit.id}`)).toEqual([
      "flow catalog/new-arrivals",
      "block mobile/home/new-arrivals",
      "block web-client/home/new-arrivals",
    ]);
    expect(scry(snapshot, { type: "search", text: "zzz-nothing" })).toMatchObject({ hits: [] });
    expect(formatScryResult(scry(snapshot, { type: "search", text: "zzz-nothing" }))).toEqual([
      'no match for "zzz-nothing"',
    ]);
  });
});

describe("scry notes", () => {
  it("notes stale route facts and says how to refresh them", async () => {
    const stale = copyFixture();

    try {
      const adapter = createShopAdapter();

      await openGrimoire(stale.root, adapter, { routes: "fresh" });
      stale.replace("src/app/orders/routes.ts", "\n", "\n// changed\n");

      const reopened = await openGrimoire(stale.root, adapter, { routes: "cached" });
      const lines = formatScryResult(scry(reopened, QUERIES.file as ScryQuery));

      expect(reopened.routes).toBe("stale");
      expect(lines.at(-1)).toBe("note      route facts are stale; run warlock grimoire build");
    } finally {
      stale.remove();
    }
  });
});
