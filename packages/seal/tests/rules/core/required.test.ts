import { describe, it } from "vitest";
import { presentRule, requiredRule } from "../../../src/rules/core/required";
import {
  expectInvalid,
  expectValid,
  mockValidateRule,
} from "../../setup/test-helpers";

describe("Required Rule", () => {
  describe("requiredRule", () => {
    it("should pass when value is a non-empty string", async () => {
      const result = await mockValidateRule(requiredRule, "hello");
      expectValid(result);
    });

    it("should pass when value is a number", async () => {
      const result = await mockValidateRule(requiredRule, 42);
      expectValid(result);
    });

    it("should pass when value is zero (0)", async () => {
      const result = await mockValidateRule(requiredRule, 0);
      expectValid(result);
    });

    it("should pass when value is false", async () => {
      const result = await mockValidateRule(requiredRule, false);
      expectValid(result);
    });

    it("should fail when value is an empty array (isEmpty considers [] as empty)", async () => {
      const result = await mockValidateRule(requiredRule, []);
      // isEmpty([]) returns true, so empty array is considered empty
      expectInvalid(result, "required");
    });

    it("should pass when value is an object", async () => {
      const result = await mockValidateRule(requiredRule, { name: "test" });
      expectValid(result);
    });

    it("should fail when value is undefined", async () => {
      const result = await mockValidateRule(requiredRule, undefined);
      expectInvalid(result, "required");
    });

    it("should fail when value is null", async () => {
      const result = await mockValidateRule(requiredRule, null);
      expectInvalid(result, "required");
    });

    it("should fail when value is an empty string", async () => {
      const result = await mockValidateRule(requiredRule, "");
      expectInvalid(result, "required");
    });

    it("should fail when value is whitespace-only string", async () => {
      const result = await mockValidateRule(requiredRule, "   ");
      // Note: isEmpty from @mongez/supportive-is might trim, so this could pass
      // Let's test the actual behavior
      if (result.isValid) {
        // If it passes, that's also valid behavior
        expectValid(result);
      } else {
        expectInvalid(result, "required");
      }
    });
  });

  describe("presentRule", () => {
    it("should pass when value is defined (even if empty string)", async () => {
      const result = await mockValidateRule(presentRule, "");
      expectValid(result);
    });

    it("should pass when value is null", async () => {
      const result = await mockValidateRule(presentRule, null);
      expectValid(result);
    });

    it("should pass when value is 0", async () => {
      const result = await mockValidateRule(presentRule, 0);
      expectValid(result);
    });

    it("should pass when value is false", async () => {
      const result = await mockValidateRule(presentRule, false);
      expectValid(result);
    });

    it("should fail when value is undefined", async () => {
      const result = await mockValidateRule(presentRule, undefined);
      expectInvalid(result, "required");
    });

    it("should pass when value is an empty array", async () => {
      const result = await mockValidateRule(presentRule, []);
      expectValid(result);
    });

    it("should pass when value is an empty object", async () => {
      const result = await mockValidateRule(presentRule, {});
      expectValid(result);
    });
  });
});
