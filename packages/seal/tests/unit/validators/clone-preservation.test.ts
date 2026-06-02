import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
import { InstanceOfValidator } from "../../../src/validators/instanceof-validator";
import { LiteralValidator } from "../../../src/validators/literal-validator";

/**
 * Regression coverage for clone() preserving subclass-specific public fields.
 *
 * Without dedicated clone() overrides, `LiteralValidator.values` and
 * `InstanceOfValidator.ctor` were dropped on clone — which silently broke any
 * chain method (clone-on-write) and crashed `discriminatedUnion` branch routing
 * when a literal discriminator was cloned via `.nullable()` / `.optional()`.
 */
describe("clone preserves subclass fields", () => {
  it("LiteralValidator.clone keeps its values", () => {
    const literal = v.literal("a", "b") as unknown as LiteralValidator;
    const cloned = literal.clone();

    expect(cloned.values).toEqual(["a", "b"]);
  });

  it("a cloned literal (via .nullable()) still validates", async () => {
    const schema = v.object({ status: v.literal("draft", "published").nullable() });

    expect((await validate(schema, { status: "draft" })).isValid).toBe(true);
    expect((await validate(schema, { status: "unknown" })).isValid).toBe(false);
    expect((await validate(schema, { status: null })).isValid).toBe(true);
  });

  it("InstanceOfValidator.clone keeps its constructor", () => {
    class Token {}
    const validator = v.instanceof(Token) as unknown as InstanceOfValidator<Token>;
    const cloned = validator.clone();

    expect(cloned.ctor).toBe(Token);
    expect(cloned.matchesType(new Token())).toBe(true);
  });

  it("a cloned instanceof (via .optional()) still validates", async () => {
    class Token {}
    const schema = v.object({ token: v.instanceof(Token).optional() });

    expect((await validate(schema, { token: new Token() })).isValid).toBe(true);
    expect((await validate(schema, { token: "nope" })).isValid).toBe(false);
    expect((await validate(schema, {})).isValid).toBe(true);
  });

  it("discriminatedUnion survives a chain method that clones its branches", async () => {
    const email = v.object({ type: v.literal("email"), email: v.string().email() });
    const sms = v.object({ type: v.literal("sms"), phone: v.string() });

    // .nullable() clones the union (and its branches' literal discriminators).
    const notif = v.discriminatedUnion("type", [email, sms]).nullable();

    expect((await validate(notif, { type: "sms", phone: "555" })).isValid).toBe(true);
    expect((await validate(notif, null)).isValid).toBe(true);
  });
});
