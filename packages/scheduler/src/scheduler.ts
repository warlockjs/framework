import { EventEmitter } from "node:events";
import { Job } from "./job";
import type { JobAroundHook, JobCallback } from "./job";
import { hasWorkerRole, rolesLabel } from "./process-roles";
import { trackRunningScheduler, untrackRunningScheduler } from "./running-schedulers";
import type { JobResult, SchedulerEvents } from "./types";

/**
 * Type-safe event emitter interface for Scheduler events
 */
interface TypedEventEmitter<TEvents extends Record<string, unknown[]>> {
  on<K extends keyof TEvents>(event: K, listener: (...args: TEvents[K]) => void): this;
  once<K extends keyof TEvents>(event: K, listener: (...args: TEvents[K]) => void): this;
  off<K extends keyof TEvents>(event: K, listener: (...args: TEvents[K]) => void): this;
  emit<K extends keyof TEvents>(event: K, ...args: TEvents[K]): boolean;
}

/**
 * Scheduler class manages and executes scheduled jobs.
 *
 * Features:
 * - Event-based observability
 * - Jobs run off the tick: the tick never waits for a running job
 * - One-at-a-time (default) or concurrent, capped job execution
 * - Drift compensation for accurate timing
 * - Graceful shutdown with job draining
 *
 * @example
 * ```typescript
 * const scheduler = new Scheduler();
 *
 * scheduler.on('job:error', (jobName, error) => {
 *   logger.error(`Job ${jobName} failed:`, error);
 * });
 *
 * scheduler
 *   .addJob(cleanupJob)
 *   .addJob(reportJob)
 *   .runInParallel(true)
 *   .start();
 *
 * // Graceful shutdown
 * process.on('SIGTERM', () => scheduler.shutdown());
 * ```
 */
