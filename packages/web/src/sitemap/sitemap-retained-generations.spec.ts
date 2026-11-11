import { describe, expect, it, vi } from "vitest";
import type { SitemapGenerationManifest, SitemapManifestKey } from "@warlock.js/sitemap";
import { createServingState } from "./sitemap-lifecycle";

function manifest(generationId: string, fence: number): SitemapGenerationManifest {
  return { generationId, fence } as unknown as SitemapGenerationManifest;
}

function key(generationId: string, fence: number): SitemapManifestKey {
  return { generationId, fence, key: `manifests/${fence}-${generationId}.json` } as never;
}

function countingStore(keys: SitemapManifestKey[]) {
  const store = {
    listManifestKeys: vi.fn(async () => keys),
    readManifestKey: vi.fn(async (candidate: SitemapManifestKey) =>
      manifest(candidate.generationId, candidate.fence),
    ),
    readLatestManifest: vi.fn(async () => undefined),
  };

  return store;
}

describe("retained sitemap generations", () => {
  it("answers unknown generation ids without a storage listing per request", async () => {
    let now = 0;
    const store = countingStore([key("current", 2), key("previous", 1)]);
    const state = createServingState(
      { store: store as never, currentManifest: manifest("current", 2) },
      "public, max-age=300",
      30_000,
      () => now,
    );

    await expect(state.getManifestByGeneration!("missing-1")).resolves.toBeUndefined();
    await expect(state.getManifestByGeneration!("missing-2")).resolves.toBeUndefined();
    now = 500;
    await expect(state.getManifestByGeneration!("missing-3")).resolves.toBeUndefined();

    expect(store.listManifestKeys).toHaveBeenCalledTimes(1);
    expect(store.readManifestKey).not.toHaveBeenCalled();
  });

  it("reads a retained generation's manifest once and reuses it", async () => {
    const store = countingStore([key("current", 2), key("previous", 1)]);
    const state = createServingState(
      { store: store as never, currentManifest: manifest("current", 2) },
      "public, max-age=300",
      30_000,
      () => 0,
    );

    await expect(state.getManifestByGeneration!("previous")).resolves.toMatchObject({
      generationId: "previous",
    });
    await state.getManifestByGeneration!("previous");

    expect(store.listManifestKeys).toHaveBeenCalledTimes(1);
    expect(store.readManifestKey).toHaveBeenCalledTimes(1);
  });

  it("finds a generation published after the last listing within a second", async () => {
    let now = 0;
    const keys = [key("current", 2)];
    const store = countingStore(keys);
    const state = createServingState(
      { store: store as never, currentManifest: manifest("current", 2) },
      "public, max-age=300",
      30_000,
      () => now,
    );

    await expect(state.getManifestByGeneration!("next")).resolves.toBeUndefined();
    keys.unshift(key("next", 3));
    now = 1_000;

    await expect(state.getManifestByGeneration!("next")).resolves.toMatchObject({
      generationId: "next",
    });
    expect(store.listManifestKeys).toHaveBeenCalledTimes(2);
  });
});
