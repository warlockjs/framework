import { log } from "@warlock.js/logger";
import type { Queue } from "bullmq";
import { getQueueConfig } from "./config";
import { BullMQDriver } from "./drivers/bullmq";
import { onJobRegistered, queueOf, registeredJobs } from "./job-registry";
import { currentQueueDriver, forgetQueueDriver, getQueueDriver } from "./queue-driver";

let stopListening: (() => void) | undefined;
let closing: Promise<void> | undefined;

/** Low-level BullMQ access. For portable operations use defineJob / failedJobs. */
export function getQueue(name: string): Queue {
  const driver = getQueueDriver();
  if (!(driver instanceof BullMQDriver))
    throw new Error("getQueue() requires the bullmq queue driver.");
  return driver.getQueue(name);
}

/** Start workers for registered queues, honouring process roles and workers.enabled. */
export async function startWorkers(): Promise<string[]> {
  if (closing) await closing;
  const { Application } = await import("@warlock.js/core");
  if (!Application.hasRole("worker")) {
    log.info(
      "queue",
      "workers",
      `queue: workers not started (role: ${[...Application.roles].join(",")})`,
    );
    return [];
  }
  if (getQueueConfig().workers?.enabled === false) return [];
  const driver = getQueueDriver();
  stopListening ??= onJobRegistered((job) => {
    void driver.start(queueOf(job)).catch((error: unknown) => log.error("queue", "worker", error));
  });
  await Promise.all(
    [...new Set(registeredJobs().map(queueOf))].map((queue) => driver.start(queue)),
  );
  return driver.running();
}

/** Names of queues with workers in this process. */
export function runningWorkers(): string[] {
  return currentQueueDriver()?.running() ?? [];
}

export type CloseQueueOptions = {
  /** Drain timeout in ms, default workers.shutdownTimeout, else 30000. */
  timeout?: number;
};

/** Stop taking jobs, drain active handlers, then release leases and close storage. */
export function closeQueue(options: CloseQueueOptions = {}): Promise<void> {
  if (closing) return closing;
  stopListening?.();
  stopListening = undefined;
  const driver = currentQueueDriver();
  if (!driver) return Promise.resolve();
  const timeout = options.timeout ?? configuredShutdownTimeout();
  if (!Number.isFinite(timeout) || timeout < 0)
    return Promise.reject(new Error("Queue shutdown timeout must be non-negative and finite."));
  closing = driver.close(timeout).finally(() => {
    forgetQueueDriver();
    closing = undefined;
  });
  return closing;
}

function configuredShutdownTimeout(): number {
  try {
    return getQueueConfig().workers?.shutdownTimeout ?? 30_000;
  } catch {
    return 30_000;
  }
}
