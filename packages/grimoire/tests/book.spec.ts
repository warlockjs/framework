/**
 * The book builder over the `shop` fixture: golden files, freshness, the
 * route cache, incremental writes and removals, and both path separators.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildBook, loadBook, writeBook } from "../src/book";
import { GrimoireError } from "../src/codes";
import type { BookAdapter, BookAnnotations, BookFacts } from "../src/contracts";
import { createShopAdapter, shopFacts } from "./fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "./support/copy-fixture";

const goldenRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "golden", "book");
const updateGolden = process.env.GRIMOIRE_UPDATE_GOLDEN === "1";
const fixedNow = (): Date => new Date("2026-11-16T10:00:00.000Z");

/** Owners, borrowers and flows as the ownership step would compute them for the fixture. */
function shopAnnotations(facts: BookFacts = shopFacts): BookAnnotations {
  const owner = (file: string): string | null => {
    if (file === "src/app/shared/jobs/delete-unverified.job.ts") return "auth";

    const match = /^src\/app\/(catalog|orders|auth)\//.exec(file);

    return match?.[1] ?? null;
  };
  const flows: Record<string, string[]> = {
    "src/app/catalog/controllers/new-arrivals.controller.ts": ["catalog/new-arrivals"],
    "src/app/catalog/services/new-arrivals.service.ts": ["catalog/new-arrivals"],
    "src/app/catalog/repositories/products.repository.ts": [
      "catalog/browse-products",
      "catalog/new-arrivals",
    ],
    "src/app/orders/controllers/place-order.controller.ts": ["orders/place-order"],
  };
  const files: BookAnnotations["files"] = {};

  for (const file of facts.files) {
    const feature = owner(file.file);
    const borrowers = new Set(
      file.importedBy
        .map(owner)
        .filter((value): value is string => value !== null && value !== feature),
    );

    files[file.file] = { feature, borrowedBy: [...borrowers], flows: flows[file.file] ?? [] };
  }

  return { writtenHash: "written-1", tests: {}, files };
}

/** Every file under a folder (dot folders included), project-relative to that folder. */
function filesUnder(folder: string): string[] {
  if (!existsSync(folder)) return [];

  return (readdirSync(folder, { recursive: true }) as string[])
    .map((file) => file.split(path.sep).join("/"))
    .filter((file) => statSync(path.join(folder, file)).isFile())
    .sort();
}

/** Size, inode and nanosecond mtime of every file under a folder: any write changes it. */
function snapshot(folder: string): Record<string, string> {
  return Object.fromEntries(
    filesUnder(folder).map((file) => {
      const info = statSync(path.join(folder, file), { bigint: true });

      return [file, `${info.size}:${info.ino}:${info.mtimeNs}`];
    }),
  );
}

const bookDir = (copy: FixtureCopy): string => path.join(copy.root, "grimoire", "book");

/** The book files the goldens hold: everything except the manifest and the machine cache. */
function goldenFiles(folder: string): string[] {
  return filesUnder(folder).filter(
    (file) => file !== "manifest.json" && !file.startsWith(".cache/"),
  );
}

const copies: FixtureCopy[] = [];

function fixture(): FixtureCopy {
  const copy = copyFixture();
  copies.push(copy);

  return copy;
}

afterEach(() => {
  while (copies.length > 0) copies.pop()?.remove();
});

async function buildAndWrite(
  copy: FixtureCopy,
  adapter: BookAdapter,
  options: Parameters<typeof buildBook>[2] = {},
  facts: BookFacts = shopFacts,
) {
  const result = await buildBook(copy.root, adapter, { now: fixedNow, ...options });
  const write = await writeBook(result.book, shopAnnotations(facts));

  return { ...result, ...write };
}

function expectGolden(copy: FixtureCopy): void {
  const actual = goldenFiles(bookDir(copy));

  if (updateGolden) {
    rmSync(goldenRoot, { recursive: true, force: true });

    for (const file of actual) {
      const target = path.join(goldenRoot, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, readFileSync(path.join(bookDir(copy), file)));
    }
  }

  expect(actual).toEqual(goldenFiles(goldenRoot));

  for (const file of actual) {
    expect(readFileSync(path.join(bookDir(copy), file), "utf8"), file).toBe(
      readFileSync(path.join(goldenRoot, file), "utf8"),
    );
  }
}

