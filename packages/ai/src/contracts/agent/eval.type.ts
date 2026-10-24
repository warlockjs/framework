import type { AgentContract } from "./agent.contract";
import type { AgentExecuteOptions } from "./agent-options.type";
import type { AgentResult } from "../result/agent-result.type";
import type { DatasetContract } from "../../eval/dataset.type";

/**
 * Outcome the scorer assigns to a single case. `score` is a normalized
 * `0..1` quality signal; `passed` is the boolean gate the suite asserts
 * on. A scorer may set `passed` independently of `score` (e.g. a hard
 * threshold) — when it returns only a `score`, the runner derives
 * `passed` from `score >= passThreshold`.
 */
export type EvalScore = {
  /** Normalized quality signal in `[0, 1]`. */
  score: number;
  /**
   * Whether this case counts as a pass. When omitted the runner
   * derives it from `score >= passThreshold`.
   */
  passed?: boolean;
  /** Optional human-readable explanation surfaced in the report. */
  reason?: string;
};

/**
 * Context handed to a {@link EvalScorer} for one case. Carries the
 * case definition, the agent's actual result, and the parsed output /
 * raw text shortcuts so a scorer never has to re-narrow the result
 * union.
 */
export type EvalScorerContext<TOutput = unknown> = {
  /** The case currently being scored. */
  case: EvalCase<TOutput>;
  /** The full `AgentResult` produced by running the case input. */
  result: AgentResult<TOutput>;
  /** Shortcut for `result.data` — the parsed structured output, if any. */
  output?: TOutput;
  /** Shortcut for `result.text` — the raw final-trip text. */
  text?: string;
};

/**
 * Scorer for a single eval case. Returns an {@link EvalScore} (sync or
 * async). Three built-in scorers ship via the `ai.eval` namespace:
 * `exactScorer`, `predicateScorer`, and `judgeScorer` (LLM-as-judge).
 * Custom scorers implement this signature directly.
 */
export type EvalScorer<TOutput = unknown> = (
  context: EvalScorerContext<TOutput>,
) => EvalScore | Promise<EvalScore>;

/**
 * A single evaluation case. `input` is the prompt fed to the agent;
 * `expected` is the optional reference answer exact / judge scorers
 * compare against. `scorers` overrides the suite-level scorer list for
 * this case only; `options` overrides the per-call execute options.
 */
export type EvalCase<TOutput = unknown> = {
  /** Stable identifier for the case — surfaced in the report. */
  name: string;
  /** Prompt fed to `agent.execute(input)`. */
  input: string;
  /**
   * Reference answer the default scorers compare against. Free-form —
   * a string for text comparison, a structured value for output
   * comparison, or omitted when the scorer is purely predicate-based.
   */
  expected?: unknown;
  /**
   * Optional grouping label. Reports carry pass-rate and mean-score
   * statistics per category, so a weak area stays visible next to a
   * healthy aggregate.
   */
  category?: string;
  /** Per-case scorer override. Falls back to the suite `scorers`. */
  scorers?: EvalScorer<TOutput>[];
  /** Per-case execute-options override merged over the suite default. */
  options?: AgentExecuteOptions<TOutput>;
};

/**
 * LLM-as-judge configuration. When supplied to `agent.eval`, the
 * judge agent scores every case that has no explicit `scorers`. The
 * judge receives the case input, the expected reference (if any), and
 * the actual output, and returns a `{ score, passed?, reason? }`
 * verdict.
 *
 * `agent` must be name-bearing and configured with an output schema
 * matching the judge verdict shape — the runner extracts `score` /
 * `passed` / `reason` from `result.data`, falling back to parsing the
 * raw text when no schema is set.
 */
export type EvalJudge = {
  /** The judge agent. Runs once per case scored by the judge. */
  agent: AgentContract<unknown>;
  /**
   * Optional rubric prepended to the judge prompt — the criteria the
   * judge grades against ("score 1.0 only if the answer cites a
   * source", etc.).
   */
  rubric?: string;
  /**
   * Score at or above which the judge verdict counts as a pass when
   * the judge returns only a numeric score. Defaults to the suite
   * `passThreshold`.
   */
  passThreshold?: number;
};

