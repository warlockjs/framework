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
import { buildEntries } from "../src/book/render";
import { GrimoireError } from "../src/codes";
import type { ScryQuery, ScryResult } from "../src/contracts/scry";
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

  it("answers a file with the entry the book wrote, and where that entry is", () => {
    for (const file of snapshot.book.facts.files) {
      const result = scry(snapshot, { type: "file", file: file.file });

      if (result.type !== "file") throw new Error("expected a file answer");
      expect(result.bookEntry).not.toBeNull();
      expect(result.entry).toEqual(
        JSON.parse(
          readFileSync(path.join(copy.root, ...(result.bookEntry ?? "").split("/")), "utf8"),
        ),
      );
    }
  });

  it("leaves Node builtins out of a file's packages, bare or node:, as the book entry does", () => {
    const target = "src/app/catalog/services/new-arrivals.service.ts";
    const withBuiltins: GrimoireSnapshot = {
      ...snapshot,
      book: {
        ...snapshot.book,
        facts: {
          ...snapshot.book.facts,
          files: snapshot.book.facts.files.map((file) =>
            file.file === target
              ? {
                  ...file,
                  imports: [
                    ...file.imports,
                    { specifier: "fs", file: null },
                    { specifier: "node:path", file: null },
                    { specifier: "dayjs/plugin/utc", file: null },
                  ],
                }
              : file,
          ),
        },
      },
    };
    const result = scry(withBuiltins, { type: "file", file: target });

    expect(result.type === "file" && result.entry.packages).toEqual(["dayjs"]);
    expect(result.type === "file" && result.entry).toEqual(
      buildEntries(withBuiltins.book.facts, withBuiltins.annotations).get(target),
    );
  });

  it("gives per-criterion test status in --flow", () => {
    const result = scry(snapshot, QUERIES.flow as ScryQuery);

    expect(
      result.type === "flow" && result.bookmap.criteria.map((criterion) => criterion.status),
    ).toEqual(["not-run", "not-run", "no-test"]);
    const stepLine = formatScryResult(result).find((line) => line.includes("home.page.tsx"));

    expect(stepLine).toMatch(/home\.page\.tsx \(\+5 reachable(, \d+ type-only)?\)$/);
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

    expect(result.type === "route" && result.route?.name).toBe("catalog.products.show");
  });

  describe("--route with a page URL", () => {
    /** The shop book with a catch-all `GET /*` route and no `/products/:id` API route. */
    function webSnapshot(): GrimoireSnapshot {
      const facts = snapshot.book.facts;
      const order = facts.routes?.find((item) => item.path === "/api/orders");

      if (order === undefined) throw new Error("fixture has no /api/orders");

      return {
        ...snapshot,
        book: {
          ...snapshot.book,
          facts: { ...facts, routes: [{ ...order, method: "GET", path: "/*", isPage: true }] },
        },
      };
    }

    it("returns the page behind GET /* with its file, setup file, layouts and imports", () => {
      const result = scry(webSnapshot(), { type: "route", method: "get", path: "/products/[id]" });

      if (result.type !== "route") throw new Error("not a route result");

      expect(result.route).toBeNull();
      expect(result.pages.map((page) => `${page.type} ${page.route}`).sort()).toEqual([
        "page /products/:id",
        "screen /products/[id]",
      ]);
      expect(result.pages.find((page) => page.type === "page")).toMatchObject({
        site: "client",
        file: "src/web/$sites/client/products/show.page.tsx",
        setupFile: "src/web/$sites/client/products/show.setup.ts",
        layouts: ["src/web/$sites/client/layout.tsx"],
      });
      expect(result.files).toEqual(
        expect.arrayContaining([
          "src/web/$sites/client/products/show.page.tsx",
          "src/web/$sites/client/products/show.setup.ts",
          "src/web/$sites/client/layout.tsx",
        ]),
      );
      expect(formatScryResult(result)[0]).toMatch(/^GET \/products\/.+ {2}\((page|screen)\)$/);
    });

    it("returns every site serving the path, and --site keeps one", () => {
      const both = scry(webSnapshot(), { type: "route", method: "GET", path: "/" });
      const one = scry(webSnapshot(), { type: "route", method: "GET", path: "/", site: "client" });
      const mobile = scry(webSnapshot(), {
        type: "route",
        method: "GET",
        path: "/",
        site: "mobile",
      });

      expect(both.type === "route" && both.pages.map((page) => page.site).sort()).toEqual([
        "client",
        "mobile",
      ]);
      expect(one.type === "route" && one.pages.map((page) => page.site)).toEqual(["client"]);
      expect(mobile.type === "route" && mobile.pages.map((page) => page.type)).toEqual(["screen"]);
    });

    it("finds a page URL when the book has no route facts yet", () => {
      const noRoutes: GrimoireSnapshot = {
        ...snapshot,
        book: { ...snapshot.book, facts: { ...snapshot.book.facts, routes: null } },
      };
      const result = scry(noRoutes, { type: "route", method: "GET", path: "/", site: "client" });

      expect(result.type === "route" && result.pages.map((page) => page.site)).toEqual(["client"]);
      expect(
        codeOf(() => scry(noRoutes, { type: "route", method: "POST", path: "/api/orders" })),
      ).toMatch(/^GR9002 No route facts yet/);
    });

    it("keeps GR9002 for other methods and unknown paths, and lists the pages in the hint", () => {
      expect(
        codeOf(() => scry(webSnapshot(), { type: "route", method: "POST", path: "/products/1" })),
      ).toMatch(/^GR9002 No route matches POST \/products\/1\./);
      expect(
        codeOf(() => scry(webSnapshot(), { type: "route", method: "POST", path: "/products/:id" })),
      ).toMatch(/Pages on that path \(GET or HEAD only\).*web-client \/products\/:id/);
      expect(
        codeOf(() => scry(webSnapshot(), { type: "route", method: "GET", path: "/nowhere" })),
      ).toMatch(/Run warlock routes/);
      expect(
        codeOf(() =>
          scry(webSnapshot(), { type: "route", method: "GET", path: "/", site: "admin" }),
        ),
      ).toMatch(/none on site admin/);
    });
  });

  it("ranks search hits by name, then by score; respects the limit", () => {
    const result = scry(snapshot, { type: "search", text: "new arrivals", limit: 3 });

    expect(result.type === "search" && result.hits.map((hit) => `${hit.type} ${hit.id}`)).toEqual([
      "flow catalog/new-arrivals",
      "route GET /api/products/new-arrivals",
      "file src/app/catalog/controllers/new-arrivals.controller.ts",
    ]);
    expect(scry(snapshot, { type: "search", text: "zzzq-qqqx" })).toMatchObject({ hits: [] });
    expect(formatScryResult(scry(snapshot, { type: "search", text: "zzzq-qqqx" }))).toEqual([
      'no match for "zzzq-qqqx"',
    ]);
  });
});

