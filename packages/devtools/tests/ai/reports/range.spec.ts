import { describe, expect, it } from "vitest";
import { parseAiReportQuery } from "../../../src/ai/reports/range";

const H = 3_600_000;
const D = 24 * H;
// 2026-03-10T10:30:00Z
const now = Date.UTC(2026, 2, 10, 10, 30);
const options = { now, retentionDays: 30 };
const nextHour = Date.UTC(2026, 2, 10, 11);

function codeOf(query: Parameters<typeof parseAiReportQuery>[0]): unknown {
  try {
    parseAiReportQuery(query, options);
  } catch (error) {
    return (error as { code?: string }).code;
  }

  return undefined;
}

describe("parseAiReportQuery", () => {
  it("defaults to 24h in 1 hour steps ending at the next hour", () => {
    const { range, previous } = parseAiReportQuery({}, options);

    expect(range).toEqual({
      preset: "24h",
      from: nextHour - D,
      to: nextHour,
      stepMs: H,
      utcOffsetMinutes: 0,
    });
    expect(previous).toEqual({ from: nextHour - 2 * D, to: nextHour - D });
  });

  it("7d uses 6 hour steps (28 buckets)", () => {
    const { range } = parseAiReportQuery({ range: "7d" }, options);

    expect(range.to).toBe(nextHour);
    expect(range.to - range.from).toBe(7 * D);
    expect(range.stepMs).toBe(6 * H);
  });

  it("30d ends at the next local midnight", () => {
    const { range } = parseAiReportQuery({ range: "30d", tz: "180" }, options);

    // 13:30 local on the 10th: next local midnight is 21:00Z on the 10th.
    expect(range.to).toBe(Date.UTC(2026, 2, 10, 21));
    expect(range.to - range.from).toBe(30 * D);
    expect(range.stepMs).toBe(D);
    expect(range.utcOffsetMinutes).toBe(180);
  });

  it("rounds a half-hour offset down to whole hours", () => {
    const { range } = parseAiReportQuery({ range: "30d", tz: "330" }, options);

    expect(range.to).toBe(Date.UTC(2026, 2, 10, 19));
    expect(range.to % H).toBe(0);
  });

  it("aligns custom ranges to hours and picks the step by length", () => {
    const from = Date.UTC(2026, 2, 9, 3, 20);
    const to = Date.UTC(2026, 2, 9, 5, 10);
    const short = parseAiReportQuery(
      { range: "custom", from: String(from), to: String(to) },
      options,
    );

    expect(short.range.from).toBe(Date.UTC(2026, 2, 9, 3));
    expect(short.range.to).toBe(Date.UTC(2026, 2, 9, 6));
    expect(short.range.stepMs).toBe(H);

    const week = parseAiReportQuery(
      { range: "custom", from: String(now - 5 * D), to: String(now) },
      options,
    );
    expect(week.range.stepMs).toBe(6 * H);

    const month = parseAiReportQuery(
      { range: "custom", from: String(now - 20 * D), to: String(now) },
      options,
    );
    expect(month.range.stepMs).toBe(D);
    // Day buckets run from local midnight to local midnight.
    expect(month.range.from).toBe(Date.UTC(2026, 1, 18));
    expect(month.range.to).toBe(Date.UTC(2026, 2, 11));
  });

  it("aligns day-step custom ranges to the browser's midnight, not before the kept history", () => {
    // UTC+3: local midnight is 21:00 UTC the day before.
    const local = parseAiReportQuery(
      { range: "custom", from: String(now - 20 * D), to: String(now), tz: "180" },
      options,
    );

    expect(local.range.from).toBe(Date.UTC(2026, 1, 17, 21));
    expect(local.range.to).toBe(Date.UTC(2026, 2, 10, 21));

    // A start right at the retention cut-off moves to the first midnight inside it.
    const edge = parseAiReportQuery(
      { range: "custom", from: String(Date.UTC(2026, 1, 8, 10)), to: String(now) },
      options,
    );

    expect(edge.range.from).toBe(Date.UTC(2026, 1, 9));
  });

  it("flags a previous period older than the kept history", () => {
    expect(parseAiReportQuery({ range: "7d" }, options).previousComplete).toBe(true);
    expect(parseAiReportQuery({ range: "30d" }, options).previousComplete).toBe(false);
    expect(parseAiReportQuery({ range: "30d" }, { now, retentionDays: 90 }).previousComplete).toBe(
      true,
    );
  });

  it("rejects custom ranges outside the rules", () => {
    expect(codeOf({ range: "custom" })).toBe("ai.range-invalid");
    expect(codeOf({ range: "custom", from: "abc", to: String(now) })).toBe("ai.range-invalid");
    expect(codeOf({ range: "custom", from: String(now), to: String(now - H) })).toBe(
      "ai.range-invalid",
    );
    expect(codeOf({ range: "custom", from: String(now - 31 * D), to: String(now) })).toBe(
      "ai.range-invalid",
    );
    expect(codeOf({ range: "custom", from: String(now - H), to: String(now + 5 * H) })).toBe(
      "ai.range-invalid",
    );
  });

  it("rejects an unknown preset, a bad tz and long filters", () => {
    expect(codeOf({ range: "1y" })).toBe("ai.range-invalid");
    expect(codeOf({ tz: "900" })).toBe("ai.range-invalid");
    expect(codeOf({ tz: "x" })).toBe("ai.range-invalid");
    expect(codeOf({ agent: "a".repeat(201) })).toBe("ai.range-invalid");
    expect(codeOf({ model: "noslash" })).toBe("ai.range-invalid");
  });

  it("splits the model filter at the first slash", () => {
    const parsed = parseAiReportQuery(
      { agent: "support", provider: "openai", model: "openrouter/openai/gpt-4o" },
      options,
    );

    expect(parsed.agent).toBe("support");
    expect(parsed.provider).toBe("openai");
    expect(parsed.model).toEqual({ provider: "openrouter", model: "openai/gpt-4o" });
  });
});
