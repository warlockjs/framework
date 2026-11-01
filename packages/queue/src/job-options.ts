import { getQueueConfig } from "./config";
import { toMilliseconds } from "./duration";
import { assertFailOnTimeout, resolveTimeout } from "./job-timeout";
import type { DispatchOptions, JobOptions } from "./types";

export type ResolvedJobOptions = Omit<JobOptions, "timeout"> & {
  delay?: number;
  priority?: number;
  jobId?: string;
  /** Per-attempt limit in milliseconds. */
  timeout?: number;
};

export function resolveJobOptions(
  definition: JobOptions,
  options: DispatchOptions,
): ResolvedJobOptions {
  const defaults = getQueueConfig().defaultJobOptions ?? {};
  const timeout = options.timeout ?? definition.timeout ?? defaults.timeout;
  const failOnTimeout =
    options.failOnTimeout ?? definition.failOnTimeout ?? defaults.failOnTimeout;
  assertFailOnTimeout(failOnTimeout);

  return {
    attempts: options.attempts ?? definition.attempts ?? defaults.attempts,
    backoff: options.backoff ?? definition.backoff ?? defaults.backoff,
    removeOnComplete: definition.removeOnComplete ?? defaults.removeOnComplete,
    removeOnFail: definition.removeOnFail ?? defaults.removeOnFail,
    timeout: timeout === undefined ? undefined : resolveTimeout(timeout),
    failOnTimeout,
    delay: options.delay === undefined ? undefined : toMilliseconds(options.delay),
    priority: options.priority,
    jobId: options.jobId,
  };
}
