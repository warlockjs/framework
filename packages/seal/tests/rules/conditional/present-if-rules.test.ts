import { describe, it } from "vitest";
import {
  presentIfEmptyRule,
  presentIfInRule,
  presentIfNotEmptyRule,
  presentIfNotInRule,
  presentIfRule,
} from "../../../src/rules/conditional/present-if-rules";
import {
  createContextualRule,
  createMockContext,
  expectInvalid,
  expectValid,
} from "../../setup/test-helpers";

describe("Present If Rules", () => {
  describe("presentIfRule", () => {
    describe("global scope", () => {
      it("should fail when value is undefined and other field equals expected value", async () => {
        const context = createMockContext(
          {
            userType: "admin",
            role: undefined,
          },
          undefined,
        );
        const rule = createContextualRule(presentIfRule, {
          field: "userType",
          value: "admin",
          scope: "global",
        });
        const result = await rule.validate(undefined, context);
        expectInvalid(result);
      });

      it("should pass when value is null and condition is met (null is considered present)", async () => {
        const context = createMockContext(
          {
            userType: "admin",
            role: null,
          },
          null,
        );
        const rule = createContextualRule(presentIfRule, {
          field: "userType",
          value: "admin",
          scope: "global",
        });
        // null is not undefined, so field is present
        const result = await rule.validate(null, context);
        expectValid(result);
      });

      it("should pass when value is empty string and condition is met (empty string is considered present)", async () => {
        const context = createMockContext(
          {
            userType: "admin",
            role: "",
          },
          "",
        );
        const rule = createContextualRule(presentIfRule, {
          field: "userType",
          value: "admin",
          scope: "global",
        });
        // empty string is not undefined, so field is present
        const result = await rule.validate("", context);
        expectValid(result);
      });

      it("should pass when value is defined and condition is met", async () => {
        const context = createMockContext(
          {
            userType: "admin",
            role: "super",
          },
          "super",
        );
        const rule = createContextualRule(presentIfRule, {
          field: "userType",
          value: "admin",
          scope: "global",
        });
        const result = await rule.validate("super", context);
        expectValid(result);
      });

      it("should pass when value is undefined but condition is NOT met", async () => {
        const context = createMockContext(
          {
            userType: "user",
            role: undefined,
          },
          undefined,
        );
        const rule = createContextualRule(presentIfRule, {
          field: "userType",
          value: "admin",
          scope: "global",
        });
        // Condition not met, so field doesn't need to be present
        const result = await rule.validate(undefined, context);
        expectValid(result);
      });

      it("should handle number values", async () => {
        const context = createMockContext(
          {
            age: 18,
            license: undefined,
          },
          undefined,
        );
        const rule = createContextualRule(presentIfRule, {
          field: "age",
          value: 18,
          scope: "global",
        });
        const result = await rule.validate(undefined, context);
        expectInvalid(result);
      });

      it("should handle boolean values", async () => {
        const context = createMockContext(
          {
            isActive: true,
            comment: undefined,
          },
          undefined,
        );
        const rule = createContextualRule(presentIfRule, {
          field: "isActive",
          value: true,
          scope: "global",
        });
        const result = await rule.validate(undefined, context);
        expectInvalid(result);
      });

      it("should handle nested field paths", async () => {
        const context = createMockContext(
          {
            user: {
              type: "premium",
              subscription: undefined,
            },
          },
          undefined,
        );
        const rule = createContextualRule(presentIfRule, {
          field: "user.type",
          value: "premium",
          scope: "global",
        });
        const result = await rule.validate(undefined, context);
        expectInvalid(result);
      });
    });

    describe("sibling scope", () => {
      it("should fail when value is undefined and sibling field equals expected value", async () => {
        const parent = { userType: "admin", role: undefined };
        const context = createMockContext(parent, undefined);
        context.parent = parent;
        const rule = createContextualRule(presentIfRule, {
          field: "userType",
          value: "admin",
          scope: "sibling",
        });
        const result = await rule.validate(undefined, context);
        expectInvalid(result);
      });

      it("should pass when value is null and sibling condition is met", async () => {
        const parent = { userType: "admin", role: null };
        const context = createMockContext(parent, null);
        context.parent = parent;
        const rule = createContextualRule(presentIfRule, {
          field: "userType",
          value: "admin",
          scope: "sibling",
        });
        const result = await rule.validate(null, context);
        expectValid(result);
      });

      it("should pass when value is undefined but sibling condition is NOT met", async () => {
        const parent = { userType: "user", role: undefined };
        const context = createMockContext(parent, undefined);
        context.parent = parent;
        const rule = createContextualRule(presentIfRule, {
          field: "userType",
          value: "admin",
          scope: "sibling",
        });
        const result = await rule.validate(undefined, context);
        expectValid(result);
      });
    });
  });

  describe("presentIfEmptyRule", () => {
    describe("global scope", () => {
      it("should fail when value is undefined and other field is empty", async () => {
        const context = createMockContext(
          {
            primaryEmail: "",
            backupEmail: undefined,
          },
          undefined,
        );
        const rule = createContextualRule(presentIfEmptyRule, {
          field: "primaryEmail",
          scope: "global",
        });
        const result = await rule.validate(undefined, context);
        expectInvalid(result);
      });

      it("should pass when value is null and other field is empty (null is present)", async () => {
        const context = createMockContext(
          {
            primaryEmail: "",
            backupEmail: null,
          },
          null,
        );
        const rule = createContextualRule(presentIfEmptyRule, {
          field: "primaryEmail",
          scope: "global",
        });
        const result = await rule.validate(null, context);
        expectValid(result);
      });

      it("should pass when value is defined and other field is empty", async () => {
        const context = createMockContext(
          {
            primaryEmail: "",
            backupEmail: "backup@example.com",
          },
          "backup@example.com",
        );
        const rule = createContextualRule(presentIfEmptyRule, {
          field: "primaryEmail",
          scope: "global",
        });
        const result = await rule.validate("backup@example.com", context);
        expectValid(result);
      });

      it("should pass when value is undefined but other field is NOT empty", async () => {
        const context = createMockContext(
          {
            primaryEmail: "primary@example.com",
            backupEmail: undefined,
          },
          undefined,
        );
        const rule = createContextualRule(presentIfEmptyRule, {
          field: "primaryEmail",
          scope: "global",
        });
        const result = await rule.validate(undefined, context);
        expectValid(result);
      });

      it("should handle null values in other field", async () => {
        const context = createMockContext(
          {
            field1: null,
            field2: undefined,
          },
          undefined,
        );
        const rule = createContextualRule(presentIfEmptyRule, {
          field: "field1",
          scope: "global",
        });
        const result = await rule.validate(undefined, context);
        expectInvalid(result);
      });
    });

    describe("sibling scope", () => {
      it("should fail when value is undefined and sibling field is empty", async () => {
        const parent = { primaryEmail: "", backupEmail: undefined };
        const context = createMockContext(parent, undefined);
        context.parent = parent;
        const rule = createContextualRule(presentIfEmptyRule, {
          field: "primaryEmail",
          scope: "sibling",
        });
        const result = await rule.validate(undefined, context);
        expectInvalid(result);
      });
    });
  });

  describe("presentIfNotEmptyRule", () => {
    describe("global scope", () => {
      it("should fail when value is undefined and other field is not empty", async () => {
        const context = createMockContext({
          phone: "1234567890",
          email: undefined,
        });
        const rule = createContextualRule(presentIfNotEmptyRule, {
          field: "phone",
          scope: "global",
        });
        const result = await rule.validate(undefined, context);
        expectInvalid(result);
      });

      it("should pass when value is null and other field is not empty (null is present)", async () => {
        const context = createMockContext({
          phone: "1234567890",
          email: null,
        });
        const rule = createContextualRule(presentIfNotEmptyRule, {
          field: "phone",
          scope: "global",
        });
        const result = await rule.validate(null, context);
        expectValid(result);
      });

      it("should pass when value is defined and other field is not empty", async () => {
        const context = createMockContext({
          value: "user@example.com",
          phone: "1234567890",
          email: "user@example.com",
        });
        const rule = createContextualRule(presentIfNotEmptyRule, {
          field: "phone",
          scope: "global",
        });
        const result = await rule.validate("user@example.com", context);
        expectValid(result);
      });

      it("should pass when value is undefined and other field is also empty", async () => {
        const context = createMockContext({
          phone: "",
          email: undefined,
        });
        const rule = createContextualRule(presentIfNotEmptyRule, {
          field: "phone",
          scope: "global",
        });
        const result = await rule.validate(undefined, context);
        expectValid(result);
      });
    });

    describe("sibling scope", () => {
      it("should fail when value is undefined and sibling field is not empty", async () => {
        const parent = { phone: "1234567890", email: undefined };
        const context = createMockContext(parent, undefined);
        context.parent = parent;
        const rule = createContextualRule(presentIfNotEmptyRule, {
          field: "phone",
          scope: "sibling",
        });
        const result = await rule.validate(undefined, context);
        expectInvalid(result);
      });
    });
  });

  describe("presentIfInRule", () => {
    describe("global scope", () => {
      it("should fail when value is undefined and other field value is in array", async () => {
        const context = createMockContext({
          userType: "premium",
          features: undefined,
        });
        const rule = createContextualRule(presentIfInRule, {
          field: "userType",
          values: ["premium", "enterprise"],
          scope: "global",
        });
        const result = await rule.validate(undefined, context);
        expectInvalid(result);
      });

      it("should pass when value is null and condition is met (null is present)", async () => {
        const context = createMockContext({
          userType: "premium",
          features: null,
        });
        const rule = createContextualRule(presentIfInRule, {
          field: "userType",
          values: ["premium", "enterprise"],
          scope: "global",
        });
        const result = await rule.validate(null, context);
        expectValid(result);
      });

      it("should pass when value is defined and condition is met", async () => {
        const context = createMockContext({
          value: "feature1,feature2",
          userType: "premium",
          features: "feature1,feature2",
        });
        const rule = createContextualRule(presentIfInRule, {
          field: "userType",
          values: ["premium", "enterprise"],
          scope: "global",
        });
        const result = await rule.validate("feature1,feature2", context);
        expectValid(result);
      });

      it("should pass when value is undefined but condition is NOT met", async () => {
        const context = createMockContext({
          userType: "basic",
          features: undefined,
        });
        const rule = createContextualRule(presentIfInRule, {
          field: "userType",
          values: ["premium", "enterprise"],
          scope: "global",
        });
        const result = await rule.validate(undefined, context);
        expectValid(result);
      });
    });

    describe("sibling scope", () => {
      it("should fail when value is undefined and sibling field value is in array", async () => {
        const parent = { userType: "premium", features: undefined };
        const context = createMockContext(parent, undefined);
        context.parent = parent;
        const rule = createContextualRule(presentIfInRule, {
          field: "userType",
          values: ["premium", "enterprise"],
          scope: "sibling",
        });
        const result = await rule.validate(undefined, context);
        expectInvalid(result);
      });
    });
  });

  describe("presentIfNotInRule", () => {
    describe("global scope", () => {
      it("should fail when value is undefined and other field value is NOT in array", async () => {
        const context = createMockContext({
          userType: "basic",
          features: undefined,
        });
        const rule = createContextualRule(presentIfNotInRule, {
          field: "userType",
          values: ["premium", "enterprise"],
          scope: "global",
        });
        const result = await rule.validate(undefined, context);
        expectInvalid(result);
      });

      it("should pass when value is null and condition is met (null is present)", async () => {
        const context = createMockContext({
          userType: "basic",
          features: null,
        });
        const rule = createContextualRule(presentIfNotInRule, {
          field: "userType",
          values: ["premium", "enterprise"],
          scope: "global",
        });
        const result = await rule.validate(null, context);
        expectValid(result);
      });

      it("should pass when value is defined and condition is met", async () => {
        const context = createMockContext({
          value: "feature1",
          userType: "basic",
          features: "feature1",
        });
        const rule = createContextualRule(presentIfNotInRule, {
          field: "userType",
          values: ["premium", "enterprise"],
          scope: "global",
        });
        const result = await rule.validate("feature1", context);
        expectValid(result);
      });

      it("should pass when value is undefined but condition is NOT met (value IS in array)", async () => {
        const context = createMockContext({
          userType: "premium",
          features: undefined,
        });
        const rule = createContextualRule(presentIfNotInRule, {
          field: "userType",
          values: ["premium", "enterprise"],
          scope: "global",
        });
        const result = await rule.validate(undefined, context);
        expectValid(result);
      });
    });

    describe("sibling scope", () => {
      it("should fail when value is undefined and sibling field value is NOT in array", async () => {
        const parent = { userType: "basic", features: undefined };
        const context = createMockContext(parent, undefined);
        context.parent = parent;
        const rule = createContextualRule(presentIfNotInRule, {
          field: "userType",
          values: ["premium", "enterprise"],
          scope: "sibling",
        });
        const result = await rule.validate(undefined, context);
        expectInvalid(result);
      });
    });
  });
});
