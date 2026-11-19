/** The business-only static export (`build --site --product`) and the freshness skip. */
import { readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
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
