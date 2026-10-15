import { describe, expect, it } from "vitest";
import { DateTimeError } from "../errors";
import { causeOf } from "../test-support";
import { dateTimeTool } from "./date-time";
import type { DateTimeInput } from "../contracts/utility.type";

/** A fixed instant for deterministic `now` tests: 2026-06-22T08:30:00Z. */
const FIXED_NOW_MS = Date.parse("2026-06-22T08:30:00.000Z");

/** A tool whose `now` reads a fixed clock — no wall-clock nondeterminism. */
function fixedTool(options?: { name?: string; defaultTimeZone?: string }) {
  return dateTimeTool(options, { clock: () => FIXED_NOW_MS });
}

/** Invoke the tool and assert it returned a value, returning that value. */
async function value(input: DateTimeInput): Promise<string> {
  const { data, error } = await fixedTool().invoke(input);

  expect(error, `expected no error for op "${input.op}"`).toBeUndefined();
  expect(data).toBeDefined();

  return (data as { value: string }).value;
}

/** Invoke the tool expecting a failure; return the surfaced error. */
async function expectError(input: unknown) {
  const { data, error } = await fixedTool().invoke(input);

  expect(data).toBeUndefined();
  expect(error).toBeDefined();

  return error;
}

describe("dateTimeTool", () => {
  describe("now (deterministic via injected clock)", () => {
    it("returns the clock's instant as a UTC ISO string by default", async () => {
      expect(await value({ op: "now" })).toBe("2026-06-22T08:30:00.000Z");
    });

    it("renders the date in a given IANA time zone", async () => {
      const rendered = await value({ op: "now", format: "date", timeZone: "UTC" });

      expect(rendered).toMatch(/2026/);
    });

    it("applies the constructor defaultTimeZone when a call omits timeZone", async () => {
      const tool = dateTimeTool(
        { defaultTimeZone: "UTC" },
        { clock: () => FIXED_NOW_MS },
      );
      const { data, error } = await tool.invoke({ op: "now", format: "time" });

      expect(error).toBeUndefined();
      expect(data?.value).toBeTruthy();
    });
  });

  describe("format", () => {
    it("round-trips an ISO instant to a UTC ISO string", async () => {
      expect(await value({ op: "format", iso: "2020-01-15T12:00:00Z" })).toBe(
        "2020-01-15T12:00:00.000Z",
      );
    });

    it("rejects a missing iso", async () => {
      const error = await expectError({ op: "format" });

      expect((causeOf(error) as DateTimeError).type).toBe("invalid-input");
    });

    it("rejects an unparseable iso", async () => {
      const error = await expectError({ op: "format", iso: "not-a-date" });

      expect((causeOf(error) as DateTimeError).type).toBe("invalid-input");
    });
  });

  describe("add", () => {
    it("adds days", async () => {
      expect(await value({ op: "add", iso: "2026-01-01T00:00:00Z", amount: 3, unit: "days" })).toBe(
        "2026-01-04T00:00:00.000Z",
      );
    });

    it("adds hours and minutes", async () => {
      expect(
        await value({ op: "add", iso: "2026-01-01T00:00:00Z", amount: 90, unit: "minutes" }),
      ).toBe("2026-01-01T01:30:00.000Z");
    });

    it("subtracts with a negative amount", async () => {
      expect(
        await value({ op: "add", iso: "2026-01-10T00:00:00Z", amount: -2, unit: "days" }),
      ).toBe("2026-01-08T00:00:00.000Z");
    });

    it("accepts singular and abbreviated unit aliases", async () => {
      expect(await value({ op: "add", iso: "2026-01-01T00:00:00Z", amount: 1, unit: "day" })).toBe(
        "2026-01-02T00:00:00.000Z",
      );
      expect(await value({ op: "add", iso: "2026-01-01T00:00:00Z", amount: 1, unit: "h" })).toBe(
        "2026-01-01T01:00:00.000Z",
      );
    });

    it("rejects a missing amount", async () => {
      const error = await expectError({ op: "add", iso: "2026-01-01T00:00:00Z", unit: "days" });

      expect((causeOf(error) as DateTimeError).type).toBe("invalid-input");
    });

    it("rejects a missing unit", async () => {
      const error = await expectError({ op: "add", iso: "2026-01-01T00:00:00Z", amount: 1 });

      expect((causeOf(error) as DateTimeError).type).toBe("invalid-input");
    });

    it("rejects an unknown unit", async () => {
      const error = await expectError({
        op: "add",
        iso: "2026-01-01T00:00:00Z",
        amount: 1,
        unit: "months",
      });

      expect((causeOf(error) as DateTimeError).type).toBe("invalid-unit");
    });
  });

  describe("diff", () => {
    it("computes a signed difference in days (to − iso)", async () => {
      expect(
        await value({
          op: "diff",
          iso: "2026-01-01T00:00:00Z",
          to: "2026-01-04T00:00:00Z",
          unit: "days",
        }),
      ).toBe("3");
    });

    it("is negative when to precedes iso", async () => {
      expect(
        await value({
          op: "diff",
          iso: "2026-01-04T00:00:00Z",
          to: "2026-01-01T00:00:00Z",
          unit: "days",
        }),
      ).toBe("-3");
    });

    it("computes a fractional difference in hours", async () => {
      expect(
        await value({
          op: "diff",
          iso: "2026-01-01T00:00:00Z",
          to: "2026-01-01T01:30:00Z",
          unit: "hours",
        }),
      ).toBe("1.5");
    });

    it("accepts `from` as an alias for the start instant", async () => {
      expect(
        await value({
          op: "diff",
          from: "2026-01-01T00:00:00Z",
          to: "2026-01-04T00:00:00Z",
          unit: "days",
        }),
      ).toBe("3");
    });

    it("prefers `iso` over `from` when both are supplied", async () => {
      expect(
        await value({
          op: "diff",
          iso: "2026-01-01T00:00:00Z",
          from: "2026-01-03T00:00:00Z",
          to: "2026-01-04T00:00:00Z",
          unit: "days",
        }),
      ).toBe("3");
    });

    it("rejects a missing second instant", async () => {
      const error = await expectError({ op: "diff", iso: "2026-01-01T00:00:00Z", unit: "days" });

      expect((causeOf(error) as DateTimeError).type).toBe("invalid-input");
    });
  });

  describe("schema + naming", () => {
    it("rejects an unknown op at the schema layer", async () => {
      const { error } = await fixedTool().invoke({ op: "sleep" });

      expect(error).toBeDefined();
      expect(error?.message).toMatch(/must be one of/i);
    });

    it("rejects a missing op", async () => {
      const { error } = await fixedTool().invoke({});

      expect(error).toBeDefined();
    });

    it("honors a custom tool name and defaults to date_time", () => {
      expect(dateTimeTool({ name: "clock" }).name).toBe("clock");
      expect(dateTimeTool().name).toBe("date_time");
    });

    it("never throws from invoke()", async () => {
      await expect(fixedTool().invoke({ op: "add", iso: "bad" })).resolves.toMatchObject({
        error: expect.anything(),
      });
    });
  });
});
