import { describe, expect, it } from "vitest";
import type { RuleTranslation } from "../../../src";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

const HOSTILE = "<script>SECRET-123</script>";

/**
 * A translator shaped like the starter's: the enum templates echo `:value`
 * and every placeholder is interpolated from the attributes seal hands over.
 * String enums run the `in` rule, scalar enums the `enum` rule.
 */
const translateRule = ({ rule, attributes }: RuleTranslation) => {
  const template =
    rule.name === "enum" || rule.name === "in"
      ? "The :input must be one of :values, given value :value."
      : "";

  return template.replace(/:([a-zA-Z_]+)/g, (match, key) =>
    key in attributes ? String(attributes[key]) : match,
  );
};

const firstError = async (schema: any, data: any, options: any) => {
  const result = await validate(schema, data, options);

  expect(result.isValid).toBe(false);

  return result.errors[0].error;
};

describe("validate — redactValue", () => {
  it("renders the redaction instead of the input in a translated :value", async () => {
    const schema = v.object({ status: v.enum(["draft", "published"]) });

    const error = await firstError(
      schema,
      { status: HOSTILE },
      { translateRule, redactValue: "[redacted]" },
    );

    expect(error).toContain("[redacted]");
    expect(error).not.toContain("SECRET-123");
  });

  it("renders the redaction in an author errorMessage using :value", async () => {
    const schema = v.object({
      status: v.enum(["draft", "published"], "Bad status :value"),
    });

    const error = await firstError(schema, { status: HOSTILE }, { redactValue: "[redacted]" });

    expect(error).toBe("Bad status [redacted]");
  });

  it("keeps the submitted value in :value when the option is unset", async () => {
    const schema = v.object({
      status: v.enum(["draft", "published"], "Bad status :value"),
    });

    const translated = await firstError(schema, { status: HOSTILE }, { translateRule });
    const custom = await firstError(schema, { status: HOSTILE }, {});

    expect(translated).toContain(HOSTILE);
    expect(custom).toBe(`Bad status ${HOSTILE}`);
  });

  it("leaves rule-supplied :value params (the compared value) untouched", async () => {
    const schema = v.object({ age: v.number().greaterThan(18) });

    const error = await firstError(schema, { age: 3 }, { redactValue: "[redacted]" });

    expect(error).toContain("18");
    expect(error).not.toContain("[redacted]");
  });
});
