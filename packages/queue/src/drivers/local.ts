import { randomUUID } from "node:crypto";
import { log } from "@warlock.js/logger";
import type { DriverDispatch, QueueDriver } from "../driver";
import { FailedJobNotFoundError, UnrecoverableJobError } from "../errors";
import { findRegisteredJob } from "../job-registry";
import { getQueueContext, unwrapPayload } from "../queue-context";
import type { DispatchedJob, FailedJob, JobContext, JobSnapshot, QueueConfig } from "../types";
import { jsonCopy, type LocalJob, type LocalStore } from "./local-store";

type ActiveJob = {
  job: LocalJob;
  token: string;
  controller: AbortController;
  heartbeat: NodeJS.Timeout;
  done: Promise<void>;
};
type LocalWorker = { timer?: NodeJS.Timeout; active: Set<ActiveJob> };

/** Shared scheduling and lease semantics for the SQLite and memory stores. */
export class LocalDriver implements QueueDriver {
  private workers = new Map<string, LocalWorker>();
  private active = new Set<ActiveJob>();
  private closed = false;
  private stopping = false;
  private leaseDuration: number;
  private pollInterval: number;
  private concurrency: number;

  public constructor(
    private store: LocalStore,
    config: QueueConfig,
  ) {
    try {
      this.leaseDuration = positiveInteger(
        config.local?.leaseDuration ?? 30_000,
        "local.leaseDuration",
        30,
      );
      this.pollInterval = positiveInteger(config.local?.pollInterval ?? 100, "local.pollInterval");
      this.concurrency = positiveInteger(config.workers?.concurrency ?? 1, "workers.concurrency");
    } catch (error) {
      store.close();
      throw error;
    }
  }

  public async dispatch(request: DriverDispatch): Promise<DispatchedJob> {
    this.assertOpen();
    validateOptions(request);
    const id = request.options.jobId ?? randomUUID();
    const now = Date.now();
    const job = this.store.transaction(() => {
      const previous = this.store.get(request.queue, id);
      if (previous) return previous;
      const entry: LocalJob = {
        id,
        name: request.name,
        queue: request.queue,
        data: jsonCopy(request.data),
        options: jsonCopy(request.options),
        state: request.options.delay
          ? "delayed"
          : request.options.priority
            ? "prioritized"
            : "waiting",
        createdAt: now,
        readyAt: now + (request.options.delay ?? 0),
        attemptsMade: 0,
        priority: request.options.priority ?? 0,
        progress: 0,
        logs: [],
        stacktrace: [],
        leaseUntil: 0,
      };
      this.store.put(entry);
      return entry;
    });
    return { id: job.id, name: request.name, queue: request.queue };
  }

  public async find(queue: string, id: string): Promise<JobSnapshot | undefined> {
    this.assertOpen();
    const job = this.store.get(queue, id);
    return job ? snapshot(job) : undefined;
  }

  public async failed(queue: string, start: number, end: number): Promise<FailedJob[]> {
    this.assertOpen();
    const jobs = newestFirst(this.store.list(queue, "failed"));
    const last = end < 0 ? jobs.length + end : end;
    return jobs.slice(start, last + 1).map((job) => ({
      id: job.id,
      name: job.name,
      queue,
      payload: unwrapPayload(job.data).payload,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason ?? "",
      stacktrace: job.stacktrace,
      failedAt: job.finishedAt === undefined ? undefined : new Date(job.finishedAt),
      retry: () => this.retry(queue, job.id),
    }));
  }

  public async retry(queue: string, id: string): Promise<void> {
    this.assertOpen();
    this.store.transaction(() => {
      const job = this.store.get(queue, id);
      if (!job || job.state !== "failed") throw new FailedJobNotFoundError(id, queue);
      job.state = job.priority ? "prioritized" : "waiting";
      job.attemptsMade = 0;
      job.readyAt = Date.now();
      delete job.finishedAt;
      delete job.failedReason;
      delete job.result;
      job.stacktrace = [];
      this.store.put(job);
    });
  }

  public async start(queue: string): Promise<void> {
    this.assertOpen();
    if (this.stopping) throw new Error("Queue workers are shutting down.");
    if (this.workers.has(queue)) return;
    const worker: LocalWorker = { active: new Set() };
    this.workers.set(queue, worker);
    this.schedule(queue, worker, 0);
  }