export class Scheduler
  extends (EventEmitter as new () => TypedEventEmitter<SchedulerEvents>)
  implements TypedEventEmitter<SchedulerEvents>
{
  // ─────────────────────────────────────────────────────────────────────────────
  // Private Properties
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * List of registered jobs
   */
  private _jobs: Job[] = [];

  /**
   * Hooks wrapping every callback execution, first registered = outermost
   */
  private _aroundHooks: readonly JobAroundHook[] = [];

  /**
   * Reference to the current timeout for stopping
   */
  private _timeoutId: NodeJS.Timeout | null = null;

  /**
   * Tick interval in milliseconds (how often to check for due jobs)
   */
  private _tickInterval = 1000;

  /**
   * Whether due jobs may run side by side (up to `_maxConcurrency`) or one at a time
   */
  private _runInParallel = false;

  /**
   * Maximum concurrent jobs when running in parallel
   */
  private _maxConcurrency = 10;

  /**
   * Due jobs waiting for a free slot, in the order they will start
   */
  private _pending: Job[] = [];

  /**
   * One-at-a-time mode: a tick fired while a job was running, so the due jobs
   * are collected as soon as the running batch finishes
   */
  private _tickDeferred = false;

  /**
   * Runs started by the scheduler that have not settled yet
   */
  private _inFlight = new Set<Promise<void>>();

  /**
   * Flag indicating scheduler is shutting down
   */
  private _isShuttingDown = false;

  /**
   * Whether `start()` has ever been called on this scheduler.
   *
   * Distinct from `isRunning`: it stays `true` after `stop()`, so the
   * registered-but-never-started warning never fires once the scheduler has
   * been started at least once.
   */
  private _hasStarted = false;

  /**
   * One-shot deferred timer that warns when jobs are registered but
   * `start()` is never called. Armed on the first `addJob`/`addJobs` and
   * cleared by `start()` (or once it has fired).
   */
  private _startWarningTimer: NodeJS.Timeout | null = null;

  // ─────────────────────────────────────────────────────────────────────────────
  // Public Getters
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Returns true if the scheduler is currently running
   */
  public get isRunning(): boolean {
    return this._timeoutId !== null;
  }

  /**
   * Returns the number of registered jobs
   */
  public get jobCount(): number {
    return this._jobs.length;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Configuration Methods (Fluent API)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Add a job to the scheduler
   *
   * @param job - Job instance to schedule
   * @returns this for chaining
   */
  public addJob(job: Job): this {
    job.bindAroundHooks(() => this._aroundHooks);
    this._jobs.push(job);

    if (this.isRunning) {
      job.prepare();
    }

    this._armStartWarning();

    return this;
  }

  /**
   * Wrap every job callback execution (each retry attempt included) in a hook.
   *
   * The first registered hook is the outermost. A hook that never calls `run`
   * skips the execution (`job:skip` is emitted); a hook that throws is treated
   * like a callback error.
   *
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * scheduler.around((job, run) => storage.run({ job: job.name }, run));
   * ```
   */
  public around(hook: JobAroundHook): () => void {
    this._aroundHooks = [...this._aroundHooks, hook];

    return () => {
      this._aroundHooks = this._aroundHooks.filter((item) => item !== hook);
    };
  }

  /**
   * Alias to create a new job directly and store it
   */
  public newJob(name: string, jobCallback: JobCallback) {
    const job = new Job(name, jobCallback);
    this.addJob(job);
    return job;
  }

  /**
   * Add multiple jobs to the scheduler.
   *
   * If the scheduler is already running, every newly-added job is prepared
   * (its initial `nextRun` is computed) so it begins firing on the next tick.
   *
   * @param jobs - Array of Job instances
   * @returns this for chaining
   */
  public addJobs(jobs: Job[]): this {
    for (const job of jobs) {
      job.bindAroundHooks(() => this._aroundHooks);
    }

    this._jobs.push(...jobs);

    if (this.isRunning) {
      for (const job of jobs) {
        job.prepare();
      }
    }

    this._armStartWarning();

    return this;
  }

  /**
   * Remove a job from the scheduler by name
   *
   * @param jobName - Name of the job to remove
   * @returns true if job was found and removed
   */
  public removeJob(jobName: string): boolean {
    const index = this._jobs.findIndex((j) => j.name === jobName);

    if (index !== -1) {
      this._jobs.splice(index, 1);
      return true;
    }

    return false;
  }

  /**
   * Get a job by name
   *
   * @param jobName - Name of the job to find
   * @returns Job instance or undefined
   */
  public getJob(jobName: string): Job | undefined {
    return this._jobs.find((j) => j.name === jobName);
  }

  /**
   * Get all registered jobs
   *
   * @returns Array of registered jobs (readonly)
   */
  public list(): readonly Job[] {
    return this._jobs;
  }

  /**
   * Set the tick interval (how often to check for due jobs)
   *
   * @param ms - Interval in milliseconds (minimum 100ms)
   * @returns this for chaining
   */
  public runEvery(ms: number): this {
    if (ms < 100) {
      throw new Error("Tick interval must be at least 100ms");
    }

    this._tickInterval = ms;
    return this;
  }

  /**
   * Configure how many due jobs may run at once.
   *
   * By default jobs run one at a time: jobs that become due while one runs
   * wait for it and then run in registration order. Pass `true` to run due
   * jobs side by side (at most `maxConcurrency` at once), so one long job no
   * longer holds back the others. Either way the scheduler keeps ticking while
   * jobs run, and a job never overlaps itself (a due job that is still running
   * is skipped).
   *
   * @param parallel - Run due jobs concurrently (default: false)
   * @param maxConcurrency - Maximum concurrent jobs (default: 10)
   * @returns this for chaining
   */
  public runInParallel(parallel: boolean, maxConcurrency = 10): this {
    this._runInParallel = parallel;
    this._maxConcurrency = maxConcurrency;
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Lifecycle Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Start the scheduler
   *
   * A no-op, logging one info line, on a process that does not serve the
   * `worker` role (`WARLOCK_ROLES`) — so an app that calls this in `main.ts`
   * doesn't run its jobs on every `web`/`api` node. With no `--role` passed,
   * every role is on and this behaves exactly as before.
   *
   * @throws Error if scheduler is already running
   */
  public start(): void {
    if (!hasWorkerRole()) {
      // eslint-disable-next-line no-console
      console.info(`scheduler: not started (role: ${rolesLabel()})`);
      return;
    }

    if (this.isRunning) {
      throw new Error("Scheduler is already running.");
    }

    if (this._jobs.length === 0) {
      throw new Error("Cannot start scheduler with no jobs.");
    }

    this._hasStarted = true;
    this._clearStartWarning();

    for (const job of this._jobs) {
      job.prepare();
    }

    this._isShuttingDown = false;
    this._scheduleTick(this._tickInterval);

    // The host process stops every tracked scheduler when it shuts down, so an
    // application that never calls `shutdown()` itself still lets the process exit.
    trackRunningScheduler(this);

    this.emit("scheduler:started");
  }

  /**
   * Stop the scheduler immediately.
   *
   * No-op if the scheduler isn't running. Does not wait for in-flight jobs —
   * use `shutdown()` for graceful termination.
   */
  public stop(): void {
    if (!this._timeoutId) return;

    clearTimeout(this._timeoutId);
    this._timeoutId = null;
    // Jobs still waiting for a slot never start once the scheduler stops.
    this._pending.length = 0;
    this._tickDeferred = false;
    untrackRunningScheduler(this);

    this.emit("scheduler:stopped");
  }

  /**
   * Gracefully shutdown the scheduler
   *
   * Stops scheduling new jobs and waits for currently running jobs to complete.
   *
   * @param timeout - Maximum time to wait for jobs (default: 30000ms)
   * @returns Promise that resolves when shutdown is complete
   */
  public async shutdown(timeout = 30000): Promise<void> {
    this._isShuttingDown = true;
    this.stop();

    this._pending.length = 0;
    this._tickDeferred = false;

    const runningJobs = this._jobs.filter((j) => j.isRunning);
    const inFlight = [...this._inFlight];

    if (runningJobs.length > 0 || inFlight.length > 0) {
      let cap: NodeJS.Timeout | undefined;

      try {
        await Promise.race([
          Promise.allSettled([...inFlight, ...runningJobs.map((j) => j.waitForCompletion())]),
          new Promise<void>((resolve) => {
            cap = setTimeout(resolve, timeout);
          }),
        ]);
      } finally {
        // A cap left armed after the jobs finished would hold the process open
        // for the rest of the timeout.
        clearTimeout(cap);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Arm the one-shot "registered but never started" development warning.
   *
   * Called whenever a job is registered. Does nothing in production
   * (`NODE_ENV === "production"`), once `start()` has been called, when a
   * check is already armed, or when this process doesn't serve the `worker`
   * role — `start()` is never expected to be called there, so the warning
   * would only be noise. The deferred check is unref'd so it can never keep
   * the event loop (and the process) alive on its own.
   */
  private _armStartWarning(): void {
    if (process.env.NODE_ENV === "production" || !hasWorkerRole()) {
      return;
    }

    if (this._hasStarted || this._startWarningTimer !== null) {
      return;
    }

    const timer = setTimeout(() => {
      this._startWarningTimer = null;

      if (this._hasStarted || this._jobs.length === 0) {
        return;
      }

      // eslint-disable-next-line no-console
      console.warn(
        `[@warlock.js/scheduler] ${this._jobs.length} job(s) registered but ` +
          `scheduler.start() was never called — no jobs will run. ` +
          `Call scheduler.start() to begin executing them.`,
      );
    }, 0);

    // Never let the deferred check hold the process open.
    timer.unref?.();

    this._startWarningTimer = timer;
  }

  /**
   * Clear the armed "registered but never started" warning, if any.
   */
  private _clearStartWarning(): void {
    if (this._startWarningTimer !== null) {
      clearTimeout(this._startWarningTimer);
      this._startWarningTimer = null;
    }
  }

  /**
   * Schedule the next tick.
   *
   * A tick only starts the due jobs; it never waits for them, so a long job
   * does not delay the next tick. Drift-compensated: the next delay is
   * `tickInterval - elapsed-tick-time` (clamped to 0), so the period between
   * tick starts averages `tickInterval`.
   */
  private _scheduleTick(delay: number): void {
    if (this._isShuttingDown) return;

    this._timeoutId = setTimeout(() => {
      const tickStart = Date.now();

      try {
        this._tick();
      } finally {
        const elapsed = Date.now() - tickStart;
        const nextDelay = Math.max(this._tickInterval - elapsed, 0);

        if (this._timeoutId !== null) this._scheduleTick(nextDelay);
      }
    }, delay);
  }

  /**
   * Execute a scheduler tick: queue the due jobs and start what the mode
   * allows. Never waits for a job.
   */
  private _tick(): void {
    this.emit("scheduler:tick", new Date());

    for (const job of this._jobs) {
      // A due job whose previous run is still going is skipped for this tick.
      if (job.isDue() && job.isRunning) {
        this.emit("job:skip", job.name, "Job is already running");
      }
    }

    if (this._runInParallel || this._inFlight.size === 0) {
      this._collectDue();
    } else {
      // One at a time: jobs that become due while a job runs are collected
      // once it finishes, as one batch in registration order.
      this._tickDeferred = true;
    }

    this._drain();
  }

  /**
   * Queue every due job that is neither running nor already queued, in
   * registration order.
   */
  private _collectDue(): void {
    for (const job of this._jobs) {
      if (job.isDue() && !job.isRunning && !this._pending.includes(job)) {
        this._pending.push(job);
      }
    }
  }

  /**
   * Start queued jobs while a slot is free: up to `maxConcurrency` in
   * parallel mode, one at a time otherwise. Called on every tick and whenever
   * a run settles.
   */
  private _drain(): void {
    if (!this._runInParallel && this._inFlight.size === 0 && this._pending.length === 0) {
      // The tick that fired while the last batch ran is applied now.
      if (this._tickDeferred && !this._isShuttingDown) this._collectDue();
      this._tickDeferred = false;
    }

    const limit = this._runInParallel ? Math.max(1, this._maxConcurrency) : 1;

    while (!this._isShuttingDown && this._pending.length > 0 && this._inFlight.size < limit) {
      const job = this._pending.shift()!;

      // Removed while it waited, or no longer due.
      if (!this._jobs.includes(job) || !job.isDue()) continue;

      // Started elsewhere (a manual `run()`) while it waited.
      if (job.isRunning) {
        this.emit("job:skip", job.name, "Job is already running");
        continue;
      }

      const run: Promise<void> = this._runJob(job).then(() => undefined);

      this._inFlight.add(run);

      void run.finally(() => {
        this._inFlight.delete(run);
        this._drain();
      });
    }
  }

  /**
   * Run a single job and emit events
   */
  private async _runJob(job: Job): Promise<JobResult> {
    this.emit("job:start", job.name);

    const result = await job.run();

    if (result.skipped) {
      this.emit("job:skip", job.name, result.skipReason ?? "Another server holds the lock");
    } else if (result.success) {
      this.emit("job:complete", job.name, result);
    } else {
      this.emit("job:error", job.name, result.error);
    }

    return result;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default scheduler instance for simple use cases
 *
 * @example
 * ```typescript
 * import { scheduler, job } from "@warlock.js/scheduler";
 *
 * scheduler.addJob(job("cleanup", cleanupFn).daily());
 * scheduler.start();
 * ```
 */
export const scheduler = new Scheduler();
