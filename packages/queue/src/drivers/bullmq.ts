import { log } from "@warlock.js/logger";
import { Queue, Worker, type Job, type JobsOptions } from "bullmq";
import type { DriverDispatch, QueueDriver } from "../driver";
import { FailedJobNotFoundError } from "../errors";
import { processJob } from "../process-job";
import { unwrapPayload } from "../queue-context";
import type { DispatchedJob, FailedJob, JobSnapshot, JobState, QueueConfig } from "../types";

export class BullMQDriver implements QueueDriver {
  private queues = new Map<string, Queue>();
  private workers = new Map<string, Worker>();

  public constructor(private config: QueueConfig) {
    if (!config.connection) throw new Error("The bullmq queue driver requires `connection`.");
  }

  public getQueue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      const connection = this.config.connection;
      if (!connection) throw new Error("The bullmq queue driver requires `connection`.");
      queue = new Queue(name, { connection, prefix: this.config.prefix ?? "warlock" });
      queue.on("error", (error) => log.error("queue", "connection", error));
      this.queues.set(name, queue);
    }
    return queue;
  }

  public async dispatch(request: DriverDispatch): Promise<DispatchedJob> {
    const { backoff, ...rest } = request.options;
    const options: JobsOptions = {
      ...rest,
      backoff: typeof backoff === "number" ? { type: "fixed", delay: backoff } : backoff,
    };
    const job = await this.getQueue(request.queue).add(request.name, request.data, options);
    return { id: String(job.id), name: request.name, queue: request.queue };
  }

  public async find(queue: string, id: string): Promise<JobSnapshot | undefined> {
    const source = this.getQueue(queue);
    const initial = await source.getJob(id);
    if (!initial) return undefined;
    // Fetch fields after reading state so completion fields match the state.
    const state = (await initial.getState()) as JobState;
    return toSnapshot((await source.getJob(id)) ?? initial, state);
  }

  public async failed(queue: string, start: number, end: number): Promise<FailedJob[]> {
    return (await this.getQueue(queue).getFailed(start, end)).map((job) => ({
      id: String(job.id),
      name: job.name,
      queue,
      payload: unwrapPayload(job.data).payload,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      stacktrace: job.stacktrace ?? [],
      failedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
      retry: () => job.retry("failed"),
    }));
  }

  public async retry(queue: string, id: string): Promise<void> {
    const job = await this.getQueue(queue).getJob(id);
    if (!job || !(await job.isFailed())) throw new FailedJobNotFoundError(id, queue);
    await job.retry("failed");
  }

  public async start(queue: string): Promise<void> {
    let worker = this.workers.get(queue);
    if (!worker) {
      const connection = this.config.connection;
      if (!connection) throw new Error("The bullmq queue driver requires `connection`.");
      worker = new Worker(queue, processJob, {
        connection,
        prefix: this.config.prefix ?? "warlock",
        concurrency: this.config.workers?.concurrency ?? 1,
      });
      worker.on("error", (error) => log.error("queue", "worker", error));
      worker.on("failed", (job, error) =>
        log.error(
          "queue",
          "job.failed",
          `${job?.name ?? "unknown"} (${job?.id ?? "?"}): ${error.message}`,
        ),
      );
      this.workers.set(queue, worker);
    }
    await worker.waitUntilReady();
  }

  public running(): string[] {
    return [...this.workers.keys()];
  }

  public async close(timeout: number): Promise<void> {
    const workers = [...this.workers.values()];
    this.workers.clear();
    await Promise.all(workers.map((worker) => closeWorker(worker, timeout)));
    const queues = [...this.queues.values()];
    this.queues.clear();
    await Promise.all(queues.map((queue) => queue.close()));
  }
}

function toSnapshot(job: Job, state: JobState): JobSnapshot {
  return {
    id: String(job.id),
    name: job.name,
    queue: job.queueName,
    state,
    payload: unwrapPayload(job.data).payload,
    progress: job.progress as JobSnapshot["progress"],
    attemptsMade: job.attemptsMade,
    result: job.returnvalue as unknown,
    failedReason: job.failedReason || undefined,
    createdAt: new Date(job.timestamp),
    finishedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
  };
}

async function closeWorker(worker: Worker, timeout: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeout);
  });
  const closing = worker.close().then(() => "closed" as const);
  closing.catch(() => undefined);
  try {
    if ((await Promise.race([closing, timedOut])) === "timeout") {
      log.warn(
        "queue",
        "shutdown",
        `Worker for "${worker.name}" still had active jobs after ${timeout}ms; disconnecting. ` +
          "Those jobs are retried once their lock expires.",
      );
      await worker.disconnect();
    }
  } finally {
    clearTimeout(timer);
  }
}
