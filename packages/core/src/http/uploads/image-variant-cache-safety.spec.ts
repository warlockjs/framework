import config from "@mongez/config";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storage } from "../../storage";
import { variantCacheDirectoryFor } from "./image-variant-cache";
import { purgeImageVariants } from "./purge-image-variants";
import { resolveImageVariantsConfig } from "./resolve-image-variants-config";

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
