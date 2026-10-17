import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveImageVariantsConfig } from "./resolve-image-variants-config";
import {
  EMPTY_GENERATION_GRACE_MS,
  ORPHAN_TEMP_AGE_MS,
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

async function age(target: string, millisecondsOld: number) {
  const date = new Date(Date.now() - millisecondsOld);
  await fs.utimes(target, date, date);
}

function rootWalks(readdir: { mock: { calls: unknown[][] } }) {
  return readdir.mock.calls.filter(([directory]) => directory === root).length;
}

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
    // Over budget, so every scheduled check has something to reclaim.
    const images = resolveImageVariantsConfig(
      { variants: { thumb: { width: 10 } }, cacheDirectory: root, maxCacheBytes: 5 },
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

  it("requires every path component to match the derivative layout before eviction", async () => {
    const keep = await derivative("a", 10);
    const expired = await derivative("b", 10, 100);
    const name = `${"c".repeat(64)}.webp`;
    const unrelated = [
      path.join(root, "photos", "c".repeat(64), "10-20", name),
      path.join(root, "cc", "photos", "10-20", name),
      path.join(root, "cc", "d".repeat(64), "10-20", name),
      path.join(root, "cc", "c".repeat(64), "photos", name),
    ];
    for (const target of unrelated) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, "user photo");
      const date = new Date(0);
      await fs.utimes(target, date, date);
    }
    const images = resolveImageVariantsConfig(
      {
        variants: { thumb: { width: 10 } },
        cacheDirectory: root,
        maxCacheAge: 60,
        maxCacheBytes: 1,
      },
      `${root}-sources`,
    )!;
    await trimImageVariantCache(images, keep);
    await expect(fs.access(expired)).rejects.toMatchObject({ code: "ENOENT" });
    for (const target of unrelated) {
      expect(await fs.readFile(target, "utf8")).toBe("user photo");
    }
  });
});

function limits(overrides: Record<string, unknown> = {}) {
  const images = resolveImageVariantsConfig(
    { variants: { thumb: { width: 10 } }, cacheDirectory: root, ...overrides },
    `${root}-sources`,
  );
  if (!images) throw new Error("expected a resolved images configuration");
  return images;
}

async function remoteGeneration(id: string, derivativeSecondsOld: number) {
  const target = variantCachePath(
    root,
    { sourceKey: id.repeat(64), generation: "e".repeat(64) },
    id.repeat(64),
    "avif",
  );
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, Buffer.alloc(10));
  await age(target, derivativeSecondsOld * 1000);
  const manifest = path.join(path.dirname(target), "source.json");
  await fs.writeFile(manifest, JSON.stringify({ format: "png" }));
  return { target, manifest, directory: path.dirname(target) };
}

