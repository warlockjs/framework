/**
 * Thrown when the queue is used before `setQueueConfig` (or the queue
 * connector) supplied a configuration.
 */
export class QueueNotConfiguredError extends Error {
  public constructor() {
    super(
      "@warlock.js/queue is not configured. Add src/config/queue.ts exporting a QueueConfig " +
        "and register queueConnector() in warlock.config.ts > connectors, " +
        "or call setQueueConfig() yourself.",
    );
    this.name = "QueueNotConfiguredError";
  }
}

/**
 * Thrown for a malformed duration such as `"10 minutes"`.
 */
export class InvalidDurationError extends Error {
  public constructor(value: unknown) {
    super(
      `Invalid duration ${JSON.stringify(value)}: expected milliseconds as a non-negative number ` +
        `or a string like "500ms", "30s", "10m", "2h", "1d".`,
    );
    this.name = "InvalidDurationError";
  }
}

/**
 * Thrown by `defineJob` for an invalid definition.
 */
export class InvalidJobDefinitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidJobDefinitionError";
  }
}

/**
 * Thrown by `retryFailedJob` when no failed job has the given id.
 */
export class FailedJobNotFoundError extends Error {
  public constructor(id: string, queue: string) {
    super(`No failed job with id "${id}" on queue "${queue}".`);
    this.name = "FailedJobNotFoundError";
  }
}

/**
 * Thrown by `queueDashboard` when an optional bull-board package is not
 * installed.
 */
export class QueueDashboardDependencyError extends Error {
  public constructor(missing: string) {
    super(
      `The queue dashboard needs the optional package "${missing}", which is not installed.\n` +
        "Install both bull-board packages:\n\n" +
        "  npm install @bull-board/api @bull-board/fastify\n",
    );
    this.name = "QueueDashboardDependencyError";
  }
}

/**
 * Throw from a job handler (or a queue context's `restore`) to fail the job
 * permanently — it is not retried, whatever `attempts` allows.
 */
export class UnrecoverableJobError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UnrecoverableJobError";
  }
}

/**
 * The failure recorded when a job attempt outlives its `timeout`. It appears
 * as the failed reason of the attempt and as the abort reason of
 * `ctx.signal`. With `failOnTimeout` the job is not retried.
 */
export class JobTimeoutError extends Error {
  public constructor(
    /** The job name. */
    public readonly jobName: string,
    /** The limit that was exceeded, in milliseconds. */
    public readonly timeout: number,
    /** Whether the job fails without retrying. */
    public readonly failOnTimeout = false,
  ) {
    super(`Job "${jobName}" timed out after ${timeout}ms.`);
    this.name = "JobTimeoutError";
  }
}
