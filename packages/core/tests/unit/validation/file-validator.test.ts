import { describe, expect, it } from "vitest";
import { FileValidator } from "../../../src/validation/validators/file-validator";

describe("FileValidator.matchesType", () => {
  it("returns false for values that are not uploaded files", () => {
    const validator = new FileValidator();

    expect(validator.matchesType("string")).toBe(false);
    expect(validator.matchesType(123)).toBe(false);
    expect(validator.matchesType({})).toBe(false);
    expect(validator.matchesType(null)).toBe(false);
  });
});

describe("FileValidator chaining", () => {
  it("returns a FileValidator from each rule-adding helper so calls can chain", () => {
    const validator = new FileValidator();

    // Seal validators are immutable builders — each rule helper yields a new
    // FileValidator rather than mutating the original.
    expect(validator.image()).toBeInstanceOf(FileValidator);
    expect(validator.pdf()).toBeInstanceOf(FileValidator);
    expect(validator.accept(["png", "jpg"])).toBeInstanceOf(FileValidator);
    expect(validator.minWidth(100)).toBeInstanceOf(FileValidator);
    expect(validator.maxHeight(2000)).toBeInstanceOf(FileValidator);
  });
});

describe("FileValidator.toJsonSchema", () => {
  it("emits a binary string for openapi-3.0", () => {
    expect(new FileValidator().toJsonSchema("openapi-3.0")).toEqual({
      type: "string",
      format: "binary",
    });
  });

  it("emits contentEncoding binary for draft-2020-12 (the default)", () => {
    expect(new FileValidator().toJsonSchema()).toEqual({
      type: "string",
      contentEncoding: "binary",
    });
  });

  it("emits a permissive empty schema for draft-07", () => {
    expect(new FileValidator().toJsonSchema("draft-07")).toEqual({});
  });
});
