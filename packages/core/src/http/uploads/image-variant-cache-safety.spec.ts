import config from "@mongez/config";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storage } from "../../storage";
import { pruneStaleVariantGenerations, variantCacheDirectoryFor } from "./image-variant-cache";
import { purgeImageVariants } from "./purge-image-variants";
import { resolveImageVariantsConfig } from "./resolve-image-variants-config";
import { variantCachePath, variantSourceKey } from "./variant-cache-key";
import type { StorageDriverContract } from "../../storage/types";
import { remoteVariantDisk } from "./remote-variant-source";

let workspace: string;
let primary: string;
let backup: string;
beforeEach(async () => {
  storage.reset();
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "variant-cache-safety-"));
  primary = path.join(workspace, "primary");
  backup = path.join(workspace, "backup");
  await fs.mkdir(primary);
  await fs.mkdir(backup);
  await fs.writeFile(path.join(primary, "photo.png"), "primary upload");
  await fs.writeFile(path.join(backup, "photo.png"), "backup upload");
  config.set("storage", {
    default: "primary",
    drivers: {
      primary: { driver: "local", root: primary },
      backup: { driver: "local", root: backup },
    },
  });
  vi.spyOn(storage, "root").mockReturnValue(primary);
});
afterEach(async () => {
  vi.restoreAllMocks();
  storage.reset();
  config.set("storage", {});
  config.set("uploads", {});
  await fs.rm(workspace, { recursive: true, force: true });
});

