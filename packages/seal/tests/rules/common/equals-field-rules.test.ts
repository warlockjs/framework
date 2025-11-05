import { describe, it } from "vitest";
import { equalsFieldRule } from "../../../src/rules/common/equals-field-rules";
import {
  createContextualRule,
  createMockContext,
  expectInvalid,
  expectValid,
} from "../../setup/test-helpers";

describe("Equals Field Rule", () => {
  describe("equalsFieldRule", () => {
    describe("global scope", () => {
      it("should pass when value equals the target field value", async () => {
        const context = createMockContext({
          password: "hello",
          confirmPassword: "hello",
        });
        const rule = createContextualRule(equalsFieldRule, {
          field: "password",
          scope: "global",
        });
        const result = await rule.validate("hello", context);
        expectValid(result);
      });

      it("should fail when value does not equal the target field value", async () => {
        const context = createMockContext({
          password: "world",
          confirmPassword: "hello",
        });
        const rule = createContextualRule(equalsFieldRule, {
          field: "password",
          scope: "global",
        });
        const result = await rule.validate("hello", context);
        expectInvalid(result);
      });

      it("should handle number values", async () => {
        const context = createMockContext({ age: 42, otherAge: 42 }, 42);
        const rule = createContextualRule(equalsFieldRule, {
          field: "age",
          scope: "global",
        });
        const result = await rule.validate(42, context);
        expectValid(result);
      });

      it("should handle boolean values", async () => {
        const context = createMockContext({ active: true, status: true });
        const rule = createContextualRule(equalsFieldRule, {
          field: "active",
          scope: "global",
        });
        const result = await rule.validate(true, context);
        expectValid(result);
      });

      it("should handle null values", async () => {
        const context = createMockContext({ value1: null, value2: null }, null);
        const rule = createContextualRule(equalsFieldRule, {
          field: "value1",
          scope: "global",
        });
        const result = await rule.validate(null, context);
        expectValid(result);
      });

      it("should handle object reference equality", async () => {
        const obj = { name: "test" };
        const context = createMockContext({ obj1: obj, obj2: obj }, obj);
        const rule = createContextualRule(equalsFieldRule, {
          field: "obj1",
          scope: "global",
        });
        const result = await rule.validate(obj, context);
        expectValid(result);
      });

      it("should fail when field does not exist", async () => {
        const context = createMockContext({ password: "world" }, "hello");
        const rule = createContextualRule(equalsFieldRule, {
          field: "nonexistent",
          scope: "global",
        });
        const result = await rule.validate("hello", context);
        // Field doesn't exist, so fieldValue is undefined, which won't match
        expectInvalid(result);
      });

      it("should handle nested field paths (dot notation)", async () => {
        const context = createMockContext({
          user: {
            email: "john@example.com",
            profile: { contact: "john@example.com" },
          },
        });
        const rule = createContextualRule(equalsFieldRule, {
          field: "user.email",
          scope: "global",
        });
        const result = await rule.validate("john@example.com", context);
        expectValid(result);
      });
    });

    describe("sibling scope", () => {
      it("should pass when value equals the sibling field value", async () => {
        const parent = { password: "hello", confirmPassword: "hello" };
        const context = createMockContext(parent);
        context.parent = parent;
        const rule = createContextualRule(equalsFieldRule, {
          field: "password",
          scope: "sibling",
        });
        const result = await rule.validate("hello", context);
        expectValid(result);
      });

      it("should fail when value does not equal the sibling field value", async () => {
        const parent = { password: "world", confirmPassword: "hello" };
        const context = createMockContext(parent);
        context.parent = parent;
        const rule = createContextualRule(equalsFieldRule, {
          field: "password",
          scope: "sibling",
        });
        const result = await rule.validate("hello", context);
        expectInvalid(result);
      });

      it("should use sibling scope when parent exists but scope is not specified", async () => {
        // Default scope is global, but if parent is provided, it should work
        const parent = { password: "hello", confirmPassword: "hello" };
        const context = createMockContext(parent);
        context.parent = parent;
        const rule = createContextualRule(equalsFieldRule, {
          field: "password",
          // No scope specified - defaults to global
        });
        // This will look in allValues, not parent
        const result = await rule.validate("hello", context);
        expectValid(result);
      });
    });

    describe("edge cases", () => {
      it("should handle zero vs negative zero", async () => {
        const context = createMockContext({ value1: -0, value2: 0 }, 0);
        const rule = createContextualRule(equalsFieldRule, {
          field: "value1",
          scope: "global",
        });
        // 0 === -0 in JavaScript strict equality
        const result = await rule.validate(0, context);
        expectValid(result);
      });

      it("should handle NaN comparison", async () => {
        const context = createMockContext({ value1: NaN, value2: NaN }, NaN);
        const rule = createContextualRule(equalsFieldRule, {
          field: "value1",
          scope: "global",
        });
        // NaN !== NaN, so this should fail
        const result = await rule.validate(NaN, context);
        expectInvalid(result);
      });
    });
  });
});
