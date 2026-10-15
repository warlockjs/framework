import { describe, expect, it } from "vitest";
import { validate } from "../../../src/factory/validate";
import { v } from "../../../src/factory/validators";

/**
 * Comprehensive coverage for the DateValidator fluent surface.
 *
 * The existing date-rules tests drive the raw rule objects via addMutableRule;
 * here we exercise the public chain methods on `v.date()` (the API consumers
 * actually call) across comparison, age, time, period, and special rules,
 * plus the output transformers and date mutators.
 *
 * All time-relative assertions build their fixtures off `new Date()` so they
 * stay deterministic regardless of when the suite runs.
 */

/** Build a Date offset from now by the given number of days (negative = past). */
function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

/** Build a birthdate that makes the person exactly `years` old today. */
function birthdateForAge(years: number): Date {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  // Pull back one day so we are safely past the birthday boundary regardless of TZ.
  date.setDate(date.getDate() - 1);
  return date;
}

describe("DateValidator (fluent API) - comprehensive", () => {
  describe("type coercion + matchesType", () => {
    it("accepts Date, ISO string, and timestamp number", async () => {
      expect((await validate(v.date(), new Date())).isValid).toBe(true);
      expect((await validate(v.date(), "2023-06-15")).isValid).toBe(true);
      expect((await validate(v.date(), Date.now())).isValid).toBe(true);
    });

    it("rejects an unparseable string", async () => {
      expect((await validate(v.date(), "not-a-date")).isValid).toBe(false);
    });

    it("matchesType only recognizes date-like values", () => {
      const validator = v.date();
      expect(validator.matchesType(new Date())).toBe(true);
      expect(validator.matchesType("2023-01-01")).toBe(true);
      expect(validator.matchesType({})).toBe(false);
    });
  });

  describe("value comparison (min/max/before/after/between)", () => {
    it("min is inclusive", async () => {
      const validator = v.date().min("2023-01-10");
      expect((await validate(validator, "2023-01-10")).isValid).toBe(true);
      expect((await validate(validator, "2023-01-11")).isValid).toBe(true);
      expect((await validate(validator, "2023-01-09")).isValid).toBe(false);
    });

    it("max is inclusive", async () => {
      const validator = v.date().max("2023-01-10");
      expect((await validate(validator, "2023-01-10")).isValid).toBe(true);
      expect((await validate(validator, "2023-01-09")).isValid).toBe(true);
      expect((await validate(validator, "2023-01-11")).isValid).toBe(false);
    });

    it("before is exclusive", async () => {
      const validator = v.date().before("2023-01-10");
      expect((await validate(validator, "2023-01-09")).isValid).toBe(true);
      expect((await validate(validator, "2023-01-10")).isValid).toBe(false);
    });

    it("after is exclusive", async () => {
      const validator = v.date().after("2023-01-10");
      expect((await validate(validator, "2023-01-11")).isValid).toBe(true);
      expect((await validate(validator, "2023-01-10")).isValid).toBe(false);
    });

    it("between is inclusive on both ends", async () => {
      const validator = v.date().between(new Date("2023-01-01"), new Date("2023-01-31"));
      expect((await validate(validator, "2023-01-15")).isValid).toBe(true);
      expect((await validate(validator, "2023-02-01")).isValid).toBe(false);
    });

    it("min/max accept a Date instance and a timestamp number", async () => {
      const byDate = v.date().min(new Date("2023-01-10"));
      expect((await validate(byDate, "2023-01-11")).isValid).toBe(true);

      const ts = new Date("2023-01-10").getTime();
      const byTimestamp = v.date().min(ts);
      expect((await validate(byTimestamp, "2023-01-11")).isValid).toBe(true);
      expect((await validate(byTimestamp, "2023-01-09")).isValid).toBe(false);
    });
  });

  describe("field comparison (global + sibling scope)", () => {
    it("min reads another field's value (global scope, plain field name)", async () => {
      const validator = v.object({
        startsAt: v.date(),
        endsAt: v.date().min("startsAt"),
      });

      expect(
        (await validate(validator, { startsAt: "2023-01-01", endsAt: "2023-01-05" })).isValid,
      ).toBe(true);
      expect(
        (await validate(validator, { startsAt: "2023-01-05", endsAt: "2023-01-01" })).isValid,
      ).toBe(false);
    });

    it("minSibling / maxSibling compare within the same parent object", async () => {
      const validator = v.object({
        range: v.object({
          from: v.date(),
          to: v.date().minSibling("from"),
        }),
      });

      expect(
        (await validate(validator, { range: { from: "2023-01-01", to: "2023-01-02" } })).isValid,
      ).toBe(true);
      expect(
        (await validate(validator, { range: { from: "2023-01-02", to: "2023-01-01" } })).isValid,
      ).toBe(false);
    });

    it("beforeSibling / afterSibling enforce strict ordering", async () => {
      const validator = v.object({
        window: v.object({
          open: v.date(),
          close: v.date().afterSibling("open"),
        }),
      });

      expect(
        (await validate(validator, { window: { open: "2023-01-01", close: "2023-01-02" } }))
          .isValid,
      ).toBe(true);
      expect(
        (await validate(validator, { window: { open: "2023-01-01", close: "2023-01-01" } }))
          .isValid,
      ).toBe(false);
    });

    it("field comparison passes when the referenced field is absent", async () => {
      const validator = v.object({
        startsAt: v.date().optional(),
        endsAt: v.date().min("startsAt"),
      });

      // startsAt undefined → rule short-circuits to valid
      expect((await validate(validator, { endsAt: "2023-01-05" })).isValid).toBe(true);
    });

    it("sameAsField / sameAsFieldSibling require equal dates", async () => {
      const global = v.object({
        a: v.date(),
        b: v.date().sameAsField("a"),
      });
      expect((await validate(global, { a: "2023-01-01", b: "2023-01-01" })).isValid).toBe(true);
      expect((await validate(global, { a: "2023-01-01", b: "2023-01-02" })).isValid).toBe(false);

      const sibling = v.object({
        pair: v.object({
          first: v.date(),
          second: v.date().sameAsFieldSibling("first"),
        }),
      });
      expect(
        (await validate(sibling, { pair: { first: "2023-01-01", second: "2023-01-01" } })).isValid,
      ).toBe(true);
    });
  });

  describe("today-relative rules", () => {
    it("today only accepts today's date", async () => {
      expect((await validate(v.date().today(), new Date())).isValid).toBe(true);
      expect((await validate(v.date().today(), daysFromNow(1))).isValid).toBe(false);
    });

    it("fromToday accepts today and future", async () => {
      const validator = v.date().fromToday();
      expect((await validate(validator, new Date())).isValid).toBe(true);
      expect((await validate(validator, daysFromNow(2))).isValid).toBe(true);
      expect((await validate(validator, daysFromNow(-2))).isValid).toBe(false);
    });

    it("beforeToday rejects today, accepts yesterday", async () => {
      const validator = v.date().beforeToday();
      expect((await validate(validator, daysFromNow(-1))).isValid).toBe(true);
      expect((await validate(validator, new Date())).isValid).toBe(false);
    });

    it("afterToday rejects today, accepts tomorrow", async () => {
      const validator = v.date().afterToday();
      expect((await validate(validator, daysFromNow(1))).isValid).toBe(true);
      expect((await validate(validator, new Date())).isValid).toBe(false);
    });

    it("past / future split around now", async () => {
      expect((await validate(v.date().past(), daysFromNow(-1))).isValid).toBe(true);
      expect((await validate(v.date().past(), daysFromNow(1))).isValid).toBe(false);
      expect((await validate(v.date().future(), daysFromNow(1))).isValid).toBe(true);
      expect((await validate(v.date().future(), daysFromNow(-1))).isValid).toBe(false);
    });
  });

  describe("age rules", () => {
    it("age requires the exact age", async () => {
      const validator = v.date().age(30);
      expect((await validate(validator, birthdateForAge(30))).isValid).toBe(true);
      expect((await validate(validator, birthdateForAge(31))).isValid).toBe(false);
    });

    it("minAge enforces a lower bound", async () => {
      const validator = v.date().minAge(18);
      expect((await validate(validator, birthdateForAge(20))).isValid).toBe(true);
      expect((await validate(validator, birthdateForAge(16))).isValid).toBe(false);
    });

    it("maxAge enforces an upper bound", async () => {
      const validator = v.date().maxAge(65);
      expect((await validate(validator, birthdateForAge(40))).isValid).toBe(true);
      expect((await validate(validator, birthdateForAge(70))).isValid).toBe(false);
    });

    it("betweenAge enforces an inclusive range", async () => {
      const validator = v.date().betweenAge(18, 30);
      expect((await validate(validator, birthdateForAge(25))).isValid).toBe(true);
      expect((await validate(validator, birthdateForAge(15))).isValid).toBe(false);
      expect((await validate(validator, birthdateForAge(40))).isValid).toBe(false);
    });
  });

  describe("time-of-day rules", () => {
    // A fixed local datetime at 14:30 — hours/minutes read from local time.
    const at1430 = new Date(2023, 5, 15, 14, 30, 0);

    it("fromHour / beforeHour", async () => {
      expect((await validate(v.date().fromHour(9), at1430)).isValid).toBe(true);
      expect((await validate(v.date().fromHour(15), at1430)).isValid).toBe(false);
      expect((await validate(v.date().beforeHour(15), at1430)).isValid).toBe(true);
      expect((await validate(v.date().beforeHour(14), at1430)).isValid).toBe(false);
    });

    it("betweenHours is inclusive", async () => {
      expect((await validate(v.date().betweenHours(9, 17), at1430)).isValid).toBe(true);
      expect((await validate(v.date().betweenHours(14, 14), at1430)).isValid).toBe(true);
      expect((await validate(v.date().betweenHours(15, 18), at1430)).isValid).toBe(false);
    });

    it("fromMinute / beforeMinute", async () => {
      expect((await validate(v.date().fromMinute(15), at1430)).isValid).toBe(true);
      expect((await validate(v.date().fromMinute(45), at1430)).isValid).toBe(false);
      expect((await validate(v.date().beforeMinute(45), at1430)).isValid).toBe(true);
      expect((await validate(v.date().beforeMinute(30), at1430)).isValid).toBe(false);
    });

    it("betweenMinutes is inclusive", async () => {
      expect((await validate(v.date().betweenMinutes(0, 30), at1430)).isValid).toBe(true);
      expect((await validate(v.date().betweenMinutes(31, 59), at1430)).isValid).toBe(false);
    });

    it("betweenTimes compares HH:MM windows", async () => {
      expect((await validate(v.date().betweenTimes("09:00", "17:00"), at1430)).isValid).toBe(true);
      expect((await validate(v.date().betweenTimes("15:00", "18:00"), at1430)).isValid).toBe(false);
    });
  });

  describe("day-of-week rules", () => {
    it("weekDay matches a specific day name", async () => {
      // 2023-06-17 is a Saturday.
      expect((await validate(v.date().weekDay("saturday"), "2023-06-17")).isValid).toBe(true);
      expect((await validate(v.date().weekDay("monday"), "2023-06-17")).isValid).toBe(false);
    });

    it("weekdays matches any of the listed days", async () => {
      // 2023-06-19 is a Monday.
      const validator = v.date().weekdays(["monday", "tuesday"]);
      expect((await validate(validator, "2023-06-19")).isValid).toBe(true);
      expect((await validate(validator, "2023-06-17")).isValid).toBe(false);
    });

    it("weekend / businessDay", async () => {
      expect((await validate(v.date().weekend(), "2023-06-17")).isValid).toBe(true); // Sat
      expect((await validate(v.date().weekend(), "2023-06-19")).isValid).toBe(false); // Mon
      expect((await validate(v.date().businessDay(), "2023-06-19")).isValid).toBe(true); // Mon
      expect((await validate(v.date().businessDay(), "2023-06-17")).isValid).toBe(false); // Sat
    });
  });

  describe("relative-day rules", () => {
    it("withinDays spans past and future", async () => {
      const validator = v.date().withinDays(5);
      expect((await validate(validator, daysFromNow(3))).isValid).toBe(true);
      expect((await validate(validator, daysFromNow(-3))).isValid).toBe(true);
      expect((await validate(validator, daysFromNow(10))).isValid).toBe(false);
    });

    it("withinPastDays only allows the recent past", async () => {
      const validator = v.date().withinPastDays(5);
      expect((await validate(validator, daysFromNow(-3))).isValid).toBe(true);
      expect((await validate(validator, daysFromNow(3))).isValid).toBe(false);
      expect((await validate(validator, daysFromNow(-10))).isValid).toBe(false);
    });

    it("withinFutureDays only allows the near future", async () => {
      const validator = v.date().withinFutureDays(5);
      expect((await validate(validator, daysFromNow(3))).isValid).toBe(true);
      expect((await validate(validator, daysFromNow(-3))).isValid).toBe(false);
      expect((await validate(validator, daysFromNow(10))).isValid).toBe(false);
    });
  });

  describe("period rules (value form)", () => {
    it("month / year / quarter", async () => {
      expect((await validate(v.date().month(6), "2023-06-15")).isValid).toBe(true);
      expect((await validate(v.date().month(7), "2023-06-15")).isValid).toBe(false);
      expect((await validate(v.date().year(2023), "2023-06-15")).isValid).toBe(true);
      expect((await validate(v.date().year(2024), "2023-06-15")).isValid).toBe(false);
      expect((await validate(v.date().quarter(2), "2023-06-15")).isValid).toBe(true);
      expect((await validate(v.date().quarter(1), "2023-06-15")).isValid).toBe(false);
    });

    it("minYear / maxYear (value form)", async () => {
      expect((await validate(v.date().minYear(2020), "2023-06-15")).isValid).toBe(true);
      expect((await validate(v.date().minYear(2024), "2023-06-15")).isValid).toBe(false);
      expect((await validate(v.date().maxYear(2025), "2023-06-15")).isValid).toBe(true);
      expect((await validate(v.date().maxYear(2022), "2023-06-15")).isValid).toBe(false);
    });

    it("minMonth / maxMonth (value form)", async () => {
      expect((await validate(v.date().minMonth(3), "2023-06-15")).isValid).toBe(true);
      expect((await validate(v.date().minMonth(7), "2023-06-15")).isValid).toBe(false);
      expect((await validate(v.date().maxMonth(8), "2023-06-15")).isValid).toBe(true);
      expect((await validate(v.date().maxMonth(5), "2023-06-15")).isValid).toBe(false);
    });

    it("minDay / maxDay (value form)", async () => {
      expect((await validate(v.date().minDay(10), "2023-06-15")).isValid).toBe(true);
      expect((await validate(v.date().minDay(20), "2023-06-15")).isValid).toBe(false);
      expect((await validate(v.date().maxDay(20), "2023-06-15")).isValid).toBe(true);
      expect((await validate(v.date().maxDay(10), "2023-06-15")).isValid).toBe(false);
    });

    it("betweenYears / betweenMonths / betweenDays (value form)", async () => {
      expect((await validate(v.date().betweenYears(2020, 2025), "2023-06-15")).isValid).toBe(true);
      expect((await validate(v.date().betweenYears(2024, 2030), "2023-06-15")).isValid).toBe(false);
      expect((await validate(v.date().betweenMonths(5, 8), "2023-06-15")).isValid).toBe(true);
      expect((await validate(v.date().betweenMonths(1, 4), "2023-06-15")).isValid).toBe(false);
      expect((await validate(v.date().betweenDays(10, 20), "2023-06-15")).isValid).toBe(true);
      expect((await validate(v.date().betweenDays(1, 10), "2023-06-15")).isValid).toBe(false);
    });
  });

  describe("period rules (field/sibling form)", () => {
    it("minYear reads a sibling field's numeric year", async () => {
      const validator = v.object({
        floor: v.object({
          minYear: v.number(),
          when: v.date().minYearSibling("minYear"),
        }),
      });

      expect(
        (await validate(validator, { floor: { minYear: 2020, when: "2023-06-15" } })).isValid,
      ).toBe(true);
      expect(
        (await validate(validator, { floor: { minYear: 2024, when: "2023-06-15" } })).isValid,
      ).toBe(false);
    });

    it("maxMonthSibling / minDaySibling resolve sibling numbers", async () => {
      const maxMonth = v.object({
        g: v.object({
          cap: v.number(),
          when: v.date().maxMonthSibling("cap"),
        }),
      });
      expect((await validate(maxMonth, { g: { cap: 8, when: "2023-06-15" } })).isValid).toBe(true);
      expect((await validate(maxMonth, { g: { cap: 5, when: "2023-06-15" } })).isValid).toBe(false);

      const minDay = v.object({
        g: v.object({
          floor: v.number(),
          when: v.date().minDaySibling("floor"),
        }),
      });
      expect((await validate(minDay, { g: { floor: 10, when: "2023-06-15" } })).isValid).toBe(true);
      expect((await validate(minDay, { g: { floor: 20, when: "2023-06-15" } })).isValid).toBe(
        false,
      );
    });

    it("betweenYearsSibling resolves both bounds from siblings", async () => {
      const validator = v.object({
        g: v.object({
          from: v.number(),
          to: v.number(),
          when: v.date().betweenYearsSibling("from", "to"),
        }),
      });
      expect(
        (await validate(validator, { g: { from: 2020, to: 2025, when: "2023-06-15" } })).isValid,
      ).toBe(true);
      expect(
        (await validate(validator, { g: { from: 2024, to: 2030, when: "2023-06-15" } })).isValid,
      ).toBe(false);
    });

    it("period field rule short-circuits to valid when the field is absent", async () => {
      const validator = v.object({
        minYear: v.number().optional(),
        when: v.date().minYear("minYear"),
      });
      expect((await validate(validator, { when: "2023-06-15" })).isValid).toBe(true);
    });
  });

  describe("special rules", () => {
    it("leapYear", async () => {
      expect((await validate(v.date().leapYear(), "2024-02-29")).isValid).toBe(true); // leap
      expect((await validate(v.date().leapYear(), "2023-06-15")).isValid).toBe(false);
      expect((await validate(v.date().leapYear(), "2000-01-01")).isValid).toBe(true); // div 400
      expect((await validate(v.date().leapYear(), "1900-01-01")).isValid).toBe(false); // century
    });

    it("birthday rejects future dates and out-of-range ages", async () => {
      expect((await validate(v.date().birthday(), birthdateForAge(30))).isValid).toBe(true);
      expect((await validate(v.date().birthday(), daysFromNow(1))).isValid).toBe(false);
      // minAge 18 → a 10-year-old fails
      expect((await validate(v.date().birthday(18), birthdateForAge(10))).isValid).toBe(false);
      // maxAge 60 → a 70-year-old fails
      expect((await validate(v.date().birthday(0, 60), birthdateForAge(70))).isValid).toBe(false);
    });
  });

  describe("output transformers", () => {
    it("toISOString returns the ISO representation", async () => {
      const date = new Date("2023-06-15T12:00:00.000Z");
      const result = await validate(v.date().toISOString(), date);
      expect(result.data).toBe(date.toISOString());
    });

    it("toTimestamp returns epoch milliseconds", async () => {
      const date = new Date("2023-06-15T12:00:00.000Z");
      const result = await validate(v.date().toTimestamp(), date);
      expect(result.data).toBe(date.getTime());
    });

    it("toFormat formats via dayjs pattern", async () => {
      const result = await validate(v.date().toFormat("YYYY-MM-DD"), "2023-06-15T12:00:00.000Z");
      expect(result.data).toBe("2023-06-15");
    });

    it("toDateOnly / toTimeOnly produce partial strings", async () => {
      const dateOnly = await validate(v.date().toDateOnly(), new Date(2023, 5, 15, 14, 30, 0));
      expect(dateOnly.data).toBe("2023-06-15");

      const timeOnly = await validate(v.date().toTimeOnly(), new Date(2023, 5, 15, 14, 30, 5));
      expect(timeOnly.data).toBe("14:30:05");
    });
  });

  describe("date mutators (applied before validation)", () => {
    it("toStartOfDay zeroes the time, passing a beforeHour(1) check", async () => {
      const result = await validate(
        v.date().toStartOfDay().beforeHour(1),
        new Date(2023, 5, 15, 23, 59, 0),
      );
      expect(result.isValid).toBe(true);
    });

    it("toEndOfDay pushes to 23:59:59.999", async () => {
      const result = await validate(
        v.date().toEndOfDay().fromHour(23),
        new Date(2023, 5, 15, 8, 0, 0),
      );
      expect(result.isValid).toBe(true);
    });

    it("addDays shifts the date forward before a day check", async () => {
      // 2023-06-15 + 5 days = 2023-06-20 → day 20
      const result = await validate(v.date().addDays(5).minDay(20), "2023-06-15");
      expect(result.isValid).toBe(true);
    });

    it("addMonths / addYears shift period before checks", async () => {
      const months = await validate(v.date().addMonths(2).month(8), "2023-06-15");
      expect(months.isValid).toBe(true);

      const years = await validate(v.date().addYears(1).year(2024), "2023-06-15");
      expect(years.isValid).toBe(true);
    });

    it("toStartOfMonth / toEndOfMonth move within the month", async () => {
      const start = await validate(v.date().toStartOfMonth().minDay(1).maxDay(1), "2023-06-15");
      expect(start.isValid).toBe(true);

      const end = await validate(v.date().toEndOfMonth().minDay(30), "2023-06-15");
      expect(end.isValid).toBe(true);
    });
  });

  describe("defaults", () => {
    it("defaultNow fills an absent value with the current time", async () => {
      const result = await validate(v.date().defaultNow(), undefined);
      expect(result.isValid).toBe(true);
      expect(result.data instanceof Date).toBe(true);
    });
  });

  describe("toJsonSchema", () => {
    it("defaults to date-time format", () => {
      expect(v.date().toJsonSchema()).toEqual({ type: "string", format: "date-time" });
    });

    it("toDateOnly / toTimeOnly drive the format keyword", () => {
      expect(v.date().toDateOnly().toJsonSchema()).toEqual({ type: "string", format: "date" });
      expect(v.date().toTimeOnly().toJsonSchema()).toEqual({ type: "string", format: "time" });
    });

    it("explicit .format() does NOT drive the JSON Schema format keyword (known bug)", () => {
      // known bug: toJsonSchema() reads getRuleOptions(this.rules, "date"), which
      // returns the FIRST "date" rule — the one added by the DateValidator
      // constructor with no format option. The format option carried by a later
      // .format() rule is therefore never seen, so the schema stays "date-time".
      // The format-driving path only works via the transformer detection branch
      // (toDateOnly/toTimeOnly/toFormat). Pinned to current behavior.
      expect(v.date().format("YYYY-MM-DD").toJsonSchema().format).toBe("date-time");
      expect(v.date().format("HH:mm:ss").toJsonSchema().format).toBe("date-time");
    });

    it("nullable adds the null branch", () => {
      const schema = v.date().nullable().toJsonSchema("draft-2020-12");
      expect(schema.type).toEqual(["string", "null"]);
    });
  });
});
