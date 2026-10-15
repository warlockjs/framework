import type {
  CheckResult,
  CheckStatus,
  DoctorBootContext,
  DoctorCheck,
  DoctorReport,
} from "./check.types";

/**
 * Run one check defensively: a check that throws (or rejects) is recorded as a
 * `fail` carrying the error message, never re-thrown. This is what keeps
 * `doctor` itself crash-proof — a broken probe degrades to a failed check
 * instead of taking the whole command down.
 *
 * A check that returns `undefined` does not apply to this project; the caller
 * drops it from the report rather than printing a line about nothing.
 */
async function runOne(
  check: DoctorCheck,
  context: DoctorBootContext,
): Promise<CheckResult | undefined> {
  try {
    return await check.run(context);
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
 * Checks run in registration order against ONE shared boot context, so the
 * report can never contain two checks that disagree about the app because they
 * inspected it at different moments. Each is isolated via {@link runOne}, so
 * one throwing check cannot abort the others. The exit code is `1` if any check
 * resolved to `fail`, otherwise `0` — warnings never fail the command.
 *
 * @param checks The diagnostic probes to execute.
 * @param context What the boot pass observed.
 * @returns The aggregated report (results + per-status counts + exit code).
 */
export async function runChecks(
  checks: DoctorCheck[],
  context: DoctorBootContext,
): Promise<DoctorReport> {
  const results: CheckResult[] = [];

  for (const check of checks) {
    const result = await runOne(check, context);

    // `undefined` is "not applicable to this project" — omitted entirely.
    if (result) {
      results.push(result);
    }
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
