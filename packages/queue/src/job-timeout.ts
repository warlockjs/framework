import { InvalidJobDefinitionError, JobTimeoutError } from "./errors";
import { toMilliseconds } from "./duration";
import type { Duration } from "./types";

/**
 * Convert a `timeout` option to milliseconds. Unparsable values throw
 * `InvalidDurationError`; zero and negative limits throw
 * `InvalidJobDefinitionError` — a timeout is never silently repaired or ignored.
 */
export function resolveTimeout(value: Duration | string, label = "timeout"): number {
  const milliseconds = toMilliseconds(value);

  if (milliseconds <= 0) {
    throw new InvalidJobDefinitionError(
      `\`${label}\` must be greater than zero, got ${JSON.stringify(value)}.`,
    );
  }

  return milliseconds;
}

/** Throw unless `failOnTimeout` is a boolean (or unset). */
export function assertFailOnTimeout(value: unknown, label = "failOnTimeout"): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new InvalidJobDefinitionError(`\`${label}\` must be a boolean, got ${JSON.stringify(value)}.`);
  }
}

export type JobTimeoutSettings = {
  /** Limit per attempt in milliseconds. */
  timeout?: number;
  /** Fail the job without retrying when the limit is hit. */
  failOnTimeout?: boolean;
};

export type JobAbort = {
  /** Handed to the handler: aborts on timeout, or when the parent signal aborts. */
  signal: AbortSignal | undefined;
  /** Run the work and reject with `JobTimeoutError` if it outlives the limit. */
  guard<T>(work: () => Promise<T>): Promise<T>;
  /** Clear the timer. Always call when the attempt ends. */
  dispose(): void;
};

/**
 * One attempt's time limit, shared by every driver. Without a `timeout` it
 * passes the parent signal through and adds nothing. On expiry the signal
 * aborts with the `JobTimeoutError` and the attempt fails; a handler that
 * ignores the signal keeps running in the background, because JavaScript
 * cannot stop it.
 */
export function createJobAbort(
  name: string,
  settings: JobTimeoutSettings,
  parent?: AbortSignal,
): JobAbort {
  const { timeout } = settings;

  if (timeout === undefined) {
    return { signal: parent, guard: (work) => work(), dispose() {} };
  }

  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent?.reason);

  if (parent?.aborted) {
    controller.abort(parent.reason);
  } else {
    parent?.addEventListener("abort", onParentAbort, { once: true });
  }

  let timer: NodeJS.Timeout | undefined;

  return {
    signal: controller.signal,
    guard(work) {
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new JobTimeoutError(name, timeout, settings.failOnTimeout === true);
          controller.abort(error);
          reject(error);
        }, timeout);
      });
      const running = work();

      // The abandoned handler may still reject later; that must not surface as unhandled.
      running.catch(() => {});

      return Promise.race([running, expired]);
    },
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}
