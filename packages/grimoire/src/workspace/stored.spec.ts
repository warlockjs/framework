/**
 * The read-only open: answers equal the full pipeline's on a fresh book, no
 * expensive step runs, nothing is written, a moved file gives a note, and a
 * book that was never built gives `GR9007`.
 */
import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShopAdapter } from "../../tests/fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "../../tests/support/copy-fixture";
import type { ScryQuery } from "../contracts/scry";
import { formatScryResult, scry } from "../scry";
import { DERIVED_PATH } from "./derived";
import { runGrimoire } from "./index";
import { openStoredGrimoire } from "./stored";

const counted = vi.hoisted(() => ({ collected: 0, proofs: 0, ownership: 0 }));

vi.mock("../bookmap", async (importOriginal) => {
  const original = await importOriginal<typeof import("../bookmap")>();

  return {
    ...original,
    buildCollectedFiles: (...args: Parameters<typeof original.buildCollectedFiles>) => {
      counted.collected++;
      return original.buildCollectedFiles(...args);
    },
  };
});

vi.mock("../proves", async (importOriginal) => {
  const original = await importOriginal<typeof import("../proves")>();

  return {
    ...original,
    scanProofs: (...args: Parameters<typeof original.scanProofs>) => {
      counted.proofs++;
      return original.scanProofs(...args);
    },
  };
});

vi.mock("../ownership", async (importOriginal) => {
  const original = await importOriginal<typeof import("../ownership")>();

  return {
    ...original,
    resolveOwnership: (...args: Parameters<typeof original.resolveOwnership>) => {
      counted.ownership++;
      return original.resolveOwnership(...args);
    },
  };
});

let copy: FixtureCopy | null = null;

afterEach(() => {
  copy?.remove();
  copy = null;
});

const QUERIES: ScryQuery[] = [
  { type: "file", file: "src/app/catalog/services/new-arrivals.service.ts" },
  { type: "impact", file: "src/app/catalog/models/product.model.ts" },
  { type: "route", method: "POST", path: "/api/orders" },
  { type: "feature", feature: "catalog" },
  { type: "flow", feature: "catalog", flow: "new-arrivals" },
  { type: "search", text: "new arrivals" },
];

/** Every file under `root` with its size and modified time. */
function filesOf(root: string): string[] {
  const lines: string[] = [];
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const absolute = path.join(folder, entry.name);

      if (entry.isDirectory()) walk(absolute);
      else
        lines.push(
          `${path.relative(root, absolute)} ${statSync(absolute).size} ${statSync(absolute).mtimeMs}`,
        );
    }
  };

  walk(root);

  return lines.sort();
}

describe("openStoredGrimoire", () => {
  it("answers every query type like the full pipeline on a fresh book", async () => {
    copy = copyFixture();
    const adapter = createShopAdapter();
    const live = (await runGrimoire(copy.root, adapter, { routes: "fresh" })).snapshot;
    const stored = await openStoredGrimoire(copy.root, adapter);

    expect(stored.behind).toBeUndefined();

    for (const query of QUERIES) {
      const expected = scry(live, query);
      const actual = scry(stored, query);

      expect(JSON.parse(JSON.stringify(actual))).toEqual(JSON.parse(JSON.stringify(expected)));
      expect(formatScryResult(actual)).toEqual(formatScryResult(expected));
    }
  });

  it("computes no book maps, owners or proofs, asks the adapter for no files, and writes nothing", async () => {
    copy = copyFixture();
    const adapter = createShopAdapter();

    await runGrimoire(copy.root, adapter, { routes: "fresh" });

    const calls = { ...adapter.calls };
    const before = filesOf(copy.root);

    Object.assign(counted, { collected: 0, proofs: 0, ownership: 0 });
    await openStoredGrimoire(copy.root, adapter);

    expect(counted).toEqual({ collected: 0, proofs: 0, ownership: 0 });
    expect(adapter.calls.files).toBe(calls.files);
    expect(adapter.calls.routes).toBe(calls.routes);
    expect(adapter.calls.named).toBe(calls.named);
    expect(filesOf(copy.root)).toEqual(before);
  });

  it("serves the stored book and counts the files that moved", async () => {
    copy = copyFixture();
    const adapter = createShopAdapter();

    await runGrimoire(copy.root, adapter, { routes: "fresh" });
    copy.replace("src/app/catalog/services/new-arrivals.service.ts", "\n", "\n// changed\n");
    copy.write("grimoire/features/catalog/notes.md", "# notes\n");

    const stored = await openStoredGrimoire(copy.root, adapter);
    const result = scry(stored, {
      type: "file",
      file: "src/app/catalog/services/new-arrivals.service.ts",
    });

    expect(stored.behind).toEqual({ changed: 2 });
    expect(result.notes).toContain("book is stale (2 files changed); run warlock grimoire build");
    // The stored answer: the line count is the one the book holds.
    expect(result).toMatchObject({ entry: { lines: 10 } });
  });

  it("fails with GR9007 when the book was never built", async () => {
    copy = copyFixture();

    await expect(openStoredGrimoire(copy.root, createShopAdapter())).rejects.toMatchObject({
      code: "GR9007",
    });
  });

  it("fails with GR9007 when the derived data is missing", async () => {
    copy = copyFixture();
    const adapter = createShopAdapter();

    await runGrimoire(copy.root, adapter, { routes: "fresh" });
    rmSync(path.join(copy.root, ...DERIVED_PATH.split("/")));

    await expect(openStoredGrimoire(copy.root, adapter)).rejects.toMatchObject({ code: "GR9007" });
  });

  it("is written by a build that writes, and left out by one that does not", async () => {
    copy = copyFixture();
    const adapter = createShopAdapter();

    await runGrimoire(copy.root, adapter, { routes: "fresh", write: false });
    await expect(openStoredGrimoire(copy.root, adapter)).rejects.toMatchObject({ code: "GR9007" });
  });
});
