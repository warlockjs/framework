import { log } from "@warlock.js/logger";
import { Queue, Worker } from "bullmq";
import { getQueueConfig } from "./config";
import { onJobRegistered, queueOf, registeredJobs } from "./job-registry";
import { processJob } from "./process-job";

const DEFAULT_SHUTDOWN_TIMEOUT = 30_000;

const queues = new Map<string, Queue>();
const workers = new Map<string, Worker>();
let stopListening: (() => void) | undefined;

/**
 * The BullMQ queue for `name`, created on first use with the configured
 * connection and prefix.
 */
export function getQueue(name: string): Queue {
  let queue = queues.get(name);

  if (!queue) {
    const config = getQueueConfig();

    queue = new Queue(name, {
      connection: config.connection,
      prefix: config.prefix ?? "warlock",
    });

    queue.on("error", (error) => {
      log.error("queue", "connection", error);
    });

    queues.set(name, queue);
  }

  return queue;
}

/**
 * Start one worker per queue that has a registered job, and keep starting
 * workers for queues whose first job is defined later.
 *
 * A no-op returning `[]` when `workers.enabled` is `false`. Calling it again
 * while workers run starts only the missing ones.
 *
 * @returns the queue names that now have a worker in this process.
 */
export async function startWorkers(): Promise<string[]> {
  const config = getQueueConfig();

  if (config.workers?.enabled === false) {
    return [];
  }

  for (const job of registeredJobs()) {
    ensureWorker(queueOf(job));
  }

  stopListening ??= onJobRegistered((job) => {
    ensureWorker(queueOf(job));
  });

  await Promise.all([...workers.values()].map((worker) => worker.waitUntilReady()));

  return [...workers.keys()];
}

/** The queue names with a running worker in this process. */
export function runningWorkers(): string[] {
  return [...workers.keys()];
}

function ensureWorker(queueName: string): void {
  if (workers.has(queueName)) {
    return;
  }

  const config = getQueueConfig();

  const worker = new Worker(queueName, processJob, {
    connection: config.connection,
    prefix: config.prefix ?? "warlock",
    concurrency: config.workers?.concurrency ?? 1,
  });

  worker.on("error", (error) => {
    log.error("queue", "worker", error);
  });

  worker.on("failed", (job, error) => {
    log.error("queue", "job.failed", `${job?.name ?? "unknown"} (${job?.id ?? "?"}): ${error.message}`);
  });

  workers.set(queueName, worker);
}

export type CloseQueueOptions = {
  /**
   * How long to wait for active jobs before force-closing workers, in
   * milliseconds. Default: `workers.shutdownTimeout`, else `30000`.
   */
  timeout?: number;
};

/**
 * Graceful shutdown: stop workers taking new jobs and wait for active ones
 * (bounded by `timeout`, then force-close), then close every queue
 * connection. Safe to call when nothing was started, and more than once.
 */
export async function closeQueue(options: CloseQueueOptions = {}): Promise<void> {
  stopListening?.();
  stopListening = undefined;

  const timeout = options.timeout ?? configuredShutdownTimeout();
  const closingWorkers = [...workers.values()];
  workers.clear();

  await Promise.all(closingWorkers.map((worker) => closeWorker(worker, timeout)));

  const closingQueues = [...queues.values()];
  queues.clear();

  await Promise.all(closingQueues.map((queue) => queue.close()));
}

function configuredShutdownTimeout(): number {
  try {
    return getQueueConfig().workers?.shutdownTimeout ?? DEFAULT_SHUTDOWN_TIMEOUT;
  } catch {
    return DEFAULT_SHUTDOWN_TIMEOUT;
  }
}

async function closeWorker(worker: Worker, timeout: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;

  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeout);
  });

  // A close already in progress cannot be upgraded to a forced one (BullMQ
  // returns the pending promise), so the timeout path drops the connections
  // instead and lets the graceful close settle in the background.
  const closing = worker.close().then(() => "closed" as const);
  closing.catch(() => undefined);

  const outcome = await Promise.race([closing, timedOut]);

  clearTimeout(timer);

  if (outcome === "timeout") {
    log.warn(
      "queue",
      "shutdown",
      `Worker for "${worker.name}" still had active jobs after ${timeout}ms; disconnecting. ` +
        "Those jobs are retried once their lock expires.",
    );

    await worker.disconnect();
  }
}