/**
 * Options for `agent.eval`.
 *
 * `cases` is the suite; `scorers` is the default scorer list applied
 * to every case lacking its own; `judge` enables LLM-as-judge scoring
 * for cases with neither. At least one of `scorers` / `judge` must be
 * resolvable per case or the runner throws at author time.
 */
export type EvalOptions<TOutput = unknown> = {
  /**
   * The evaluation cases to run. Either a raw `EvalCase[]` or a
   * {@link DatasetContract} (from `ai.dataset(...)`) — the runner reads
   * `.cases` off a dataset.
   */
  cases: EvalCase<TOutput>[] | DatasetContract<TOutput>;
  /** Default scorers applied to every case without its own `scorers`. */
  scorers?: EvalScorer<TOutput>[];
  /** LLM-as-judge fallback for cases with no scorers. */
  judge?: EvalJudge;
  /**
   * Score at or above which a case passes when a scorer returns only a
   * numeric `score` (no explicit `passed`). Defaults to `0.5`.
   */
  passThreshold?: number;
  /**
   * Fired once per failing case, after it is scored. Receives the
   * full case result so suites can log, snapshot, or accumulate
   * failures. Errors thrown here are swallowed so a reporting bug
   * cannot abort the run.
   */
  onFailure?: (caseResult: EvalCaseResult<TOutput>) => void | Promise<void>;
  /** Execute-options applied to every case (merged under per-case `options`). */
  executeOptions?: AgentExecuteOptions<TOutput>;
  /**
   * A prior {@link EvalReport} to diff against. When set, the new report
   * carries a `regression` block flagging cases whose score dropped more
   * than `tolerance` below the baseline.
   */
  baseline?: EvalReport<TOutput>;
  /**
   * Maximum allowed per-case score drop vs baseline before it counts as a
   * regression. Only consulted when `baseline` is set. Defaults to `0`
   * (any drop is a regression).
   */
  tolerance?: number;
  /**
   * How many times every case runs. Runs execute one after another, in
   * case order, repeating each case `repeat` times before the next. A case
   * passes only when all of its runs pass; `passes` / `repeat` on the case
   * result shows how many did. Defaults to `1` (single run, unchanged
   * behavior).
   */
  repeat?: number;
  /**
   * Confidence level of the reported intervals, in `(0, 1)`. Defaults to
   * `0.95`.
   */
  confidence?: number;
  /**
   * How a `baseline` is compared. `"point"` (default) flags a case whose
   * score dropped more than `tolerance` below its baseline score.
   * `"interval"` flags a case or metric only when the baseline's lower
   * confidence bound sits above the current upper bound by more than
   * `tolerance` (the two intervals are separated), so run-to-run noise is
   * not reported as a regression.
   * Cases with fewer than two runs have no interval and fall back to the
   * point rule.
   */
  gate?: "point" | "interval";
  /**
   * When `true`, any stable failure (a case failing in every one of
   * `repeat > 1` runs) fails the regression verdict on its own. Requires a
   * `baseline`; without one, read `report.stableFailures` directly.
   */
  failOnStableFailures?: boolean;
};

/** Closed confidence interval `[low, high]`, both bounds in `[0, 1]`. */
export type EvalInterval = {
  low: number;
  high: number;
};

/**
 * Statistics of one group of runs (the whole suite, or one category).
 * Every run of every case is one sample.
 */
export type EvalMetricStats = {
  /** Number of samples (cases x repeat). */
  runs: number;
  /** Samples that passed. */
  passes: number;
  /** `passes / runs`. */
  passRate: number;
  /** Wilson score interval of the pass rate. */
  passRateInterval: EvalInterval;
  /** Mean score across samples. */
  meanScore: number;
  /** Student-t interval of the mean score, clamped to `[0, 1]`. */
  meanScoreInterval: EvalInterval;
};

/** Overall and per-category statistics attached to an {@link EvalReport}. */
export type EvalStats = {
  /** Confidence level the intervals were computed at. */
  confidence: number;
  overall: EvalMetricStats;
  /** Keyed by `EvalCase.category`; cases without a category are not listed. */
  categories: Record<string, EvalMetricStats>;
};

