import type { CheckResult, CheckStatus, DoctorCheck, DoctorReport } from "./check.types";

/**
 * Run one check defensively: a check that throws (or rejects) is recorded as a
 * `fail` carrying the error message, never re-thrown. This is what keeps
 * `doctor` itself crash-proof — a broken probe degrades to a failed check
 * instead of taking the whole command down.
 */
async function runOne(check: DoctorCheck): Promise<CheckResult> {
  try {
    return await check.run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      name: check.name,
      status: "fail",
      detail: `check threw: ${message}`,
    };
  }
}

/**
 * Run every check and aggregate the results into a {@link DoctorReport}.
 *
 * Checks run in registration order. Each is isolated via {@link runOne}, so one
 * throwing check cannot abort the others. The exit code is `1` if any check
 * resolved to `fail`, otherwise `0` — warnings never fail the command.
 *
 * @param checks The diagnostic probes to execute.
 * @returns The aggregated report (results + per-status counts + exit code).
 */
export async function runChecks(checks: DoctorCheck[]): Promise<DoctorReport> {
  const results: CheckResult[] = [];

  for (const check of checks) {
    results.push(await runOne(check));
  }

  const summary: Record<CheckStatus, number> = { ok: 0, warn: 0, fail: 0 };

  for (const result of results) {
    summary[result.status] += 1;
  }

  const hasFailures = summary.fail > 0;

  return {
    results,
    summary,
    hasFailures,
    exitCode: hasFailures ? 1 : 0,
  };
}
