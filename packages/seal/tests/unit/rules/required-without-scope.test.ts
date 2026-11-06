import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

/**
 * `requiredWith` / `requiredWithout` and the rest of the unsuffixed family look
 * the other field up from the ROOT of the validated data; the `...Sibling`
 * variants look it up beside the field.
 */
describe("requiredWithout scope inside a nested object", () => {
  const rootScoped = v.object({
    address: v.object({
      en: v.string().requiredWithout("ar"),
      ar: v.string().requiredWithout("en"),
    }),
  });

  const siblingScoped = v.object({
    address: v.object({
      en: v.string().requiredWithoutSibling("ar"),
      ar: v.string().requiredWithoutSibling("en"),
    }),
  });

  it("reads the other field from the root, so a nested pair is rejected", async () => {
    const result = await validate(rootScoped, { address: { en: "Street" } });

    expect(result.isValid).toBe(false);
  });

  it("the Sibling variant accepts one locale of the pair", async () => {
    expect((await validate(siblingScoped, { address: { en: "Street" } })).isValid).toBe(true);
    expect((await validate(siblingScoped, { address: { ar: "شارع" } })).isValid).toBe(true);
  });

  it("the Sibling variant still requires one of the pair", async () => {
    expect((await validate(siblingScoped, { address: {} })).isValid).toBe(false);
  });
});
