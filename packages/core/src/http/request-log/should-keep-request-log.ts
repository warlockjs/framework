import type { ResolvedRequestLogConfig } from "./request-log.types";

/** The outcome of a request, as far as the keep decision needs it. */
export type RequestLogOutcome = {
  status: number;
  durationMs: number;
  /** The request threw, or an error was logged while it ran. */
  failed?: boolean;
};

/** A 5xx response, or a request that threw. */
export function isRequestLogErrorOutcome(outcome: RequestLogOutcome): boolean {
  return outcome.status >= 500 || outcome.failed === true;
}

/**
 * Whether a finished request is written to the log.
 *
 * - `only: "errors"` keeps 5xx responses and requests that threw.
 * - `only: "slow"` keeps requests of at least `slowMs`.
 * - `only: "all"` keeps everything.
 *
 * `sampleRate` then thins what is left. Errors are never sampled out when
 * `only` includes them (`"all"` and `"errors"`).
 *
 * @param random A number in [0, 1); injectable for tests.
 */
export function shouldKeepRequestLog(
  config: Pick<ResolvedRequestLogConfig, "only" | "slowMs" | "sampleRate">,
  outcome: RequestLogOutcome,
  random: () => number = Math.random,
): boolean {
  const error = isRequestLogErrorOutcome(outcome);

  if (config.only === "errors" && !error) return false;

  if (config.only === "slow" && outcome.durationMs < config.slowMs) return false;

  if (error && config.only !== "slow") return true;

  if (config.sampleRate >= 1) return true;

  if (config.sampleRate <= 0) return false;

  return random() < config.sampleRate;
}
