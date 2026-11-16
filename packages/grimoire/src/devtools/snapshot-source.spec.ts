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
    expect(quick.calls.files).toBe(2);

    const fixed = slowAdapter(3000);
    const always = createSnapshotSource(copy.root, { adapter: fixed, ttlMs: 0 });

    await always.get();
    await always.get();
    expect(fixed.calls.files).toBe(2);
  });
});
