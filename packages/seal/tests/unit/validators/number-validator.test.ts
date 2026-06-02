import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

describe("NumberValidator - Comprehensive", () => {
  describe("Type Validation", () => {
    it("validates number type", async () => {
      expect((await validate(v.number(), 123)).isValid).toBe(true);
      expect((await validate(v.number(), 0)).isValid).toBe(true);
      expect((await validate(v.number(), -456)).isValid).toBe(true);
      expect((await validate(v.number(), 3.14)).isValid).toBe(true);
    });

    it("fails for non-number", async () => {
      expect((await validate(v.number(), "123")).isValid).toBe(false);
      expect((await validate(v.number(), true)).isValid).toBe(false);
    });
  });

  describe("Range Rules", () => {
    it("min", async () => {
      expect((await validate(v.number().min(10), 15)).isValid).toBe(true);
      expect((await validate(v.number().min(10), 10)).isValid).toBe(true);
      expect((await validate(v.number().min(10), 5)).isValid).toBe(false);
    });

    it("max", async () => {
      expect((await validate(v.number().max(100), 50)).isValid).toBe(true);
      expect((await validate(v.number().max(100), 100)).isValid).toBe(true);
      expect((await validate(v.number().max(100), 150)).isValid).toBe(false);
    });

    it("between", async () => {
      expect((await validate(v.number().between(10, 20), 15)).isValid).toBe(true);
      expect((await validate(v.number().between(10, 20), 10)).isValid).toBe(true);
      expect((await validate(v.number().between(10, 20), 20)).isValid).toBe(true);
      expect((await validate(v.number().between(10, 20), 5)).isValid).toBe(false);
      expect((await validate(v.number().between(10, 20), 25)).isValid).toBe(false);
    });

    it("greaterThan", async () => {
      expect((await validate(v.number().greaterThan(10), 15)).isValid).toBe(true);
      expect((await validate(v.number().greaterThan(10), 10)).isValid).toBe(false);
      expect((await validate(v.number().greaterThan(10), 5)).isValid).toBe(false);
    });

    it("lessThan", async () => {
      expect((await validate(v.number().lessThan(100), 50)).isValid).toBe(true);
      expect((await validate(v.number().lessThan(100), 100)).isValid).toBe(false);
      expect((await validate(v.number().lessThan(100), 150)).isValid).toBe(false);
    });
  });

  describe("Sign Rules", () => {
    it("positive", async () => {
      expect((await validate(v.number().positive(), 10)).isValid).toBe(true);
      expect((await validate(v.number().positive(), 0)).isValid).toBe(false);
      expect((await validate(v.number().positive(), -10)).isValid).toBe(false);
    });

    it("negative", async () => {
      expect((await validate(v.number().negative(), -10)).isValid).toBe(true);
      expect((await validate(v.number().negative(), 0)).isValid).toBe(false);
      expect((await validate(v.number().negative(), 10)).isValid).toBe(false);
    });
  });

  describe("Parity Rules", () => {
    it("even", async () => {
      expect((await validate(v.number().even(), 10)).isValid).toBe(true);
      expect((await validate(v.number().even(), 0)).isValid).toBe(true);
      expect((await validate(v.number().even(), 11)).isValid).toBe(false);
    });

    it("odd", async () => {
      expect((await validate(v.number().odd(), 11)).isValid).toBe(true);
      expect((await validate(v.number().odd(), 10)).isValid).toBe(false);
      expect((await validate(v.number().odd(), 0)).isValid).toBe(false);
    });
  });

  describe("Divisibility Rules", () => {
    it("divisibleBy", async () => {
      expect((await validate(v.number().divisibleBy(5), 15)).isValid).toBe(true);
      expect((await validate(v.number().divisibleBy(5), 17)).isValid).toBe(false);
    });

    it("multipleOf", async () => {
      expect((await validate(v.number().multipleOf(3), 9)).isValid).toBe(true);
      expect((await validate(v.number().multipleOf(3), 10)).isValid).toBe(false);
    });
  });

  describe("Field Comparisons", () => {
    it("minField", async () => {
      const validator = v.object({
        min: v.number(),
        value: v.number().min("min"),
      });

      expect((await validate(validator, { min: 10, value: 15 })).isValid).toBe(true);
      expect((await validate(validator, { min: 10, value: 5 })).isValid).toBe(false);
    });

    it("maxField", async () => {
      const validator = v.object({
        max: v.number(),
        value: v.number().max("max"),
      });

      expect((await validate(validator, { max: 100, value: 50 })).isValid).toBe(true);
      expect((await validate(validator, { max: 100, value: 150 })).isValid).toBe(false);
    });

    it("greaterThanField", async () => {
      const validator = v.object({
        start: v.number(),
        end: v.number().greaterThan("start"),
      });

      expect((await validate(validator, { start: 10, end: 20 })).isValid).toBe(true);
      expect((await validate(validator, { start: 10, end: 5 })).isValid).toBe(false);
    });

    it("lessThanField", async () => {
      const validator = v.object({
        max: v.number(),
        value: v.number().lessThan("max"),
      });

      expect((await validate(validator, { max: 100, value: 50 })).isValid).toBe(true);
      expect((await validate(validator, { max: 100, value: 150 })).isValid).toBe(false);
    });
  });

  describe("Mutators", () => {
    it("abs", async () => {
      expect((await validate(v.number().abs(), -10)).data).toBe(10);
      expect((await validate(v.number().abs(), 10)).data).toBe(10);
    });

    it("ceil", async () => {
      expect((await validate(v.number().ceil(), 3.2)).data).toBe(4);
      expect((await validate(v.number().ceil(), 3.9)).data).toBe(4);
    });

    it("floor", async () => {
      expect((await validate(v.number().floor(), 3.2)).data).toBe(3);
      expect((await validate(v.number().floor(), 3.9)).data).toBe(3);
    });

    it("round", async () => {
      expect((await validate(v.number().round(), 3.4)).data).toBe(3);
      expect((await validate(v.number().round(), 3.6)).data).toBe(4);
    });
  });

  describe("Chaining", () => {
    it("chains multiple rules", async () => {
      const validator = v.number().min(0).max(100).even();
      expect((await validate(validator, 50)).isValid).toBe(true);
      expect((await validate(validator, 51)).isValid).toBe(false);
      expect((await validate(validator, -10)).isValid).toBe(false);
      expect((await validate(validator, 150)).isValid).toBe(false);
    });

    it("chains mutators and rules", async () => {
      const result = await validate(v.number().abs().min(10), -15);
      expect(result.isValid).toBe(true);
      expect(result.data).toBe(15);
    });
  });
});
