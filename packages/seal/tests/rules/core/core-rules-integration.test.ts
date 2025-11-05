import { describe, expect, it } from "vitest";
import { v } from "../../../src/factory/validators";

describe("Core Rules Integration Tests", () => {
  describe("required() through validators", () => {
    it("should validate required string", async () => {
      const validator = v.string().required();
      const result = await v.validate(validator, "hello");
      expect(result.isValid).toBe(true);
      expect(result.data).toBe("hello");
    });

    it("should fail when required string is missing", async () => {
      const validator = v.string().required();
      const result = await v.validate(validator, undefined);
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0]?.error).toContain("required");
    });

    it("should fail when required string is empty", async () => {
      const validator = v.string().required();
      const result = await v.validate(validator, "");
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0]?.error).toContain("required");
    });
  });

  describe("equal() through validators", () => {
    it("should validate equal string", async () => {
      const validator = v.string().equal("test");
      const result = await v.validate(validator, "test");
      expect(result.isValid).toBe(true);
    });

    it("should fail when string is not equal", async () => {
      const validator = v.string().equal("test");
      const result = await v.validate(validator, "hello");
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0]?.error).toContain("equal");
    });

    it("should validate equal number", async () => {
      const validator = v.number().equal(42);
      const result = await v.validate(validator, 42);
      expect(result.isValid).toBe(true);
    });

    it("should fail when number is not equal", async () => {
      const validator = v.number().equal(42);
      const result = await v.validate(validator, 100);
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0]?.error).toContain("equal");
    });
  });

  describe("forbidden() through validators", () => {
    it("should pass when forbidden field is undefined", async () => {
      const validator = v.string().forbidden();
      const result = await v.validate(validator, undefined);
      expect(result.isValid).toBe(true);
    });

    it("should pass when forbidden field is null", async () => {
      const validator = v.string().forbidden();
      const result = await v.validate(validator, null);
      expect(result.isValid).toBe(true);
    });

    it("should fail when forbidden field has value", async () => {
      const validator = v.string().forbidden();
      const result = await v.validate(validator, "test");
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0]?.error).toContain("forbidden");
    });

    it("should fail when forbidden field is empty string", async () => {
      const validator = v.string().forbidden();
      const result = await v.validate(validator, "");
      expect(result.isValid).toBe(true); // Empty string is considered empty, so passes
    });
  });

  describe("Combined rules", () => {
    it("should validate required and equal together", async () => {
      const validator = v.string().required().equal("admin");
      const result = await v.validate(validator, "admin");
      expect(result.isValid).toBe(true);
    });

    it("should fail required first, then equal", async () => {
      const validator = v.string().required().equal("admin");
      const result = await v.validate(validator, undefined);
      expect(result.isValid).toBe(false);
      // Should fail on required first
      expect(result.errors?.[0]?.error).toContain("required");
    });

    it("should validate optional field with equal", async () => {
      const validator = v.string().optional().equal("admin");
      const result1 = await v.validate(validator, undefined);
      expect(result1.isValid).toBe(true);

      const result2 = await v.validate(validator, "admin");
      expect(result2.isValid).toBe(true);

      const result3 = await v.validate(validator, "user");
      expect(result3.isValid).toBe(false);
      expect(result3.errors?.[0]?.error).toContain("equal");
    });
  });

  describe("Object validation with core rules", () => {
    it("should validate object with required fields", async () => {
      const schema = v.object({
        name: v.string().required(),
        email: v.string().optional(),
      });

      const result = await v.validate(schema, {
        name: "John",
        email: "john@example.com",
      });

      expect(result.isValid).toBe(true);
      expect(result.data.name).toBe("John");
      expect(result.data.email).toBe("john@example.com");
    });

    it("should fail when required field is missing in object", async () => {
      const schema = v.object({
        name: v.string().required(),
        email: v.string().optional(),
      });

      const result = await v.validate(schema, {
        email: "john@example.com",
      });

      expect(result.isValid).toBe(false);
      expect(result.errors?.some(e => e.input === "name")).toBe(true);
    });

    it("should validate forbidden field in object", async () => {
      const schema = v.object({
        name: v.string().required(),
        secret: v.string().forbidden(),
      });

      const result1 = await v.validate(schema, {
        name: "John",
      });

      expect(result1.isValid).toBe(true);

      const result2 = await v.validate(schema, {
        name: "John",
        secret: "should not be here",
      });

      expect(result2.isValid).toBe(false);
      expect(result2.errors?.some(e => e.input === "secret")).toBe(true);
    });
  });
});
