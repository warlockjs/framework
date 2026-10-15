import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

describe("Validator immutability", () => {
  it("chain methods return a new instance, leaving the original untouched", () => {
    const base = v.string();
    const withRules = base.min(3).email();

    expect(withRules).not.toBe(base);
    expect(base.rules.length).toBeLessThan(withRules.rules.length);
  });

  it("a shared base validator is not mutated by deriving from it", async () => {
    const base = v.string();
    const longer = base.min(3);

    // The derived validator enforces min(3); a 1-char string fails it.
    expect((await validate(longer, "a")).isValid).toBe(false);

    // The original base never gained the min(3) rule, so the same value passes.
    expect((await validate(base, "a")).isValid).toBe(true);
  });

  it(".optional() does not mutate the source validator", async () => {
    const schema = v.object({
      name: v.string(),
    });

    const optionalName = schema.schema.name.optional();

    expect(optionalName).not.toBe(schema.schema.name);
    expect(optionalName.isOptional).toBe(true);
    expect(schema.schema.name.isOptional).toBe(false);
  });

  it(".nullable() / .default() / .catch() each fork a new instance", () => {
    const base = v.int();

    expect(base.nullable()).not.toBe(base);
    expect(base.default(5)).not.toBe(base);
    expect(base.catch(0)).not.toBe(base);
  });

  it(".mutable mutates in place and returns the same instance", () => {
    const validator = v.string().mutable;
    const afterMin = validator.min(3);

    expect(afterMin).toBe(validator);
    expect(validator.rules.some((rule) => rule.name === "minLength")).toBe(true);
  });

  it(".immutable toggles back to clone-on-chain", () => {
    const validator = v.string().mutable;
    const stillMutable = validator.min(2);

    expect(stillMutable).toBe(validator);

    const immutable = validator.immutable;
    const forked = immutable.max(10);

    expect(forked).not.toBe(immutable);
  });

  it("cloning an object schema deep-copies field validators", () => {
    const schema = v.object({
      email: v.string().email(),
    });

    const cloned = schema.clone();

    expect(cloned).not.toBe(schema);
    expect(cloned.schema.email).not.toBe(schema.schema.email);
  });

  it("validating through a schema does not leak rules back onto reused field validators", async () => {
    const email = v.string().email();

    const login = v.object({ email });
    const signup = v.object({ email });

    await validate(login, { email: "user@example.com" });
    await validate(signup, { email: "user@example.com" });

    // The shared `email` validator's rule count is stable across reuse.
    expect(email.rules.filter((rule) => rule.name === "email").length).toBe(1);
  });
});
