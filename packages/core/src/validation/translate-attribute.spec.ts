import { extend, trans } from "@mongez/localization";
import { v, validate } from "@warlock.js/seal";
import { describe, expect, it } from "vitest";
import { translateSealAttribute } from "./translate-attribute";

const translate = (key: string, placeholders: unknown) => trans(key, placeholders as never);

describe("default seal attribute translation", () => {
  it("uses the translated label under attributes.<field>", () => {
    extend("en", { attributes: { weight_kg: "Weight" } });

    expect(
      translateSealAttribute({ attribute: "weight_kg", key: "weight_kg", translate }),
    ).toBe("Weight");
  });

  it("uses validation.attributes.<field> when no attribute group is configured", () => {
    extend("en", { validation: { attributes: { dumbbell_kg: "Dumbbell weight" } } });

    expect(
      translateSealAttribute({ attribute: "dumbbell_kg", key: "dumbbell_kg", translate }),
    ).toBe("Dumbbell weight");
  });

  it("honours a configured attribute group and does not try the nested one", () => {
    extend("en", { fields: { plan_name: "Plan" }, validation: { attributes: { plan_name: "X" } } });

    expect(
      translateSealAttribute({
        attribute: "plan_name",
        key: "plan_name",
        attributeGroup: "fields",
        translate,
      }),
    ).toBe("Plan");
    expect(
      translateSealAttribute({
        attribute: "other_field",
        key: "other_field",
        attributeGroup: "fields",
        translate,
      }),
    ).toBe("Other field");
  });

  it("humanises a field without a label", () => {
    expect(
      translateSealAttribute({
        attribute: "max_dumbbell_kg",
        key: "max_dumbbell_kg",
        translate,
      }),
    ).toBe("Max dumbbell kg");
    expect(translateSealAttribute({ attribute: "firstName", key: "firstName", translate })).toBe(
      "First name",
    );
  });

  it("humanises a sibling field a rule refers to", () => {
    expect(
      translateSealAttribute({
        attribute: "start_date",
        key: "end_date",
        allValues: { start_date: "2026-01-01" },
        translate,
      }),
    ).toBe("Start date");
  });

  it("keeps values that are not fields untouched", () => {
    expect(
      translateSealAttribute({
        attribute: "left_side",
        key: "side",
        allValues: { side: "left_side" },
        translate,
      }),
    ).toBe("left_side");
  });

  it("keeps the raw key when humanising is turned off", () => {
    expect(
      translateSealAttribute({
        attribute: "max_dumbbell_kg",
        key: "max_dumbbell_kg",
        humanize: false,
        translate,
      }),
    ).toBe("max_dumbbell_kg");
  });

  it("fills :input in a seal message with the humanised name", async () => {
    const result = await validate(
      v.object({ max_dumbbell_kg: v.number().max(200) }),
      { max_dumbbell_kg: 500 },
      {
        translateAttribute: ({ attribute, context }) =>
          translateSealAttribute({
            attribute,
            key: context.key,
            allValues: context.allValues,
            translate,
          }),
      },
    );

    expect(result.isValid).toBe(false);
    expect(result.isValid ? "" : result.errors[0]?.error).toContain("Max dumbbell kg");
  });
});
