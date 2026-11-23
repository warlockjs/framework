/** The business-only static export (`build --site --product`) and the freshness skip. */
import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createShopAdapter } from "../../tests/fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "../../tests/support/copy-fixture";
import { openGrimoire } from "../workspace";
import { buildProductSiteData, buildSiteData, exportGrimoireSiteDetailed } from "./site";

let copy: FixtureCopy | null = null;

afterEach(() => {
  copy?.remove();
  copy = null;
});

async function open() {
  copy = copyFixture();

  return openGrimoire(copy.root, createShopAdapter(), { routes: "fresh", write: false });
}

describe("the product export", () => {
  it("carries the share-safe product answers and no file path, test name or per-file answer", async () => {
    const snapshot = await open();
    const site = buildProductSiteData(snapshot);
    const json = JSON.stringify(site);

    expect(site.routes.product).toBeDefined();
    expect(Object.keys(site.files)).toHaveLength(0);
    expect(site.search).toHaveLength(0);
    expect(Object.keys(site.routes).every((key) => key.startsWith("product"))).toBe(true);

    for (const file of snapshot.book.facts.files) expect(json).not.toContain(file.file);
    for (const test of snapshot.book.facts.tests) expect(json).not.toContain(test);
    // No written file's own path (`grimoire/features/…/README.md`) and no source path either.
    expect(json).not.toMatch(/grimoire\/[\w./-]*\.md/);
    expect(json).not.toMatch(/"(?:src|mobile|e2e)\/[\w./$-]+\.(?:ts|tsx|js)"/);
    for (const feature of snapshot.written.features)
      if (feature.readme !== null) expect(json).not.toContain(feature.readme.file);

    // Smaller than the full export of the same book.
    expect(json.length).toBeLessThan(JSON.stringify(buildSiteData(snapshot)).length);
  });

  it("writes a page that opens on the Product map without the developer view", async () => {
    const snapshot = await open();
    const exported = await exportGrimoireSiteDetailed(snapshot.root, {
      snapshot,
      outDir: "out/product",
      product: true,
    });
    const html = readFileSync(path.join(snapshot.root, exported.outDir, "index.html"), "utf8");

    expect(exported.upToDate).toBe(false);
    expect(html).toContain("<title>Product map</title>");
    expect(html).toContain("renderProductMap);");
    expect(html).not.toContain("async function renderGrimoire");
    for (const file of snapshot.book.facts.files) expect(html).not.toContain(file.file);
  });

  it("does not write again while the book is unchanged, and writes when a written file changes or force is set", async () => {
    const snapshot = await open();
    const options = { snapshot, outDir: "out/site", product: true };
    const first = await exportGrimoireSiteDetailed(snapshot.root, options);
    const page = path.join(snapshot.root, first.outDir, "index.html");
    const writtenAt = statSync(page).mtimeMs;

    expect(first.upToDate).toBe(false);

    const second = await exportGrimoireSiteDetailed(snapshot.root, options);

    expect(second.upToDate).toBe(true);
    expect(statSync(page).mtimeMs).toBe(writtenAt);

    // The same book in the other mode is a different page.
    expect(
      (await exportGrimoireSiteDetailed(snapshot.root, { ...options, product: false })).upToDate,
    ).toBe(false);
    expect((await exportGrimoireSiteDetailed(snapshot.root, options)).upToDate).toBe(false);

    expect(
      (await exportGrimoireSiteDetailed(snapshot.root, { ...options, force: true })).upToDate,
    ).toBe(false);

    const readme = path.join(snapshot.root, snapshot.written.features[0]?.readme?.file ?? "");

    writeFileSync(readme, `${readFileSync(readme, "utf8")}\n`);
    utimesSync(readme, new Date(), new Date(Date.now() + 5000));

    expect((await exportGrimoireSiteDetailed(snapshot.root, options)).upToDate).toBe(false);
  });
});

describe("the bird-view in the exports", () => {
  it("is in the developer export with its images, and not in the product export", async () => {
    const snapshot = await open();
    const flow = snapshot.written.features
      .flatMap((item) => item.flows)
      .find((item) => item.criteria.length > 0);
    const criterion = flow?.criteria[0];

    if (flow === undefined || criterion === undefined) throw new Error("no flow with a criterion");

    const shot = `captured/${flow.ref}/${criterion.id}.png`;
    const file = path.join(snapshot.root, "grimoire", "screenshots", shot);

    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "png");

    const shown = {
      ...snapshot,
      shots: {
        mode: "changed" as const,
        shows: [],
        showsFindings: [],
        captures: {
          schemaVersion: 1 as const,
          updatedAt: "2026-11-21T10:00:00.000Z",
          captures: [
            {
              ref: flow.ref,
              criterion: criterion.id,
              language: "",
              file: shot,
              sha256: "abc",
              outcome: "pass" as const,
              error: null,
              viewport: { name: "desktop", width: 1280, height: 800 },
              spec: "e2e/shows.e2e.ts",
              ranAt: "2026-11-21T10:00:00.000Z",
            },
          ],
        },
        baseline: null,
        drift: [],
        optedOut: [],
      },
    };

    shown.shots.shows.push({
      feature: flow.feature,
      flow: flow.id.value,
      ref: flow.ref,
      criterion: criterion.id,
      call: null,
      at: { file: "e2e/shows.e2e.ts", line: 1, column: null },
    } as never);

    const full = buildSiteData(shown);
    const matrix = full.routes.matrix as { development: boolean };

    expect(matrix.development).toBe(false);
    expect(JSON.stringify(full.routes.matrix)).toContain(shot);
    expect(buildProductSiteData(shown).routes.matrix).toBeUndefined();

    const developer = await exportGrimoireSiteDetailed(snapshot.root, {
      snapshot: shown,
      outDir: "out/developer",
    });
    const product = await exportGrimoireSiteDetailed(snapshot.root, {
      snapshot: shown,
      outDir: "out/business",
      product: true,
    });

    expect(existsSync(path.join(snapshot.root, developer.outDir, "screenshots", shot))).toBe(true);
    expect(existsSync(path.join(snapshot.root, product.outDir, "screenshots", shot))).toBe(false);
  });

  it("puts what's new in both exports", async () => {
    const snapshot = await open();

    expect(buildSiteData(snapshot).routes["product/whats-new"]).toBeDefined();
    expect(buildProductSiteData(snapshot).routes["product/whats-new"]).toBeDefined();
  });
});
