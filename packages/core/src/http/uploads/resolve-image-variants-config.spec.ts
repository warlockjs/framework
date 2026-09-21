import path from "node:path";
import { describe, expect, it } from "vitest";
import type { UploadsImagesConfigurations } from "../uploads-types";
import { ImageVariantsConfigError } from "./image-variants-config-error";
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
