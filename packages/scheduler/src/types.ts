/**
 * Time unit types for scheduling intervals
 */
export type TimeType = "second" | "minute" | "hour" | "day" | "week" | "month" | "year";

/**
 * Days of the week (lowercase for consistency)
 */
export type Day =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

/**
 * How the day-of-month constraint is interpreted.
 *
 * - `"specific"` — `day` is a fixed day number (1–31).
 * - `"last"` — recompute each cycle as the last day of the current month
 *   (so `endOf("month")` is correct in February vs. March).
 */
export type DayOfMonthMode = "specific" | "last";

/**
 * Job interval configuration
 */
export type JobIntervals = {
  /** Day of week (string) or day of month (1–31) */
  day?: Day | number;
  /**
   * Day-of-month interpretation. Defaults to `"specific"` when `day` is a
   * number. `"last"` overrides `day` and resolves to `daysInMonth()` per cycle.
   */
  dayOfMonthMode?: DayOfMonthMode;
  /** Month constraint (1–12). Used by `beginOf`/`endOf` of `"year"`. */
  month?: number;
  /** Time of day in HH:mm or HH:mm:ss format */
  time?: string;
  /** Recurring interval configuration */
  every?: {
    type?: TimeType;
    value?: number;
  };
};

/**
 * Result of a job execution
 */
export type JobResult = {
  /** Whether the job completed successfully */
  success: boolean;
  /** Execution duration in milliseconds */
  duration: number;
  /** Error if the job failed */
  error?: unknown;
  /** Number of retry attempts made */
  retries?: number;
  /** True when the run was skipped (e.g. another server held the `onOneServer()` lock) */
  skipped?: boolean;
  /** Why the run was skipped; absent for the `onOneServer()` lock skip */
  skipReason?: string;
};

/**
 * How one recorded run ended
 */
export type JobRunOutcome = "success" | "failed" | "skipped";

/**
 * One entry of a job's run history. Holds the message only, never the stack.
 */
export type JobRunRecord = {
  /** When the run started (epoch ms) */
  startedAt: number;
  /** How long it took in milliseconds (0 for an overlap skip) */
  durationMs: number;
  outcome: JobRunOutcome;
  /** Error message of a failed run (cut to 500 characters) */
  error?: string;
  /** Why a skipped run did not execute */
  skipReason?: string;
};

/**
 * Running totals of a job since the process started
 */
export type JobStats = {
  /** Executed runs (successful and failed; skipped runs are not counted) */
  runs: number;
  /** Runs that ended in an error */
  failures: number;
  /** Ticks skipped (overlap prevention, another server held the lock, a hook declined) */
  skips: number;
  /** Start time of the last executed run (epoch ms) */
  lastRunAt: number | null;
  /** Duration of the last executed run */
  lastDurationMs: number | null;
  /** Message of the last failure, cleared by the next successful run */
  lastError: string | null;
  /** Outcome of the last recorded entry */
  lastOutcome: JobRunOutcome | null;
};

/**
 * Job execution status
 */
export type JobStatus = "idle" | "running" | "completed" | "failed";

/**
 * Retry configuration for jobs
 */
export type RetryConfig = {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Delay between retries in milliseconds */
  delay: number;
  /** Backoff multiplier for exponential backoff */
  backoffMultiplier?: number;
};

/**
 * Scheduler event types for observability
 */
export type SchedulerEvents = {
  "job:start": [jobName: string];
  "job:complete": [jobName: string, result: JobResult];
  "job:error": [jobName: string, error: unknown];
  "job:skip": [jobName: string, reason: string];
  "scheduler:started": [];
  "scheduler:stopped": [];
  "scheduler:tick": [timestamp: Date];
};
