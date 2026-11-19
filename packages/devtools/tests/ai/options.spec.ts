import { describe, expect, it } from "vitest";
import { resolveDevtoolsAiOptions } from "../../src/ai/options";
import { resolveDevtoolsOptions } from "../../src/options";

describe("resolveDevtoolsAiOptions", () => {
  it("applies the defaults of each mode", () => {
    expect(resolveDevtoolsAiOptions(undefined, "development")).toEqual({
      reports: true,
      retentionDays: 30,
      flushIntervalMs: 60_000,
      mode: "development",
    });
    expect(resolveDevtoolsAiOptions({}, "production")).toEqual({
      reports: true,
      retentionDays: 90,
      flushIntervalMs: 60_000,
      mode: "production",
    });
  });

  it("keeps given values", () => {
    expect(
      resolveDevtoolsAiOptions(
        { reports: false, retentionDays: 400, flushIntervalMs: 5000 },
        "production",
      ),
    ).toMatchObject({ reports: false, retentionDays: 400, flushIntervalMs: 5000 });
  });

  it.each([0, -1, 1.5, 401, Number.NaN])("rejects retentionDays %s", (value) => {
    expect(() => resolveDevtoolsAiOptions({ retentionDays: value }, "development")).toThrow(
      /"ai\.retentionDays"/,
    );
  });

  it.each([0, 4999, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects flushIntervalMs %s",
    (value) => {
      expect(() => resolveDevtoolsAiOptions({ flushIntervalMs: value }, "development")).toThrow(
        /"ai\.flushIntervalMs"/,
      );
    },
  );

  it("rejects a non-boolean reports", () => {
    expect(() => resolveDevtoolsAiOptions({ reports: "yes" as never }, "development")).toThrow(
      /"ai\.reports"/,
    );
  });
});

describe("resolveDevtoolsOptions with ai", () => {
  it("leaves ai out when not given", () => {
    expect("ai" in resolveDevtoolsOptions({})).toBe(false);
  });

  it("passes a valid ai block through", () => {
    expect(resolveDevtoolsOptions({ ai: { retentionDays: 7 } }).ai).toEqual({ retentionDays: 7 });
  });

  it("rejects an invalid ai block", () => {
    expect(() => resolveDevtoolsOptions({ ai: { flushIntervalMs: 10 } })).toThrow(
      /"ai\.flushIntervalMs"/,
    );
  });
});
