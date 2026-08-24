/**
 * Both ends of a request's log entry.
 *
 * ## Why the completion line exists
 *
 * The router logged `Starting Request: <id>` and nothing else. A request that
 * hung for thirty seconds and one that returned in two milliseconds produced
 * **byte-identical output**, so the log could not answer the one question
 * anyone opens it to ask.
 *
 * Note what "detecting a hang" actually means. Nothing can log the completion
 * of a request that never completes — the mechanism is the **absence** of a
 * completion line beside a start line that has one. That only works if the
 * completion line is emitted on every settled path, **including a throw**,
 * which is why the error path here is not an afterthought.
 *
 * ## Why the level tracks the status
 *
 * A handled 500 does not throw; it returns a response. Logging it at `info`
 * would bury the exact entries someone scanning the log is hunting for, so the
 * level is derived from the outcome: informational below 400, a warning for
 * client errors, an error for server errors and for anything that threw.
 *
 * ## Ports rather than a direct `log` import
 *
 * The behaviour worth pinning down is *which lines come out, in which order,
 * at which level, when the run throws*. Injecting the sink and the clock makes
 * that assertable without a server, a socket or a fake timer.
 */

export type RequestLogEntry = {
  module: string;
  action: string;
  message: string;
  context?: unknown;
};

export type RequestLogPorts = {
  info(entry: RequestLogEntry): void;
  warn(entry: RequestLogEntry): void;
  error(entry: RequestLogEntry): void;
  /** Monotonic milliseconds. Called exactly twice per request. */
  now(): number;
};

export type RequestLogDescriptor = {
  module: string;
  action: string;
  requestId: string;
  context?: unknown;
  /**
   * Read AFTER the run settles — the status is decided during the request, so
   * capturing it up front would report the default on every entry.
   */
  statusCode(): number | undefined;
};

type Level = "info" | "warn" | "error";

function levelForStatus(statusCode: number | undefined): Level {
  // An unknown status is not evidence of a problem; saying "error" because we
  // failed to read a number would be inventing a defect.
  if (statusCode === undefined) return "info";

  if (statusCode >= 500) return "error";

  if (statusCode >= 400) return "warn";

  return "info";
}

export async function logRequestLifecycle<TResult>(
  ports: RequestLogPorts,
  descriptor: RequestLogDescriptor,
  run: () => Promise<TResult>,
): Promise<TResult> {
  const startedAt = ports.now();

  ports.info({
    module: descriptor.module,
    action: descriptor.action,
    message: `Starting Request: ${descriptor.requestId}`,
    context: descriptor.context,
  });

  const finish = (level: Level, outcome: string): void => {
    const duration = Math.round(ports.now() - startedAt);

    ports[level]({
      module: descriptor.module,
      action: descriptor.action,
      message: `Completed Request: ${descriptor.requestId} — ${outcome} in ${duration}ms`,
      context: descriptor.context,
    });
  };

  try {
    const result = await run();

    const statusCode = descriptor.statusCode();

    finish(levelForStatus(statusCode), statusCode === undefined ? "no status" : String(statusCode));

    return result;
  } catch (error) {
    // The throw is reported and then re-thrown untouched: this function
    // observes the request, it does not own its error handling.
    finish("error", `threw ${error instanceof Error ? error.name : typeof error}`);

    throw error;
  }
}
