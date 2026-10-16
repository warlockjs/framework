import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveImageVariantsConfig } from "./resolve-image-variants-config";
import {
  freshImageVariant,
  scheduleImageVariantCacheTrim,
  trimImageVariantCache,
} from "./trim-image-variant-cache";
import { variantCachePath } from "./variant-cache-key";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "variant-cap-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await fs.rm(root, { recursive: true, force: true });
});

async function derivative(id: string, bytes: number, secondsOld = 0) {
  const target = variantCachePath(
    root,
    { sourceKey: id.repeat(64), generation: "10-20" },
    id.repeat(64),
    "webp",
  );
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, Buffer.alloc(bytes));
  const date = new Date(Date.now() - secondsOld * 1000);
  await fs.utimes(target, date, date);
  return target;
}

describe("image derivative cache limits", () => {
  it("coalesces concurrent sweeps instead of queueing repeated directory walks", async () => {
    const keep = await derivative("a", 10);
    const images = resolveImageVariantsConfig(
      { variants: { thumb: { width: 10 } }, cacheDirectory: root },
      `${root}-sources`,
    )!;
    const readdir = vi.spyOn(fs, "readdir");
    await Promise.all(Array.from({ length: 20 }, () => trimImageVariantCache(images, keep)));
    expect(readdir.mock.calls.filter(([directory]) => directory === root)).toHaveLength(1);
  });

  it("schedules writes off the response path and throttles later writes to one sweep per minute", async () => {
    const keep = await derivative("a", 10);
    const images = resolveImageVariantsConfig(
      { variants: { thumb: { width: 10 } }, cacheDirectory: root },
      `${root}-sources`,
    )!;
    await trimImageVariantCache(images, keep);
    const readdir = vi.spyOn(fs, "readdir");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    for (let i = 0; i < 20; i++) scheduleImageVariantCacheTrim(images, keep);
    // Let stat callbacks settle; timers are held, so scheduling never walks.
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    expect(readdir).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(readdir).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_001);
    await vi.waitFor(() =>
      expect(readdir.mock.calls.filter(([directory]) => directory === root)).toHaveLength(1),
    );
  });
  it("removes expired files even below the byte budget and expires hits", async () => {
    const old = await derivative("a", 10, 100);
    const keep = await derivative("b", 10);
    const images = resolveImageVariantsConfig(
      { variants: { thumb: { width: 10 } }, cacheDirectory: root, maxCacheAge: 60 },
      `${root}-sources`,
    )!;
    expect(await freshImageVariant(old, images.maxCacheAge)).toBe(false);
    await trimImageVariantCache(images, keep);
    await expect(fs.access(old)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await freshImageVariant(keep, images.maxCacheAge)).toBe(true);
  });

  it("evicts oldest derivatives across sources and retains the response file", async () => {
    const old = await derivative("a", 10, 10);
    const recent = await derivative("b", 10, 5);
    const keep = await derivative("c", 10);
    const images = resolveImageVariantsConfig(
      { variants: { thumb: { width: 10 } }, cacheDirectory: root, maxCacheBytes: 20 },
      `${root}-sources`,
    )!;
    await trimImageVariantCache(images, keep);
    await expect(fs.access(old)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(recent)).resolves.toBeUndefined();
    await expect(fs.access(keep)).resolves.toBeUndefined();
  });

  it("preserves unrelated files and does not follow symlinks", async () => {
    const keep = await derivative("a", 10);
    const unrelated = path.join(root, "notes.txt");
    await fs.writeFile(unrelated, "keep");
    await fs.symlink(path.dirname(root), path.join(root, "external"));
    const images = resolveImageVariantsConfig(
      { variants: { thumb: { width: 10 } }, cacheDirectory: root, maxCacheBytes: 1 },
      `${root}-sources`,
    )!;
    await trimImageVariantCache(images, keep);
    expect(await fs.readFile(unrelated, "utf8")).toBe("keep");
    await expect(fs.access(keep)).resolves.toBeUndefined();
  });
});
