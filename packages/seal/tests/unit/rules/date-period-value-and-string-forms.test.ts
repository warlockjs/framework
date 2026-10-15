import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

/**
 * Closes the remaining branch coverage on date-period-rules.ts: the value-form
 * numeric arms (which populate translatableParams differently from the field
 * arms) and the string-field arms that PARSE a date string for each of
 * minYear/maxYear/minMonth/maxMonth/minDay/maxDay and betweenMonths/betweenDays.
 *
 * Verified against date-period-rules.ts.
 */

describe("Date period rules - value-form numeric arms", () => {
  it("maxMonth value form (translates the numeric month via MONTHS table)", async () => {
    // exercises the `typeof monthOrField === "number"` arm of maxMonthRule,
    // which sets translatableParams.monthOrField = MONTHS[monthOrField]
    expect((await validate(v.date().maxMonth(8), "2023-06-15")).isValid).toBe(true);
    expect((await validate(v.date().maxMonth(5), "2023-06-15")).isValid).toBe(false);
  });

  it("minMonth / minDay / maxDay value forms", async () => {
    expect((await validate(v.date().minMonth(3), "2023-06-15")).isValid).toBe(true);
    expect((await validate(v.date().minMonth(9), "2023-06-15")).isValid).toBe(false);
    expect((await validate(v.date().minDay(10), "2023-06-15")).isValid).toBe(true);
    expect((await validate(v.date().maxDay(10), "2023-06-15")).isValid).toBe(false);
  });

  it("minYear / maxYear value forms", async () => {
    expect((await validate(v.date().minYear(2020), "2023-06-15")).isValid).toBe(true);
    expect((await validate(v.date().maxYear(2020), "2023-06-15")).isValid).toBe(false);
  });
});

describe("Date period rules - string-field arms (parse a date string)", () => {
  it("minYear reads + parses a global date-string field", async () => {
    const validator = v.object({
      ref: v.string(),
      when: v.date().minYear("ref"),
    });
    expect((await validate(validator, { ref: "2020-01-01", when: "2023-06-15" })).isValid).toBe(
      true,
    );
    expect((await validate(validator, { ref: "2025-01-01", when: "2023-06-15" })).isValid).toBe(
      false,
    );
  });

  it("maxYear short-circuits to valid for an unparseable string field", async () => {
    const validator = v.object({
      ref: v.string(),
      when: v.date().maxYear("ref"),
    });
    expect((await validate(validator, { ref: "bogus", when: "2023-06-15" })).isValid).toBe(true);
  });

  it("minMonth / maxMonth parse a global date-string field", async () => {
    const minV = v.object({ ref: v.string(), when: v.date().minMonth("ref") });
    expect((await validate(minV, { ref: "2023-03-01", when: "2023-06-15" })).isValid).toBe(true);
    expect((await validate(minV, { ref: "2023-09-01", when: "2023-06-15" })).isValid).toBe(false);

    const maxV = v.object({ ref: v.string(), when: v.date().maxMonth("ref") });
    expect((await validate(maxV, { ref: "2023-08-01", when: "2023-06-15" })).isValid).toBe(true);
    expect((await validate(maxV, { ref: "2023-05-01", when: "2023-06-15" })).isValid).toBe(false);
  });

  it("minDay / maxDay parse a global date-string field", async () => {
    const minV = v.object({ ref: v.string(), when: v.date().minDay("ref") });
    expect((await validate(minV, { ref: "2023-06-10", when: "2023-06-15" })).isValid).toBe(true);
    expect((await validate(minV, { ref: "2023-06-20", when: "2023-06-15" })).isValid).toBe(false);

    const maxV = v.object({ ref: v.string(), when: v.date().maxDay("ref") });
    expect((await validate(maxV, { ref: "2023-06-20", when: "2023-06-15" })).isValid).toBe(true);
    expect((await validate(maxV, { ref: "2023-06-10", when: "2023-06-15" })).isValid).toBe(false);
  });

  it("betweenMonths / betweenDays / betweenYears parse global date-string bound fields", async () => {
    const months = v.object({
      from: v.string(),
      to: v.string(),
      when: v.date().betweenMonths("from", "to"),
    });
    expect(
      (await validate(months, { from: "2023-05-01", to: "2023-08-01", when: "2023-06-15" }))
        .isValid,
    ).toBe(true);
    expect(
      (await validate(months, { from: "2023-01-01", to: "2023-04-01", when: "2023-06-15" }))
        .isValid,
    ).toBe(false);

    const days = v.object({
      from: v.string(),
      to: v.string(),
      when: v.date().betweenDays("from", "to"),
    });
    expect(
      (await validate(days, { from: "2023-06-10", to: "2023-06-20", when: "2023-06-15" })).isValid,
    ).toBe(true);

    const years = v.object({
      from: v.string(),
      to: v.string(),
      when: v.date().betweenYears("from", "to"),
    });
    expect(
      (await validate(years, { from: "2020-01-01", to: "2025-01-01", when: "2023-06-15" }))
        .isValid,
    ).toBe(true);
  });

  it("between* short-circuit to valid when a bound string field is unparseable", async () => {
    const validator = v.object({
      from: v.string(),
      to: v.string(),
      when: v.date().betweenYears("from", "to"),
    });
    expect(
      (await validate(validator, { from: "bogus", to: "2025-01-01", when: "2023-06-15" })).isValid,
    ).toBe(true);
  });

  it("between* read numeric global fields", async () => {
    const validator = v.object({
      from: v.number(),
      to: v.number(),
      when: v.date().betweenMonths("from", "to"),
    });
    expect((await validate(validator, { from: 5, to: 8, when: "2023-06-15" })).isValid).toBe(true);
    expect((await validate(validator, { from: 1, to: 4, when: "2023-06-15" })).isValid).toBe(false);
  });
});

describe("string mutators - default-option branches", () => {
  it("mask with only a start uses the rest of the string as the end", async () => {
    // end defaults to str.length → everything from start is masked
    const result = await validate(v.string().mask(2), "12345678");
    expect(result.data).toBe("12******");
  });

  it("replace returns the string unchanged when search is falsy", async () => {
    // drive replaceMutator's `if (!search) return value.toString()` arm via useRule-free path:
    // calling .replace("", "x") yields an empty-string search which is falsy
    const result = await validate(v.string().replace("", "x"), "abc");
    expect(result.data).toBe("abc");
  });

  it("replaceAll with a string search builds a global RegExp", async () => {
    const result = await validate(v.string().replaceAll("a", "X"), "banana");
    expect(result.data).toBe("bXnXnX");
  });
});