describe("image variant cache overlap safety", () => {
  it.each([
    ["local", "nested"],
    ["local", "default"],
    ["local", "separate"],
    ["remote", "nested"],
    ["remote", "default"],
    ["remote", "separate"],
  ])(
    "does not traverse a shard symlink during %s per-file purge: %s cache",
    async (disk, location) => {
      const cacheDirectory =
        location === "separate"
          ? path.join(workspace, "cache")
          : location === "default"
            ? path.join(primary, ".cache", "image-variants")
            : path.join(primary, "photos");
      config.set("uploads.images", {
        variants: { thumb: { width: 10 } },
        ...(disk === "local" && location === "default" ? {} : { cacheDirectory }),
      });
      let sourceKey = variantSourceKey(primary, "photo.png");
      if (disk === "remote") {
        vi.spyOn(storage, "getDriver").mockReturnValue({
          name: "s3",
          options: { bucket: "photos" },
          applyPrefix: (key: string) => `tenant/${key}`,
        } as StorageDriverContract);
        const remote = remoteVariantDisk("cloud");
        sourceKey = variantSourceKey(remote.root, remote.driver.applyPrefix("photo.png"));
      }
      const externalShard = path.join(backup, "linked-shard");
      const original = path.join(externalShard, sourceKey, "10-20", `${"a".repeat(64)}.jpg`);
      await fs.mkdir(path.dirname(original), { recursive: true });
      await fs.writeFile(original, "user upload outside cache");
      await fs.mkdir(cacheDirectory, { recursive: true });
      const linkedShard = path.join(cacheDirectory, sourceKey.slice(0, 2));
      await fs.symlink(externalShard, linkedShard, "junction");

      expect(
        await purgeImageVariants("photo.png", disk === "remote" ? { disk: "cloud" } : {}),
      ).toBe(false);
      await pruneStaleVariantGenerations(path.join(linkedShard, sourceKey), "30-40");
      expect(await fs.readFile(original, "utf8")).toBe("user upload outside cache");
      expect((await fs.lstat(linkedShard)).isSymbolicLink()).toBe(true);
    },
  );

  it("prunes only recognized old-generation files and retains unrelated entries", async () => {
    const cacheDirectory = path.join(primary, "photos");
    const sourceKey = variantSourceKey(primary, "photo.png");
    const target = variantCachePath(
      cacheDirectory,
      { sourceKey, generation: "10-20" },
      "a".repeat(64),
      "webp",
    );
    const sourceDirectory = path.dirname(path.dirname(target));
    const current = variantCachePath(
      cacheDirectory,
      { sourceKey, generation: "30-40" },
      "b".repeat(64),
      "webp",
    );
    const owned = [
      target,
      `${target}.tmp-${"c".repeat(16)}`,
      path.join(path.dirname(target), "source.json"),
    ];
    const uploads = [
      path.join(sourceDirectory, "user.jpg"),
      path.join(sourceDirectory, "user-photos", `${"a".repeat(64)}.webp`),
      path.join(path.dirname(target), "user.jpg"),
      current,
    ];
    for (const file of [...owned, ...uploads]) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, "keep user bytes");
    }
    const external = path.join(backup, `${"c".repeat(64)}.webp`);
    await fs.writeFile(external, "outside bytes");
    const linkedGeneration = path.join(sourceDirectory, "50-60");
    await fs.symlink(backup, linkedGeneration, "junction");
    const linkedFile = path.join(path.dirname(target), `${"d".repeat(64)}.webp`);
    await fs.symlink(external, linkedFile);

    await pruneStaleVariantGenerations(sourceDirectory, "30-40");
    for (const file of owned) {
      await expect(fs.access(file)).rejects.toMatchObject({ code: "ENOENT" });
    }
    for (const file of uploads) {
      expect(await fs.readFile(file, "utf8")).toBe("keep user bytes");
    }
    expect(await fs.readFile(external, "utf8")).toBe("outside bytes");
    expect((await fs.lstat(linkedGeneration)).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(linkedFile)).isSymbolicLink()).toBe(true);
    expect((await fs.stat(path.dirname(target))).isDirectory()).toBe(true);
  });

  it.each(["local", "remote"])(
    "purges only recognized cache files inside a storage folder: %s",
    async (disk) => {
      const cacheDirectory = path.join(primary, "photos");
      config.set("uploads.images", { variants: { thumb: { width: 10 } }, cacheDirectory });
      if (disk === "remote") {
        vi.spyOn(storage, "getDriver").mockReturnValue({
          name: "s3",
          options: { bucket: "photos" },
        } as StorageDriverContract);
      }
      const target = variantCachePath(
        cacheDirectory,
        { sourceKey: "a".repeat(64), generation: "10-20" },
        "b".repeat(64),
        "webp",
      );
      const remoteTarget = variantCachePath(
        cacheDirectory,
        { sourceKey: "c".repeat(64), generation: "d".repeat(64) },
        "e".repeat(64),
        "avif",
      );
      const owned = [
        target,
        remoteTarget,
        `${target}.tmp-${"f".repeat(16)}`,
        path.join(path.dirname(remoteTarget), "source.json"),
        path.join(path.dirname(remoteTarget), ".source.json.abcdef123456.tmp"),
      ];
      const uploads = [
        path.join(cacheDirectory, "user.jpg"),
        path.join(cacheDirectory, "source.json"),
        path.join(cacheDirectory, ".tmp-user"),
        path.join(cacheDirectory, "user", "photos", "10-20", `${"b".repeat(64)}.webp`),
        path.join(cacheDirectory, "aa", "photos", "10-20", `${"b".repeat(64)}.webp`),
        path.join(cacheDirectory, "aa", "b".repeat(64), "10-20", `${"b".repeat(64)}.webp`),
        path.join(path.dirname(target), "user.jpg"),
        path.join(path.dirname(path.dirname(target)), "photos", `${"b".repeat(64)}.webp`),
      ];
      for (const file of [...owned, ...uploads]) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, "keep user bytes");
      }
      const linkedSource = path.join(cacheDirectory, "ab", `ab${"0".repeat(62)}`);
      await fs.mkdir(path.dirname(linkedSource), { recursive: true });
      await fs.symlink(path.dirname(path.dirname(target)), linkedSource, "junction");
      const options = disk === "remote" ? { disk: "cloud" } : {};
      expect(await purgeImageVariants(undefined, options)).toBe(true);
      for (const file of owned) {
        await expect(fs.access(file)).rejects.toMatchObject({ code: "ENOENT" });
      }
      for (const file of uploads) {
        expect(await fs.readFile(file, "utf8")).toBe("keep user bytes");
      }
      expect((await fs.lstat(linkedSource)).isSymbolicLink()).toBe(true);
      expect((await fs.stat(cacheDirectory)).isDirectory()).toBe(true);
      expect(await purgeImageVariants(undefined, options)).toBe(false);
    },
  );

  it("leaves a source-cache symlink and its user files untouched during a per-file purge", async () => {
    const cacheDirectory = path.join(primary, "photos");
    config.set("uploads.images", { variants: { thumb: { width: 10 } }, cacheDirectory });
    const sourceKey = variantSourceKey(primary, "photo.png");
    const directory = path.join(cacheDirectory, sourceKey.slice(0, 2));
    const original = path.join(backup, "10-20", `${"a".repeat(64)}.webp`);
    await fs.mkdir(path.dirname(original));
    await fs.writeFile(original, "user upload");
    await fs.mkdir(directory, { recursive: true });
    await fs.symlink(backup, path.join(directory, sourceKey), "junction");

    expect(await purgeImageVariants("photo.png")).toBe(false);
    expect(await fs.readFile(original, "utf8")).toBe("user upload");
  });

  it.each(["equal", "parent", "another disk", "symlinked cache", "symlinked disk"])(
    "refuses purge and rendering when the cache overlaps a local root: %s",
    async (scenario) => {
      let cacheDirectory = primary;
      if (scenario === "parent") cacheDirectory = workspace;
      if (scenario === "another disk" || scenario === "symlinked disk") cacheDirectory = backup;
      if (scenario === "symlinked cache") {
        cacheDirectory = path.join(workspace, "cache-link");
        await fs.symlink(backup, cacheDirectory, "junction");
      }
      if (scenario === "symlinked disk") {
        const rootLink = path.join(workspace, "disk-link");
        await fs.symlink(backup, rootLink, "junction");
        config.set("storage.drivers.backup.root", rootLink);
      }
      const images = { variants: { thumb: { width: 10 } }, cacheDirectory };
      config.set("uploads.images", images);
      expect(() => variantCacheDirectoryFor(primary)).toThrow(
        /must not equal or contain the storage root/,
      );
      expect(() => resolveImageVariantsConfig(images, primary)).toThrow(
        /must not equal or contain the storage root/,
      );
      await expect(purgeImageVariants()).rejects.toThrow(
        /must not equal or contain the storage root/,
      );
      await expect(purgeImageVariants("photo.png")).rejects.toThrow(
        /must not equal or contain the storage root/,
      );
      expect(await fs.readFile(path.join(primary, "photo.png"), "utf8")).toBe("primary upload");
      expect(await fs.readFile(path.join(backup, "photo.png"), "utf8")).toBe("backup upload");
    },
  );

  it("checks runtime-registered local roots as well as static config", async () => {
    config.set("storage.drivers", { primary: { driver: "local", root: primary } });
    storage.register("runtime-backup", { driver: "local", root: backup });
    const images = { variants: { thumb: { width: 10 } }, cacheDirectory: backup };
    config.set("uploads.images", images);
    await expect(purgeImageVariants()).rejects.toThrow(
      /must not equal or contain the storage root/,
    );
    expect(() => resolveImageVariantsConfig(images, primary)).toThrow(
      /must not equal or contain the storage root/,
    );
    expect(await fs.readFile(path.join(backup, "photo.png"), "utf8")).toBe("backup upload");
  });

  it("resolves symlinked ancestors when the cache and disk suffixes do not exist yet", async () => {
    const alias = path.join(workspace, "alias");
    await fs.symlink(backup, alias, "junction");
    config.set("storage.drivers.future", {
      driver: "local",
      root: path.join(backup, "future", "uploads"),
    });
    const images = {
      variants: { thumb: { width: 10 } },
      cacheDirectory: path.join(alias, "future"),
    };
    config.set("uploads.images", images);
    await expect(purgeImageVariants()).rejects.toThrow(
      /must not equal or contain the storage root/,
    );
    expect(() => resolveImageVariantsConfig(images, primary)).toThrow(
      /must not equal or contain the storage root/,
    );
  });

  it("protects a configured disk inside the default cache even without image configuration", async () => {
    const nested = path.join(primary, ".cache", "image-variants", "private");
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, "receipt.txt"), "private upload");
    config.set("storage.drivers.private", { driver: "local", root: nested });
    config.set("uploads", {});
    await expect(purgeImageVariants()).rejects.toThrow(
      /must not equal or contain the storage root/,
    );
    expect(await fs.readFile(path.join(nested, "receipt.txt"), "utf8")).toBe("private upload");
  });

  it("allows dedicated derivative caches beneath a source root without treating a sibling as contained", async () => {
    const cacheDirectory = path.join(primary, ".cache", "image-variants");
    config.set("uploads.images", { variants: { thumb: { width: 10 } }, cacheDirectory });
    expect(variantCacheDirectoryFor(primary)).toBe(cacheDirectory);
    config.set("uploads.images.cacheDirectory", `${primary}-cache`);
    expect(variantCacheDirectoryFor(primary)).toBe(`${primary}-cache`);
  });
});
