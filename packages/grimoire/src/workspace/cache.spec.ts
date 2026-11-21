import { lstatSync, readdirSync, utimesSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createShopAdapter } from "../../tests/fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "../../tests/support/copy-fixture";
import { createBookCache } from "./cache";
import { openGrimoire } from "./index";

let copy: FixtureCopy | null = null;

afterEach(() => {
  copy?.remove();
  copy = null;
});

function counted() {
  const state = { opens: 0 };
  const cache = createBookCache(async (...args: Parameters<typeof openGrimoire>) => {
    state.opens += 1;

    return openGrimoire(...args);
  });

  return { state, cache };
}

/** Move every file and folder time of the copy into the past, so the spec never depends on how fast the copy and the open follow each other. */
function age(root: string): string {
  const past = new Date(Date.now() - 60_000);
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);

      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);

      utimesSync(full, past, past);
    }

    if (!lstatSync(folder).isSymbolicLink()) utimesSync(folder, past, past);
  };

  walk(root);

  return root;
}

const touch = (file: string) => {
  writeFileSync(file, `${readFileSync(file, "utf8")}\n`);
  utimesSync(file, new Date(), new Date(Date.now() + 10_000));
};

describe("the kept opened book", () => {
  it("opens once for repeated calls on an unchanged book and shares concurrent opens", async () => {
    copy = copyFixture();
    age(copy.root);
    const adapter = createShopAdapter();
    const { state, cache } = counted();
    const [first, second] = await Promise.all([
      cache.open(copy.root, adapter, { routes: "fresh", write: false }),
      cache.open(copy.root, adapter, { routes: "fresh", write: false }),
    ]);

    // A fresh-routes ask always opens; both calls above are separate asks.
    expect(state.opens).toBe(2);
    expect(first.root).toBe(second.root);

    const before = state.opens;
    const a = await cache.open(copy.root, adapter, { routes: "cached", write: false });
    const b = await cache.open(copy.root, adapter, { routes: "cached", write: false });

    expect(state.opens).toBe(before);
    expect(b).toBe(a);
  });

  it("opens again after a written file, a code file or the manifest changes", async () => {
    copy = copyFixture();
    age(copy.root);
    const adapter = createShopAdapter();
    const { state, cache } = counted();
    const options = { routes: "cached", write: false } as const;
    const first = await cache.open(copy.root, adapter, options);

    expect(state.opens).toBe(1);

    const readme = first.written.features[0]?.readme?.file ?? "";

    touch(path.join(copy.root, readme));
    await cache.open(copy.root, adapter, options);
    expect(state.opens).toBe(2);

    await cache.open(copy.root, adapter, options);
    expect(state.opens).toBe(2);

    const code = first.book.facts.files[0]?.file ?? "";

    touch(path.join(copy.root, code));
    await cache.open(copy.root, adapter, options);
    expect(state.opens).toBe(3);

    cache.clear();
    await cache.open(copy.root, adapter, options);
    expect(state.opens).toBe(4);
  });

  it("opens again when a folder above the listed ones changes (a new module folder)", async () => {
    copy = copyFixture();
    age(copy.root);
    const adapter = createShopAdapter();
    const { state, cache } = counted();
    const options = { routes: "cached", write: false } as const;

    await cache.open(copy.root, adapter, options);
    expect(state.opens).toBe(1);

    // Creating `src/app/billing/` moves the mtime of `src/app` only, not of any listed folder.
    const later = new Date(Date.now() + 10_000);

    utimesSync(path.join(copy.root, "src", "app"), later, later);
    await cache.open(copy.root, adapter, options);
    expect(state.opens).toBe(2);
  });

  it("never runs two writing opens of one project at the same time", async () => {
    copy = copyFixture();
    age(copy.root);
    const adapter = createShopAdapter();
    const running = { now: 0, most: 0, opens: 0 };
    const cache = createBookCache(async (...args: Parameters<typeof openGrimoire>) => {
      running.opens += 1;
      running.now += 1;
      running.most = Math.max(running.most, running.now);
      await new Promise((resolve) => setTimeout(resolve, 30));

      try {
        return await openGrimoire(...args);
      } finally {
        running.now -= 1;
      }
    });

    await Promise.all([
      cache.open(copy.root, adapter, { routes: "fresh" }),
      cache.open(copy.root, adapter, { routes: "fresh" }),
      cache.open(copy.root, adapter, { routes: "cached", force: true }),
    ]);
    expect(running.opens).toBe(3);
    expect(running.most).toBe(1);
  });

  it("opens again after an open during which a code file changed", async () => {
    copy = copyFixture();
    age(copy.root);
    const adapter = createShopAdapter();
    const state = { opens: 0 };
    const cache = createBookCache(async (...args: Parameters<typeof openGrimoire>) => {
      state.opens += 1;

      const snapshot = await openGrimoire(...args);

      if (state.opens === 1) {
        // An edit lands after the open read the files.
        await new Promise((resolve) => setTimeout(resolve, 15));
        touchNow(path.join(copy?.root ?? "", snapshot.book.facts.files[0]?.file ?? ""));
      }

      return snapshot;
    });
    const options = { routes: "cached", write: false } as const;

    await cache.open(copy.root, adapter, options);
    await cache.open(copy.root, adapter, options);
    expect(state.opens).toBe(2);

    // The second open saw no change, so the third call is served from the kept book.
    await cache.open(copy.root, adapter, options);
    expect(state.opens).toBe(2);
  });
});

function touchNow(file: string): void {
  writeFileSync(file, `${readFileSync(file, "utf8")}\n`);
}
