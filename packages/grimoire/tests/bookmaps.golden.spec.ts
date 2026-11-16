/**
 * The book maps and indexes of the `shop` fixture, through the whole
 * `openGrimoire` pipeline, compared with the golden files in
 * `tests/golden/bookmaps/`. Regenerate them with
 * `GRIMOIRE_UPDATE_GOLDEN=1 npx vitest run tests/bookmaps.golden.spec.ts`
 * and review the diff.
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
import { openGrimoire } from "../src/workspace";
import { createShopAdapter } from "./fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "./support/copy-fixture";

const goldenDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "golden", "bookmaps");
const update = process.env.GRIMOIRE_UPDATE_GOLDEN === "1";
const now = () => new Date("2026-11-16T12:00:00.000Z");

let copy: FixtureCopy | null = null;

afterEach(() => {
  copy?.remove();
  copy = null;
});

/** Every collected file under the copy's `grimoire/`, project-relative, sorted. */
function collectedFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const absolute = path.join(directory, name);

      if (statSync(absolute).isDirectory()) {
        if (name !== "book") walk(absolute);
      } else if (
        name === "index.json" ||
        name.endsWith(".bookmap.json") ||
        name === "bookmap.json"
      ) {
        found.push(path.relative(root, absolute).split(path.sep).join("/"));
      }
    }
  };

  walk(path.join(root, "grimoire"));

  return found.sort();
}

describe("book maps of the shop fixture", () => {
  it("match the golden files", async () => {
    copy = copyFixture();
    const snapshot = await openGrimoire(copy.root, createShopAdapter(), { routes: "fresh", now });
    const files = collectedFiles(copy.root);

    expect(files).toEqual([
      "grimoire/features/auth/bookmap.json",
      "grimoire/features/auth/flows/login.bookmap.json",
      "grimoire/features/auth/flows/sign-up.bookmap.json",
      "grimoire/features/catalog/bookmap.json",
      "grimoire/features/catalog/flows/browse-products.bookmap.json",
      "grimoire/features/catalog/flows/new-arrivals.bookmap.json",
      "grimoire/features/catalog/flows/wishlist.bookmap.json",
      "grimoire/features/index.json",
      "grimoire/features/orders/bookmap.json",
      "grimoire/features/orders/flows/place-order.bookmap.json",
      "grimoire/tasks/index.json",
    ]);

    for (const file of files) {
      const actual = copy.read(file);
      const golden = path.join(goldenDir, file.replace(/^grimoire\//, ""));

      if (update) {
        mkdirSync(path.dirname(golden), { recursive: true });
        writeFileSync(golden, actual);
      }

      expect(existsSync(golden), `${golden} exists`).toBe(true);
      expect(actual, file).toBe(readFileSync(golden, "utf8"));
    }

    // The fixture is built so that every own file is reached and no file has two owners.
    for (const map of Object.values(snapshot.collected.features))
      expect(map.unreached, map.feature).toEqual([]);
    expect(
      Object.values(snapshot.ownership.files).filter((file) => file.conflicts.length > 0),
    ).toEqual([]);
  });

  it("rewrites nothing on a second run and calls no adapter method", async () => {
    copy = copyFixture();
    await openGrimoire(copy.root, createShopAdapter(), { routes: "fresh", now });
    const before = collectedFiles(copy.root).map((file) => [
      file,
      statSync(path.join(copy?.root ?? "", file)).mtimeMs,
    ]);
    const adapter = createShopAdapter();

    await openGrimoire(copy.root, adapter, { routes: "fresh", now });

    expect(
      collectedFiles(copy.root).map((file) => [
        file,
        statSync(path.join(copy?.root ?? "", file)).mtimeMs,
      ]),
    ).toEqual(before);
    expect(
      adapter.calls.files + adapter.calls.routes + adapter.calls.pages + adapter.calls.named,
    ).toBe(0);
  });

  it("removes the book map of a deleted flow and updates only what changed", async () => {
    copy = copyFixture();
    await openGrimoire(copy.root, createShopAdapter(), { routes: "fresh", now });
    const flowsBefore = readFileSync(
      path.join(copy.root, "grimoire/features/catalog/flows/new-arrivals.bookmap.json"),
      "utf8",
    );

    rmSync(path.join(copy.root, "grimoire/features/catalog/flows/wishlist.md"));
    copy.replace(
      "grimoire/features/catalog/README.md",
      "- wishlist          save a product for later\n",
      "",
    );

    await openGrimoire(copy.root, createShopAdapter(), { routes: "fresh", now });

    expect(
      existsSync(path.join(copy.root, "grimoire/features/catalog/flows/wishlist.bookmap.json")),
    ).toBe(false);
    expect(copy.read("grimoire/features/catalog/flows/new-arrivals.bookmap.json")).toBe(
      flowsBefore,
    );
    expect(
      JSON.parse(copy.read("grimoire/features/index.json")).features[1].flows.map(
        (flow: { id: string }) => flow.id,
      ),
    ).toEqual(["browse-products", "new-arrivals"]);
  });

  it("reports a file claimed by two features and a file with no owner", async () => {
    copy = copyFixture();
    copy.replace(
      "grimoire/features/orders/README.md",
      "folders: [src/app/orders]",
      "folders: [src/app/orders, src/app/catalog]",
    );

    const snapshot = await openGrimoire(copy.root, createShopAdapter(), {
      routes: "fresh",
      now,
      write: false,
    });
    const repository =
      snapshot.ownership.files["src/app/catalog/repositories/products.repository.ts"];

    expect(repository).toMatchObject({
      owner: null,
      conflicts: [
        { feature: "catalog", via: "folder" },
        { feature: "orders", via: "folder" },
      ],
    });
    expect(snapshot.ownership.files["src/app/shared/utils/money.ts"]?.owner).toBeNull();
    expect(snapshot.ownership.files["src/app/shared/jobs/delete-unverified.job.ts"]).toMatchObject({
      owner: "auth",
      via: "tag",
    });
  });
});