describe("image derivative cache housekeeping", () => {
  it("removes orphaned writer temporaries past the grace period and keeps fresh ones", async () => {
    const keep = await derivative("a", 10);
    const generation = path.dirname(keep);
    const orphan = `${keep}.tmp-${"0".repeat(16)}`;
    const orphanManifest = path.join(generation, ".source.json.abcdef123456.tmp");
    const fresh = `${keep}.tmp-${"1".repeat(16)}`;
    const unrelated = [path.join(generation, ".tmp-user"), path.join(root, ".tmp-user")];
    for (const file of [orphan, orphanManifest, fresh, ...unrelated]) {
      await fs.writeFile(file, "partial");
    }
    for (const file of [orphan, orphanManifest, ...unrelated]) {
      await age(file, ORPHAN_TEMP_AGE_MS + 60_000);
    }
    await age(fresh, ORPHAN_TEMP_AGE_MS - 60_000);

    await trimImageVariantCache(limits(), keep);

    await expect(fs.access(orphan)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(orphanManifest)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(fresh)).resolves.toBeUndefined();
    for (const file of unrelated) expect(await fs.readFile(file, "utf8")).toBe("partial");
    await expect(fs.access(keep)).resolves.toBeUndefined();
  });

  it("walks the cache on the first scheduled check after boot", async () => {
    const keep = await derivative("a", 10);
    const readdir = vi.spyOn(fs, "readdir");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    // Nothing has reconciled the estimate yet, so the check is due at once
    // (waitFor advances the fake clock while it polls).
    scheduleImageVariantCacheTrim(limits(), keep);
    await vi.waitFor(() => expect(rootWalks(readdir)).toBe(1));
  });

  it("skips scheduled walks while under budget with nothing expired", async () => {
    const keep = await derivative("a", 10);
    const images = limits({ maxCacheBytes: 1_000, maxCacheAge: 3_600 });
    await trimImageVariantCache(images, keep);
    const readdir = vi.spyOn(fs, "readdir");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    for (let minute = 0; minute < 3; minute++) {
      const write = await derivative(String.fromCharCode(98 + minute), 10);
      scheduleImageVariantCacheTrim(images, write);
      await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
      await vi.advanceTimersByTimeAsync(61_000);
    }
    expect(vi.getTimerCount()).toBe(0);
    expect(readdir).not.toHaveBeenCalled();
  });

  it("walks once when writes take the cache over budget", async () => {
    const keep = await derivative("a", 10);
    const images = limits({ maxCacheBytes: 15 });
    await trimImageVariantCache(images, keep);
    const readdir = vi.spyOn(fs, "readdir");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const write = await derivative("b", 10);
    scheduleImageVariantCacheTrim(images, write);
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    await vi.advanceTimersByTimeAsync(61_000);
    await vi.waitFor(() => expect(rootWalks(readdir)).toBe(1));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(rootWalks(readdir)).toBe(1);
  });

  it("walks once when the oldest retained derivative passes maxCacheAge", async () => {
    const keep = await derivative("a", 10);
    const images = limits({ maxCacheAge: 60 });
    await trimImageVariantCache(images, keep);
    const readdir = vi.spyOn(fs, "readdir");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const write = await derivative("b", 10);
    scheduleImageVariantCacheTrim(images, write);
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(readdir).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(31_000);
    await vi.waitFor(() => expect(rootWalks(readdir)).toBe(1));
  });

  it("removes the manifest and directory of a generation whose derivatives were all evicted", async () => {
    const keep = await derivative("a", 10);
    const evicted = await remoteGeneration("b", 120);
    await age(evicted.directory, EMPTY_GENERATION_GRACE_MS + 60_000);

    await trimImageVariantCache(limits({ maxCacheAge: 60 }), keep);

    await expect(fs.access(evicted.target)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(evicted.manifest)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(evicted.directory)).rejects.toMatchObject({ code: "ENOENT" });
    // Source and shard directories stay, and so does the generation in use.
    await expect(fs.access(path.dirname(evicted.directory))).resolves.toBeUndefined();
    await expect(fs.access(keep)).resolves.toBeUndefined();
  });

  it("keeps the manifest and directory of a generation that still has a derivative", async () => {
    const keep = await derivative("a", 10);
    const retained = await remoteGeneration("b", 0);
    await age(retained.directory, EMPTY_GENERATION_GRACE_MS + 60_000);

    await trimImageVariantCache(limits({ maxCacheAge: 60 }), keep);

    await expect(fs.access(retained.target)).resolves.toBeUndefined();
    await expect(fs.access(retained.manifest)).resolves.toBeUndefined();
  });

  it("keeps an emptied generation directory younger than the grace period", async () => {
    const keep = await derivative("a", 10);
    const recent = await remoteGeneration("b", 120);

    await trimImageVariantCache(limits({ maxCacheAge: 60 }), keep);

    await expect(fs.access(recent.target)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await fs.lstat(recent.directory)).isDirectory()).toBe(true);
    await expect(fs.access(recent.manifest)).resolves.toBeUndefined();
  });

  it("never removes a symlinked or user directory with a generation-like name", async () => {
    const keep = await derivative("a", 10);
    const external = path.join(`${root}-external`, "e".repeat(64));
    await fs.mkdir(external, { recursive: true });
    const linkedParent = path.join(root, "cc", "c".repeat(64));
    await fs.mkdir(linkedParent, { recursive: true });
    const linked = path.join(linkedParent, "e".repeat(64));
    await fs.symlink(external, linked, "junction");
    const userDirectory = path.join(root, "cc", "photos", "e".repeat(64));
    await fs.mkdir(userDirectory, { recursive: true });
    await fs.writeFile(path.join(userDirectory, "source.json"), "user data");
    for (const directory of [external, userDirectory]) {
      await age(directory, EMPTY_GENERATION_GRACE_MS + 60_000);
    }

    try {
      await trimImageVariantCache(limits({ maxCacheAge: 60, maxCacheBytes: 1 }), keep);

      expect((await fs.lstat(linked)).isSymbolicLink()).toBe(true);
      expect((await fs.lstat(external)).isDirectory()).toBe(true);
      expect(await fs.readFile(path.join(userDirectory, "source.json"), "utf8")).toBe("user data");
    } finally {
      await fs.rm(`${root}-external`, { recursive: true, force: true });
    }
  });
});
