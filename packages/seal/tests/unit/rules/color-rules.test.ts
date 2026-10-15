import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
import {
  colorRule,
  darkColorRule,
  hexColorRule,
  lightColorRule,
  rgbColorRule,
} from "../../../src/rules/color/color-rules";

describe("Color Rules", () => {
  it("should validate generic color", async () => {
    const validator = v.string().addRule(colorRule);

    expect((await validate(validator, "#000")).isValid).toBe(true);
    expect((await validate(validator, "#ffffff")).isValid).toBe(true);
    expect((await validate(validator, "rgb(0,0,0)")).isValid).toBe(true);
    expect((await validate(validator, "not-a-color")).isValid).toBe(false);
  });

  it("should validate hex color", async () => {
    const validator = v.string().mutable;
    validator.addMutableRule(hexColorRule);

    expect((await validate(validator, "#fff")).isValid).toBe(true);
    expect((await validate(validator, "fff")).isValid).toBe(false);
  });

  it("should validate rgb color", async () => {
    const validator = v.string().mutable;
    validator.addMutableRule(rgbColorRule);

    expect((await validate(validator, "rgb(255, 0, 0)")).isValid).toBe(true);
    expect((await validate(validator, "rgba(255, 0, 0, 1)")).isValid).toBe(false);
  });

  it("should validate light and dark colors", async () => {
    const lightValidator = v.string().mutable;
    lightValidator.addMutableRule(lightColorRule);

    expect((await validate(lightValidator, "#ffffff")).isValid).toBe(true);
    expect((await validate(lightValidator, "#000000")).isValid).toBe(false);

    const darkValidator = v.string().mutable;
    darkValidator.addMutableRule(darkColorRule);

    expect((await validate(darkValidator, "#000000")).isValid).toBe(true);
    expect((await validate(darkValidator, "#ffffff")).isValid).toBe(false);
  });
});
