import { log } from "@warlock.js/logger";
import type { ChildModel, Model } from "../model/model";
import { getModelEventListeners, type ModelSyncEventTypeName } from "./model-events";

/** A listener of a model sync event, called with the event's arguments. */
type SyncFanoutListener = (...args: unknown[]) => unknown;

type SyncFanoutJob = {
  sourceModel: string;
  operation: string;

  /** Run the whole job as one unit, retried as one unit. */
  execute?: () => Promise<void>;

  /**
   * The listeners to call, read when the job runs. Each one is retried on its
   * own, so a failing listener does not run the others again. A job whose
   * list is empty does nothing.
   */
  listeners?: () => SyncFanoutListener[];

  /** Arguments the listeners are called with. */
  args?: unknown[];

  /**
   * The source document, for example `categories:12`. Jobs with the same key
   * run one at a time in the order they were queued; jobs with different keys
   * may run side by side up to `concurrency`.
   */
  key?: string;
};

type SyncFanoutQueueOptions = {
  maxAttempts?: number;
  retryDelay?: (attempt: number) => number;
  reportFailure?: (job: SyncFanoutJob, error: unknown) => void;

  /**
   * How many fan-out jobs run at once. Jobs for the same source document
   * always run in queue order, whatever this is set to.
   *
   * @default 1
   */
  concurrency?: number;
};

/**
 * Runs post-commit sync fan-out and retries transient failures without
 * making the already-committed write, delete, or restore fail.
 *
 * Jobs run one at a time by default. With `concurrency` above 1, jobs for
 * different source documents overlap while jobs for one document keep their
 * order. A job with listeners retries each failing listener alone.
 */
export class SyncFanoutQueue {
  private jobs: SyncFanoutJob[] = [];
  private readonly runningKeys = new Set<string>();
  private running = 0;
  private maxAttempts: number;
  private retryDelay: (attempt: number) => number;
  private reportFailure: (job: SyncFanoutJob, error: unknown) => void;
  private concurrency: number;
  private idleResolvers: Array<() => void> = [];

  public constructor(options: SyncFanoutQueueOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.retryDelay = options.retryDelay ?? ((attempt) => attempt * 50);
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
    this.reportFailure =
      options.reportFailure ??
      ((job, error) => {
        log.error(
          "database",
          "sync.failed",
          `[cascade] ${job.operation} sync failed for ${job.sourceModel} after ${this.maxAttempts} attempts: ${error}`,
        );
      });
  }

  /** Change the queue's settings; jobs already running are not affected. */
  public configure(options: SyncFanoutQueueOptions): void {
    if (options.maxAttempts !== undefined) this.maxAttempts = options.maxAttempts;
    if (options.retryDelay) this.retryDelay = options.retryDelay;
    if (options.reportFailure) this.reportFailure = options.reportFailure;
    if (options.concurrency !== undefined) {
      this.concurrency = Math.max(1, Math.floor(options.concurrency));
      this.pump();
    }
  }

  /**
   * Add a committed lifecycle fan-out job without awaiting its execution.
   * A job that lists its listeners and finds none is dropped.
   */
  public enqueue(job: SyncFanoutJob): void {
    if (job.listeners && job.listeners().length === 0) {
      return;
    }

    this.jobs.push(job);
    this.pump();
  }

  /** Wait until the currently queued fan-out jobs have settled. */
  public async flush(): Promise<void> {
    if (this.running === 0 && this.jobs.length === 0) {
      return;
    }

    await new Promise<void>((resolve) => this.idleResolvers.push(resolve));
  }

  /** Start every queued job that may start now. */
  private pump(): void {
    // A key waiting earlier in the queue blocks later jobs of the same key,
    // so a document's jobs never overtake each other.
    const blockedKeys = new Set<string>();
    const waiting: SyncFanoutJob[] = [];

    for (const job of this.jobs) {
      const blocked =
        job.key !== undefined && (blockedKeys.has(job.key) || this.runningKeys.has(job.key));

      if (this.running < this.concurrency && !blocked) {
        this.start(job);
        continue;
      }

      if (job.key !== undefined) blockedKeys.add(job.key);

      waiting.push(job);
    }

    this.jobs = waiting;

    if (this.running === 0 && this.jobs.length === 0) {
      this.idleResolvers.splice(0).forEach((resolve) => resolve());
    }
  }

  private start(job: SyncFanoutJob): void {
    this.running++;

    if (job.key !== undefined) this.runningKeys.add(job.key);

    void this.execute(job).finally(() => {
      this.running--;

      if (job.key !== undefined) this.runningKeys.delete(job.key);

      this.pump();
    });
  }

  private async execute(job: SyncFanoutJob): Promise<void> {
    if (job.listeners) {
      // The listener list is read again: one removed since the job was queued
      // is not called.
      for (const listener of job.listeners()) {
        await this.attempt(job, () => Promise.resolve(listener(...(job.args ?? []))));
      }

      return;
    }

    if (job.execute) {
      await this.attempt(job, job.execute);
    }
  }

  /** Run one unit of work with retries; report it once the last attempt fails. */
  private async attempt(job: SyncFanoutJob, work: () => Promise<unknown>): Promise<void> {
    let error: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        await work();
        return;
      } catch (caught) {
        error = caught;

        if (attempt < this.maxAttempts) {
          await this.wait(this.retryDelay(attempt));
        }
      }
    }

    this.reportFailure(job, error);
  }

  private async wait(milliseconds: number): Promise<void> {
    if (milliseconds <= 0) {
      return;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }
}

const syncFanoutQueue = new SyncFanoutQueue();

/** Queue a lifecycle sync after its database change has committed. */
export function enqueueSyncFanout(job: SyncFanoutJob): void {
  syncFanoutQueue.enqueue(job);
}

/**
 * Queue a model sync event (`updated` / `deleted`) for the listeners it has
 * when it runs. Nothing is queued when nobody listens, and a failing listener
 * is retried without running the others again.
 */
export function enqueueModelEventFanout(options: {
  operation: string;
  modelClass: ChildModel<Model>;
  eventType: ModelSyncEventTypeName;
  model: Model;
  args?: unknown[];
}): void {
  const { modelClass, eventType, model } = options;
  const sourceId = model.get(modelClass.primaryKey ?? "id");

  syncFanoutQueue.enqueue({
    sourceModel: modelClass.name,
    operation: options.operation,
    listeners: () => getModelEventListeners(modelClass, eventType),
    args: [model, ...(options.args ?? [])],
    key: `${modelClass.table ?? modelClass.name}:${String(sourceId)}`,
  });
}

/**
 * Change how sync fan-out runs.
 *
 * `concurrency` (default 1) is how many jobs run at once; jobs for one source
 * document always keep their order.
 */
export function configureSyncFanout(options: SyncFanoutQueueOptions): void {
  syncFanoutQueue.configure(options);
}

/** Wait until the queued sync fan-out jobs have settled. */
export function flushSyncFanout(): Promise<void> {
  return syncFanoutQueue.flush();
}
