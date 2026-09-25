import { log } from "@warlock.js/logger";

type SyncFanoutJob = {
  sourceModel: string;
  operation: string;
  execute: () => Promise<void>;
};

type SyncFanoutQueueOptions = {
  maxAttempts?: number;
  retryDelay?: (attempt: number) => number;
  reportFailure?: (job: SyncFanoutJob, error: unknown) => void;
};

/**
 * Serializes post-commit sync fan-out and retries transient failures without
 * making the already-committed write, delete, or restore fail.
 */
export class SyncFanoutQueue {
  private readonly jobs: SyncFanoutJob[] = [];
  private readonly maxAttempts: number;
  private readonly retryDelay: (attempt: number) => number;
  private readonly reportFailure: (job: SyncFanoutJob, error: unknown) => void;
  private draining = false;
  private idleResolvers: Array<() => void> = [];

  public constructor(options: SyncFanoutQueueOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.retryDelay = options.retryDelay ?? ((attempt) => attempt * 50);
    this.reportFailure = options.reportFailure ?? ((job, error) => {
      log.error(
        "database",
        "sync.failed",
        `[cascade] ${job.operation} sync failed for ${job.sourceModel} after ${this.maxAttempts} attempts: ${error}`,
      );
    });
  }

  /** Add a committed lifecycle fan-out job without awaiting its execution. */
  public enqueue(job: SyncFanoutJob): void {
    this.jobs.push(job);

    if (!this.draining) {
      this.draining = true;
      void this.drain();
    }
  }

  /** Wait until the currently queued fan-out jobs have settled. */
  public async flush(): Promise<void> {
    if (!this.draining && this.jobs.length === 0) {
      return;
    }

    await new Promise<void>((resolve) => this.idleResolvers.push(resolve));
  }

  private async drain(): Promise<void> {
    while (this.jobs.length > 0) {
      const job = this.jobs.shift();

      if (job) {
        await this.execute(job);
      }
    }

    this.draining = false;
    this.idleResolvers.splice(0).forEach((resolve) => resolve());
  }

  private async execute(job: SyncFanoutJob): Promise<void> {
    let error: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        await job.execute();
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