describe("the book of the shop fixture", () => {
  it("matches the golden files", async () => {
    const copy = fixture();
    const result = await buildAndWrite(copy, createShopAdapter(), { routes: "fresh" });

    expect(result.rebuilt).toBe(true);
    expect(result.book.routes).toBe("fresh");
    expect(result.removed).toEqual([]);
    expect(result.written).toContain("grimoire/book/app/auth/controllers/login.controller.json");
    expect(result.written).toContain("grimoire/book/app/routes.json");
    expect(result.written).toContain("grimoire/book/web/client.pages.json");
    expect(result.written).toContain("grimoire/book/mobile/mobile/app/products/[id].json");
    expect(result.written).toContain("grimoire/book/mobile/mobile.screens.json");
    expect(result.written).toContain("grimoire/book/app/catalog/index.md");
    expect(result.changed).toHaveLength(shopFacts.files.length);
    expectGolden(copy);
  });

  it("writes the manifest: versions, a hash per source file with its entry, tests and route inputs", async () => {
    const copy = fixture();
    const { book } = await buildAndWrite(copy, createShopAdapter(), { routes: "fresh" });
    const manifest = JSON.parse(copy.read("grimoire/book/manifest.json"));

    expect(manifest).toEqual(book.manifest);
    expect(manifest.adapter).toEqual({ name: "shop-fixture", version: "1.0.0" });
    expect(manifest.sourceRoots).toEqual(["mobile", "src"]);
    expect(manifest.writtenHash).toBe("written-1");
    expect(manifest.files["src/app/auth/controllers/login.controller.ts"]).toMatchObject({
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      entry: "grimoire/book/app/auth/controllers/login.controller.json",
    });
    expect(Object.keys(manifest.files)).toHaveLength(shopFacts.files.length);
    expect(manifest.boot.collectedAt).toBe("2026-11-16T10:00:00.000Z");
    expect(Object.keys(manifest.boot.inputs)).toContain(
      "src/app/catalog/services/new-arrivals.service.ts",
    );
    expect(manifest.boot.inputs["package.json"]).toBe("");
    expect(JSON.parse(copy.read("grimoire/book/.cache/facts.json")).facts.routes).toHaveLength(9);
  });

  it("computes in memory only when asked not to write", async () => {
    const copy = fixture();
    const options = { routes: "fresh", now: fixedNow, write: false } as Parameters<
      typeof buildBook
    >[2];
    const result = await buildBook(copy.root, createShopAdapter(), options);

    expect(result.book.facts.files).toHaveLength(shopFacts.files.length);
    expect(existsSync(bookDir(copy))).toBe(false);
  });

  it("loads the book without an adapter", async () => {
    const copy = fixture();

    expect(await loadBook(copy.root)).toBeNull();

    const { book } = await buildAndWrite(copy, createShopAdapter(), { routes: "fresh" });
    const loaded = await loadBook(copy.root);

    expect(loaded?.facts).toEqual(book.facts);
    expect(loaded?.manifest).toEqual(book.manifest);
    expect(loaded?.routes).toBe("cached");
  });
});

