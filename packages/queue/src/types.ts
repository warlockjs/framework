import type { ConnectionOptions } from "bullmq";

/** Units accepted in a {@link Duration} string. */
export type DurationUnit = "ms" | "s" | "m" | "h" | "d";

/**
 * A duration: milliseconds as a number, or a string such as `"500ms"`,
 * `"30s"`, `"10m"`, `"2h"`, `"1d"`.
 */
export type Duration = number | `${number}${DurationUnit}`;

/**
 * How a failed attempt waits before the next one. A number is a fixed delay in
 * milliseconds.
 */
export type JobBackoff =
  | number
  | {
      /** `fixed` waits `delay` every time; `exponential` waits `delay * 2^(attempt - 1)`. */
      type: "fixed" | "exponential";
      /** Base delay in milliseconds. */
      delay: number;
    };

/**
 * How many finished jobs to keep: `true` removes them immediately, `false`
 * keeps them all, a number keeps the newest N.
 */
export type JobRetention = boolean | number;

/**
 * Options that shape how a job is retried and retained. Set app-wide in
 * `queue.defaultJobOptions`, per job in `defineJob`.
 */
export type JobOptions = {
  /** Total attempts including the first. Default `1` (no retry). */
  attempts?: number;
  /** Wait between attempts. */
  backoff?: JobBackoff;
  /** Retention for completed jobs. Default keeps them. */
  removeOnComplete?: JobRetention;
  /** Retention for failed jobs. Default keeps them, so `failedJobs()` can list them. */
  removeOnFail?: JobRetention;
};

/**
 * In-process worker settings.
 */
export type QueueWorkersConfig = {
  /**
   * Start workers in this process. Default `true`. Set `false` for a process
   * that only dispatches jobs while another process consumes them.
   */
  enabled?: boolean;
  /** Jobs processed in parallel per queue. Default `1`. */
  concurrency?: number;
  /**
   * How long shutdown waits for active jobs before force-closing the workers,
   * in milliseconds. Default `30000`.
   */
  shutdownTimeout?: number;
};

/**
 * The `queue` configuration key — `src/config/queue.ts`.
 */
export type QueueConfig = {
  /**
   * Redis connection. Any BullMQ connection option: `{ host, port, password, db }`,
   * `{ url }`, or an ioredis instance.
   */
  connection: ConnectionOptions;
  /** Redis key prefix for every queue. Default `"warlock"`. */
  prefix?: string;
  /** Queue name used when a job does not name one. Default `"default"`. */
  defaultQueue?: string;
  /** Defaults merged under every job's own options. */
  defaultJobOptions?: JobOptions;
  /** In-process workers. */
  workers?: QueueWorkersConfig;
};

/** A progress value: a number (e.g. a percentage) or a JSON object. */
export type JobProgress = number | Record<string, unknown>;

/**
 * What a job handler receives beside its payload.
 */
export type JobContext = {
  /** The job id. */
  id: string;
  /** The job name given to `defineJob`. */
  name: string;
  /** The queue the job runs on. */
  queue: string;
  /** The current attempt, starting at `1`. */
  attempt: number;
  /** Total attempts allowed. */
  maxAttempts: number;
  /** Record progress; readable through `job.find(id)`. */
  progress(value: JobProgress): Promise<void>;
  /** Append a line to the job's log. */
  log(line: string): Promise<void>;
};

/**
 * The definition passed to `defineJob`.
 */
export type JobDefinition<TPayload, TResult> = JobOptions & {
  /** Unique job name, e.g. `"invoices.send"`. */
  name: string;
  /** Queue to run on. Default: `queue.defaultQueue` (`"default"`). */
  queue?: string;
  /** The work. Throw to fail the attempt; the return value is stored as the job result. */
  handle(payload: TPayload, context: JobContext): Promise<TResult> | TResult;
};

/**
 * Per-dispatch options.
 */
export type DispatchOptions = {
  /** Wait before the job becomes available. */
  delay?: Duration;
  /**
   * Priority: `1` is the highest; larger numbers run later. Omit for no
   * priority — such jobs run ahead of every prioritized job.
   */
  priority?: number;
  /**
   * Explicit job id. Dispatching again with an id that still exists is a
   * no-op, which makes dispatch idempotent.
   */
  jobId?: string;
  /** Override the job's attempts for this dispatch. */
  attempts?: number;
  /** Override the job's backoff for this dispatch. */
  backoff?: JobBackoff;
};

/** What `dispatch` resolves with. */
export type DispatchedJob = {
  id: string;
  name: string;
  queue: string;
};

/** A job's lifecycle state. */
export type JobState =
  | "waiting"
  | "delayed"
  | "prioritized"
  | "active"
  | "completed"
  | "failed"
  | "waiting-children"
  | "unknown";

/** A point-in-time view of a job. */
export type JobSnapshot<TPayload = unknown, TResult = unknown> = {
  id: string;
  name: string;
  queue: string;
  state: JobState;
  payload: TPayload;
  progress: JobProgress;
  attemptsMade: number;
  result?: TResult;
  failedReason?: string;
  createdAt: Date;
  finishedAt?: Date;
};

/** A failed job, with the means to retry it. */
export type FailedJob<TPayload = unknown> = {
  id: string;
  name: string;
  queue: string;
  payload: TPayload;
  attemptsMade: number;
  failedReason: string;
  stacktrace: string[];
  failedAt?: Date;
  /** Move the job back to waiting so a worker picks it up again. */
  retry(): Promise<void>;
};

/**
 * A job returned by `defineJob`.
 */
export type QueueJob<TPayload, TResult = unknown> = {
  readonly name: string;
  readonly queue: string;
  /** Enqueue the job. */
  dispatch(payload: TPayload, options?: DispatchOptions): Promise<DispatchedJob>;
  /** Read a job of this type by id; `undefined` when it no longer exists. */
  find(id: string): Promise<JobSnapshot<TPayload, TResult> | undefined>;
};
