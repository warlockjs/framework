import config from "@mongez/config";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storage } from "../../storage";
import type { UploadsImagesConfigurations } from "../uploads-types";
import { resetVariantCacheOverlapChecks } from "./image-variant-cache";
import { ImageVariantsConfigError } from "./image-variants-config-error";
import { purgeImageVariants } from "./purge-image-variants";
import { resolveImageVariantsConfig } from "./resolve-image-variants-config";

const root = path.resolve("/srv/storage");

function resolve(images: unknown) {
  return resolveImageVariantsConfig(images as UploadsImagesConfigurations, root);
}

function requiredVariant(
  config: NonNullable<ReturnType<typeof resolveImageVariantsConfig>>,
  name: string,
) {
  const variant = config.variants[name];
  expect(variant, `expected resolved ${name} variant`).toBeDefined();
  if (variant === undefined) throw new Error(`expected resolved ${name} variant`);
  return variant;
}

describe("resolveImageVariantsConfig", () => {
  it.each([root, path.dirname(root)])(
    "refuses a cache directory that contains the storage root: %s",
    (cacheDirectory) => {
      expect(() => resolve({ variants: { thumb: { width: 10 } }, cacheDirectory })).toThrow(
        /must not equal or contain the storage root/,
      );
    },
  );
  it("returns undefined when no images config exists", () => {
    expect(resolve(undefined)).toBeUndefined();
  });

  it("applies the documented defaults", () => {
    const resolved = resolve({ variants: { thumb: { width: 320 } } });

    expect(resolved).toEqual({
      variants: { thumb: { width: 320, enlarge: false } },
      formats: [],
      maxSourceBytes: 25 * 1024 * 1024,
      maxSourcePixels: 40_000_000,
      maxCacheBytes: 512 * 1024 * 1024,
      maxCacheAge: 7 * 24 * 60 * 60,
      cacheDirectory: path.join(root, ".cache", "image-variants"),
    });
  });

  it("accepts a complete, valid config", () => {
    const resolved = resolve({
      variants: { card: { width: 640, height: 480, fit: "inside", quality: 80, enlarge: true } },
      formats: ["webp", "avif"],
      maxSourceBytes: 1000,
      maxSourcePixels: 2000,
      cacheDirectory: "/tmp/variants",
    });

    expect(resolved?.variants.card).toEqual({
      width: 640,
      height: 480,
      fit: "inside",
      quality: 80,
      enlarge: true,
    });
    expect(resolved?.formats).toEqual(["webp", "avif"]);
    expect(resolved?.cacheDirectory).toBe(path.resolve("/tmp/variants"));
  });

  it("defaults enlarge to false when omitted", () => {
    const resolved = resolve({ variants: { thumb: { width: 320 } } });

    expect(resolved).toBeDefined();
    if (resolved === undefined) throw new Error("expected resolved image variants config");
    expect(requiredVariant(resolved, "thumb").enlarge).toBe(false);
  });

  it.each([
    ["cache bytes zero", { variants: { a: { width: 10 } }, maxCacheBytes: 0 }],
    ["cache age negative", { variants: { a: { width: 10 } }, maxCacheAge: -1 }],
    ["variants missing", {}],
    ["no variants", { variants: {} }],
    ["width 0", { variants: { a: { width: 0 } } }],
    ["negative width", { variants: { a: { width: -5 } } }],
    ["fractional width", { variants: { a: { width: 10.5 } } }],
    ["width over 8192", { variants: { a: { width: 8193 } } }],
    ["string width", { variants: { a: { width: "100" } } }],
    ["missing width", { variants: { a: { height: 100 } } }],
    ["height 0", { variants: { a: { width: 10, height: 0 } } }],
    ["height over 8192", { variants: { a: { width: 10, height: 9000 } } }],
    ["quality 0", { variants: { a: { width: 10, quality: 0 } } }],
    ["quality 101", { variants: { a: { width: 10, quality: 101 } } }],
    ["fractional quality", { variants: { a: { width: 10, quality: 50.5 } } }],
    ["unknown fit", { variants: { a: { width: 10, fit: "fill" } } }],
    ["non-boolean enlarge", { variants: { a: { width: 10, enlarge: "yes" } } }],
    ["unknown format", { variants: { a: { width: 10 } }, formats: ["png"] }],
    ["non-positive maxSourceBytes", { variants: { a: { width: 10 } }, maxSourceBytes: 0 }],
    ["non-positive maxSourcePixels", { variants: { a: { width: 10 } }, maxSourcePixels: -1 }],
  ])("throws ImageVariantsConfigError for %s", (_label, images) => {
    expect(() => resolve(images)).toThrow(ImageVariantsConfigError);
  });

  it("names the offending variant and key in the message", () => {
    expect(() => resolve({ variants: { hero: { width: 99999 } } })).toThrow(
      /uploads\.images\.variants\.hero\.width/,
    );
  });
});

