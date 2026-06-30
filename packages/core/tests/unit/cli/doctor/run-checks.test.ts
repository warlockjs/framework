import { describe, expect, it } from "vitest";
import type { CheckResult, DoctorCheck } from "../../../../src/cli/commands/doctor/check.types";
import { runChecks } from "../../../../src/cli/commands/doctor/run-checks";

/**
 * Unit coverage for the doctor check RUNNER — the aggregation contract:
 * per-status counts, the failure→exit-code mapping, ordering preservation, and
 * the crash-proofing guarantee that a throwing check becomes a `fail` result
 * rather than propagating out of the runner.
 */

const okCheck = (name: string): DoctorCheck => ({
  name,
  run: (): CheckResult => ({ name, status: "ok", detail: "fine" }),
});

const warnCheck = (name: string): DoctorCheck => ({
  name,
  run: (): CheckResult => ({ name, status: "warn", detail: "soft" }),
});

const failCheck = (name: string): DoctorCheck => ({
  name,
  run: (): CheckResult => ({ name, status: "fail", detail: "broken" }),
});

const throwingCheck = (name: string, message: string): DoctorCheck => ({
  name,
  run: (): CheckResult => {
    throw new Error(message);
  },
});

describe("runChecks aggregation", () => {
  it("counts each status and preserves registration order", async () => {
    const report = await runChecks([okCheck("a"), warnCheck("b"), okCheck("c")]);

    expect(report.results.map((result) => result.name)).toEqual(["a", "b", "c"]);
    expect(report.summary).toEqual({ ok: 2, warn: 1, fail: 0 });
  });

  it("exits 0 and reports no failures when only ok/warn results exist", async () => {
    const report = await runChecks([okCheck("a"), warnCheck("b")]);

    expect(report.hasFailures).toBe(false);
    expect(report.exitCode).toBe(0);
  });

  it("exits 1 and flags failures when any check fails", async () => {
    const report = await runChecks([okCheck("a"), failCheck("b"), warnCheck("c")]);

    expect(report.summary).toEqual({ ok: 1, warn: 1, fail: 1 });
    expect(report.hasFailures).toBe(true);
    expect(report.exitCode).toBe(1);
  });
});

describe("runChecks crash-proofing", () => {
  it("records a thrown check as a fail result instead of throwing", async () => {
    const report = await runChecks([okCheck("a"), throwingCheck("boom", "kaboom")]);

    const boom = report.results.find((result) => result.name === "boom");

    expect(boom).toBeDefined();
    expect(boom?.status).toBe("fail");
    expect(boom?.detail).toContain("kaboom");
    // the healthy check still ran
    expect(report.results.find((result) => result.name === "a")?.status).toBe("ok");
    expect(report.exitCode).toBe(1);
  });

  it("a throwing check never aborts the checks that follow it", async () => {
    const report = await runChecks([
      throwingCheck("first", "nope"),
      okCheck("second"),
      okCheck("third"),
    ]);

    expect(report.results.map((result) => result.name)).toEqual(["first", "second", "third"]);
    expect(report.summary).toEqual({ ok: 2, warn: 0, fail: 1 });
  });

  it("handles an async check that rejects", async () => {
    const rejectingCheck: DoctorCheck = {
      name: "async-fail",
      run: async (): Promise<CheckResult> => {
        throw new Error("async boom");
      },
    };

    const report = await runChecks([rejectingCheck]);

    expect(report.results[0].status).toBe("fail");
    expect(report.results[0].detail).toContain("async boom");
  });
});
