import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveImageVariantsConfig } from "./resolve-image-variants-config";
import { freshImageVariant, trimImageVariantCache } from "./trim-image-variant-cache";
import { variantCachePath } from "./variant-cache-key";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "variant-cap-"));
});
afterEach(async () => {
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
  it("removes expired files even below the byte budget and expires hits", async () => {
    const old = await derivative("a", 10, 100);
    const keep = await derivative("b", 10);
    const images = resolveImageVariantsConfig(
      { variants: { thumb: { width: 10 } }, cacheDirectory: root, maxCacheAge: 60 },
      root,
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
      root,
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
      root,
    )!;
    await trimImageVariantCache(images, keep);
    expect(await fs.readFile(unrelated, "utf8")).toBe("keep");
    await expect(fs.access(keep)).resolves.toBeUndefined();
  });
});
