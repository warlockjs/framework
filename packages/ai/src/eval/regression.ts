import type {
  EvalCaseResult,
  EvalMetricStats,
  EvalRegression,
  EvalReport,
} from "../contracts/agent/eval.type";
import { caseScoreInterval, computeStats, DEFAULT_CONFIDENCE, samplesOf } from "./statistics";

/** Options for {@link diff}. */
export type DiffOptions = {
  /**
   * Slack allowed before a drop counts as a regression. Point gate: the max
   * score drop. Interval gate: how far the baseline value must sit above the
   * upper bound of the current confidence interval. Defaults to `0`.
   */
  tolerance?: number;
  /** `"point"` (default) or `"interval"`; see `EvalOptions.gate`. */
  gate?: "point" | "interval";
  /** Confidence level for intervals computed here. Defaults to `0.95`. */
  confidence?: number;
  /** Fail the verdict when any case failed every run of a repeated eval. */
  failOnStableFailures?: boolean;
};

/**
 * Diff a fresh {@link EvalReport} against a `baseline`, joining cases by
 * name, to produce an {@link EvalRegression} verdict.
 *
 * **Point gate (default).** A case **regresses** when its new aggregate
 * `score` is more than `tolerance` below its baseline score
 * (`before - after > tolerance`).
 *
 * **Interval gate.** Run-to-run noise makes a single comparison unreliable,
 * so a case (or an overall / per-category pass rate or mean score) regresses
 * only when the **baseline interval and the current interval are separated**:
 * the baseline's lower bound sits above the current upper bound by more than
 * `tolerance` (`before.low > now.high + tolerance`). Pass rates use Wilson
 * intervals, mean scores use Student-t intervals. Both samples' uncertainty
 * counts, so small samples (wide intervals) rarely trip the gate. A side with
 * fewer than two samples has no usable interval: the baseline then
 * contributes its point value, and a current case with fewer than two runs
 * uses the point rule. Baselines recorded without runs or stats are read as
 * one sample per case.
 *
 * Cases present in only one of the two reports are surfaced under `added` /
 * `removed` rather than treated as regressions. When the new report was run
 * with `repeat > 1`, cases failing every run are listed under
 * `stableFailures` and cases failing some runs under `flaky`.
 *
 * Pure — mutates neither input.
 *
 * @param report - The newly produced report.
 * @param baseline - A prior report to compare against.
 * @param options - A {@link DiffOptions} object, or just the tolerance
 *   number (point gate).
 *
 * @example
 * const regression = diff(report, baseline, 0.05);
 * expect(regression.passed).toBe(true);
 *
 * @example
 * const regression = diff(report, baseline, { gate: "interval", tolerance: 0.02 });
 */
export function diff<TOutput = unknown>(
  report: EvalReport<TOutput>,
  baseline: EvalReport<TOutput>,
  options: number | DiffOptions = {},
): EvalRegression {
  const resolved: DiffOptions = typeof options === "number" ? { tolerance: options } : options;
  const tolerance = resolved.tolerance ?? 0;
  const confidence = resolved.confidence ?? report.stats?.confidence ?? DEFAULT_CONFIDENCE;
  const useInterval = resolved.gate === "interval";
  const baselineScores = new Map<string, number>();
  const baselineEntries = new Map<string, EvalCaseResult<TOutput>>();

  for (const entry of baseline.cases) {
    baselineScores.set(entry.case.name, entry.score);
    baselineEntries.set(entry.case.name, entry);
  }

  const currentNames = new Set<string>();
  const regressed: EvalRegression["regressed"] = [];

  for (const entry of report.cases) {
    const name = entry.case.name;
    currentNames.add(name);

    const before = baselineScores.get(name);

    if (before === undefined) {
      continue;
    }

    const interval =
      useInterval && samplesOf(entry).length >= 2
        ? caseScoreInterval(entry, confidence)
        : undefined;
    const reference = baselineEntries.get(name);
    const floor =
      reference && samplesOf(reference).length >= 2
        ? caseScoreInterval(reference, confidence).low
        : before;
    const exceeded = interval
      ? floor > interval.high + tolerance
      : before - entry.score > tolerance;

    if (exceeded) {
      regressed.push({ name, before, after: entry.score });
    }
  }

  const removed = baseline.cases
    .map((entry) => entry.case.name)
    .filter((name) => !currentNames.has(name));

  const added = report.cases
    .map((entry) => entry.case.name)
    .filter((name) => !baselineScores.has(name));

  const regressedMetrics: NonNullable<EvalRegression["regressedMetrics"]> = [];

  if (useInterval) {
    const current = computeStats(report.cases, confidence);
    const previous = computeStats(baseline.cases, confidence);

    const compare = (scope: string, now: EvalMetricStats, before: EvalMetricStats) => {
      const passFloor = before.runs >= 2 ? before.passRateInterval.low : before.passRate;
      const scoreFloor = before.runs >= 2 ? before.meanScoreInterval.low : before.meanScore;

      if (passFloor > now.passRateInterval.high + tolerance) {
        regressedMetrics.push({
          scope,
          metric: "passRate",
          before: before.passRate,
          after: now.passRate,
          interval: now.passRateInterval,
        });
      }

      if (scoreFloor > now.meanScoreInterval.high + tolerance) {
        regressedMetrics.push({
          scope,
          metric: "meanScore",
          before: before.meanScore,
          after: now.meanScore,
          interval: now.meanScoreInterval,
        });
      }
    };

    compare("overall", current.overall, previous.overall);

    for (const [category, now] of Object.entries(current.categories)) {
      const before = previous.categories[category];

      if (before) {
        compare(`category:${category}`, now, before);
      }
    }
  }

  const regression: EvalRegression = {
    regressed,
    removed,
    added,
    passed: regressed.length === 0 && regressedMetrics.length === 0,
  };

  if (useInterval) {
    regression.regressedMetrics = regressedMetrics;
  }

  if ((report.repeat ?? 1) > 1) {
    regression.stableFailures = report.cases
      .filter((entry) => samplesOf(entry).every((run) => !run.passed))
      .map((entry) => entry.case.name);
    regression.flaky = report.cases
      .filter((entry) => {
        const runs = samplesOf(entry);

        return runs.some((run) => run.passed) && runs.some((run) => !run.passed);
      })
      .map((entry) => entry.case.name);

    if (resolved.failOnStableFailures && regression.stableFailures.length > 0) {
      regression.passed = false;
    }
  }

  return regression;
}
