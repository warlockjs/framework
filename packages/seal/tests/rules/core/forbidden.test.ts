import { describe, it } from "vitest";
import { forbiddenRule } from "../../../src/rules/core/forbidden";
import {
  expectInvalid,
  expectValid,
  mockValidateRule,
} from "../../setup/test-helpers";

describe("Forbidden Rule", () => {
  describe("forbiddenRule", () => {
    it("should pass when value is undefined", async () => {
      const result = await mockValidateRule(forbiddenRule, undefined);
      expectValid(result);
    });

    it("should pass when value is null", async () => {
      const result = await mockValidateRule(forbiddenRule, null);
      expectValid(result);
    });

    it("should pass when value is an empty string", async () => {
      const result = await mockValidateRule(forbiddenRule, "");
      expectValid(result);
    });

    it("should pass when value is an empty array", async () => {
      const result = await mockValidateRule(forbiddenRule, []);
      expectValid(result);
    });

    it("should pass when value is an empty object", async () => {
      const result = await mockValidateRule(forbiddenRule, {});
      expectValid(result);
    });

    it("should fail when value is a non-empty string", async () => {
      const result = await mockValidateRule(forbiddenRule, "hello");
      expectInvalid(result, "forbidden");
    });

    it("should fail when value is a number", async () => {
      const result = await mockValidateRule(forbiddenRule, 42);
      expectInvalid(result, "forbidden");
    });

    it("should fail when value is zero", async () => {
      const result = await mockValidateRule(forbiddenRule, 0);
      expectInvalid(result, "forbidden");
    });

    it("should fail when value is false", async () => {
      const result = await mockValidateRule(forbiddenRule, false);
      expectInvalid(result, "forbidden");
    });

    it("should fail when value is true", async () => {
      const result = await mockValidateRule(forbiddenRule, true);
      expectInvalid(result, "forbidden");
    });

    it("should fail when value is a non-empty array", async () => {
      const result = await mockValidateRule(forbiddenRule, [1, 2, 3]);
      expectInvalid(result, "forbidden");
    });

    it("should fail when value is an object with properties", async () => {
      const result = await mockValidateRule(forbiddenRule, { name: "test" });
      expectInvalid(result, "forbidden");
    });

    it("should fail when value is whitespace-only string", async () => {
      const result = await mockValidateRule(forbiddenRule, "   ");
      expectInvalid(result, "forbidden");
    });
  });
});
