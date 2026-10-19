import { getQueueConfig } from "./config";
import { toMilliseconds } from "./duration";
import type { DispatchOptions, JobOptions } from "./types";

export type ResolvedJobOptions = JobOptions & {
  delay?: number;
  priority?: number;
  jobId?: string;
};

export function resolveJobOptions(
  definition: JobOptions,
  options: DispatchOptions,
): ResolvedJobOptions {
  const defaults = getQueueConfig().defaultJobOptions ?? {};
  return {
    attempts: options.attempts ?? definition.attempts ?? defaults.attempts,
    backoff: options.backoff ?? definition.backoff ?? defaults.backoff,
    removeOnComplete: definition.removeOnComplete ?? defaults.removeOnComplete,
    removeOnFail: definition.removeOnFail ?? defaults.removeOnFail,
    delay: options.delay === undefined ? undefined : toMilliseconds(options.delay),
    priority: options.priority,
    jobId: options.jobId,
  };
}
