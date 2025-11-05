import { describe, it } from "vitest";
import { requiredUnlessRule } from "../../../src/rules/conditional/required-unless-rules";
import {
  createContextualRule,
  createMockContext,
  expectInvalid,
  expectValid,
} from "../../setup/test-helpers";

describe("Required Unless Rules", () => {
  describe("requiredUnlessRule", () => {
    describe("global scope", () => {
      it("should fail when value is empty and other field does NOT equal expected value", async () => {
        const context = createMockContext(
          {
            userType: "user",
            role: "",
          },
          "",
        );
        const rule = createContextualRule(requiredUnlessRule, {
          field: "userType",
          value: "guest",
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });

      it("should pass when value is not empty and other field does NOT equal expected value", async () => {
        const context = createMockContext(
          {
            userType: "user",
            role: "member",
          },
          "member",
        );
        const rule = createContextualRule(requiredUnlessRule, {
          field: "userType",
          value: "guest",
          scope: "global",
        });
        const result = await rule.validate("member", context);
        expectValid(result);
      });

      it("should pass when value is empty but other field EQUALS expected value (exception)", async () => {
        const context = createMockContext(
          {
            userType: "guest",
            role: "",
          },
          "",
        );
        const rule = createContextualRule(requiredUnlessRule, {
          field: "userType",
          value: "guest",
          scope: "global",
        });
        // When userType is "guest", role is NOT required
        const result = await rule.validate("", context);
        expectValid(result);
      });

      it("should pass when value is not empty and other field equals expected value", async () => {
        const context = createMockContext(
          {
            userType: "guest",
            role: "optional",
          },
          "optional",
        );
        const rule = createContextualRule(requiredUnlessRule, {
          field: "userType",
          value: "guest",
          scope: "global",
        });
        const result = await rule.validate("optional", context);
        expectValid(result);
      });

      it("should handle null values", async () => {
        const context = createMockContext(
          {
            status: "inactive",
            notes: null,
          },
          null,
        );
        const rule = createContextualRule(requiredUnlessRule, {
          field: "status",
          value: "active",
          scope: "global",
        });
        // status is "inactive", not "active", so notes is required
        const result = await rule.validate(null, context);
        expectInvalid(result, "required");
      });

      it("should handle undefined values", async () => {
        const context = createMockContext(
          {
            status: "pending",
            notes: undefined,
          },
          undefined,
        );
        const rule = createContextualRule(requiredUnlessRule, {
          field: "status",
          value: "active",
          scope: "global",
        });
        const result = await rule.validate(undefined, context);
        expectInvalid(result, "required");
      });

      it("should handle number values", async () => {
        const context = createMockContext({ age: 20, license: "" }, "");
        const rule = createContextualRule(requiredUnlessRule, {
          field: "age",
          value: 18,
          scope: "global",
        });
        // age is 20, not 18, so license is required
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });

      it("should handle boolean values", async () => {
        const context = createMockContext({ isActive: false, comment: "" }, "");
        const rule = createContextualRule(requiredUnlessRule, {
          field: "isActive",
          value: true,
          scope: "global",
        });
        // isActive is false, not true, so comment is required
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });

      it("should handle nested field paths", async () => {
        const context = createMockContext(
          {
            user: {
              type: "basic",
              subscription: "",
            },
          },
          "",
        );
        const rule = createContextualRule(requiredUnlessRule, {
          field: "user.type",
          value: "premium",
          scope: "global",
        });
        // user.type is "basic", not "premium", so subscription is required
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });

      it("should pass when condition matches (field equals value)", async () => {
        const context = createMockContext(
          {
            user: {
              type: "premium",
              subscription: "",
            },
          },
          "",
        );
        const rule = createContextualRule(requiredUnlessRule, {
          field: "user.type",
          value: "premium",
          scope: "global",
        });
        // user.type is "premium", so subscription is NOT required
        const result = await rule.validate("", context);
        expectValid(result);
      });
    });

    describe("sibling scope", () => {
      it("should fail when value is empty and sibling field does NOT equal expected value", async () => {
        const parent = { userType: "user", role: "" };
        const context = createMockContext(parent, "");
        context.parent = parent;
        const rule = createContextualRule(requiredUnlessRule, {
          field: "userType",
          value: "guest",
          scope: "sibling",
        });
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });

      it("should pass when value is empty but sibling field EQUALS expected value", async () => {
        const parent = { userType: "guest", role: "" };
        const context = createMockContext(parent, "");
        context.parent = parent;
        const rule = createContextualRule(requiredUnlessRule, {
          field: "userType",
          value: "guest",
          scope: "sibling",
        });
        const result = await rule.validate("", context);
        expectValid(result);
      });

      it("should pass when value is not empty regardless of condition", async () => {
        const parent = { userType: "user", role: "member" };
        const context = createMockContext(parent, "member");
        context.parent = parent;
        const rule = createContextualRule(requiredUnlessRule, {
          field: "userType",
          value: "guest",
          scope: "sibling",
        });
        const result = await rule.validate("member", context);
        expectValid(result);
      });
    });

    describe("edge cases", () => {
      it("should handle zero values", async () => {
        const context = createMockContext({ count: 0, message: "" }, "");
        const rule = createContextualRule(requiredUnlessRule, {
          field: "count",
          value: 0,
          scope: "global",
        });
        // count is 0, which equals the expected value, so message is NOT required
        const result = await rule.validate("", context);
        expectValid(result);
      });

      it("should handle empty string values", async () => {
        const context = createMockContext({ status: "", reason: "" }, "");
        const rule = createContextualRule(requiredUnlessRule, {
          field: "status",
          value: "",
          scope: "global",
        });
        // status is empty string, which equals the expected value, so reason is NOT required
        const result = await rule.validate("", context);
        expectValid(result);
      });

      it("should handle different types (string vs number)", async () => {
        const context = createMockContext({ id: "123", comment: "" }, "");
        const rule = createContextualRule(requiredUnlessRule, {
          field: "id",
          value: 123, // number
          scope: "global",
        });
        // "123" !== 123 (strict equality), so comment is required
        const result = await rule.validate("", context);
        expectInvalid(result, "required");
      });
    });
  });
});