describe("scry search finds mails and jobs", () => {
  it("lists a mail and a job by their names", () => {
    const withNamed: GrimoireSnapshot = {
      ...snapshot,
      book: {
        ...snapshot.book,
        facts: {
          ...snapshot.book.facts,
          named: [
            ...snapshot.book.facts.named,
            { type: "mail", name: "zz-verification", file: "src/app/users/zz.email.ts" },
            { type: "job", name: "zz-reengagement", file: null },
            { type: "event", name: "zz-event", file: null },
          ],
        },
      },
    };
    const hitsFor = (text: string) => {
      const result = scry(withNamed, { type: "search", text });

      return result.type === "search" ? result.hits.map((hit) => `${hit.type} ${hit.id}`) : [];
    };

    // The exact name ranks first; hits that share only some words follow it.
    expect(hitsFor("zz-verification")[0]).toBe("mail zz-verification");
    expect(hitsFor("zz-reengagement")[0]).toBe("job zz-reengagement");
    // Events are not search candidates: the name finds no event, only hits that share a word.
    expect(hitsFor("zz-event").some((hit) => hit.startsWith("event "))).toBe(false);
  });
});

describe("scry search ranking and impact caps", () => {
  const scoresOf = (text: string) => {
    const result = scry(snapshot, { type: "search", text, limit: 200 });

    return result.type === "search" ? result.hits : [];
  };

  it("ranks name matches above every scored match, with features and flows two levels up", () => {
    const flowScore = (text: string) =>
      scoresOf(text).find((hit) => hit.id === "catalog/new-arrivals")?.score;
    const routeScore = (text: string) =>
      scoresOf(text).find((hit) => hit.id === "GET /api/products/new-arrivals")?.score;

    // Both names end with the whole text (level 7); the flow adds two levels, and the
    // BM25F score only orders hits inside a level (it adds less than one).
    const gap = (flowScore("new arrivals") ?? 0) - (routeScore("new arrivals") ?? 0);

    expect(scoresOf("new arrivals")[0]?.id).toBe("catalog/new-arrivals");
    expect(gap).toBeGreaterThan(1);
    expect(gap).toBeLessThan(3);
    // A whole word of the name (level 5) still puts the flow first.
    expect(scoresOf("arrivals")[0]?.id).toBe("catalog/new-arrivals");
    // A stemmed form matches through the score, below names; in-order letters no longer match.
    expect(flowScore("arrival")).toBeGreaterThan(0);
    expect(scoresOf("newarr")).toEqual([]);
  });

  it("prints hits in score order, whatever the type", () => {
    for (const text of ["arrivals", "products", "new arrivals"]) {
      const scores = scoresOf(text).map((hit) => hit.score);

      expect(scores).toEqual([...scores].sort((left, right) => right - left));
    }

    const types = scoresOf("new arrivals").map((hit) => hit.type);

    // A route and a file outrank the blocks of the same words: no grouping by type.
    expect(types.indexOf("route")).toBeLessThan(types.indexOf("block"));
    expect(types.indexOf("file")).toBeLessThan(types.indexOf("block"));
  });

  function bigImpact(): ScryResult {
    const routes = Array.from({ length: 30 }, (_, index) => ({
      method: "GET",
      path: `/api/r${index}`,
      name: null,
      handlerFile: null,
    }));

    return {
      type: "impact",
      file: "src/a.ts",
      notes: [],
      importers: { direct: ["src/b.ts"], all: ["src/b.ts", "src/c.ts"] },
      routes,
      pages: [],
      flows: [],
      features: [],
      tests: Array.from({ length: 21 }, (_, index) => `src/t${index}.test.ts`),
    };
  }

  it("counts each impact section and stops long lists at 20 lines", () => {
    const lines = formatScryResult(bigImpact());

    expect(lines.filter((line) => line.includes("/api/r"))).toHaveLength(20);
    expect(lines.some((line) => line.startsWith("routes (30)"))).toBe(true);
    expect(lines).toContain("              … and 10 more (--all lists every one)");
    expect(lines.some((line) => line.startsWith("tests (21)"))).toBe(true);
    expect(lines.some((line) => line.includes("… and 1 more"))).toBe(true);
    expect(lines.some((line) => line.startsWith("pages"))).toBe(false);
  });

  it("prints every line with all", () => {
    const lines = formatScryResult(bigImpact(), { all: true });

    expect(lines.filter((line) => line.includes("/api/r"))).toHaveLength(30);
    expect(lines.some((line) => line.includes("more"))).toBe(false);
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
