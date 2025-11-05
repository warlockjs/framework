import { describe, it } from "vitest";
import {
  requiredIfEmptyRule,
  requiredIfInRule,
  requiredIfNotEmptyRule,
  requiredIfNotInRule,
  requiredIfRule,
} from "../../../src/rules/conditional/required-if-rules";
import {
  createContextualRule,
  createMockContext,
  expectInvalid,
  expectValid,
} from "../../setup/test-helpers";

describe("Required If Rules", () => {
  describe("requiredIfRule", () => {
    describe("global scope", () => {
      it("should fail when value is empty and other field equals expected value", async () => {
        const context = createMockContext({
          userType: "admin",
          role: "",
        });
        const rule = createContextualRule(requiredIfRule, {
          field: "userType",
          value: "admin",
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });

      it("should pass when value is not empty and other field equals expected value", async () => {
        const context = createMockContext({
          userType: "admin",
          role: "super",
        });
        const rule = createContextualRule(requiredIfRule, {
          field: "userType",
          value: "admin",
          scope: "global",
        });
        const result = await rule.validate("super", context);
        expectValid(result);
      });

      it("should pass when value is empty but other field does not equal expected value", async () => {
        const context = createMockContext({
          userType: "user",
          role: "",
        });
        const rule = createContextualRule(requiredIfRule, {
          field: "userType",
          value: "admin",
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectValid(result);
      });

      it("should pass when value is null and condition is met", async () => {
        const context = createMockContext({
          status: "active",
          notes: null,
        });
        const rule = createContextualRule(requiredIfRule, {
          field: "status",
          value: "active",
          scope: "global",
        });
        const result = await rule.validate(null, context);
        expectInvalid(result, "required");
      });

      it("should pass when value is undefined and condition is met", async () => {
        const context = createMockContext({
          status: "active",
          notes: undefined,
        });
        const rule = createContextualRule(requiredIfRule, {
          field: "status",
          value: "active",
          scope: "global",
        });
        const result = await rule.validate(undefined, context);
        expectInvalid(result, "required");
      });

      it("should handle number values", async () => {
        const context = createMockContext({ age: 18, license: "" });
        const rule = createContextualRule(requiredIfRule, {
          field: "age",
          value: 18,
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });

      it("should handle boolean values", async () => {
        const context = createMockContext({ isActive: true, comment: "" });
        const rule = createContextualRule(requiredIfRule, {
          field: "isActive",
          value: true,
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });

      it("should handle nested field paths", async () => {
        const context = createMockContext({
          user: {
            type: "premium",
            subscription: "",
          },
        });
        const rule = createContextualRule(requiredIfRule, {
          field: "user.type",
          value: "premium",
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });
    });

    describe("sibling scope", () => {
      it("should fail when value is empty and sibling field equals expected value", async () => {
        const parent = { userType: "admin", role: "" };
        const context = createMockContext(parent);
        context.parent = parent;
        const rule = createContextualRule(requiredIfRule, {
          field: "userType",
          value: "admin",
          scope: "sibling",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });

      it("should pass when value is not empty and sibling field equals expected value", async () => {
        const parent = { userType: "admin", role: "super" };
        const context = createMockContext(parent);
        context.parent = parent;
        const rule = createContextualRule(requiredIfRule, {
          field: "userType",
          value: "admin",
          scope: "sibling",
        });
        const result = await rule.validate("super", context);
        expectValid(result);
      });

      it("should pass when value is empty but sibling field does not equal expected value", async () => {
        const parent = { userType: "user", role: "" };
        const context = createMockContext(parent);
        context.parent = parent;
        const rule = createContextualRule(requiredIfRule, {
          field: "userType",
          value: "admin",
          scope: "sibling",
        });
        const result = await rule.validate("", context);
        expectValid(result);
      });
    });
  });

  describe("requiredIfEmptyRule", () => {
    describe("global scope", () => {
      it("should fail when value is empty and other field is empty", async () => {
        const context = createMockContext({
          primaryEmail: "",
          backupEmail: "",
        });
        const rule = createContextualRule(requiredIfEmptyRule, {
          field: "primaryEmail",
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });

      it("should pass when value is not empty and other field is empty", async () => {
        const context = createMockContext(
          {
            primaryEmail: "",
            backupEmail: "backup@example.com",
          },
          "backup@example.com",
        );
        const rule = createContextualRule(requiredIfEmptyRule, {
          field: "primaryEmail",
          scope: "global",
        });
        const result = await rule.validate("backup@example.com", context);
        expectValid(result);
      });

      it("should pass when value is empty but other field is not empty", async () => {
        const context = createMockContext(
          {
            primaryEmail: "primary@example.com",
            backupEmail: "",
          },
          "",
        );
        const rule = createContextualRule(requiredIfEmptyRule, {
          field: "primaryEmail",
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectValid(result);
      });

      it("should handle null values", async () => {
        const context = createMockContext(
          {
            field1: null,
            field2: "",
          },
          "",
        );
        const rule = createContextualRule(requiredIfEmptyRule, {
          field: "field1",
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });

      it("should handle undefined values", async () => {
        const context = createMockContext(
          {
            field1: undefined,
            field2: "",
          },
          "",
        );
        const rule = createContextualRule(requiredIfEmptyRule, {
          field: "field1",
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });
    });

    describe("sibling scope", () => {
      it("should fail when value is empty and sibling field is empty", async () => {
        const parent = { primaryEmail: "", backupEmail: "" };
        const context = createMockContext(parent, "");
        context.parent = parent;
        const rule = createContextualRule(requiredIfEmptyRule, {
          field: "primaryEmail",
          scope: "sibling",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });

      it("should pass when value is not empty and sibling field is empty", async () => {
        const parent = { primaryEmail: "", backupEmail: "backup@example.com" };
        const context = createMockContext(parent, "backup@example.com");
        context.parent = parent;
        const rule = createContextualRule(requiredIfEmptyRule, {
          field: "primaryEmail",
          scope: "sibling",
        });
        const result = await rule.validate("backup@example.com", context);
        expectValid(result);
      });
    });
  });

  describe("requiredIfNotEmptyRule", () => {
    describe("global scope", () => {
      it("should fail when value is empty and other field is not empty", async () => {
        const context = createMockContext(
          {
            phone: "1234567890",
            email: "",
          },
          "",
        );
        const rule = createContextualRule(requiredIfNotEmptyRule, {
          field: "phone",
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });

      it("should pass when value is not empty and other field is not empty", async () => {
        const context = createMockContext(
          {
            phone: "1234567890",
            email: "user@example.com",
          },
          "user@example.com",
        );
        const rule = createContextualRule(requiredIfNotEmptyRule, {
          field: "phone",
          scope: "global",
        });
        const result = await rule.validate("user@example.com", context);
        expectValid(result);
      });

      it("should pass when value is empty and other field is also empty", async () => {
        const context = createMockContext(
          {
            phone: "",
            email: "",
          },
          "",
        );
        const rule = createContextualRule(requiredIfNotEmptyRule, {
          field: "phone",
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectValid(result);
      });

      it("should handle non-empty string", async () => {
        const context = createMockContext(
          {
            name: "John",
            description: "",
          },
          "",
        );
        const rule = createContextualRule(requiredIfNotEmptyRule, {
          field: "name",
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });

      it("should handle non-empty number", async () => {
        const context = createMockContext(
          {
            age: 25,
            comment: "",
          },
          "",
        );
        const rule = createContextualRule(requiredIfNotEmptyRule, {
          field: "age",
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });
    });

    describe("sibling scope", () => {
      it("should fail when value is empty and sibling field is not empty", async () => {
        const parent = { phone: "1234567890", email: "" };
        const context = createMockContext(parent, "");
        context.parent = parent;
        const rule = createContextualRule(requiredIfNotEmptyRule, {
          field: "phone",
          scope: "sibling",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });
    });
  });

  describe("requiredIfInRule", () => {
    describe("global scope", () => {
      it("should fail when value is empty and other field value is in array", async () => {
        const context = createMockContext(
          {
            userType: "premium",
            features: "",
          },
          "",
        );
        const rule = createContextualRule(requiredIfInRule, {
          field: "userType",
          values: ["premium", "enterprise"],
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });

      it("should pass when value is not empty and other field value is in array", async () => {
        const context = createMockContext(
          {
            userType: "premium",
            features: "feature1,feature2",
          },
          "feature1,feature2",
        );
        const rule = createContextualRule(requiredIfInRule, {
          field: "userType",
          values: ["premium", "enterprise"],
          scope: "global",
        });
        const result = await rule.validate("feature1,feature2", context);
        expectValid(result);
      });

      it("should pass when value is empty but other field value is NOT in array", async () => {
        const context = createMockContext(
          {
            userType: "basic",
            features: "",
          },
          "",
        );
        const rule = createContextualRule(requiredIfInRule, {
          field: "userType",
          values: ["premium", "enterprise"],
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectValid(result);
      });

      it("should handle number values in array", async () => {
        const context = createMockContext(
          {
            level: 5,
            bonus: "",
          },
          "",
        );
        const rule = createContextualRule(requiredIfInRule, {
          field: "level",
          values: [5, 10, 15],
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });

      it("should handle boolean values in array", async () => {
        const context = createMockContext(
          {
            isActive: true,
            reason: "",
          },
          "",
        );
        const rule = createContextualRule(requiredIfInRule, {
          field: "isActive",
          values: [true, false],
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });

      it("should handle empty array (never matches)", async () => {
        const context = createMockContext(
          {
            userType: "premium",
            features: "",
          },
          "",
        );
        const rule = createContextualRule(requiredIfInRule, {
          field: "userType",
          values: [],
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectValid(result);
      });
    });

    describe("sibling scope", () => {
      it("should fail when value is empty and sibling field value is in array", async () => {
        const parent = { userType: "premium", features: "" };
        const context = createMockContext(parent, "");
        context.parent = parent;
        const rule = createContextualRule(requiredIfInRule, {
          field: "userType",
          values: ["premium", "enterprise"],
          scope: "sibling",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });
    });
  });

  describe("requiredIfNotInRule", () => {
    describe("global scope", () => {
      it("should fail when value is empty and other field value is NOT in array", async () => {
        const context = createMockContext(
          {
            userType: "basic",
            features: "",
          },
          "",
        );
        const rule = createContextualRule(requiredIfNotInRule, {
          field: "userType",
          values: ["premium", "enterprise"],
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });

      it("should pass when value is not empty and other field value is NOT in array", async () => {
        const context = createMockContext(
          {
            userType: "basic",
            features: "feature1",
          },
          "feature1",
        );
        const rule = createContextualRule(requiredIfNotInRule, {
          field: "userType",
          values: ["premium", "enterprise"],
          scope: "global",
        });
        const result = await rule.validate("feature1", context);
        expectValid(result);
      });

      it("should pass when value is empty but other field value IS in array", async () => {
        const context = createMockContext(
          {
            userType: "premium",
            features: "",
          },
          "",
        );
        const rule = createContextualRule(requiredIfNotInRule, {
          field: "userType",
          values: ["premium", "enterprise"],
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectValid(result);
      });

      it("should handle empty array (always matches, so always required when empty)", async () => {
        const context = createMockContext(
          {
            userType: "premium",
            features: "",
          },
          "",
        );
        const rule = createContextualRule(requiredIfNotInRule, {
          field: "userType",
          values: [],
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });
    });

    describe("sibling scope", () => {
      it("should fail when value is empty and sibling field value is NOT in array", async () => {
        const parent = { userType: "basic", features: "" };
        const context = createMockContext(parent, "");
        context.parent = parent;
        const rule = createContextualRule(requiredIfNotInRule, {
          field: "userType",
          values: ["premium", "enterprise"],
          scope: "sibling",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });
    });
  });
});
