import { describe, it } from "vitest";
import { equalRule } from "../../../src/rules/core/equal";
import {
  expectInvalid,
  expectValid,
  mockValidateRule,
} from "../../setup/test-helpers";

describe("Equal Rule", () => {
  describe("equalRule", () => {
    it("should pass when value equals the target value (string)", async () => {
      const result = await mockValidateRule(equalRule, "hello", {
        value: "hello",
      });
      expectValid(result);
    });

    it("should pass when value equals the target value (number)", async () => {
      const result = await mockValidateRule(equalRule, 42, { value: 42 });
      expectValid(result);
    });

    it("should pass when value equals the target value (boolean)", async () => {
      const result = await mockValidateRule(equalRule, true, { value: true });
      expectValid(result);
    });

    it("should pass when value equals the target value (null)", async () => {
      const result = await mockValidateRule(equalRule, null, { value: null });
      expectValid(result);
    });

    it("should fail when value does not equal the target value (string)", async () => {
      const result = await mockValidateRule(equalRule, "hello", {
        value: "world",
      });
      expectInvalid(result, "equal");
    });

    it("should fail when value does not equal the target value (number)", async () => {
      const result = await mockValidateRule(equalRule, 42, { value: 100 });
      expectInvalid(result, "equal");
    });

    it("should fail when value does not equal the target value (boolean)", async () => {
      const result = await mockValidateRule(equalRule, true, { value: false });
      expectInvalid(result, "equal");
    });

    it("should handle strict equality (NaN)", async () => {
      // NaN !== NaN, so this should fail with strict equality
      const result = await mockValidateRule(equalRule, NaN, { value: NaN });
      expectInvalid(result);
    });

    it("should handle zero vs negative zero", async () => {
      // 0 === -0 in JavaScript, so this should pass
      const result = await mockValidateRule(equalRule, 0, { value: -0 });
      expectValid(result);
    });

    it("should handle object reference equality", async () => {
      const obj = { name: "test" };
      const result = await mockValidateRule(equalRule, obj, { value: obj });
      expectValid(result);
    });

    it("should fail with different object references (even if content is same)", async () => {
      const obj1 = { name: "test" };
      const obj2 = { name: "test" };
      const result = await mockValidateRule(equalRule, obj1, { value: obj2 });
      expectInvalid(result);
    });
  });
});
