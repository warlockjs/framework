import { describe, it } from "vitest";
import { notEqualsFieldRule } from "../../../src/rules/common/equals-field-rules";
import {
  createContextualRule,
  createMockContext,
  expectInvalid,
  expectValid,
} from "../../setup/test-helpers";

describe("Not Equals Field Rule", () => {
  describe("notEqualsFieldRule", () => {
    describe("global scope", () => {
      it("should pass when value does NOT equal the target field value", async () => {
        const context = createMockContext({
          password: "world",
          confirmPassword: "hello",
        });
        const rule = createContextualRule(notEqualsFieldRule, {
          field: "password",
          scope: "global",
        });
        const result = await rule.validate("hello", context);
        expectValid(result);
      });

      it("should fail when value equals the target field value", async () => {
        const context = createMockContext({
          password: "hello",
          confirmPassword: "hello",
        });
        const rule = createContextualRule(notEqualsFieldRule, {
          field: "password",
          scope: "global",
        });
        const result = await rule.validate("hello", context);
        expectInvalid(result);
      });

      it("should handle number values", async () => {
        const context = createMockContext({ age: 100, otherAge: 42 }, 42);
        const rule = createContextualRule(notEqualsFieldRule, {
          field: "age",
          scope: "global",
        });
        const result = await rule.validate(42, context);
        expectValid(result);
      });

      it("should fail when number values match", async () => {
        const context = createMockContext({ age: 42, otherAge: 42 }, 42);
        const rule = createContextualRule(notEqualsFieldRule, {
          field: "age",
          scope: "global",
        });
        const result = await rule.validate(42, context);
        expectInvalid(result);
      });

      it("should handle boolean values", async () => {
        const context = createMockContext({
          active: false,
          status: true,
        });
        const rule = createContextualRule(notEqualsFieldRule, {
          field: "active",
          scope: "global",
        });
        const result = await rule.validate(true, context);
        expectValid(result);
      });

      it("should handle null values", async () => {
        const context = createMockContext({
          value1: "test",
          value2: null,
        });
        const rule = createContextualRule(notEqualsFieldRule, {
          field: "value1",
          scope: "global",
        });
        const result = await rule.validate(null, context);
        expectValid(result);
      });

      it("should pass when field does not exist (undefined !== value)", async () => {
        const context = createMockContext({ password: "world" }, "hello");
        const rule = createContextualRule(notEqualsFieldRule, {
          field: "nonexistent",
          scope: "global",
        });
        // undefined !== "hello", so should pass
        const result = await rule.validate("hello", context);
        expectValid(result);
      });

      it("should handle nested field paths (dot notation)", async () => {
        const context = createMockContext({
          user: {
            email: "jane@example.com",
            profile: { contact: "john@example.com" },
          },
        });
        const rule = createContextualRule(notEqualsFieldRule, {
          field: "user.email",
          scope: "global",
        });
        const result = await rule.validate("john@example.com", context);
        expectValid(result);
      });
    });

    describe("sibling scope", () => {
      it("should pass when value does NOT equal the sibling field value", async () => {
        const parent = { password: "world", confirmPassword: "hello" };
        const context = createMockContext(parent);
        context.parent = parent;
        const rule = createContextualRule(notEqualsFieldRule, {
          field: "password",
          scope: "sibling",
        });
        const result = await rule.validate("hello", context);
        expectValid(result);
      });

      it("should fail when value equals the sibling field value", async () => {
        const parent = { password: "hello", confirmPassword: "hello" };
        const context = createMockContext(parent);
        context.parent = parent;
        const rule = createContextualRule(notEqualsFieldRule, {
          field: "password",
          scope: "sibling",
        });
        const result = await rule.validate("hello", context);
        expectInvalid(result);
      });
    });

    describe("edge cases", () => {
      it("should handle zero vs negative zero", async () => {
        const context = createMockContext({ value1: -0, value2: 0 }, 0);
        const rule = createContextualRule(notEqualsFieldRule, {
          field: "value1",
          scope: "global",
        });
        // 0 === -0 in JavaScript strict equality, so should fail
        const result = await rule.validate(0, context);
        expectInvalid(result);
      });

      it("should handle NaN comparison", async () => {
        const context = createMockContext({ value1: NaN, value2: NaN }, NaN);
        const rule = createContextualRule(notEqualsFieldRule, {
          field: "value1",
          scope: "global",
        });
        // NaN !== NaN, so this should pass
        const result = await rule.validate(NaN, context);
        expectValid(result);
      });

      it("should handle different object references", async () => {
        const obj1 = { name: "test" };
        const obj2 = { name: "test" };
        const context = createMockContext({ obj1: obj1, obj2: obj2 }, obj1);
        const rule = createContextualRule(notEqualsFieldRule, {
          field: "obj2",
          scope: "global",
        });
        // Different references, so should pass
        const result = await rule.validate(obj1, context);
        expectValid(result);
      });
    });
  });
});
