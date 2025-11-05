import { describe, it } from "vitest";
import { presentUnlessRule } from "../../../src/rules/conditional/present-unless-rules";
import {
  createContextualRule,
  createMockContext,
  expectInvalid,
  expectValid,
} from "../../setup/test-helpers";

describe("Present Unless Rules", () => {
  describe("presentUnlessRule", () => {
    describe("global scope", () => {
      it("should fail when value is undefined and other field does NOT equal expected value", async () => {
        const context = createMockContext(
          {
            userType: "user",
            role: undefined,
          },
          undefined,
        );
        const rule = createContextualRule(presentUnlessRule, {
          field: "userType",
          value: "guest",
          scope: "global",
        });
        const result = await rule.validate(undefined, context);
        expectInvalid(result);
      });

      it("should pass when value is null and condition is NOT met (null is present)", async () => {
        const context = createMockContext(
          {
            userType: "user",
            role: null,
          },
          null,
        );
        const rule = createContextualRule(presentUnlessRule, {
          field: "userType",
          value: "guest",
          scope: "global",
        });
        const result = await rule.validate(null, context);
        expectValid(result);
      });

      it("should pass when value is empty string and condition is NOT met (empty string is present)", async () => {
        const context = createMockContext(
          {
            userType: "user",
            role: "",
          },
          "",
        );
        const rule = createContextualRule(presentUnlessRule, {
          field: "userType",
          value: "guest",
          scope: "global",
        });
        const result = await rule.validate("", context);
        expectValid(result);
      });

      it("should pass when value is undefined but other field EQUALS expected value (exception)", async () => {
        const context = createMockContext(
          {
            userType: "guest",
            role: undefined,
          },
          undefined,
        );
        const rule = createContextualRule(presentUnlessRule, {
          field: "userType",
          value: "guest",
          scope: "global",
        });
        // When userType is "guest", role is NOT required to be present
        const result = await rule.validate(undefined, context);
        expectValid(result);
      });

      it("should pass when value is defined regardless of condition", async () => {
        const context = createMockContext(
          {
            userType: "user",
            role: "optional",
          },
          "optional",
        );
        const rule = createContextualRule(presentUnlessRule, {
          field: "userType",
          value: "guest",
          scope: "global",
        });
        const result = await rule.validate("optional", context);
        expectValid(result);
      });

      it("should handle number values", async () => {
        const context = createMockContext(
          {
            age: 20,
            license: undefined,
          },
          undefined,
        );
        const rule = createContextualRule(presentUnlessRule, {
          field: "age",
          value: 18,
          scope: "global",
        });
        // age is 20, not 18, so license must be present
        const result = await rule.validate(undefined, context);
        expectInvalid(result);
      });

      it("should handle boolean values", async () => {
        const context = createMockContext(
          {
            isActive: false,
            comment: undefined,
          },
          undefined,
        );
        const rule = createContextualRule(presentUnlessRule, {
          field: "isActive",
          value: true,
          scope: "global",
        });
        // isActive is false, not true, so comment must be present
        const result = await rule.validate(undefined, context);
        expectInvalid(result);
      });

      it("should handle nested field paths", async () => {
        const context = createMockContext(
          {
            user: {
              type: "basic",
              subscription: undefined,
            },
          },
          undefined,
        );
        const rule = createContextualRule(presentUnlessRule, {
          field: "user.type",
          value: "premium",
          scope: "global",
        });
        // user.type is "basic", not "premium", so subscription must be present
        const result = await rule.validate(undefined, context);
        expectInvalid(result);
      });

      it("should pass when condition matches (field equals value)", async () => {
        const context = createMockContext(
          {
            user: {
              type: "premium",
              subscription: undefined,
            },
          },
          undefined,
        );
        const rule = createContextualRule(presentUnlessRule, {
          field: "user.type",
          value: "premium",
          scope: "global",
        });
        // user.type is "premium", so subscription is NOT required to be present
        const result = await rule.validate(undefined, context);
        expectValid(result);
      });
    });

    describe("sibling scope", () => {
      it("should fail when value is undefined and sibling field does NOT equal expected value", async () => {
        const parent = { userType: "user", role: undefined };
        const context = createMockContext(parent, undefined);
        context.parent = parent;
        const rule = createContextualRule(presentUnlessRule, {
          field: "userType",
          value: "guest",
          scope: "sibling",
        });
        const result = await rule.validate(undefined, context);
        expectInvalid(result);
      });

      it("should pass when value is undefined but sibling field EQUALS expected value", async () => {
        const parent = { userType: "guest", role: undefined };
        const context = createMockContext(parent, undefined);
        context.parent = parent;
        const rule = createContextualRule(presentUnlessRule, {
          field: "userType",
          value: "guest",
          scope: "sibling",
        });
        const result = await rule.validate(undefined, context);
        expectValid(result);
      });

      it("should pass when value is null regardless of condition", async () => {
        const parent = { userType: "user", role: null };
        const context = createMockContext(parent, null);
        context.parent = parent;
        const rule = createContextualRule(presentUnlessRule, {
          field: "userType",
          value: "guest",
          scope: "sibling",
        });
        const result = await rule.validate(null, context);
        expectValid(result);
      });
    });

    describe("edge cases", () => {
      it("should handle zero values", async () => {
        const context = createMockContext(
          {
            count: 0,
            message: undefined,
          },
          undefined,
        );
        const rule = createContextualRule(presentUnlessRule, {
          field: "count",
          value: 0,
          scope: "global",
        });
        // count is 0, which equals the expected value, so message is NOT required to be present
        const result = await rule.validate(undefined, context);
        expectValid(result);
      });

      it("should handle empty string values", async () => {
        const context = createMockContext(
          {
            status: "",
            reason: undefined,
          },
          undefined,
        );
        const rule = createContextualRule(presentUnlessRule, {
          field: "status",
          value: "",
          scope: "global",
        });
        // status is empty string, which equals the expected value, so reason is NOT required to be present
        const result = await rule.validate(undefined, context);
        expectValid(result);
      });

      it("should handle different types (string vs number)", async () => {
        const context = createMockContext(
          {
            id: "123",
            comment: undefined,
          },
          undefined,
        );
        const rule = createContextualRule(presentUnlessRule, {
          field: "id",
          value: 123, // number
          scope: "global",
        });
        // "123" !== 123 (strict equality), so comment must be present
        const result = await rule.validate(undefined, context);
        expectInvalid(result);
      });
    });
  });
});
