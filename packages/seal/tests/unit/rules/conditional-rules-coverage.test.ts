import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

/**
 * Coverage for the conditional fluent methods the base conditional-rules suite
 * skips: the array/in variants, the any/all empty variants, the requiredWhen
 * callback, the forbidden family driven via the public chain, the presentIfIn
 * family, and a representative slice of the *Sibling scope variants.
 *
 * Every assertion is checked against the rule source (required-if-rules.ts,
 * forbidden-if-rules.ts, present-if-rules.ts, required-when-rule.ts).
 */

describe("Conditional Rules - extended coverage", () => {
  describe("required: value-in-array variants", () => {
    it("requiredIfIn requires when the other field is in the set", async () => {
      const validator = v.object({
        plan: v.string(),
        seats: v.number().requiredIfIn("plan", ["team", "enterprise"]),
      });

      expect((await validate(validator, { plan: "solo" })).isValid).toBe(true);
      expect((await validate(validator, { plan: "team", seats: 5 })).isValid).toBe(true);
      expect((await validate(validator, { plan: "team" })).isValid).toBe(false);
    });

    it("requiredIfNotIn requires when the other field is NOT in the set", async () => {
      const validator = v.object({
        country: v.string(),
        vatId: v.string().requiredIfNotIn("country", ["US", "CA"]),
      });

      expect((await validate(validator, { country: "US" })).isValid).toBe(true);
      expect((await validate(validator, { country: "DE", vatId: "DE123" })).isValid).toBe(true);
      expect((await validate(validator, { country: "DE" })).isValid).toBe(false);
    });

    it("requiredIfInSibling resolves within the parent object", async () => {
      const validator = v.object({
        group: v.object({
          tier: v.string(),
          code: v.string().requiredIfInSibling("tier", ["gold", "platinum"]),
        }),
      });

      expect((await validate(validator, { group: { tier: "silver" } })).isValid).toBe(true);
      expect((await validate(validator, { group: { tier: "gold", code: "X" } })).isValid).toBe(
        true,
      );
      expect((await validate(validator, { group: { tier: "gold" } })).isValid).toBe(false);
    });
  });

  describe("required: any/all empty variants", () => {
    it("requiredIfAnyEmpty requires when at least one field is empty", async () => {
      const validator = v.object({
        a: v.string().optional(),
        b: v.string().optional(),
        fallback: v.string().requiredIfAnyEmpty(["a", "b"]),
      });

      expect((await validate(validator, { a: "A", b: "B", fallback: "F" })).isValid).toBe(true);
      // a present, b empty → fallback required
      expect((await validate(validator, { a: "A" })).isValid).toBe(false);
      expect((await validate(validator, { a: "A", fallback: "F" })).isValid).toBe(true);
    });

    it("requiredIfAllNotEmpty requires only when every field has a value", async () => {
      const validator = v.object({
        first: v.string().optional(),
        last: v.string().optional(),
        fullName: v.string().requiredIfAllNotEmpty(["first", "last"]),
      });

      expect((await validate(validator, { first: "A" })).isValid).toBe(true);
      expect((await validate(validator, { first: "A", last: "B" })).isValid).toBe(false);
      expect((await validate(validator, { first: "A", last: "B", fullName: "A B" })).isValid).toBe(
        true,
      );
    });

    it("requiredIfAnyNotEmpty requires when at least one field has a value", async () => {
      const validator = v.object({
        phone: v.string().optional(),
        email: v.string().optional(),
        contactName: v.string().requiredIfAnyNotEmpty(["phone", "email"]),
      });

      expect((await validate(validator, {})).isValid).toBe(true);
      expect((await validate(validator, { phone: "123" })).isValid).toBe(false);
      expect((await validate(validator, { phone: "123", contactName: "Bob" })).isValid).toBe(true);
    });

    it("requiredIfAllEmptySiblings honors sibling scope", async () => {
      const validator = v.object({
        contact: v.object({
          phone: v.string().optional(),
          email: v.string().optional(),
          mustReach: v.string().requiredIfAllEmptySiblings(["phone", "email"]),
        }),
      });

      // both empty → mustReach required
      expect((await validate(validator, { contact: {} })).isValid).toBe(false);
      expect((await validate(validator, { contact: { mustReach: "x" } })).isValid).toBe(true);
      // one present → not required
      expect((await validate(validator, { contact: { phone: "1" } })).isValid).toBe(true);
    });
  });

  describe("requiredWhen (callback)", () => {
    it("requires the field when the callback returns true", async () => {
      const validator = v.object({
        notify: v.string(),
        email: v.string().requiredWhen((context) => context.allValues.notify === "email"),
      });

      expect((await validate(validator, { notify: "sms" })).isValid).toBe(true);
      expect((await validate(validator, { notify: "email", email: "a@b.com" })).isValid).toBe(true);
      expect((await validate(validator, { notify: "email" })).isValid).toBe(false);
    });

    it("supports an async callback", async () => {
      const validator = v.object({
        flag: v.boolean(),
        reason: v.string().requiredWhen(async (context) => {
          await Promise.resolve();
          return context.allValues.flag === true;
        }),
      });

      expect((await validate(validator, { flag: false })).isValid).toBe(true);
      expect((await validate(validator, { flag: true })).isValid).toBe(false);
      expect((await validate(validator, { flag: true, reason: "ok" })).isValid).toBe(true);
    });
  });

  describe("forbidden family (fluent)", () => {
    it("forbidden rejects any present value", async () => {
      const validator = v.object({
        legacy: v.string().forbidden().optional(),
      });

      expect((await validate(validator, {})).isValid).toBe(true);
      expect((await validate(validator, { legacy: "x" })).isValid).toBe(false);
    });

    it("forbiddenIf forbids when another field equals a value", async () => {
      const validator = v.object({
        authType: v.string(),
        password: v.string().forbiddenIf("authType", "oauth").optional(),
      });

      expect((await validate(validator, { authType: "local", password: "p" })).isValid).toBe(true);
      expect((await validate(validator, { authType: "oauth" })).isValid).toBe(true);
      expect((await validate(validator, { authType: "oauth", password: "p" })).isValid).toBe(false);
    });

    it("forbiddenIfNot forbids when another field does NOT equal a value", async () => {
      const validator = v.object({
        mode: v.string(),
        advanced: v.string().forbiddenIfNot("mode", "expert").optional(),
      });

      expect((await validate(validator, { mode: "expert", advanced: "y" })).isValid).toBe(true);
      expect((await validate(validator, { mode: "basic" })).isValid).toBe(true);
      expect((await validate(validator, { mode: "basic", advanced: "y" })).isValid).toBe(false);
    });

    it("forbiddenIfIn / forbiddenIfNotIn react to array membership", async () => {
      const inSet = v.object({
        role: v.string(),
        secret: v.string().forbiddenIfIn("role", ["guest", "anon"]).optional(),
      });
      expect((await validate(inSet, { role: "admin", secret: "s" })).isValid).toBe(true);
      expect((await validate(inSet, { role: "guest", secret: "s" })).isValid).toBe(false);

      const notInSet = v.object({
        role: v.string(),
        token: v.string().forbiddenIfNotIn("role", ["admin", "owner"]).optional(),
      });
      expect((await validate(notInSet, { role: "admin", token: "t" })).isValid).toBe(true);
      expect((await validate(notInSet, { role: "guest", token: "t" })).isValid).toBe(false);
    });

    it("forbiddenIfSibling honors sibling scope", async () => {
      const validator = v.object({
        block: v.object({
          type: v.string(),
          extra: v.string().forbiddenIfSibling("type", "minimal").optional(),
        }),
      });

      expect((await validate(validator, { block: { type: "full", extra: "e" } })).isValid).toBe(
        true,
      );
      expect((await validate(validator, { block: { type: "minimal", extra: "e" } })).isValid).toBe(
        false,
      );
    });
  });

  describe("presentIf family (key must exist)", () => {
    it("presentIfIn requires the key when the other field is in the set", async () => {
      const validator = v.object({
        kind: v.string(),
        details: v.string().presentIfIn("kind", ["a", "b"]).optional(),
      });

      // present means the KEY must exist (value may be empty string)
      expect((await validate(validator, { kind: "c" })).isValid).toBe(true);
      expect((await validate(validator, { kind: "a", details: "" })).isValid).toBe(true);
      expect((await validate(validator, { kind: "a" })).isValid).toBe(false);
    });

    it("presentIfNotIn requires the key when the other field is NOT in the set", async () => {
      const validator = v.object({
        kind: v.string(),
        note: v.string().presentIfNotIn("kind", ["x", "y"]).optional(),
      });

      expect((await validate(validator, { kind: "x" })).isValid).toBe(true);
      expect((await validate(validator, { kind: "z", note: "" })).isValid).toBe(true);
      expect((await validate(validator, { kind: "z" })).isValid).toBe(false);
    });

    it("presentIfSibling honors sibling scope", async () => {
      const validator = v.object({
        wrap: v.object({
          trigger: v.string(),
          dependent: v.string().presentIfSibling("trigger", "on").optional(),
        }),
      });

      expect((await validate(validator, { wrap: { trigger: "off" } })).isValid).toBe(true);
      expect((await validate(validator, { wrap: { trigger: "on", dependent: "" } })).isValid).toBe(
        true,
      );
      expect((await validate(validator, { wrap: { trigger: "on" } })).isValid).toBe(false);
    });
  });

  describe("required: empty/not-empty sibling variants", () => {
    it("requiredIfEmptySibling / requiredIfNotEmptySibling", async () => {
      const ifEmpty = v.object({
        g: v.object({
          primary: v.string().optional(),
          backup: v.string().requiredIfEmptySibling("primary"),
        }),
      });
      expect((await validate(ifEmpty, { g: { primary: "p" } })).isValid).toBe(true);
      expect((await validate(ifEmpty, { g: { backup: "b" } })).isValid).toBe(true);
      expect((await validate(ifEmpty, { g: {} })).isValid).toBe(false);

      const ifNotEmpty = v.object({
        g: v.object({
          phone: v.string().optional(),
          country: v.string().requiredIfNotEmptySibling("phone"),
        }),
      });
      expect((await validate(ifNotEmpty, { g: {} })).isValid).toBe(true);
      expect((await validate(ifNotEmpty, { g: { phone: "1", country: "US" } })).isValid).toBe(true);
      expect((await validate(ifNotEmpty, { g: { phone: "1" } })).isValid).toBe(false);
    });
  });
});
