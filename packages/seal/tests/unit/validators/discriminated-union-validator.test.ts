import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

const email = () => v.object({ type: v.literal("email"), email: v.string().email() });
const sms = () => v.object({ type: v.literal("sms"), phone: v.string() });
const push = () => v.object({ type: v.literal("push"), deviceId: v.string() });

describe("DiscriminatedUnionValidator", () => {
  describe("routing", () => {
    it("routes to the matching branch and validates it", async () => {
      const notif = v.discriminatedUnion("type", [email(), sms(), push()]);

      const ok = await validate(notif, { type: "sms", phone: "555-1234" });
      expect(ok.isValid).toBe(true);
      expect(ok.data).toEqual({ type: "sms", phone: "555-1234" });
    });

    it("reports errors from the matched branch only", async () => {
      const notif = v.discriminatedUnion("type", [email(), sms()]);

      const result = await validate(notif, { type: "email", email: "not-an-email" });
      expect(result.isValid).toBe(false);
      expect(result.errors[0].type).toBe("email");
    });

    it("rejects an unknown discriminator value with the list of allowed values", async () => {
      const notif = v.discriminatedUnion("type", [email(), sms()]);

      const result = await validate(notif, { type: "carrier-pigeon" });
      expect(result.isValid).toBe(false);
      expect(result.errors[0].type).toBe("discriminatedUnion");
      expect(result.errors[0].error).toContain("email, sms");
    });

    it("rejects non-object input", async () => {
      const notif = v.discriminatedUnion("type", [email(), sms()]);

      const result = await validate(notif, "nope");
      expect(result.isValid).toBe(false);
      expect(result.errors[0].type).toBe("discriminatedUnion");
    });
  });

  describe("nullable", () => {
    it("accepts null when marked nullable", async () => {
      const notif = v.discriminatedUnion("type", [email(), sms()]).nullable();

      const result = await validate(notif, null);
      expect(result.isValid).toBe(true);
      expect(result.data).toBeNull();
    });
  });

  describe("construction-time validation", () => {
    it("throws when a branch is missing the discriminator field", () => {
      const bad = v.object({ email: v.string() });
      expect(() => v.discriminatedUnion("type", [email(), bad as any])).toThrow(
        /missing discriminator/i,
      );
    });

    it("throws when the discriminator is not a literal", () => {
      const bad = v.object({ type: v.string(), phone: v.string() });
      expect(() => v.discriminatedUnion("type", [email(), bad as any])).toThrow(/v\.literal/i);
    });

    it("throws on duplicate discriminator values across branches", () => {
      const dupe = v.object({ type: v.literal("email"), other: v.string() });
      expect(() => v.discriminatedUnion("type", [email(), dupe])).toThrow(/duplicate/i);
    });
  });

  describe("JSON Schema", () => {
    it("emits oneOf of branch schemas with literal discriminators", () => {
      const notif = v.discriminatedUnion("type", [email(), sms()]);
      const json = notif.toJsonSchema("draft-2020-12") as any;

      expect(Array.isArray(json.oneOf)).toBe(true);
      expect(json.oneOf).toHaveLength(2);
      expect(json.oneOf[0].properties.type).toEqual({ const: "email" });
      expect(json.oneOf[1].properties.type).toEqual({ const: "sms" });
    });
  });
});
