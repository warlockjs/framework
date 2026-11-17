import { describe, expect, it } from "vitest";
import { capReportSize } from "../../../src/production/insights";
import { errorGroup, logEntry, point, report, route, shape } from "./helpers";

const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

function big() {
  return report("a", 1000, {
    logs: Array.from({ length: 50 }, (_, i) => ({ ...logEntry(i), message: "x".repeat(1000) })),
    errors: Array.from({ length: 50 }, (_, i) => errorGroup(`e${i}`, i)),
    routes: Array.from({ length: 200 }, (_, i) => route(`GET /r${i}`, [1, 2, 3])),
    queries: Array.from({ length: 200 }, (_, i) => shape(`q${i}`, [1, 2, 3], { shape: "s".repeat(500) })),
  });
}

describe("capReportSize", () => {
  it("returns a report that fits unchanged", () => {
    const small = report("a", 1);

    expect(capReportSize(small)).toBe(small);
  });

  it("trims logs first, from the end", () => {
    const input = big();
    const limit = size(input) - 20_000;
    const capped = capReportSize(input, limit);

    expect(size(capped)).toBeLessThanOrEqual(limit);
    expect(capped.logs.length).toBeLessThan(50);
    expect(capped.logs.map((l) => l.at)).toEqual(input.logs.slice(0, capped.logs.length).map((l) => l.at));
    expect(capped.errors).toHaveLength(50);
    expect(capped.queries).toHaveLength(200);
  });

  it("moves on to errors, routes and queries in that order", () => {
    const input = big();
    const noLogs = size({ ...input, logs: [] });
    const afterErrors = capReportSize(input, noLogs - 1);

    expect(afterErrors.logs).toHaveLength(0);
    expect(afterErrors.errors.length).toBeLessThan(50);
    expect(afterErrors.routes).toHaveLength(200);

    const tiny = capReportSize(input, 20_000);

    expect(size(tiny)).toBeLessThanOrEqual(20_000);
    expect(tiny.logs).toHaveLength(0);
    expect(tiny.errors).toHaveLength(0);
    expect(tiny.routes.length).toBeLessThan(200);
  });

  it("trims the resource history last", () => {
    const input = big();

    input.resources.history = Array.from({ length: 120 }, (_, i) => point(i));
    const capped = capReportSize(input, 1500);

    expect(capped.queries).toHaveLength(0);
    expect(capped.resources.history.length).toBeLessThan(120);
    expect(size(capped)).toBeLessThanOrEqual(1500);
  });

  it("defaults to 256 KB", () => {
    const input = big();

    input.logs = Array.from({ length: 50 }, (_, i) => ({ ...logEntry(i), message: "x".repeat(20_000) }));
    expect(size(input)).toBeGreaterThan(262_144);
    expect(size(capReportSize(input))).toBeLessThanOrEqual(262_144);
  });
});