describe("freshness", () => {
  it("does no work when nothing changed: one sourceRoots call, no file written", async () => {
    const copy = fixture();
    await buildAndWrite(copy, createShopAdapter(), { routes: "fresh" });

    const before = snapshot(bookDir(copy));
    const adapter = createShopAdapter();
    const result = await buildAndWrite(copy, adapter, { routes: "fresh" });

    expect(adapter.calls).toEqual({
      sourceRoots: 1,
      files: 0,
      routes: 0,
      sites: 0,
      pages: 0,
      mobile: 0,
      named: 0,
      tests: 0,
    });
    expect(result).toMatchObject({ rebuilt: false, changed: [], written: [], removed: [] });
    expect(result.book.routes).toBe("fresh");
    expect(snapshot(bookDir(copy))).toEqual(before);
  });

  it("rebuilds only the entries of a changed file, without touching the routes", async () => {
    const copy = fixture();
    await buildAndWrite(copy, createShopAdapter(), { routes: "fresh" });

    const file = "src/web/$sites/client/home.setup.ts";
    copy.write(file, `${copy.read(file)}// one more line\n`);

    const facts = structuredClone(shopFacts);
    const changed = facts.files.find((entry) => entry.file === file);
    if (changed) changed.lines += 1;

    const adapter = createShopAdapter(facts);
    const result = await buildAndWrite(copy, adapter, { routes: "fresh" }, facts);

    expect(result.rebuilt).toBe(true);
    expect(result.changed).toEqual([file]);
    expect(adapter.calls).toMatchObject({ files: 1, routes: 0, named: 0 });
    expect(result.book.routes).toBe("fresh");
    expect(result.written).toEqual([
      "grimoire/book/web/$sites/client/home.setup.json",
      "grimoire/book/web/index.md",
    ]);
    expect(result.removed).toEqual([]);
  });

  it("marks routes stale when a routes input changes, and refreshes them only when asked", async () => {
    const copy = fixture();
    await buildAndWrite(copy, createShopAdapter(), { routes: "fresh" });

    copy.write(
      "src/app/catalog/routes.ts",
      `${copy.read("src/app/catalog/routes.ts")}// touched\n`,
    );

    const cached = createShopAdapter();
    const first = await buildBook(copy.root, cached, { routes: "cached", now: fixedNow });

    expect(first.rebuilt).toBe(true);
    expect(first.book.routes).toBe("stale");
    expect(first.book.facts.routes).toHaveLength(9);
    expect(cached.calls).toMatchObject({ files: 1, routes: 0, named: 0 });

    // Still stale on the next cached run: the stored inputs are the old ones.
    const again = createShopAdapter();
    expect((await buildBook(copy.root, again, { routes: "cached" })).book.routes).toBe("stale");
    expect(again.calls).toMatchObject({ files: 0, routes: 0, named: 0 });

    const fresh = createShopAdapter();
    const refreshed = await buildBook(copy.root, fresh, { routes: "fresh", now: fixedNow });

    expect(refreshed.book.routes).toBe("fresh");
    expect(refreshed.rebuilt).toBe(true);
    expect(fresh.calls).toMatchObject({ files: 0, routes: 1, named: 1 });

    const settled = createShopAdapter();
    expect((await buildBook(copy.root, settled, { routes: "fresh" })).rebuilt).toBe(false);
    expect(settled.calls).toMatchObject({ sourceRoots: 1, files: 0, routes: 0, named: 0 });
  });

  it("tracks a file a routes file starts importing after a cached rebuild", async () => {
    const copy = fixture();
    await buildAndWrite(copy, createShopAdapter(), { routes: "fresh" });

    // Not a route input until the routes file imports it.
    const added = "src/web/$sites/client/home.setup.ts";
    const facts = structuredClone(shopFacts);
    const routesFile = facts.files.find((entry) => entry.file === "src/app/orders/routes.ts");
    routesFile?.imports.push({ specifier: "web/$sites/client/home.setup", file: added });
    copy.write(
      "src/app/orders/routes.ts",
      `${copy.read("src/app/orders/routes.ts")}// imports the setup file now\n`,
    );

    expect(
      (await buildBook(copy.root, createShopAdapter(facts), { routes: "cached" })).book.routes,
    ).toBe("stale");

    const refreshed = await buildBook(copy.root, createShopAdapter(facts), {
      routes: "fresh",
      now: fixedNow,
    });

    expect(refreshed.book.routes).toBe("fresh");
    expect(Object.keys(refreshed.book.manifest.boot.inputs)).toContain(added);
  });

  it("notices a route input outside the source roots (package.json)", async () => {
    const copy = fixture();
    await buildAndWrite(copy, createShopAdapter(), { routes: "fresh" });
    copy.write("package.json", "{}\n");

    const cached = createShopAdapter();
    const stale = await buildBook(copy.root, cached, { routes: "cached" });

    expect(stale).toMatchObject({ rebuilt: false, changed: [] });
    expect(stale.book.routes).toBe("stale");
    expect(cached.calls).toMatchObject({ files: 0, routes: 0 });

    const fresh = createShopAdapter();
    const refreshed = await buildBook(copy.root, fresh, { routes: "fresh", now: fixedNow });

    expect(refreshed.book.routes).toBe("fresh");
    expect(fresh.calls).toMatchObject({ files: 0, routes: 1, named: 1 });
  });

  it("never calls routes or named for a file-only build", async () => {
    const copy = fixture();
    const adapter = createShopAdapter();
    const result = await buildAndWrite(copy, adapter);

    expect(adapter.calls).toMatchObject({ files: 1, routes: 0, named: 0 });
    expect(result.book.routes).toBe("missing");
    expect(result.book.facts.routes).toBeNull();
    expect(result.book.facts.named).toEqual([]);
    expect(existsSync(path.join(bookDir(copy), "app", "routes.json"))).toBe(false);

    // A later fresh build collects them once, without rebuilding the static facts.
    const fresh = createShopAdapter();
    const refreshed = await buildAndWrite(copy, fresh, { routes: "fresh" });

    expect(fresh.calls).toMatchObject({ files: 0, routes: 1, named: 1 });
    expect(refreshed.book.routes).toBe("fresh");
    expect(refreshed.written).toContain("grimoire/book/app/routes.json");
    expect(refreshed.written).toContain("grimoire/book/app/catalog/index.md");
  });

  it("deletes entries of removed files and keeps test results, the static site and the cache", async () => {
    const copy = fixture();
    await buildAndWrite(copy, createShopAdapter(), { routes: "fresh" });
    copy.write("grimoire/book/test-results.json", "{}\n");
    mkdirSync(path.join(bookDir(copy), "site"), { recursive: true });
    copy.write("grimoire/book/site/index.html", "<!doctype html>\n");

    const gone = "src/app/orders/notifications/order-shipped.notification.ts";
    rmSync(path.join(copy.root, ...gone.split("/")));

    const facts = structuredClone(shopFacts);
    facts.files = facts.files.filter((entry) => entry.file !== gone);
    facts.named = facts.named.filter((thing) => thing.file !== gone);

    for (const entry of facts.files) {
      entry.imports = entry.imports.filter((item) => item.file !== gone);
      entry.importedBy = entry.importedBy.filter((item) => item !== gone);
    }

    const result = await buildAndWrite(copy, createShopAdapter(facts), { routes: "fresh" }, facts);

    expect(result.changed).toEqual([gone]);
    expect(result.removed).toEqual([
      "grimoire/book/app/orders/notifications/order-shipped.notification.json",
    ]);
    expect(existsSync(path.join(bookDir(copy), "app", "orders", "notifications"))).toBe(false);
    expect(copy.read("grimoire/book/test-results.json")).toBe("{}\n");
    expect(copy.read("grimoire/book/site/index.html")).toBe("<!doctype html>\n");
    expect(existsSync(path.join(bookDir(copy), ".cache", "facts.json"))).toBe(true);
  });

  it("restores edited or deleted entries on a forced build, rewriting only those", async () => {
    const copy = fixture();
    await buildAndWrite(copy, createShopAdapter(), { routes: "fresh" });
    rmSync(path.join(bookDir(copy), "app", "catalog", "routes.json"));
    copy.write("grimoire/book/app/auth/routes.json", "{}\n");

    const adapter = createShopAdapter();
    const result = await buildAndWrite(copy, adapter, { routes: "fresh", force: true });

    expect(adapter.calls).toMatchObject({ files: 1, routes: 1, named: 1 });
    expect(result.written).toEqual([
      "grimoire/book/app/auth/routes.json",
      "grimoire/book/app/catalog/routes.json",
    ]);
    expectGolden(copy);
  });

  it("rebuilds when the adapter version changes", async () => {
    const copy = fixture();
    await buildAndWrite(copy, createShopAdapter(), { routes: "fresh" });

    const adapter = { ...createShopAdapter(), version: "2.0.0" };
    const result = await buildBook(copy.root, adapter, { routes: "cached" });

    expect(result.rebuilt).toBe(true);
    expect(result.book.manifest.adapter.version).toBe("2.0.0");
    expect(result.book.routes).toBe("fresh");
  });
});