/** Lightweight record of one run of a case (kept in serialized reports). */
export type EvalCaseRun = {
  score: number;
  passed: boolean;
  duration: number;
};

/**
 * Regression verdict attached to an {@link EvalReport} when `agent.eval`
 * is called with a `baseline`. Cases are joined by `name`.
 */
export type EvalRegression = {
  /**
   * Cases whose score fell more than `tolerance` below the baseline,
   * carrying the before/after scores.
   */
  regressed: Array<{ name: string; before: number; after: number }>;
  /**
   * Interval gate only: the overall or per-category metrics whose baseline
   * interval lies above the current interval by more than `tolerance`.
   * `scope` is `"overall"` or `"category:<name>"`.
   */
  regressedMetrics?: Array<{
    scope: string;
    metric: "passRate" | "meanScore";
    before: number;
    after: number;
    interval: EvalInterval;
  }>;
  /** Cases that failed every run of a repeated eval (`repeat > 1`). */
  stableFailures?: string[];
  /** Cases that passed some runs and failed others (`repeat > 1`). */
  flaky?: string[];
  /** Case names present in the baseline but absent in the new report. */
  removed: string[];
  /** Case names present in the new report but absent in the baseline. */
  added: string[];
  /**
   * `true` when no case or metric regressed beyond tolerance (and, with
   * `failOnStableFailures`, no stable failure exists).
   */
  passed: boolean;
};

/**
 * Per-case outcome in an {@link EvalReport}. Bundles the case, the
 * agent result, the resolved scores, and the case-level pass/fail
 * verdict (the AND of every scorer's `passed`).
 */
export type EvalCaseResult<TOutput = unknown> = {
  /** The case that produced this result. */
  case: EvalCase<TOutput>;
  /** The full agent result for the case input. */
  result: AgentResult<TOutput>;
  /** Every scorer's verdict, in scorer order. */
  scores: EvalScore[];
  /** Mean of `scores[].score` — the case's aggregate quality signal. */
  score: number;
  /** `true` only when EVERY scorer passed and the agent did not error. */
  passed: boolean;
  /** Wall-clock duration of the case (all runs) in milliseconds. */
  duration: number;
  /** Number of times the case ran. Absent in reports from before repeats. */
  repeat?: number;
  /** Runs that passed, e.g. `2` of `repeat: 3`. */
  passes?: number;
  /** Per-run score, verdict and duration, in run order. */
  runs?: EvalCaseRun[];
  /** Student-t interval of the case's run scores (`[0, 1]` when under two runs). */
  scoreInterval?: EvalInterval;
  /** Wilson interval of the case's per-run pass rate. */
  passRateInterval?: EvalInterval;
};

/**
 * Aggregate report returned by `agent.eval`. Summarizes pass rate and
 * mean score across the suite and carries every per-case result for
 * drill-down. Assertion-friendly: `expect(report.passed).toBe(true)`.
 */
export type EvalReport<TOutput = unknown> = {
  /** Name of the agent under evaluation. */
  agentName: string;
  /** Total number of cases run. */
  total: number;
  /** Number of cases that passed. */
  passedCount: number;
  /** Number of cases that failed. */
  failedCount: number;
  /** `passedCount / total` in `[0, 1]`. */
  passRate: number;
  /** Mean of every case's aggregate `score`. */
  meanScore: number;
  /** `true` only when every case passed. */
  passed: boolean;
  /** Runs per case. Absent in reports from before repeats. */
  repeat?: number;
  /** Pooled pass-rate / mean-score statistics with confidence intervals. */
  stats?: EvalStats;
  /** Cases that failed every run (only when `repeat > 1`). */
  stableFailures?: string[];
  /** Cases that passed some runs and failed others (only when `repeat > 1`). */
  flakyCases?: string[];
  /** Per-case results in suite order. */
  cases: EvalCaseResult<TOutput>[];
  /** Total wall-clock duration of the whole suite in milliseconds. */
  duration: number;
  /**
   * Regression diff vs a baseline. Present only when `agent.eval` was
   * called with a `baseline`.
   */
  regression?: EvalRegression;
};
