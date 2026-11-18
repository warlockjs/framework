import { mkdirSync, utimesSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShopAdapter } from "../../tests/fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "../../tests/support/copy-fixture";
import { createSnapshotSource } from "./snapshot-source";

let copy: FixtureCopy | null = null;

afterEach(() => {
  vi.useRealTimers();
  copy?.remove();
  copy = null;
});

/** The shop adapter whose file scan takes `took` ms of (fake) time; no stored book, so every open rebuilds. */
function slowAdapter(took: number) {
  const adapter = createShopAdapter();
  const files = adapter.files.bind(adapter);

  adapter.files = async (root) => {
    vi.setSystemTime(Date.now() + took);
    return files(root);
  };

  return adapter;
}

describe("the panel's snapshot source", () => {
  it("does not repeat a slow open on every view", async () => {
    copy = copyFixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    const adapter = slowAdapter(3000);
    const source = createSnapshotSource(copy.root, { adapter });

    await source.get();
    expect(adapter.calls.files).toBe(1);

    // Over the 2 s default, but within five times the 3 s the open took.
    vi.setSystemTime(Date.now() + 5000);
    await source.get();
    expect(adapter.calls.files).toBe(1);

    vi.setSystemTime(Date.now() + 15_000);
    await source.get();
    await source.idle();
    expect(adapter.calls.files).toBe(2);
  });

  it("shares one open between concurrent requests, so two never rebuild or write at once", async () => {
    copy = copyFixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    const adapter = slowAdapter(0);
    const source = createSnapshotSource(copy.root, { adapter, write: true });

    await source.get();
    expect(adapter.calls.sourceRoots).toBe(1);

    vi.setSystemTime(Date.now() + 2500);
    const [first, second, third] = await Promise.all([source.get(), source.get(), source.get()]);

    await source.idle();
    expect(adapter.calls.sourceRoots).toBe(2);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("opens again after the 2 s default when opening is quick, and honours ttlMs", async () => {
    copy = copyFixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    const quick = slowAdapter(0);
    const source = createSnapshotSource(copy.root, { adapter: quick });

    await source.get();
    vi.setSystemTime(Date.now() + 2500);
    await source.get();
    await source.idle();
    expect(quick.calls.files).toBe(2);

    const fixed = slowAdapter(3000);
    const always = createSnapshotSource(copy.root, { adapter: fixed, ttlMs: 0 });

    await always.get();
    await always.get();
    await always.idle();
    expect(fixed.calls.files).toBe(2);
  });

  it("serves the cached snapshot in development while one background open runs", async () => {
    copy = copyFixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    const adapter = slowAdapter(0);
    const source = createSnapshotSource(copy.root, { adapter });

    const first = await source.get();

    vi.setSystemTime(Date.now() + 2500);
    const [a, b] = await Promise.all([source.get(), source.get()]);

    expect(a).toBe(first);
    expect(b).toBe(first);

    await source.idle();
    expect(adapter.calls.files).toBe(2);
    expect(await source.get()).not.toBe(first);
  });

  it("keeps serving the old snapshot when a refresh fails, and fails only with no snapshot", async () => {
    copy = copyFixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    const adapter = slowAdapter(0);
    let broken = false;
    const source = createSnapshotSource(copy.root, {
      adapter: async () => {
        if (broken) throw new Error("adapter failed");

        return adapter;
      },
    });

    const first = await source.get();

    broken = true;
    vi.setSystemTime(Date.now() + 2500);
    expect(await source.get()).toBe(first);
    await source.idle();
    expect(await source.get()).toBe(first);

    const empty = createSnapshotSource(copy.root, {
      adapter: async () => {
        throw new Error("adapter failed");
      },
    });

    await expect(empty.get()).rejects.toThrow("adapter failed");
  });

  it("reuses a snapshot in production with no time limit until the book changes", async () => {
    copy = copyFixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    const adapter = slowAdapter(0);
    const source = createSnapshotSource(copy.root, { adapter, mode: "production" });

    const first = await source.get();

    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
    expect(await source.get()).toBe(first);
    expect(adapter.calls.files).toBe(1);

    // A change in an agent-written folder moves the stamp.
    const features = path.join(copy.root, "grimoire", "features");

    mkdirSync(features, { recursive: true });
    const later = new Date(Date.now() + 60_000);

    utimesSync(features, later, later);

    const second = await source.get();

    expect(second).not.toBe(first);
    expect(adapter.calls.files).toBe(2);
    expect(await source.get()).toBe(second);
  });

  it("honours an explicit ttlMs in production", async () => {
    copy = copyFixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    const adapter = slowAdapter(0);
    const source = createSnapshotSource(copy.root, { adapter, mode: "production", ttlMs: 1000 });

    const first = await source.get();

    vi.setSystemTime(Date.now() + 5000);
    expect(await source.get()).not.toBe(first);
  });

  it("opens the book once when warmed, and the first get shares that open", async () => {
    copy = copyFixture();
    const adapter = slowAdapter(0);
    const source = createSnapshotSource(copy.root, { adapter, mode: "production" });

    source.warm();
    source.warm();
    const snapshot = await source.get();

    await source.idle();
    expect(adapter.calls.files).toBe(1);
    expect(await source.get()).toBe(snapshot);
    expect(adapter.calls.files).toBe(1);
  });
});