describe("paths and safety", () => {
  it("builds the same book from Windows-style adapter paths", async () => {
    const copy = fixture();
    const win = (value: string): string => value.split("/").join("\\");
    const facts = structuredClone(shopFacts);

    for (const file of facts.files) {
      file.file = win(file.file);
      file.module = win(file.module);
      file.importedBy = file.importedBy.map(win);
      file.imports = file.imports.map((item) => ({
        ...item,
        file: item.file === null ? null : win(item.file),
      }));
    }

    for (const route of facts.routes ?? []) {
      route.sourceFile = route.sourceFile === null ? null : win(route.sourceFile);
      route.handlerFile = route.handlerFile === null ? null : win(route.handlerFile);
    }

    for (const page of facts.pages) {
      page.file = win(page.file);
      page.setupFile = page.setupFile === null ? null : win(page.setupFile);
      page.layouts = page.layouts.map(win);
      page.loaders = page.loaders.map(win);
      page.reachedFrom =
        page.reachedFrom?.map((link) => ({ ...link, from: win(link.from) })) ?? null;
    }

    for (const app of facts.mobile) {
      app.routesDir = app.routesDir === null ? null : win(app.routesDir);
      app.screens = app.screens.map((screen) => ({
        ...screen,
        file: win(screen.file),
        layouts: screen.layouts.map(win),
      }));
    }

    for (const site of facts.sites) site.root = win(site.root);

    facts.tests = facts.tests.map(win);

    const adapter = {
      ...createShopAdapter(facts),
      sourceRoots: async () => ["src\\", ".\\mobile"],
    };
    const result = await buildBook(copy.root, adapter, { routes: "fresh", now: fixedNow });
    await writeBook(result.book, shopAnnotations());

    expect(result.book.manifest.sourceRoots).toEqual(["mobile", "src"]);
    expect(result.book.facts.tests).toContain("src/app/catalog/tests/new-arrivals.test.ts");
    expectGolden(copy);
  });

  it("writes nothing outside grimoire/book and leaves no temporary files", async () => {
    const copy = fixture();
    const outside = (): Record<string, string> =>
      Object.fromEntries(
        Object.entries(snapshot(copy.root)).filter(([file]) => !file.startsWith("grimoire/book/")),
      );
    const before = outside();
    const facts = structuredClone(shopFacts);
    facts.files.push({
      ...structuredClone(shopFacts.files[0]!),
      file: "../escape/x.ts",
      module: "../escape",
    });

    await buildAndWrite(copy, createShopAdapter(facts), { routes: "fresh" }, facts);

    expect(outside()).toEqual(before);
    expect(filesUnder(bookDir(copy)).filter((file) => file.endsWith(".tmp"))).toEqual([]);
  });

  it("reports GR8001 when the adapter cannot read the source files", async () => {
    const copy = fixture();
    const adapter = {
      ...createShopAdapter(),
      files: async () => {
        throw new Error("disk on fire");
      },
    };
    const error = await buildBook(copy.root, adapter).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GrimoireError);
    expect(error).toMatchObject({ code: "GR8001" });
    expect((error as Error).message).toContain("disk on fire");
  });
});