  public running(): string[] {
    return [...this.workers.keys()];
  }

  public async close(timeout: number): Promise<void> {
    if (this.closed) return;
    this.stopping = true;
    for (const worker of this.workers.values()) clearTimeout(worker.timer);
    this.workers.clear();
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeout);
    });
    try {
      await Promise.race([
        Promise.allSettled([...this.active].map((entry) => entry.done)),
        timedOut,
      ]);
    } finally {
      clearTimeout(timer);
      try {
        for (const entry of this.active) {
          clearInterval(entry.heartbeat);
          entry.controller.abort(new Error("Queue shutdown timeout elapsed."));
          this.mutate(entry.job, entry.token, (job) => {
            job.state = job.priority ? "prioritized" : "waiting";
            job.readyAt = Date.now();
            job.leaseUntil = 0;
            delete job.token;
          });
        }
      } finally {
        this.closed = true;
        for (const entry of this.active) clearInterval(entry.heartbeat);
        this.store.close();
      }
    }
  }

  private schedule(queue: string, worker: LocalWorker, delay: number): void {
    if (this.stopping) return;
    worker.timer = setTimeout(() => {
      try {
        while (!this.stopping && worker.active.size < this.concurrency) {
          const token = randomUUID();
          const job = this.store.transaction(() => {
            const now = Date.now();
            const candidate = this.store.ready(queue, now);
            if (!candidate) return undefined;
            candidate.state = "active";
            candidate.token = token;
            candidate.leaseUntil = now + this.leaseDuration;
            this.store.put(candidate);
            return candidate;
          });
          if (!job) break;
          this.run(job, token, worker);
        }
      } catch (error) {
        log.error("queue", "worker", error);
      }
      this.schedule(queue, worker, this.pollInterval);
    }, delay);
  }

  private run(job: LocalJob, token: string, worker: LocalWorker): void {
    const controller = new AbortController();
    const heartbeat = setInterval(
      () => {
        try {
          if (
            !this.mutate(job, token, (current) => {
              current.leaseUntil = Date.now() + this.leaseDuration;
            })
          ) {
            controller.abort(new Error("Queue job lease expired or changed owner."));
            clearInterval(heartbeat);
          }
        } catch (error) {
          controller.abort(error);
          clearInterval(heartbeat);
          log.error("queue", "lease", error);
        }
      },
      Math.floor(this.leaseDuration / 3),
    );
    const entry: ActiveJob = { job, token, controller, heartbeat, done: Promise.resolve() };
    this.active.add(entry);
    worker.active.add(entry);
    entry.done = this.execute(entry)
      .catch((error: unknown) => {
        log.error("queue", "job", error);
      })
      .finally(() => {
        clearInterval(heartbeat);
        this.active.delete(entry);
        worker.active.delete(entry);
      });
  }

  private async execute(entry: ActiveJob): Promise<void> {
    const { job, token, controller } = entry;
    try {
      const definition = findRegisteredJob(job.name);
      if (!definition)
        throw new UnrecoverableJobError(
          `No job named "${job.name}" is defined in this process. Import its definition in the worker.`,
        );
      const { payload, context: captured } = unwrapPayload(job.data);
      const context: JobContext = {
        id: job.id,
        name: job.name,
        queue: job.queue,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.options.attempts ?? 1,
        context: captured,
        signal: controller.signal,
        progress: async (value) => {
          if (
            !this.mutate(job, token, (current) => {
              current.progress = jsonCopy(value);
            })
          )
            throw new Error("Queue job lease lost.");
        },
        log: async (line) => {
          if (
            !this.mutate(job, token, (current) => {
              current.logs.push(line);
            })
          )
            throw new Error("Queue job lease lost.");
        },
      };
      const run = async () => definition.handle(payload, context);
      const queueContext = getQueueContext();
      const result = jsonCopy(
        captured !== undefined && queueContext
          ? await queueContext.restore(captured, run)
          : await run(),
      );
      this.mutate(
        job,
        token,
        (current) => {
          current.attemptsMade++;
          current.result = result;
          current.state = "completed";
          current.finishedAt = Date.now();
          current.leaseUntil = 0;
          delete current.token;
        },
        true,
      );
    } catch (error) {
      this.mutate(
        job,
        token,
        (current) => {
          current.attemptsMade++;
          current.failedReason = error instanceof Error ? error.message : String(error);
          current.stacktrace.push(
            error instanceof Error ? (error.stack ?? error.message) : String(error),
          );
          current.leaseUntil = 0;
          delete current.token;
          if (
            error instanceof UnrecoverableJobError ||
            current.attemptsMade >= (current.options.attempts ?? 1)
          ) {
            current.state = "failed";
            current.finishedAt = Date.now();
          } else {
            const backoff = current.options.backoff;
            const base = typeof backoff === "number" ? backoff : (backoff?.delay ?? 0);
            const delay =
              typeof backoff === "object" && backoff.type === "exponential"
                ? base * 2 ** (current.attemptsMade - 1)
                : base;
            current.readyAt = Math.min(Number.MAX_SAFE_INTEGER, Date.now() + delay);
            current.state = delay > 0 ? "delayed" : current.priority ? "prioritized" : "waiting";
          }
        },
        true,
      );
    }
  }

  /** Fencing: expired owners cannot renew, finish, or overwrite a new owner's job. */
  private mutate(
    job: LocalJob,
    token: string,
    update: (current: LocalJob) => void,
    retain = false,
  ): boolean {
    if (this.closed) return false;
    return this.store.transaction(() => {
      const current = this.store.get(job.queue, job.id);
      if (!current || !ownsLease(current, token)) return false;
      update(current);
      this.store.put(current);
      if (retain && (current.state === "completed" || current.state === "failed")) {
        const retention =
          current.state === "completed"
            ? current.options.removeOnComplete
            : current.options.removeOnFail;
        if (retention === true) this.store.remove(current.queue, current.id);
        if (typeof retention === "number") {
          for (const old of newestFirst(this.store.list(current.queue, current.state)).slice(
            retention,
          ))
            this.store.remove(old.queue, old.id);
        }
      }
      return true;
    });
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Queue driver is closed.");
  }
}

