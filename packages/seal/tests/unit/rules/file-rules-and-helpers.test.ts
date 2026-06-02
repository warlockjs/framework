import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
import { humanizeSize, resolveFileSize } from "../../../src/helpers/file.utils";
import {
  maxHeightRule,
  maxWidthRule,
  minHeightRule,
  minWidthRule,
} from "../../../src/rules/file/dimensions";
import { maxFileSizeRule, minFileSizeRule } from "../../../src/rules/file/file-size";

/**
 * The "core" file rules are framework-agnostic: they duck-type `value.size`
 * (number or async fn) and `value.dimensions()` rather than depending on a
 * concrete UploadedFile class (see src/rules/file/index.ts). They are exercised
 * here with plain stand-in objects, alongside the pure file-size helpers.
 */

/** Minimal stand-in for an uploaded file exposing a numeric size. */
function fileWithSize(size: number) {
  return { size };
}

/** Stand-in exposing size as an async function (the other supported shape). */
function fileWithAsyncSize(size: number) {
  return { size: async () => size };
}

/** Stand-in exposing async dimensions. */
function imageWithDimensions(width: number, height: number) {
  return { dimensions: async () => ({ width, height }) };
}

describe("File size rules (duck-typed file objects)", () => {
  it("maxFileSize accepts sizes at or under the cap (numeric size)", async () => {
    const validator = v.any().mutable;
    const rule = validator.addMutableRule(maxFileSizeRule);
    rule.context.options.maxSize = 1024;

    expect((await validate(validator, fileWithSize(512))).isValid).toBe(true);
    expect((await validate(validator, fileWithSize(1024))).isValid).toBe(true);
    expect((await validate(validator, fileWithSize(2048))).isValid).toBe(false);
  });

  it("maxFileSize resolves an async size()", async () => {
    const validator = v.any().mutable;
    const rule = validator.addMutableRule(maxFileSizeRule);
    rule.context.options.maxSize = 1000;

    expect((await validate(validator, fileWithAsyncSize(500))).isValid).toBe(true);
    expect((await validate(validator, fileWithAsyncSize(1500))).isValid).toBe(false);
  });

  it("minFileSize enforces a lower bound", async () => {
    const validator = v.any().mutable;
    const rule = validator.addMutableRule(minFileSizeRule);
    rule.context.options.minSize = 1024;

    expect((await validate(validator, fileWithSize(2048))).isValid).toBe(true);
    expect((await validate(validator, fileWithSize(512))).isValid).toBe(false);
    expect((await validate(validator, fileWithAsyncSize(2048))).isValid).toBe(true);
  });
});

describe("Image dimension rules (duck-typed image objects)", () => {
  it("minWidth / maxWidth", async () => {
    const minV = v.any().mutable;
    minV.addMutableRule(minWidthRule).context.options.minWidth = 100;
    expect((await validate(minV, imageWithDimensions(200, 50))).isValid).toBe(true);
    expect((await validate(minV, imageWithDimensions(80, 50))).isValid).toBe(false);

    const maxV = v.any().mutable;
    maxV.addMutableRule(maxWidthRule).context.options.maxWidth = 100;
    expect((await validate(maxV, imageWithDimensions(80, 50))).isValid).toBe(true);
    expect((await validate(maxV, imageWithDimensions(200, 50))).isValid).toBe(false);
  });

  it("minHeight / maxHeight", async () => {
    const minV = v.any().mutable;
    minV.addMutableRule(minHeightRule).context.options.minHeight = 100;
    expect((await validate(minV, imageWithDimensions(50, 200))).isValid).toBe(true);
    expect((await validate(minV, imageWithDimensions(50, 80))).isValid).toBe(false);

    const maxV = v.any().mutable;
    maxV.addMutableRule(maxHeightRule).context.options.maxHeight = 100;
    expect((await validate(maxV, imageWithDimensions(50, 80))).isValid).toBe(true);
    expect((await validate(maxV, imageWithDimensions(50, 200))).isValid).toBe(false);
  });
});

describe("file.utils helpers", () => {
  describe("resolveFileSize", () => {
    it("returns a plain number unchanged", () => {
      expect(resolveFileSize(2048)).toBe(2048);
    });

    it("converts each unit to bytes", () => {
      expect(resolveFileSize({ size: 1, unit: "B" })).toBe(1);
      expect(resolveFileSize({ size: 1, unit: "KB" })).toBe(1024);
      expect(resolveFileSize({ size: 1, unit: "MB" })).toBe(1024 * 1024);
      expect(resolveFileSize({ size: 1, unit: "GB" })).toBe(1024 * 1024 * 1024);
    });
  });

  describe("humanizeSize", () => {
    it("formats bytes through the unit ladder", () => {
      expect(humanizeSize(512)).toBe("512B");
      expect(humanizeSize(1024)).toBe("1KB");
      expect(humanizeSize(1024 * 1024)).toBe("1MB");
      expect(humanizeSize(1024 * 1024 * 1024)).toBe("1GB");
    });

    it("uses two decimals for non-integer results", () => {
      expect(humanizeSize(1536)).toBe("1.50KB");
    });
  });
});
