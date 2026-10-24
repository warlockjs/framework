import { describe, expect, it } from "vitest";
import { isRequestLogErrorOutcome, shouldKeepRequestLog } from "./should-keep-request-log";

const base = { only: "all", slowMs: 1000, sampleRate: 1 } as const;

describe("shouldKeepRequestLog", () => {
  it("keeps everything with only all", () => {
    expect(shouldKeepRequestLog(base, { status: 200, durationMs: 5 })).toBe(true);
    expect(shouldKeepRequestLog(base, { status: 404, durationMs: 5 })).toBe(true);
  });

  it("keeps only 5xx and thrown requests with only errors", () => {
    const config = { ...base, only: "errors" } as const;

    expect(shouldKeepRequestLog(config, { status: 200, durationMs: 5 })).toBe(false);
    expect(shouldKeepRequestLog(config, { status: 404, durationMs: 5 })).toBe(false);
    expect(shouldKeepRequestLog(config, { status: 503, durationMs: 5 })).toBe(true);
    expect(shouldKeepRequestLog(config, { status: 200, durationMs: 5, failed: true })).toBe(true);
  });

  it("keeps requests of at least slowMs with only slow", () => {
    const config = { ...base, only: "slow", slowMs: 300 } as const;

    expect(shouldKeepRequestLog(config, { status: 200, durationMs: 299 })).toBe(false);
    expect(shouldKeepRequestLog(config, { status: 200, durationMs: 300 })).toBe(true);
    expect(shouldKeepRequestLog(config, { status: 500, durationMs: 10 })).toBe(false);
  });

  it("samples ordinary requests but never an error that only includes", () => {
    const config = { ...base, sampleRate: 0.5 };

    expect(shouldKeepRequestLog(config, { status: 200, durationMs: 1 }, () => 0.49)).toBe(true);
    expect(shouldKeepRequestLog(config, { status: 200, durationMs: 1 }, () => 0.5)).toBe(false);
    expect(shouldKeepRequestLog(config, { status: 500, durationMs: 1 }, () => 0.99)).toBe(true);
    expect(
      shouldKeepRequestLog({ ...config, only: "errors" }, { status: 500, durationMs: 1 }, () => 0.99),
    ).toBe(true);
  });

  it("keeps nothing at sample rate 0 except errors", () => {
    const config = { ...base, sampleRate: 0 };

    expect(shouldKeepRequestLog(config, { status: 200, durationMs: 1 })).toBe(false);
    expect(shouldKeepRequestLog(config, { status: 500, durationMs: 1 })).toBe(true);
  });

  it("recognises error outcomes", () => {
    expect(isRequestLogErrorOutcome({ status: 500, durationMs: 1 })).toBe(true);
    expect(isRequestLogErrorOutcome({ status: 499, durationMs: 1 })).toBe(false);
    expect(isRequestLogErrorOutcome({ status: 200, durationMs: 1, failed: true })).toBe(true);
  });
});