describe("cache directory resolution on disk", () => {
  let workspace: string;
  let disk: string;

  beforeEach(async () => {
    storage.reset();
    resetVariantCacheOverlapChecks();
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "variant-config-"));
    disk = path.join(workspace, "disk");
    await fs.mkdir(disk);
    config.set("storage", {
      default: "primary",
      drivers: { primary: { driver: "local", root: disk } },
    });
    vi.spyOn(storage, "root").mockReturnValue(disk);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    storage.reset();
    config.set("storage", {});
    config.set("uploads", {});
    resetVariantCacheOverlapChecks();
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("reports a cache directory beneath a regular file as a configuration error", async () => {
    const file = path.join(workspace, "not-a-directory");
    await fs.writeFile(file, "plain file");
    const images = { variants: { thumb: { width: 10 } }, cacheDirectory: path.join(file, "cache") };

    const thrown = (() => {
      try {
        resolveImageVariantsConfig(images, disk);
      } catch (error) {
        return error;
      }
    })();
    expect(thrown).toBeInstanceOf(ImageVariantsConfigError);
    expect((thrown as Error).message).toMatch(
      /could not be resolved: .*not-a-directory.*\(ENOTDIR\)/,
    );
    expect(((thrown as Error).cause as NodeJS.ErrnoException).code).toBe("ENOTDIR");

    config.set("uploads.images", images);
    const purge = purgeImageVariants().then(
      () => undefined,
      (error: unknown) => error,
    );
    const purgeError = await purge;
    expect(purgeError).toBeInstanceOf(ImageVariantsConfigError);
    expect(((purgeError as Error).cause as NodeJS.ErrnoException).code).toBe("ENOTDIR");
  });

  it("resolves each path once for repeated resolutions of the same configuration", () => {
    const images = {
      variants: { thumb: { width: 10 } },
      cacheDirectory: path.join(workspace, "cache"),
    };
    const realpath = vi.spyOn(fsSync, "realpathSync");

    resolveImageVariantsConfig(images, disk);
    const firstCalls = realpath.mock.calls.length;
    expect(firstCalls).toBeGreaterThan(0);
    resolveImageVariantsConfig(images, disk);
    expect(realpath.mock.calls).toHaveLength(firstCalls);
  });

  it("checks again when a disk registered afterwards overlaps the cache", () => {
    const cacheDirectory = path.join(workspace, "cache");
    const images = { variants: { thumb: { width: 10 } }, cacheDirectory };
    expect(resolveImageVariantsConfig(images, disk)?.cacheDirectory).toBe(cacheDirectory);

    config.set("storage.drivers", {
      primary: { driver: "local", root: disk },
      tenant: { driver: "local", root: path.join(cacheDirectory, "tenant") },
    });
    expect(() => resolveImageVariantsConfig(images, disk)).toThrow(
      /must not equal or contain the storage root/,
    );
    // The refusal is remembered too, and still thrown.
    expect(() => resolveImageVariantsConfig(images, disk)).toThrow(ImageVariantsConfigError);
  });
});
