import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

/**
 * Coverage for the date-period rules' field/sibling forms where the referenced
 * field resolves to a Date instance or a date string (not just a bare number).
 *
 * date-period-rules.ts extracts the comparison year/month/day differently for
 * Date-instance fields, numeric fields, and parseable-string fields, with a
 * short-circuit-to-valid path when the field is absent or unparseable. These
 * branches are exercised here.
 */

describe("Date period rules - field/sibling forms", () => {
  describe("min/max year/month/day reading a sibling Date instance", () => {
    it("minYearSibling extracts the year from a sibling Date", async () => {
      const validator = v.object({
        g: v.object({
          ref: v.date(),
          when: v.date().minYearSibling("ref"),
        }),
      });
      // ref year 2020, when year 2023 → ok
      expect(
        (await validate(validator, { g: { ref: new Date("2020-01-01"), when: "2023-06-15" } }))
          .isValid,
      ).toBe(true);
      // ref year 2024, when year 2023 → fails minYear
      expect(
        (await validate(validator, { g: { ref: new Date("2024-01-01"), when: "2023-06-15" } }))
          .isValid,
      ).toBe(false);
    });

    it("maxMonthSibling extracts the month from a sibling Date", async () => {
      const validator = v.object({
        g: v.object({
          ref: v.date(),
          when: v.date().maxMonthSibling("ref"),
        }),
      });
      // ref month 8 (Aug), when month 6 (Jun) → ok (6 <= 8)
      expect(
        (await validate(validator, { g: { ref: new Date("2023-08-01"), when: "2023-06-15" } }))
          .isValid,
      ).toBe(true);
      // ref month 3 (Mar), when month 6 → fails (6 > 3)
      expect(
        (await validate(validator, { g: { ref: new Date("2023-03-01"), when: "2023-06-15" } }))
          .isValid,
      ).toBe(false);
    });

    it("minDaySibling extracts the day-of-month from a sibling Date", async () => {
      const validator = v.object({
        g: v.object({
          ref: v.date(),
          when: v.date().minDaySibling("ref"),
        }),
      });
      // ref day 10, when day 15 → ok (15 >= 10)
      expect(
        (await validate(validator, { g: { ref: new Date("2023-06-10"), when: "2023-06-15" } }))
          .isValid,
      ).toBe(true);
      // ref day 20, when day 15 → fails (15 < 20)
      expect(
        (await validate(validator, { g: { ref: new Date("2023-06-20"), when: "2023-06-15" } }))
          .isValid,
      ).toBe(false);
    });
  });

  describe("min/max reading a sibling date string", () => {
    it("minYearSibling parses a date-string field", async () => {
      const validator = v.object({
        g: v.object({
          ref: v.string(),
          when: v.date().minYearSibling("ref"),
        }),
      });
      expect(
        (await validate(validator, { g: { ref: "2020-01-01", when: "2023-06-15" } })).isValid,
      ).toBe(true);
      expect(
        (await validate(validator, { g: { ref: "2025-01-01", when: "2023-06-15" } })).isValid,
      ).toBe(false);
    });

    it("short-circuits to valid when the sibling field is an unparseable string", async () => {
      const validator = v.object({
        g: v.object({
          ref: v.string(),
          when: v.date().minYearSibling("ref"),
        }),
      });
      // "n/a" → NaN date → rule returns valid (cannot compare)
      expect((await validate(validator, { g: { ref: "n/a", when: "2023-06-15" } })).isValid).toBe(
        true,
      );
    });
  });

  describe("betweenYears / betweenMonths / betweenDays with sibling Date bounds", () => {
    it("betweenYearsSibling reads both bounds from sibling Dates", async () => {
      const validator = v.object({
        g: v.object({
          from: v.date(),
          to: v.date(),
          when: v.date().betweenYearsSibling("from", "to"),
        }),
      });
      expect(
        (await validate(validator, {
          g: { from: new Date("2020-01-01"), to: new Date("2025-01-01"), when: "2023-06-15" },
        })).isValid,
      ).toBe(true);
      expect(
        (await validate(validator, {
          g: { from: new Date("2024-01-01"), to: new Date("2030-01-01"), when: "2023-06-15" },
        })).isValid,
      ).toBe(false);
    });

    it("betweenMonthsSibling reads both bounds from sibling Dates", async () => {
      const validator = v.object({
        g: v.object({
          from: v.date(),
          to: v.date(),
          when: v.date().betweenMonthsSibling("from", "to"),
        }),
      });
      // from month 5, to month 8, when month 6 → ok
      expect(
        (await validate(validator, {
          g: { from: new Date("2023-05-01"), to: new Date("2023-08-01"), when: "2023-06-15" },
        })).isValid,
      ).toBe(true);
    });

    it("betweenDaysSibling reads both bounds from sibling Dates", async () => {
      const validator = v.object({
        g: v.object({
          from: v.date(),
          to: v.date(),
          when: v.date().betweenDaysSibling("from", "to"),
        }),
      });
      // from day 10, to day 20, when day 15 → ok
      expect(
        (await validate(validator, {
          g: { from: new Date("2023-06-10"), to: new Date("2023-06-20"), when: "2023-06-15" },
        })).isValid,
      ).toBe(true);
    });

    it("between* short-circuits to valid when a bound field is absent", async () => {
      const validator = v.object({
        g: v.object({
          from: v.number().optional(),
          to: v.number().optional(),
          when: v.date().betweenYearsSibling("from", "to"),
        }),
      });
      expect((await validate(validator, { g: { when: "2023-06-15" } })).isValid).toBe(true);
    });
  });

  describe("betweenMonths value form translates start/end month names", () => {
    it("accepts a value within the month range", async () => {
      // exercises the numeric-startMonth/endMonth translatableParams branch
      const validator = v.date().betweenMonths(5, 8);
      expect((await validate(validator, "2023-06-15")).isValid).toBe(true);
      expect((await validate(validator, "2023-09-15")).isValid).toBe(false);
    });
  });
});
