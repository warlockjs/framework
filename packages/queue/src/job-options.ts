import { getQueueConfig } from "./config";
import { toMilliseconds } from "./duration";
import { InvalidJobDefinitionError } from "./errors";
import { assertFailOnTimeout, resolveTimeout } from "./job-timeout";
import type { DispatchOptions, JobOptions, JobRetention } from "./types";

/** A retention after resolution: an `{ age }` window is always milliseconds. */
export type ResolvedJobRetention = boolean | number | { age?: number; count?: number };

export type ResolvedJobOptions = Omit<
  JobOptions,
  "timeout" | "removeOnComplete" | "removeOnFail"
> & {
  delay?: number;
  priority?: number;
  jobId?: string;
  /** Per-attempt limit in milliseconds. */
  timeout?: number;
  removeOnComplete?: ResolvedJobRetention;
  removeOnFail?: ResolvedJobRetention;
};

/** Completed jobs kept when nothing configures retention: one day, at most 1,000. */
export const DEFAULT_REMOVE_ON_COMPLETE = {
  age: "24h",
  count: 1000,
} as const satisfies JobRetention;

/** Failed jobs kept when nothing configures retention: one week, at most 5,000. */
export const DEFAULT_REMOVE_ON_FAIL = { age: "7d", count: 5000 } as const satisfies JobRetention;

export function resolveJobOptions(
  definition: JobOptions,
  options: DispatchOptions,
): ResolvedJobOptions {
  const defaults = getQueueConfig().defaultJobOptions ?? {};
  const timeout = options.timeout ?? definition.timeout ?? defaults.timeout;
  const failOnTimeout = options.failOnTimeout ?? definition.failOnTimeout ?? defaults.failOnTimeout;
  assertFailOnTimeout(failOnTimeout);

  return {
    attempts: options.attempts ?? definition.attempts ?? defaults.attempts,
    backoff: options.backoff ?? definition.backoff ?? defaults.backoff,
    removeOnComplete: resolveRetention(
      definition.removeOnComplete ?? defaults.removeOnComplete ?? DEFAULT_REMOVE_ON_COMPLETE,
      "removeOnComplete",
    ),
    removeOnFail: resolveRetention(
      definition.removeOnFail ?? defaults.removeOnFail ?? DEFAULT_REMOVE_ON_FAIL,
      "removeOnFail",
    ),
    timeout: timeout === undefined ? undefined : resolveTimeout(timeout),
    failOnTimeout,
    delay: options.delay === undefined ? undefined : toMilliseconds(options.delay),
    priority: options.priority,
    jobId: options.jobId,
  };
}

/** Validate a retention and turn an `{ age }` duration into milliseconds. */
export function resolveRetention(value: JobRetention, label: string): ResolvedJobRetention {
  if (typeof value === "boolean" || typeof value === "number") return value;

  if (
    value === null ||
    typeof value !== "object" ||
    (value.age === undefined && value.count === undefined)
  ) {
    throw new InvalidJobDefinitionError(
      `\`${label}\` must be true, false, a number, or { age, count } with at least one of them, got ${JSON.stringify(value)}.`,
    );
  }

  const resolved: { age?: number; count?: number } = {};

  if (value.age !== undefined) resolved.age = toMilliseconds(value.age);

  if (value.count !== undefined) {
    if (!Number.isInteger(value.count) || value.count < 0) {
      throw new InvalidJobDefinitionError(
        `\`${label}.count\` must be a non-negative integer, got ${JSON.stringify(value.count)}.`,
      );
    }

    resolved.count = value.count;
  }

  return resolved;
}
