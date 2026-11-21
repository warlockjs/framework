/**
 * Route facts that shrank or look incomplete are never reported as fresh: a
 * live read far below the stored list keeps the stored list, facts without a
 * source file get a pointed message, and the dev tab reopens when a routes
 * file changes.
 */
import { readFileSync, utimesSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildBook } from "../src/book/build";
import type { BookFacts } from "../src/contracts";
import { createSnapshotSource } from "../src/devtools/snapshot-source";
import { GRIMOIRE_PATHS } from "../src/paths";
import { formatScryResult, scry } from "../src/scry";
import { runBuild } from "../src/warlock/actions";
import { openGrimoire } from "../src/workspace";
import { createShopAdapter, shopFacts } from "./fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "./support/copy-fixture";

let copy: FixtureCopy | null = null;

afterEach(() => {
  copy?.remove();
  copy = null;
});

const manyRoutes = (count: number): BookFacts => {
  const base = structuredClone(shopFacts);
  const first = base.routes?.[0];

  if (!first) throw new Error("the fixture has no routes");

  base.routes = Array.from({ length: count }, (_, index) => ({
    ...first,
    path: `/api/bulk/${index}`,
    name: `bulk.${index}`,
  }));

  return base;
};

const fileOf = (root: string, entry: string): string =>
  readFileSync(path.join(root, ...entry.split("/")), "utf8");

describe("a live read that found far fewer routes", () => {
  it("keeps the stored list, adds a note and writes nothing", async () => {
    copy = copyFixture();
    const full = manyRoutes(277);

    const built = await buildBook(copy.root, createShopAdapter(full), { routes: "fresh" });

    expect(built.book.manifest.boot.counts).toEqual({
      routes: 277,
      pages: full.pages.length,
    });

    // Make the stored route facts look old without touching any source file.
    const manifestFile = path.join(copy.root, ...GRIMOIRE_PATHS.bookManifest.split("/"));
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    const firstInput = Object.keys(manifest.boot.inputs)[0] ?? "";

    manifest.boot.inputs[firstInput] = "0".repeat(8);
    copy.write(GRIMOIRE_PATHS.bookManifest, `${JSON.stringify(manifest, null, 2)}\n`);

    const manifestBefore = fileOf(copy.root, GRIMOIRE_PATHS.bookManifest);
    const factsBefore = fileOf(copy.root, GRIMOIRE_PATHS.bookFactsCache);
    const small = await buildBook(copy.root, createShopAdapter(manyRoutes(10)), {
      routes: "fresh",
    });

    expect(small.book.facts.routes).toHaveLength(277);
    expect(small.book.routes).toBe("stale");
    expect(small.book.routeNote).toContain("10 routes against the 277 stored");
    expect(small.rebuilt).toBe(false);
    expect(fileOf(copy.root, GRIMOIRE_PATHS.bookManifest)).toBe(manifestBefore);
    expect(fileOf(copy.root, GRIMOIRE_PATHS.bookFactsCache)).toBe(factsBefore);
  });

  it("prints the note from warlock grimoire build, and accepts the smaller list with --force", async () => {
    copy = copyFixture();

    await buildBook(copy.root, createShopAdapter(manyRoutes(277)), { routes: "fresh" });
    copy.replace("src/app/orders/routes.ts", "\n", "\n// changed\n");

    const lines: string[] = [];
    const io = { out: (line: string) => lines.push(line), err: (line: string) => lines.push(line) };
    const small = createShopAdapter(manyRoutes(10));

    expect(await runBuild({ root: copy.root, adapter: small, io })).toBe(0);
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^note {6}a live read found 10 routes against the 277 stored; .*--force/,
      ),
    );

    // A forced build trusts the read: the routes were really removed.
    const forced = await buildBook(copy.root, small, { routes: "fresh", force: true });

    expect(forced.book.facts.routes).toHaveLength(10);
    expect(forced.book.routes).toBe("fresh");
    expect(forced.book.routeNote).toBeUndefined();
    expect(forced.book.manifest.boot.counts?.routes).toBe(10);
  });
});

describe("route facts without a source file", () => {
  it("says the facts look incomplete in the GR9002 error and in impact answers", async () => {
    copy = copyFixture();
    const facts = structuredClone(shopFacts);

    facts.routes = (facts.routes ?? []).map((route) => ({ ...route, sourceFile: null }));

    const snapshot = await openGrimoire(copy.root, createShopAdapter(facts), {
      routes: "fresh",
      write: false,
    });

    expect(() => scry(snapshot, { type: "route", method: "GET", path: "/nope" })).toThrow(
      "No route matches GET /nope; route facts look incomplete; run warlock grimoire build.",
    );

    const impact = scry(snapshot, {
      type: "impact",
      file: "src/app/catalog/models/product.model.ts",
    });

    expect(formatScryResult(impact).at(-1)).toBe(
      "note      route facts look incomplete; run warlock grimoire build",
    );
  });
});

describe("the dev tab and a routes-file edit", () => {
  it("opens again at once and reports the route facts stale", async () => {
    copy = copyFixture();
    const adapter = createShopAdapter();

    await openGrimoire(copy.root, adapter, { routes: "fresh" });

    const source = createSnapshotSource(copy.root, { adapter, write: true, ttlMs: 600_000 });
    const first = await source.get();

    expect(first.routes).toBe("fresh");

    const routesFile = path.join(copy.root, "src", "app", "orders", "routes.ts");

    copy.replace("src/app/orders/routes.ts", "\n", "\n// changed\n");
    const later = new Date(Date.now() + 10_000);

    utimesSync(routesFile, later, later);

    const second = await source.get();

    expect(second).not.toBe(first);
    expect(second.routes).toBe("stale");
  });
});

describe("the dev tab with live facts and a routes-file edit", () => {
  it("reads the routes again from the running app and shows the new route as fresh", async () => {
    copy = copyFixture();
    const facts = structuredClone(shopFacts);
    const adapter = createShopAdapter(facts);

    await openGrimoire(copy.root, adapter, { routes: "fresh" });

    const source = createSnapshotSource(copy.root, {
      adapter,
      write: true,
      ttlMs: 600_000,
      liveFacts: true,
    });
    const first = await source.get();
    const reads = adapter.calls.routes;

    expect(first.routes).toBe("fresh");

    // The dev server reloaded the edited routes file: the running app now serves one more route.
    const order = facts.routes?.find((route) => route.path === "/api/orders");

    if (order === undefined) throw new Error("the fixture has no /api/orders");

    facts.routes = [...(facts.routes ?? []), { ...order, method: "GET", path: "/api/orders/live" }];

    const routesFile = path.join(copy.root, "src", "app", "orders", "routes.ts");

    copy.replace("src/app/orders/routes.ts", "\n", "\n// changed\n");
    const later = new Date(Date.now() + 10_000);

    utimesSync(routesFile, later, later);

    const second = await source.get();

    expect(adapter.calls.routes).toBe(reads + 1);
    expect(second.routes).toBe("fresh");
    expect(second.book.facts.routes?.map((route) => route.path)).toContain("/api/orders/live");
  });
});