describe("a large project", () => {
  it("builds 3000 files and answers a no-change run with one adapter call", async () => {
    const copy = fixture();
    const count = 3000;
    const files: BookFacts["files"] = [];

    for (let index = 0; index < count; index++) {
      const file = `src/app/big/services/s${index}.service.ts`;
      const imported = index + 1 < count ? `src/app/big/services/s${index + 1}.service.ts` : null;

      files.push({
        file,
        module: "src/app/big",
        type: index === 0 ? "routes" : "service",
        lines: 1,
        about: null,
        tags: {},
        exports: [],
        imports:
          imported === null ? [] : [{ specifier: `./s${index + 1}.service`, file: imported }],
        importedBy: index === 0 ? [] : [`src/app/big/services/s${index - 1}.service.ts`],
        mobileApp: null,
      });
    }

    mkdirSync(path.join(copy.root, "src", "app", "big", "services"), { recursive: true });

    for (const file of files)
      writeFileSync(path.join(copy.root, ...file.file.split("/")), `// ${file.file}\n`);

    const facts: BookFacts = {
      ...structuredClone(shopFacts),
      files: [...structuredClone(shopFacts.files), ...files],
    };
    const first = await buildAndWrite(copy, createShopAdapter(facts), { routes: "fresh" }, facts);

    expect(first.written.length).toBeGreaterThan(count);
    // The routes file's import chain reaches every file: all are route inputs.
    expect(Object.keys(first.book.manifest.boot.inputs).length).toBeGreaterThan(count);

    const adapter = createShopAdapter(facts);
    const second = await buildAndWrite(copy, adapter, { routes: "fresh" }, facts);

    expect(second).toMatchObject({ rebuilt: false, written: [], removed: [] });
    expect(adapter.calls.sourceRoots).toBe(1);
    expect(adapter.calls.files).toBe(0);
  }, 60_000);
});