function snapshot(job: LocalJob): JobSnapshot {
  return {
    id: job.id,
    name: job.name,
    queue: job.queue,
    state: job.state,
    payload: unwrapPayload(job.data).payload,
    progress: job.progress,
    attemptsMade: job.attemptsMade,
    result: job.result,
    failedReason: job.failedReason,
    createdAt: new Date(job.createdAt),
    finishedAt: job.finishedAt === undefined ? undefined : new Date(job.finishedAt),
  };
}
function newestFirst(jobs: LocalJob[]): LocalJob[] {
  return jobs.reverse().sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
}
function positiveInteger(value: number, name: string, minimum = 1): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > 2_147_483_647)
    throw new Error(`${name} must be an integer between ${minimum} and 2147483647.`);
  return value;
}
function validateOptions({ options }: DriverDispatch): void {
  positiveInteger(options.attempts ?? 1, "attempts");
  if (
    options.priority !== undefined &&
    (!Number.isInteger(options.priority) || options.priority < 0 || options.priority > 2_097_152)
  )
    throw new Error("priority must be an integer between 0 and 2097152.");
  const backoff = options.backoff;
  const delay = typeof backoff === "number" ? backoff : (backoff?.delay ?? 0);
  if (
    !Number.isFinite(delay) ||
    delay < 0 ||
    (typeof backoff === "object" && !["fixed", "exponential"].includes(backoff.type))
  )
    throw new Error("backoff must have a non-negative finite delay and fixed or exponential type.");
  if (options.delay !== undefined && (!Number.isFinite(options.delay) || options.delay < 0))
    throw new Error("delay must be non-negative and finite.");
  for (const retention of [options.removeOnComplete, options.removeOnFail]) {
    if (typeof retention === "number" && (!Number.isInteger(retention) || retention < 0))
      throw new Error("Job retention must be a non-negative integer or boolean.");
  }
}

function ownsLease(job: LocalJob, token: string): boolean {
  return job.state === "active" && job.token === token && job.leaseUntil > Date.now();
}
