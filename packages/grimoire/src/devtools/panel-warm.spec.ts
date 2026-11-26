import { setConfig } from "@warlock.js/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShopAdapter } from "../../tests/fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "../../tests/support/copy-fixture";
import { grimoireDevtoolsPanel } from "./index";
import { createSnapshotSource } from "./snapshot-source";

let copy: FixtureCopy | null = null;

beforeEach(() => {
  setConfig("web", {
    sites: {
      client: { hosts: ["shop.test"] },
      admin: { hosts: ["shop.test"], basePath: "/admin" },
    },
  });
});

afterEach(() => {
  copy?.remove();
  copy = null;
  setConfig("web", undefined);
});

const request = { query: {}, params: {} } as never;

describe("the panel's warm option", () => {
  it("in production never opens the book at creation or after boot; the first view builds it once", async () => {
    copy = copyFixture();
    const adapter = createShopAdapter();
    const panel = await grimoireDevtoolsPanel({ root: copy.root, mode: "production", adapter });

    expect(adapter.calls.files).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(adapter.calls.files).toBe(0);

    const summary = panel.routes?.find((route) => route.path === "/summary");

    await Promise.all([summary?.handler(request), summary?.handler(request)]);
    expect(adapter.calls.files).toBe(1);
  });

  it("with warm: true the open starts after the creating tick, never during creation", async () => {
    copy = copyFixture();
    const adapter = createShopAdapter();

    await grimoireDevtoolsPanel({ root: copy.root, mode: "production", adapter, warm: true });
    expect(adapter.calls.files).toBe(0);

    await Promise.resolve();
    expect(adapter.calls.files).toBe(0);
    await vi.waitFor(() => expect(adapter.calls.files).toBe(1));
  });

  it("with warm: false in development a first view still builds", async () => {
    copy = copyFixture();
    const adapter = createShopAdapter();
    const panel = await grimoireDevtoolsPanel({ root: copy.root, adapter, warm: false });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(adapter.calls.files).toBe(0);

    await panel.routes?.find((route) => route.path === "/summary")?.handler(request);
    expect(adapter.calls.files).toBe(1);
  });
});

describe("the production snapshot source and the stored book", () => {
  it("reads a current stored book without scanning the sources, and rebuilds when there is none", async () => {
    copy = copyFixture();
    const builder = createShopAdapter();

    // Build and store the book once (development source writes it).
    await createSnapshotSource(copy.root, { adapter: builder, write: true }).get();

    const adapter = createShopAdapter();
    const snapshot = await createSnapshotSource(copy.root, { adapter, mode: "production" }).get();

    expect(snapshot.behind).toBeUndefined();
    expect(adapter.calls.files).toBe(0);

    const empty = copyFixture();
    const fresh = createShopAdapter();

    try {
      await createSnapshotSource(empty.root, { adapter: fresh, mode: "production" }).get();
      expect(fresh.calls.files).toBe(1);
    } finally {
      empty.remove();
    }
  });
});
