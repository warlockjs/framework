import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";
import { BooleanValidator } from "../../../src/validators/boolean-validator";

/**
 * `v.boolean().accepted()` / `.declined()` (and their conditional variants)
 * opt the validator into form-boolean parsing: a mutator runs before the
 * type rule and converts the accepted/declined string+number forms into a
 * real boolean, so those forms are no longer rejected by the strict type
 * rule before the accepted/declined rule ever sees them.
 */
describe("BooleanValidator - form value parsing", () => {
  const acceptedForms = [1, "1", true, "true", "yes", "y", "on", "Yes", "Y", "On"];
  const declinedForms = [0, "0", false, "false", "no", "n", "off", "No", "N", "Off"];

  describe("accepted()", () => {
    it.each(acceptedForms)("parses %j into true", async (form) => {
      const validator = new BooleanValidator().accepted();
      const result = await validate(validator, form);

      expect(result.isValid).toBe(true);
      expect(result.data).toBe(true);
    });

    it("rejects a declined form", async () => {
      const validator = new BooleanValidator().accepted();
      const result = await validate(validator, "no");

      expect(result.isValid).toBe(false);
    });

    it("rejects a value that is neither accepted nor declined", async () => {
      const validator = new BooleanValidator().accepted();
      const result = await validate(validator, "maybe");

      expect(result.isValid).toBe(false);
    });
  });

  describe("declined()", () => {
    it.each(declinedForms)("parses %j into false", async (form) => {
      const validator = new BooleanValidator().declined();
      const result = await validate(validator, form);

      expect(result.isValid).toBe(true);
      expect(result.data).toBe(false);
    });

    it("rejects an accepted form", async () => {
      const validator = new BooleanValidator().declined();
      const result = await validate(validator, "yes");

      expect(result.isValid).toBe(false);
    });
  });

  describe("conditional variants", () => {
    it("acceptedIf parses a form string when the condition holds", async () => {
      const validator = v.object({
        subscribe: v.boolean(),
        terms: v.boolean().acceptedIf("subscribe", true).optional(),
      });

      const result = await validate(validator, { subscribe: true, terms: "on" });

      expect(result.isValid).toBe(true);
      expect(result.data?.terms).toBe(true);
    });
  });

  describe("control: plain v.boolean() unaffected", () => {
    it("still rejects a form string with no accepted/declined method called", async () => {
      const validator = new BooleanValidator();
      const result = await validate(validator, "yes");

      expect(result.isValid).toBe(false);
    });
  });

  describe("idempotence", () => {
    it("adds the form-boolean mutator only once across chained accepted/declined calls", async () => {
      const validator = new BooleanValidator().accepted().declinedIf("other", true);

      const mutatorCount = (validator as any).mutators.filter(
        (m: any) => m.mutate?.name === "formBooleanMutator",
      ).length;

      expect(mutatorCount).toBe(1);
    });
  });
});
