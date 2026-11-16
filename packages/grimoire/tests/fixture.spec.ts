/**
 * The `shop` fixture's static facts must agree with its files on disk, or
 * every spec built on them tests a project that does not exist.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isCodeFile, toPosixPath } from "../src/paths";
import { createShopAdapter, shopFacts, shopRoot } from "./fixtures/shop-facts";

function codeFilesUnder(folder: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const absolute = path.join(directory, name);

      if (statSync(absolute).isDirectory()) walk(absolute);
      else if (isCodeFile(name)) found.push(toPosixPath(path.relative(shopRoot, absolute)));
    }
  };

  walk(path.join(shopRoot, folder));

  return found.sort();
}

const lines = (file: string): number =>
  readFileSync(path.join(shopRoot, file), "utf8").split("\n").length - 1;

describe("the shop fixture", () => {
  it("lists every code file under its source roots, and only those", () => {
    expect(shopFacts.files.map((file) => file.file).sort()).toEqual(
      [...codeFilesUnder("mobile"), ...codeFilesUnder("src")].sort(),
    );
  });

  it("matches each file's lines, header sentence and tags", () => {
    for (const file of shopFacts.files) {
      const text = readFileSync(path.join(shopRoot, file.file), "utf8");

      expect(lines(file.file), file.file).toBe(file.lines);
      expect(text, file.file).toContain(file.about ?? "");

      for (const [tag, values] of Object.entries(file.tags)) {
        for (const value of values) expect(text).toContain(`@${tag} ${value}`);
      }
    }
  });

  it("keeps imports and importers in step", () => {
    const known = new Set(shopFacts.files.map((file) => file.file));

    for (const file of shopFacts.files) {
      for (const imported of file.imports) {
        if (imported.file === null) continue;

        expect(known.has(imported.file), imported.file).toBe(true);
        expect(shopFacts.files.find((other) => other.file === imported.file)?.importedBy).toContain(
          file.file,
        );
      }
    }
  });

  it("points routes, pages, screens, named things and tests at real files", () => {
    const paths = [
      ...(shopFacts.routes ?? []).flatMap((route) => [route.sourceFile, route.handlerFile]),
      ...shopFacts.pages.flatMap((page) => [
        page.file,
        page.setupFile,
        ...page.layouts,
        ...page.loaders,
      ]),
      ...shopFacts.mobile.flatMap((app) =>
        app.screens.flatMap((screen) => [screen.file, ...screen.layouts]),
      ),
      ...shopFacts.named.map((thing) => thing.file),
      ...shopFacts.tests,
      ...shopFacts.sites.map((site) => site.root),
    ].filter((file): file is string => file !== null);

    for (const file of paths) expect(existsSync(path.join(shopRoot, file)), file).toBe(true);
  });

  it("has a written grimoire with features, apps, tasks and a release", () => {
    for (const file of [
      "grimoire/features/catalog/README.md",
      "grimoire/features/catalog/flows/wishlist.md",
      "grimoire/features/orders/flows/place-order.md",
      "grimoire/apps/web-client/pages/home/blocks/new-arrivals.md",
      "grimoire/apps/mobile/screens/home/README.md",
      "grimoire/tasks/done/2026-11/T-010-new-arrivals-no-country.md",
      "grimoire/releases/1.0.0.md",
    ]) {
      expect(existsSync(path.join(shopRoot, file)), file).toBe(true);
    }
  });

  it("counts adapter calls", async () => {
    const adapter = createShopAdapter();

    await adapter.files(shopRoot);
    await adapter.routes?.(shopRoot);

    expect(adapter.calls.files).toBe(1);
    expect(adapter.calls.routes).toBe(1);
    expect(adapter.calls.pages).toBe(0);
  });
});

describe("copyFixture", () => {
  it("copies the shop fixture to a folder a spec may change", async () => {
    const { copyFixture } = await import("./support/copy-fixture");
    const copy = copyFixture();

    try {
      copy.replace(
        "grimoire/features/orders/flows/place-order.md",
        "POST /api/orders",
        "POST /api/order",
      );
      expect(copy.read("grimoire/features/orders/flows/place-order.md")).toContain(
        "POST /api/order\n",
      );
      expect(
        readFileSync(path.join(shopRoot, "grimoire/features/orders/flows/place-order.md"), "utf8"),
      ).toContain("POST /api/orders");
    } finally {
      copy.remove();
    }

    expect(existsSync(copy.root)).toBe(false);
  });
});
